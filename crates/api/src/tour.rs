use std::hash::{Hash, Hasher};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use codemap_ai_client::TokenUsage;
use codemap_core::ExplanationLanguage;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::analyze::{
    cache_key_file, cache_key_tour, cache_key_tree, fetch_file_from_github, fetch_tree_from_github,
    GitHubTree,
};
use crate::auth::{require_github_token, AppState};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TourRequest {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub query: String,
    #[serde(default)]
    pub explanation_language: ExplanationLanguage,
}

#[derive(Serialize, Deserialize)]
pub struct TourResponse {
    pub query: String,
    pub title: String,
    pub stops: Vec<TourStopResponse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<TokenUsage>,
}

#[derive(Serialize, Deserialize)]
pub struct TourStopResponse {
    pub file_path: String,
    pub line_start: u32,
    pub line_end: u32,
    pub explanation: String,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn tour_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(req): Json<TourRequest>,
) -> Response {
    // 1. Auth
    let github_token = match require_github_token(&headers, &state).await {
        Ok(t) => t,
        Err(r) => return r,
    };

    // 2. Validate query
    if req.query.is_empty() || req.query.len() > 500 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "query must be between 1 and 500 characters"})),
        )
            .into_response();
    }

    // 3. Cache lookup
    let lang_str = match req.explanation_language {
        ExplanationLanguage::Japanese => "ja",
        ExplanationLanguage::English => "en",
    };
    let query_hash = hash_query(&req.query);
    let cache_key = cache_key_tour(&req.owner, &req.repo, &req.git_ref, &query_hash, lang_str);
    let cache_enabled = !state.cache_table.is_empty();

    if cache_enabled {
        match state
            .storage
            .get_cache(&state.cache_table, &cache_key)
            .await
        {
            Ok(Some(cached)) => {
                if let Ok(resp) = serde_json::from_str::<TourResponse>(&cached) {
                    return Json(resp).into_response();
                }
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!("DynamoDB tour cache lookup failed: {e}");
            }
        }
    }

    // 4. Fetch tree
    let tree_key = cache_key_tree(&req.owner, &req.repo, &req.git_ref);
    let tree: GitHubTree = {
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

        if let Some(json_str) = cached_tree {
            match serde_json::from_str::<GitHubTree>(&json_str) {
                Ok(t) => t,
                Err(_) => {
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
        }
    };

    // 5. Select relevant files
    let source_paths = select_relevant_files(&tree, &req.query);

    if source_paths.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "no source files found in repository"})),
        )
            .into_response();
    }

    // 6. Fetch file contents
    let mut file_contents: Vec<(String, String)> = Vec::new();
    for path in &source_paths {
        let file_key = cache_key_file(&req.owner, &req.repo, &req.git_ref, path);
        let content = if cache_enabled {
            match state.storage.get_cache(&state.cache_table, &file_key).await {
                Ok(Some(c)) => Some(c),
                _ => None,
            }
        } else {
            None
        };

        let content = match content {
            Some(c) => c,
            None => {
                match fetch_file_from_github(
                    &state,
                    &req.owner,
                    &req.repo,
                    &req.git_ref,
                    path,
                    &github_token,
                )
                .await
                {
                    Some(c) => {
                        if cache_enabled {
                            let _ = state
                                .storage
                                .put_cache(&state.cache_table, &file_key, &c, 3600)
                                .await;
                        }
                        c
                    }
                    None => continue,
                }
            }
        };

        file_contents.push((path.clone(), content));
    }

    if file_contents.is_empty() {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "failed to fetch any source files"})),
        )
            .into_response();
    }

    // 7. Build AI request
    let files_for_ai: Vec<(&str, &str)> = file_contents
        .iter()
        .map(|(p, c)| (p.as_str(), c.as_str()))
        .collect();

    let (tour_result, usage) = match state
        .ai_client
        .generate_tour(req.explanation_language, &req.query, &files_for_ai)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("AI tour generation failed: {e}");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": "AI tour generation failed"})),
            )
                .into_response();
        }
    };

    // 8. Validate and clamp stops
    let valid_paths: std::collections::HashSet<&str> =
        file_contents.iter().map(|(p, _)| p.as_str()).collect();
    let line_counts: std::collections::HashMap<&str, u32> = file_contents
        .iter()
        .map(|(p, c)| (p.as_str(), c.lines().count() as u32))
        .collect();

    let stops: Vec<TourStopResponse> = tour_result
        .stops
        .into_iter()
        .filter(|s| valid_paths.contains(s.file_path.as_str()))
        .map(|s| {
            let max_line = line_counts
                .get(s.file_path.as_str())
                .copied()
                .unwrap_or(1)
                .max(1);
            let line_start = s.line_start.max(1).min(max_line);
            let line_end = s.line_end.max(line_start).min(max_line);
            TourStopResponse {
                file_path: s.file_path,
                line_start,
                line_end,
                explanation: s.explanation,
            }
        })
        .collect();

    let response = TourResponse {
        query: req.query,
        title: tour_result.title,
        stops,
        token_usage: Some(usage),
    };

    // 9. Cache write (without token_usage)
    if cache_enabled {
        let cacheable = TourResponse {
            query: response.query.clone(),
            title: response.title.clone(),
            stops: response
                .stops
                .iter()
                .map(|s| TourStopResponse {
                    file_path: s.file_path.clone(),
                    line_start: s.line_start,
                    line_end: s.line_end,
                    explanation: s.explanation.clone(),
                })
                .collect(),
            token_usage: None,
        };
        if let Ok(json_str) = serde_json::to_string(&cacheable) {
            if let Err(e) = state
                .storage
                .put_cache(&state.cache_table, &cache_key, &json_str, 86400)
                .await
            {
                tracing::warn!("Failed to cache tour result: {e}");
            }
        }
    }

    Json(response).into_response()
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const TOUR_SOURCE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb", "c", "cpp", "h", "hpp", "cs",
    "swift", "kt", "scala", "ex", "exs",
];

