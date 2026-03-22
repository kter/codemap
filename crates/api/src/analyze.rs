use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use codemap_analyzer_ts::TypeScriptAnalyzer;
use codemap_core::FilePath;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::{extract_cookie, AppState};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AnalyzeRequest {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
}

#[derive(Serialize, Deserialize)]
pub struct AnalyzeResponse {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub files: Vec<FileResult>,
}

#[derive(Serialize, Deserialize)]
pub struct FileResult {
    pub path: String,
    pub interfaces: Vec<AnnotatedInterface>,
    pub happy_paths: Vec<AnnotatedHappyPath>,
}

#[derive(Serialize, Deserialize)]
pub struct AnnotatedInterface {
    pub name: String,
    pub line: u32,
    pub signature: String,
    pub description: String,
}

#[derive(Serialize, Deserialize)]
pub struct AnnotatedHappyPath {
    pub name: String,
    pub line: u32,
    pub summary: String,
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GitHubTree {
    tree: Vec<GitHubTreeEntry>,
}

#[derive(Deserialize)]
struct GitHubTreeEntry {
    path: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Deserialize)]
struct GitHubContents {
    content: String,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn analyze_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(req): Json<AnalyzeRequest>,
) -> Response {
    // 1. Authenticate via session cookie.
    let session_id = match extract_cookie(&headers, "session_id") {
        Some(id) => id,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "not authenticated"})),
            )
                .into_response();
        }
    };

    let session = match state
        .dynamo
        .get_session(&state.sessions_table, &session_id)
        .await
    {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "session not found"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!("get_session failed: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "storage error"})),
            )
                .into_response();
        }
    };

    // 2. Check DSQL cache (skip GitHub/AI if result is fresh).
    if let Some(dsql) = &state.dsql {
        match dsql
            .get_cached_analysis(&req.owner, &req.repo, &req.git_ref)
            .await
        {
            Ok(Some(cached)) => match serde_json::from_value::<AnalyzeResponse>(cached) {
                Ok(resp) => return Json(resp).into_response(),
                Err(e) => tracing::warn!("Failed to deserialize cached analysis: {e}"),
            },
            Ok(None) => {}
            Err(e) => tracing::warn!("DSQL cache lookup failed: {e}"),
        }
    }

    let github_token = &session.github_access_token;

    // 3. Fetch repository file tree from GitHub.
    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        req.owner, req.repo, req.git_ref
    );

    let tree_resp = match state
        .http_client
        .get(&tree_url)
        .header("Authorization", format!("Bearer {github_token}"))
        .header("User-Agent", "codemap/1.0")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("GitHub tree request failed: {e}");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": "GitHub API request failed"})),
            )
                .into_response();
        }
    };

    if !tree_resp.status().is_success() {
        let status = tree_resp.status();
        let body = tree_resp.text().await.unwrap_or_default();
        tracing::error!("GitHub tree API returned {status}: {body}");
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "GitHub tree API error"})),
        )
            .into_response();
    }

    let tree: GitHubTree = match tree_resp.json().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to parse GitHub tree response: {e}");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": "invalid GitHub tree response"})),
            )
                .into_response();
        }
    };

    // 3. Filter to .ts/.tsx files, max 20.
    let ts_files: Vec<String> = tree
        .tree
        .into_iter()
        .filter(|entry| {
            entry.kind.as_deref() == Some("blob")
                && entry
                    .path
                    .as_deref()
                    .map(|p| p.ends_with(".ts") || p.ends_with(".tsx"))
                    .unwrap_or(false)
        })
        .filter_map(|entry| entry.path)
        .take(20)
        .collect();

    // 4. Process each file.
    let mut file_results: Vec<FileResult> = Vec::new();
    let analyzer = TypeScriptAnalyzer::new();

    for path in &ts_files {
        // a. Fetch file contents.
        let contents_url = format!(
            "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
            req.owner, req.repo, path, req.git_ref
        );

        let contents_resp = match state
            .http_client
            .get(&contents_url)
            .header("Authorization", format!("Bearer {github_token}"))
            .header("User-Agent", "codemap/1.0")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to fetch {path}: {e}");
                continue;
            }
        };

        let contents: GitHubContents = match contents_resp.json().await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Failed to parse contents for {path}: {e}");
                continue;
            }
        };

        let decoded = match BASE64.decode(contents.content.replace('\n', "")) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("Failed to base64-decode {path}: {e}");
                continue;
            }
        };

        let source = match String::from_utf8(decoded) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("Non-UTF8 file {path}: {e}");
                continue;
            }
        };

        // b. Run tree-sitter analysis.
        let file_path = FilePath::new(path.clone());
        let (analysis, exported_fns) = match analyzer.analyze_with_functions(file_path, &source) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Analysis failed for {path}: {e}");
                continue;
            }
        };

        // c. Call AI client.
        let iface_pairs: Vec<(String, String)> = analysis
            .interfaces
            .iter()
            .map(|i| (i.name.as_str().to_string(), i.signature.clone()))
            .collect();

        let fn_pairs: Vec<(String, String)> = exported_fns
            .iter()
            .map(|f| (f.name.clone(), f.source_text.clone()))
            .collect();

        let descriptions = match state
            .ai_client
            .analyze_file(path, &source, &iface_pairs, &fn_pairs)
            .await
        {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("AI analysis failed for {path}: {e}");
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({"error": "AI analysis failed"})),
                )
                    .into_response();
            }
        };

        // d. Assemble FileResult.
        let annotated_interfaces: Vec<AnnotatedInterface> = analysis
            .interfaces
            .iter()
            .map(|iface| {
                let description = descriptions
                    .interfaces
                    .iter()
                    .find(|d| d.name == iface.name.as_str())
                    .map(|d| d.description.clone())
                    .unwrap_or_default();
                AnnotatedInterface {
                    name: iface.name.as_str().to_string(),
                    line: iface.line,
                    signature: iface.signature.clone(),
                    description,
                }
            })
            .collect();

        let annotated_happy_paths: Vec<AnnotatedHappyPath> = exported_fns
            .iter()
            .map(|f| {
                let summary = descriptions
                    .functions
                    .iter()
                    .find(|s| s.name == f.name)
                    .map(|s| s.summary.clone())
                    .unwrap_or_default();
                AnnotatedHappyPath {
                    name: f.name.clone(),
                    line: f.line,
                    summary,
                }
            })
            .collect();

        file_results.push(FileResult {
            path: path.clone(),
            interfaces: annotated_interfaces,
            happy_paths: annotated_happy_paths,
        });
    }

    let response = AnalyzeResponse {
        owner: req.owner,
        repo: req.repo,
        git_ref: req.git_ref,
        files: file_results,
    };

    // Save to DSQL cache for future requests.
    if let Some(dsql) = &state.dsql {
        match serde_json::to_value(&response) {
            Ok(json) => {
                if let Err(e) = dsql
                    .save_analysis(
                        &response.owner,
                        &response.repo,
                        &response.git_ref,
                        session.github_user_id,
                        &json,
                    )
                    .await
                {
                    tracing::warn!("Failed to save analysis to DSQL: {e}");
                }
            }
            Err(e) => tracing::warn!("Failed to serialize analysis for DSQL: {e}"),
        }
    }

    Json(response).into_response()
}
