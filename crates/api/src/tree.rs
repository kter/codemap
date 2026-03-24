use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use codemap_ai_client::{FileDescriptions, TokenUsage};
use codemap_core::{ExplanationLanguage, LanguageKind};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::analyze::{
    analyze_source_file, cache_key_ai_result, cache_key_file, cache_key_tree,
    fetch_file_from_github, fetch_tree_from_github, language_kind_for_path, AnnotatedHappyPath,
    AnnotatedInterface, GitHubTree,
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
    #[serde(default)]
    pub explanation_language: ExplanationLanguage,
}

#[derive(Serialize, Deserialize)]
pub struct TreeResponse {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub paths: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct FileResponse {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileExplanationKind {
    Structured,
    Summary,
}

#[derive(Serialize, Deserialize)]
pub struct FileExplanationResponse {
    pub path: String,
    pub kind: FileExplanationKind,
    #[serde(default)]
    pub overview: String,
    pub interfaces: Vec<AnnotatedInterface>,
    pub happy_paths: Vec<AnnotatedHappyPath>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<TokenUsage>,
}

#[derive(Serialize, Deserialize)]
struct FileSummaryCache {
    overview: String,
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
        match state.storage.get_cache(&state.cache_table, &tree_key).await {
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

    match load_file_content(&state, &req, &github_token).await {
        Some(content) => Json(FileResponse {
            path: req.path,
            content,
        })
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "file not found or not UTF-8"})),
        )
            .into_response(),
    }
}

pub async fn file_explanation_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(req): Query<FileQuery>,
) -> Response {
    let github_token = match require_github_token(&headers, &state).await {
        Ok(t) => t,
        Err(r) => return r,
    };

    let source = match load_file_content(&state, &req, &github_token).await {
        Some(content) => content,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "file not found or not UTF-8"})),
            )
                .into_response();
        }
    };

    let response = match language_kind_for_path(&req.path) {
        LanguageKind::TypeScript | LanguageKind::Python => {
            match build_structured_explanation(&state, &req, &source).await {
                Ok(response) => response,
                Err(message) => {
                    return (StatusCode::BAD_GATEWAY, Json(json!({ "error": message })))
                        .into_response();
                }
            }
        }
        _ => match build_summary_explanation(&state, &req, &source).await {
            Ok(response) => response,
            Err(message) => {
                return (StatusCode::BAD_GATEWAY, Json(json!({ "error": message })))
                    .into_response();
            }
        },
    };

    Json(response).into_response()
}

async fn load_file_content(
    state: &AppState,
    req: &FileQuery,
    github_token: &str,
) -> Option<String> {
    let cache_enabled = !state.cache_table.is_empty();
    let file_key = cache_key_file(&req.owner, &req.repo, &req.git_ref, &req.path);

    if cache_enabled {
        match state.storage.get_cache(&state.cache_table, &file_key).await {
            Ok(Some(content)) => return Some(content),
            Ok(None) => {}
            Err(e) => {
                tracing::warn!("DynamoDB file cache lookup failed for {}: {e}", req.path);
            }
        }
    }

    let content = fetch_file_from_github(
        state,
        &req.owner,
        &req.repo,
        &req.git_ref,
        &req.path,
        github_token,
    )
    .await?;

    if cache_enabled {
        if let Err(e) = state
            .storage
            .put_cache(&state.cache_table, &file_key, &content, 3600)
            .await
        {
            tracing::warn!("Failed to cache file {}: {e}", req.path);
        }
    }

    Some(content)
}