fn is_tour_source_file(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .map(|ext| TOUR_SOURCE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

fn select_relevant_files(tree: &GitHubTree, query: &str) -> Vec<String> {
    let keywords: Vec<String> = query
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() >= 2)
        .collect();

    let mut scored: Vec<(String, usize)> = tree
        .tree
        .iter()
        .filter(|entry| entry.kind.as_deref() == Some("blob"))
        .filter_map(|entry| entry.path.as_ref())
        .filter(|path| is_tour_source_file(path))
        .map(|path| {
            let lower = path.to_lowercase();
            let score = keywords
                .iter()
                .filter(|kw| lower.contains(kw.as_str()))
                .count();
            (path.clone(), score)
        })
        .collect();

    // Sort by score descending, then alphabetically for stable ordering
    scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    scored.into_iter().take(15).map(|(path, _)| path).collect()
}

fn hash_query(query: &str) -> String {
    let mut hasher = std::hash::DefaultHasher::new();
    query.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyze::GitHubTreeEntry;
    use crate::analyze::{cache_key_file, cache_key_tree};
    use crate::test_support::{
        auth_headers, response_json, session, test_state, FakeAiClient, FakeStorage,
    };
    use axum::{extract::State, Json};
    use codemap_ai_client::{TokenUsage, TourResult, TourStop};
    use std::sync::Arc;

    #[test]
    fn is_tour_source_file_accepts_common_extensions() {
        assert!(is_tour_source_file("src/auth.ts"));
        assert!(is_tour_source_file("main.py"));
        assert!(is_tour_source_file("lib.rs"));
        assert!(is_tour_source_file("app/page.tsx"));
        assert!(is_tour_source_file("index.js"));
        assert!(is_tour_source_file("handler.go"));
    }

    #[test]
    fn is_tour_source_file_rejects_non_source() {
        assert!(!is_tour_source_file("README.md"));
        assert!(!is_tour_source_file("package.json"));
        assert!(!is_tour_source_file("styles.css"));
        assert!(!is_tour_source_file("image.png"));
    }

    #[test]
    fn select_relevant_files_scores_by_keywords() {
        let tree = GitHubTree {
            tree: vec![
                GitHubTreeEntry {
                    path: Some("src/auth/login.ts".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("src/utils/helpers.ts".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("src/auth/oauth.ts".to_string()),
                    kind: Some("blob".to_string()),
                },
            ],
        };

        let result = select_relevant_files(&tree, "auth login flow");
        // auth/login.ts should score highest (matches "auth" and "login")
        assert_eq!(result[0], "src/auth/login.ts");
        // auth/oauth.ts should score next (matches "auth")
        assert_eq!(result[1], "src/auth/oauth.ts");
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn select_relevant_files_limits_to_15() {
        let entries: Vec<GitHubTreeEntry> = (0..30)
            .map(|i| GitHubTreeEntry {
                path: Some(format!("src/file_{i}.ts")),
                kind: Some("blob".to_string()),
            })
            .collect();
        let tree = GitHubTree { tree: entries };
        let result = select_relevant_files(&tree, "test");
        assert_eq!(result.len(), 15);
    }

    #[test]
    fn hash_query_is_deterministic() {
        let h1 = hash_query("explain auth flow");
        let h2 = hash_query("explain auth flow");
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_query_differs_for_different_input() {
        let h1 = hash_query("auth flow");
        let h2 = hash_query("database queries");
        assert_ne!(h1, h2);
    }

    #[tokio::test]
    async fn tour_handler_clamps_lines_and_filters_unknown_paths() {
        let session_id = "session-tour";
        let req = TourRequest {
            owner: "acme".to_string(),
            repo: "demo".to_string(),
            git_ref: "main".to_string(),
            query: "auth flow".to_string(),
            explanation_language: ExplanationLanguage::English,
        };
        let tree = GitHubTree {
            tree: vec![GitHubTreeEntry {
                path: Some("src/auth.ts".to_string()),
                kind: Some("blob".to_string()),
            }],
        };
        let storage = Arc::new(
            FakeStorage::new()
                .with_session("sessions", session(session_id))
                .with_cache(
                    "cache",
                    &cache_key_tree("acme", "demo", "main"),
                    &serde_json::to_string(&tree).unwrap(),
                )
                .with_cache(
                    "cache",
                    &cache_key_file("acme", "demo", "main", "src/auth.ts"),
                    "line1\nline2\nline3\n",
                ),
        );
        let ai = Arc::new(FakeAiClient::default());
        *ai.generate_tour_result.lock().unwrap() = Ok((
            TourResult {
                title: "Auth tour".to_string(),
                stops: vec![
                    TourStop {
                        file_path: "src/auth.ts".to_string(),
                        line_start: 0,
                        line_end: 99,
                        explanation: "valid".to_string(),
                    },
                    TourStop {
                        file_path: "src/missing.ts".to_string(),
                        line_start: 1,
                        line_end: 2,
                        explanation: "drop".to_string(),
                    },
                ],
            },
            TokenUsage {
                input_tokens: 5,
                output_tokens: 8,
            },
        ));

        let response = tour_handler(
            auth_headers(session_id),
            State(test_state(storage, ai.clone())),
            Json(req),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: TourResponse = response_json(response).await;
        assert_eq!(body.title, "Auth tour");
        assert_eq!(body.stops.len(), 1);
        assert_eq!(body.stops[0].line_start, 1);
        assert_eq!(body.stops[0].line_end, 3);
        assert_eq!(body.token_usage.unwrap().output_tokens, 8);
        assert_eq!(ai.generate_tour_call_count(), 1);
    }
}
