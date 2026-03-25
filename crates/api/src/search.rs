use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::analyze::{
    cache_key_file, cache_key_tree, fetch_file_from_github, fetch_tree_from_github, GitHubTree,
};
use crate::auth::{require_github_token, AppState};

const MAX_QUERY_LEN: usize = 200;
const MAX_FILES_TO_SEARCH: usize = 200;
const MAX_MATCHES: usize = 200;
const MAX_CONTENT_LEN: usize = 200;
const CONCURRENT_FILE_FETCHES: usize = 10;

const SEARCHABLE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "rb", "md", "txt", "json", "yaml", "yml",
    "toml", "sh", "css", "html", "xml", "c", "cpp", "h", "cs", "swift",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SearchParams {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub q: String,
    pub case_sensitive: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    pub content: String,
}

#[derive(Serialize, Deserialize)]
pub struct SearchResponse {
    pub matches: Vec<SearchMatch>,
    pub searched_files: u32,
    pub truncated: bool,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn search_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Response {
    // 1. Authenticate
    let github_token = match require_github_token(&headers, &state).await {
        Ok(t) => t,
        Err(r) => return r,
    };

    // 2. Validate query
    let q = params.q.trim().to_string();
    if q.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "q must not be empty"})),
        )
            .into_response();
    }
    if q.len() > MAX_QUERY_LEN {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "q exceeds maximum length"})),
        )
            .into_response();
    }

    let case_sensitive = params.case_sensitive.unwrap_or(false);
    let cache_enabled = !state.cache_table.is_empty();

    // 3. Fetch tree (with DynamoDB cache)
    let tree_key = cache_key_tree(&params.owner, &params.repo, &params.git_ref);
    let tree: GitHubTree = {
        let cached = if cache_enabled {
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

        if let Some(json_str) = cached {
            match serde_json::from_str::<GitHubTree>(&json_str) {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("Failed to deserialize cached tree: {e}");
                    match fetch_tree_from_github(
                        &state,
                        &params.owner,
                        &params.repo,
                        &params.git_ref,
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
                &params.owner,
                &params.repo,
                &params.git_ref,
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

    // 4. Filter to searchable blob entries
    let paths: Vec<String> = tree
        .tree
        .into_iter()
        .filter(|entry| entry.kind.as_deref() == Some("blob"))
        .filter_map(|entry| entry.path)
        .filter(|path| is_searchable_path(path))
        .take(MAX_FILES_TO_SEARCH)
        .collect();

    // 5. Fetch file contents concurrently (bounded by semaphore)
    let semaphore = Arc::new(Semaphore::new(CONCURRENT_FILE_FETCHES));
    let mut join_set: JoinSet<(String, Option<String>)> = JoinSet::new();

    for path in paths {
        let state_clone = state.clone();
        let token_clone = github_token.clone();
        let owner_clone = params.owner.clone();
        let repo_clone = params.repo.clone();
        let git_ref_clone = params.git_ref.clone();
        let sem_clone = semaphore.clone();

        join_set.spawn(async move {
            let _permit = sem_clone.acquire().await.unwrap();
            let file_key = cache_key_file(&owner_clone, &repo_clone, &git_ref_clone, &path);
            let cache_enabled = !state_clone.cache_table.is_empty();

            let content = if cache_enabled {
                match state_clone
                    .storage
                    .get_cache(&state_clone.cache_table, &file_key)
                    .await
                {
                    Ok(Some(s)) => Some(s),
                    Ok(None) => {
                        let fetched = fetch_file_from_github(
                            &state_clone,
                            &owner_clone,
                            &repo_clone,
                            &git_ref_clone,
                            &path,
                            &token_clone,
                        )
                        .await;
                        if let Some(ref s) = fetched {
                            if let Err(e) = state_clone
                                .storage
                                .put_cache(&state_clone.cache_table, &file_key, s, 3600)
                                .await
                            {
                                tracing::warn!("Failed to cache file {path}: {e}");
                            }
                        }
                        fetched
                    }
                    Err(e) => {
                        tracing::warn!("DynamoDB file cache lookup failed for {path}: {e}");
                        fetch_file_from_github(
                            &state_clone,
                            &owner_clone,
                            &repo_clone,
                            &git_ref_clone,
                            &path,
                            &token_clone,
                        )
                        .await
                    }
                }
            } else {
                fetch_file_from_github(
                    &state_clone,
                    &owner_clone,
                    &repo_clone,
                    &git_ref_clone,
                    &path,
                    &token_clone,
                )
                .await
            };

            (path, content)
        });
    }

    let mut file_contents: Vec<(String, String)> = Vec::new();
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((path, Some(content))) => file_contents.push((path, content)),
            Ok((_, None)) => {}
            Err(e) => tracing::warn!("File fetch task panicked: {e}"),
        }
    }

    // Sort by path for stable output
    file_contents.sort_by(|(a, _), (b, _)| a.cmp(b));

    // 6. Search each file, stop when MAX_MATCHES reached
    let searched_files = file_contents.len() as u32;
    let mut all_matches: Vec<SearchMatch> = Vec::new();
    let mut truncated = false;

    for (path, content) in &file_contents {
        if search_in_content(
            content,
            &q,
            case_sensitive,
            path,
            &mut all_matches,
            MAX_MATCHES,
        ) {
            truncated = true;
            break;
        }
    }

    Json(SearchResponse {
        matches: all_matches,
        searched_files,
        truncated,
    })
    .into_response()
}

// ---------------------------------------------------------------------------
// Pure helper (unit-testable)
// ---------------------------------------------------------------------------

pub(crate) fn search_in_content(
    content: &str,
    query: &str,
    case_sensitive: bool,
    path: &str,
    matches: &mut Vec<SearchMatch>,
    max_matches: usize,
) -> bool {
    let query_lower = if case_sensitive {
        String::new()
    } else {
        query.to_lowercase()
    };

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        let found = if case_sensitive {
            trimmed.contains(query)
        } else {
            trimmed.to_lowercase().contains(&query_lower)
        };

        if found {
            let content_str: String = trimmed.chars().take(MAX_CONTENT_LEN).collect();
            matches.push(SearchMatch {
                path: path.to_string(),
                line: (i + 1) as u32,
                content: content_str,
            });
            if matches.len() >= max_matches {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn is_searchable_path(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .map(|ext| SEARCHABLE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{search_in_content, SearchMatch};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use std::sync::Arc;
    use tower::ServiceExt;

    use crate::auth::AppState;
    use crate::test_support::{test_state, FakeAiClient, FakeStorage};

    fn empty_cache_state() -> AppState {
        let state = test_state(
            Arc::new(FakeStorage::new()),
            Arc::new(FakeAiClient::default()),
        );
        AppState {
            cache_table: String::new(),
            ..state
        }
    }

    #[tokio::test]
    async fn search_without_auth_returns_401() {
        let router = crate::app(empty_cache_state());
        let req = Request::builder()
            .uri("/search?owner=foo&repo=bar&git_ref=main&q=hello")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn search_with_missing_q_returns_400() {
        let router = crate::app(empty_cache_state());
        let req = Request::builder()
            .uri("/search?owner=foo&repo=bar&git_ref=main")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn search_with_empty_q_returns_400() {
        use crate::test_support::{session, FakeStorage};
        use axum::http::header;

        let session_id = "session-search-empty";
        let storage = Arc::new(FakeStorage::new().with_session("sessions", session(session_id)));
        let state = test_state(storage, Arc::new(FakeAiClient::default()));
        let router = crate::app(state);
        let req = Request::builder()
            .uri("/search?owner=foo&repo=bar&git_ref=main&q=")
            .header(header::COOKIE, format!("session_id={session_id}"))
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn search_with_long_q_returns_400() {
        use crate::test_support::{session, FakeStorage};
        use axum::http::header;

        let session_id = "session-search-long";
        let storage = Arc::new(FakeStorage::new().with_session("sessions", session(session_id)));
        let state = test_state(storage, Arc::new(FakeAiClient::default()));
        let router = crate::app(state);
        let long_q = "a".repeat(201);
        let req = Request::builder()
            .uri(&format!(
                "/search?owner=foo&repo=bar&git_ref=main&q={long_q}"
            ))
            .header(header::COOKIE, format!("session_id={session_id}"))
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn search_in_content_finds_matches() {
        let content = "fn main() {\n    println!(\"hello\");\n    let x = 1;\n}\n";
        let mut matches: Vec<SearchMatch> = Vec::new();
        let truncated =
            search_in_content(content, "println", true, "src/main.rs", &mut matches, 10);

        assert!(!truncated);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, "src/main.rs");
        assert_eq!(matches[0].line, 2);
        assert!(matches[0].content.contains("println"));
    }

    #[test]
    fn search_in_content_case_insensitive() {
        let content = "const FOO = 1;\nconst bar = 2;\n";
        let mut matches: Vec<SearchMatch> = Vec::new();
        let truncated = search_in_content(content, "foo", false, "src/lib.rs", &mut matches, 10);

        assert!(!truncated);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].line, 1);
        assert!(matches[0].content.to_lowercase().contains("foo"));
    }

    #[test]
    fn search_in_content_respects_max_matches() {
        let content = "foo\nfoo\nfoo\nfoo\nfoo\n";
        let mut matches: Vec<SearchMatch> = Vec::new();
        let truncated = search_in_content(content, "foo", true, "file.txt", &mut matches, 3);

        assert!(truncated);
        assert_eq!(matches.len(), 3);
    }
}