async fn build_structured_explanation(
    state: &AppState,
    req: &FileQuery,
    source: &str,
) -> Result<FileExplanationResponse, String> {
    let (analysis, functions) = analyze_source_file(&req.path, source)
        .map_err(|e| format!("failed to analyze source file: {e}"))?;

    let iface_pairs: Vec<(String, String)> = analysis
        .interfaces
        .iter()
        .map(|iface| (iface.name.as_str().to_string(), iface.signature.clone()))
        .collect();
    let fn_pairs: Vec<(String, String)> = functions
        .iter()
        .map(|function| (function.name.clone(), function.source_text.clone()))
        .collect();

    let cache_enabled = !state.cache_table.is_empty();
    let ai_key = format!(
        "{}:{}",
        cache_key_ai_result(&req.owner, &req.repo, &req.git_ref, &req.path),
        explanation_language_cache_key(req.explanation_language)
    );
    let cached_desc = if cache_enabled {
        match state.storage.get_cache(&state.cache_table, &ai_key).await {
            Ok(Some(json)) => serde_json::from_str::<FileDescriptions>(&json).ok(),
            Ok(None) => None,
            Err(e) => {
                tracing::warn!("DynamoDB AI cache lookup failed for {}: {e}", req.path);
                None
            }
        }
    } else {
        None
    };

    let (descriptions, token_usage) = match cached_desc {
        Some(desc) => (desc, None),
        None => {
            let (desc, usage) = state
                .ai_client
                .analyze_file(
                    analysis.language,
                    req.explanation_language,
                    &req.path,
                    source,
                    &iface_pairs,
                    &fn_pairs,
                )
                .await
                .map_err(|e| format!("AI analysis failed: {e}"))?;

            if cache_enabled {
                if let Ok(json_str) = serde_json::to_string(&desc) {
                    if let Err(e) = state
                        .storage
                        .put_cache(&state.cache_table, &ai_key, &json_str, 86400)
                        .await
                    {
                        tracing::warn!("Failed to cache AI result for {}: {e}", req.path);
                    }
                }
            }

            (desc, Some(usage))
        }
    };

    let interfaces = analysis
        .interfaces
        .iter()
        .map(|iface| {
            let description = descriptions
                .interfaces
                .iter()
                .find(|item| item.name == iface.name.as_str())
                .map(|item| item.description.clone())
                .unwrap_or_default();
            AnnotatedInterface {
                name: iface.name.as_str().to_string(),
                line: iface.line,
                signature: iface.signature.clone(),
                description,
            }
        })
        .collect();

    let happy_paths = functions
        .iter()
        .map(|function| {
            let summary = descriptions
                .functions
                .iter()
                .find(|item| item.name == function.name)
                .map(|item| item.summary.clone())
                .unwrap_or_default();
            AnnotatedHappyPath {
                name: function.name.clone(),
                line: function.line,
                summary,
            }
        })
        .collect();

    Ok(FileExplanationResponse {
        path: req.path.clone(),
        kind: FileExplanationKind::Structured,
        overview: descriptions.overview,
        interfaces,
        happy_paths,
        token_usage,
    })
}

async fn build_summary_explanation(
    state: &AppState,
    req: &FileQuery,
    source: &str,
) -> Result<FileExplanationResponse, String> {
    let cache_enabled = !state.cache_table.is_empty();
    let summary_key = format!(
        "ai-summary:{}/{}/{}:{}:{}",
        req.owner,
        req.repo,
        req.git_ref,
        req.path,
        explanation_language_cache_key(req.explanation_language)
    );

    let cached_summary = if cache_enabled {
        match state
            .storage
            .get_cache(&state.cache_table, &summary_key)
            .await
        {
            Ok(Some(json)) => serde_json::from_str::<FileSummaryCache>(&json).ok(),
            Ok(None) => None,
            Err(e) => {
                tracing::warn!("DynamoDB summary cache lookup failed for {}: {e}", req.path);
                None
            }
        }
    } else {
        None
    };

    let (overview, token_usage) = match cached_summary {
        Some(summary) => (summary.overview, None),
        None => {
            let (overview, usage) = state
                .ai_client
                .summarize_file(req.explanation_language, &req.path, source)
                .await
                .map_err(|e| format!("AI summary failed: {e}"))?;

            if cache_enabled {
                let json = serde_json::to_string(&FileSummaryCache {
                    overview: overview.clone(),
                })
                .map_err(|e| format!("failed to serialize summary cache: {e}"))?;
                if let Err(e) = state
                    .storage
                    .put_cache(&state.cache_table, &summary_key, &json, 86400)
                    .await
                {
                    tracing::warn!("Failed to cache summary for {}: {e}", req.path);
                }
            }

            (overview, Some(usage))
        }
    };

    Ok(FileExplanationResponse {
        path: req.path.clone(),
        kind: FileExplanationKind::Summary,
        overview,
        interfaces: Vec::new(),
        happy_paths: Vec::new(),
        token_usage,
    })
}

