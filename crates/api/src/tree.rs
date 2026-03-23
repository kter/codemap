use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::analyze::{
    cache_key_file, cache_key_tree, fetch_file_from_github, fetch_tree_from_github, GitHubTree,
};
use crate::auth::{require_github_token, AppState};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RepoQuery {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
}

#[derive(Deserialize)]
pub struct FileQuery {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct TreeResponse {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub paths: Vec<String>,
}

#[derive(Serialize)]
pub struct FileResponse {
    pub path: String,
    pub content: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn tree_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(req): Query<RepoQuery>,
) -> Response {
    let github_token = match require_github_token(&headers, &state).await {
        Ok(t) => t,
        Err(r) => return r,
    };

    let cache_enabled = !state.cache_table.is_empty();
    let tree_key = cache_key_tree(&req.owner, &req.repo, &req.git_ref);

    let cached_tree = if cache_enabled {
        match state.dynamo.get_cache(&state.cache_table, &tree_key).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("DynamoDB tree cache lookup failed: {e}");
                None
            }
        }
    } else {
        None
    };

    let tree = if let Some(json_str) = cached_tree {
        match serde_json::from_str::<GitHubTree>(&json_str) {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("Failed to deserialize cached tree: {e}");
                match fetch_tree_from_github(
                    &state,
                    &req.owner,
                    &req.repo,
                    &req.git_ref,
                    &github_token,
                    &tree_key,
                    cache_enabled,
                )
                .await
                {
                    Ok(t) => t,
                    Err(r) => return r,
                }
            }
        }
    } else {
        match fetch_tree_from_github(
            &state,
            &req.owner,
            &req.repo,
            &req.git_ref,
            &github_token,
            &tree_key,
            cache_enabled,
        )
        .await
        {
            Ok(t) => t,
            Err(r) => return r,
        }
    };

    let paths: Vec<String> = tree
        .tree
        .into_iter()
        .filter(|entry| entry.kind.as_deref() == Some("blob"))
        .filter_map(|entry| entry.path)
        .collect();

    Json(TreeResponse {
        owner: req.owner,
        repo: req.repo,
        git_ref: req.git_ref,
        paths,
    })
    .into_response()
}

pub async fn file_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(req): Query<FileQuery>,
) -> Response {
    let github_token = match require_github_token(&headers, &state).await {
        Ok(t) => t,
        Err(r) => return r,
    };

    let cache_enabled = !state.cache_table.is_empty();
    let file_key = cache_key_file(&req.owner, &req.repo, &req.git_ref, &req.path);

    if cache_enabled {
        match state.dynamo.get_cache(&state.cache_table, &file_key).await {
            Ok(Some(content)) => {
                return Json(FileResponse {
                    path: req.path,
                    content,
                })
                .into_response();
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!("DynamoDB file cache lookup failed for {}: {e}", req.path);
            }
        }
    }

    match fetch_file_from_github(
        &state,
        &req.owner,
        &req.repo,
        &req.git_ref,
        &req.path,
        &github_token,
    )
    .await
    {
        Some(content) => {
            if cache_enabled {
                if let Err(e) = state
                    .dynamo
                    .put_cache(&state.cache_table, &file_key, &content, 3600)
                    .await
                {
                    tracing::warn!("Failed to cache file {}: {e}", req.path);
                }
            }
            Json(FileResponse {
                path: req.path,
                content,
            })
            .into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "file not found or not UTF-8"})),
        )
            .into_response(),
    }
}