fn explanation_language_cache_key(language: ExplanationLanguage) -> &'static str {
    match language {
        ExplanationLanguage::English => "en",
        ExplanationLanguage::Japanese => "ja",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyze::{cache_key_ai_result, cache_key_file, cache_key_tree, GitHubTreeEntry};
    use crate::test_support::{
        auth_headers, response_json, session, test_state, FakeAiClient, FakeStorage,
    };
    use axum::extract::{Query, State};
    use codemap_ai_client::{FileDescriptions, FunctionSummary, InterfaceDescription, TokenUsage};
    use std::sync::Arc;

    fn repo_query() -> RepoQuery {
        RepoQuery {
            owner: "acme".to_string(),
            repo: "demo".to_string(),
            git_ref: "main".to_string(),
        }
    }

    fn file_query(path: &str, explanation_language: ExplanationLanguage) -> FileQuery {
        FileQuery {
            owner: "acme".to_string(),
            repo: "demo".to_string(),
            git_ref: "main".to_string(),
            path: path.to_string(),
            explanation_language,
        }
    }

    #[tokio::test]
    async fn tree_handler_returns_cached_tree_paths() {
        let session_id = "session-tree";
        let tree = GitHubTree {
            tree: vec![
                GitHubTreeEntry {
                    path: Some("src/user.ts".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("docs/guide.md".to_string()),
                    kind: Some("blob".to_string()),
                },
            ],
        };
        let storage = Arc::new(
            FakeStorage::new()
                .with_session("sessions", session(session_id))
                .with_cache(
                    "cache",
                    &cache_key_tree("acme", "demo", "main"),
                    &serde_json::to_string(&tree).unwrap(),
                ),
        );

        let response = tree_handler(
            auth_headers(session_id),
            State(test_state(storage, Arc::new(FakeAiClient::default()))),
            Query(repo_query()),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: TreeResponse = response_json(response).await;
        assert_eq!(body.paths, vec!["src/user.ts", "docs/guide.md"]);
    }

    #[tokio::test]
    async fn file_explanation_handler_uses_cached_structured_description() {
        let session_id = "session-structured";
        let query = file_query("src/user.ts", ExplanationLanguage::English);
        let storage = Arc::new(
            FakeStorage::new()
                .with_session("sessions", session(session_id))
                .with_cache(
                    "cache",
                    &cache_key_file("acme", "demo", "main", "src/user.ts"),
                    "export interface User { id: number }\nexport function createUser(): User { return { id: 1 }; }\n",
                )
                .with_cache(
                    "cache",
                    &format!(
                        "{}:en",
                        cache_key_ai_result("acme", "demo", "main", "src/user.ts")
                    ),
                    &serde_json::to_string(&FileDescriptions {
                        overview: "Cached overview".to_string(),
                        interfaces: vec![InterfaceDescription {
                            name: "User".to_string(),
                            description: "Cached interface".to_string(),
                        }],
                        functions: vec![FunctionSummary {
                            name: "createUser".to_string(),
                            summary: "Cached summary".to_string(),
                        }],
                    })
                    .unwrap(),
                ),
        );
        let ai = Arc::new(FakeAiClient::default());

        let response = file_explanation_handler(
            auth_headers(session_id),
            State(test_state(storage, ai.clone())),
            Query(query),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: FileExplanationResponse = response_json(response).await;
        assert_eq!(body.kind, FileExplanationKind::Structured);
        assert_eq!(body.overview, "Cached overview");
        assert_eq!(body.interfaces[0].description, "Cached interface");
        assert_eq!(body.happy_paths[0].summary, "Cached summary");
        assert!(body.token_usage.is_none());
        assert_eq!(ai.analyze_file_call_count(), 0);
    }

    #[tokio::test]
    async fn file_explanation_handler_generates_summary_and_caches_it() {
        let session_id = "session-summary";
        let query = file_query("docs/guide.md", ExplanationLanguage::Japanese);
        let storage = Arc::new(
            FakeStorage::new()
                .with_session("sessions", session(session_id))
                .with_cache(
                    "cache",
                    &cache_key_file("acme", "demo", "main", "docs/guide.md"),
                    "# Guide\nhello\n",
                ),
        );
        let ai = Arc::new(FakeAiClient::default());
        *ai.summarize_file_result.lock().unwrap() = Ok((
            "Japanese overview".to_string(),
            TokenUsage {
                input_tokens: 7,
                output_tokens: 11,
            },
        ));

        let response = file_explanation_handler(
            auth_headers(session_id),
            State(test_state(storage.clone(), ai.clone())),
            Query(query),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: FileExplanationResponse = response_json(response).await;
        assert_eq!(body.kind, FileExplanationKind::Summary);
        assert_eq!(body.overview, "Japanese overview");
        assert_eq!(body.token_usage.unwrap().output_tokens, 11);
        assert_eq!(ai.summarize_file_call_count(), 1);
        assert!(storage
            .cache_value("cache", "ai-summary:acme/demo/main:docs/guide.md:ja")
            .is_some());
    }
}
