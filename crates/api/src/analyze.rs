use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use codemap_ai_client::{FileDescriptions, TokenUsage};
use codemap_analyzer::AnalysisResult;
use codemap_analyzer_py::PythonAnalyzer;
use codemap_analyzer_ts::TypeScriptAnalyzer;
use codemap_core::{ExplanationLanguage, FilePath, LanguageKind};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<TokenUsage>,
}

#[derive(Serialize, Deserialize)]
pub struct FileResult {
    pub path: String,
    #[serde(default)]
    pub source_code: String,
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

pub(crate) struct FunctionDocInput {
    pub(crate) name: String,
    pub(crate) line: u32,
    pub(crate) source_text: String,
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

#[derive(Deserialize, Serialize)]
pub(crate) struct GitHubTree {
    pub(crate) tree: Vec<GitHubTreeEntry>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct GitHubTreeEntry {
    pub(crate) path: Option<String>,
    #[serde(rename = "type")]
    pub(crate) kind: Option<String>,
}

#[derive(Deserialize)]
struct GitHubContents {
    content: String,
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

pub(crate) fn cache_key_analysis(owner: &str, repo: &str, git_ref: &str) -> String {
    format!("analysis:{owner}/{repo}:{git_ref}")
}

pub(crate) fn cache_key_tree(owner: &str, repo: &str, git_ref: &str) -> String {
    format!("tree:{owner}/{repo}:{git_ref}")
}

pub(crate) fn cache_key_file(owner: &str, repo: &str, git_ref: &str, path: &str) -> String {
    format!("file:{owner}/{repo}:{git_ref}:{path}")
}

pub(crate) fn cache_key_ai_result(owner: &str, repo: &str, git_ref: &str, path: &str) -> String {
    format!("ai:{owner}/{repo}:{git_ref}:{path}")
}

pub(crate) fn cache_key_symbol(
    owner: &str,
    repo: &str,
    git_ref: &str,
    path: &str,
    symbol: &str,
    lang: &str,
) -> String {
    format!("symbol:{owner}/{repo}:{git_ref}:{path}:{symbol}:{lang}")
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
        Some(id) if !id.is_empty() => id,
        _ => {
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

    let cache_enabled = !state.cache_table.is_empty();

    // 2. Check DynamoDB cache for a complete analysis result.
    if cache_enabled {
        let key = cache_key_analysis(&req.owner, &req.repo, &req.git_ref);
        match state.dynamo.get_cache(&state.cache_table, &key).await {
            Ok(Some(cached)) => match serde_json::from_str::<AnalyzeResponse>(&cached) {
                Ok(resp) => return Json(resp).into_response(),
                Err(e) => tracing::warn!("Failed to deserialize cached analysis: {e}"),
            },
            Ok(None) => {}
            Err(e) => tracing::warn!("DynamoDB cache lookup failed: {e}"),
        }
    }

    let github_token = &session.github_access_token;

    // 3. Fetch repository file tree from GitHub (with DynamoDB cache).
    let tree: GitHubTree = {
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

        if let Some(json_str) = cached_tree {
            match serde_json::from_str::<GitHubTree>(&json_str) {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("Failed to deserialize cached tree: {e}");
                    match fetch_tree_from_github(
                        &state,
                        &req.owner,
                        &req.repo,
                        &req.git_ref,
                        github_token,
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
                github_token,
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

    // 4. Filter to supported source files, max 5.
    let source_files = collect_supported_files(tree);

    // 5. Process each file.
    let mut file_results: Vec<FileResult> = Vec::new();
    let mut total_usage = TokenUsage::default();

    for path in &source_files {
        // a. Fetch file contents (with DynamoDB cache).
        let source = {
            let file_key = cache_key_file(&req.owner, &req.repo, &req.git_ref, path);
            let cached_source = if cache_enabled {
                match state.dynamo.get_cache(&state.cache_table, &file_key).await {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!("DynamoDB file cache lookup failed for {path}: {e}");
                        None
                    }
                }
            } else {
                None
            };

            if let Some(s) = cached_source {
                s
            } else {
                match fetch_file_from_github(
                    &state,
                    &req.owner,
                    &req.repo,
                    &req.git_ref,
                    path,
                    github_token,
                )
                .await
                {
                    Some(s) => {
                        if cache_enabled {
                            let file_key =
                                cache_key_file(&req.owner, &req.repo, &req.git_ref, path);
                            if let Err(e) = state
                                .dynamo
                                .put_cache(&state.cache_table, &file_key, &s, 3600)
                                .await
                            {
                                tracing::warn!("Failed to cache file {path}: {e}");
                            }
                        }
                        s
                    }
                    None => continue,
                }
            }
        };

        // b. Run tree-sitter analysis.
        let (analysis, functions) = match analyze_source_file(path, &source) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Analysis failed for {path}: {e}");
                continue;
            }
        };

        // c. Call AI client (with DynamoDB cache).
        let iface_pairs: Vec<(String, String)> = analysis
            .interfaces
            .iter()
            .map(|i| (i.name.as_str().to_string(), i.signature.clone()))
            .collect();

        let fn_pairs: Vec<(String, String)> = functions
            .iter()
            .map(|f| (f.name.clone(), f.source_text.clone()))
            .collect();

        let ai_key = cache_key_ai_result(&req.owner, &req.repo, &req.git_ref, path);
        let cached_desc = if cache_enabled {
            match state.dynamo.get_cache(&state.cache_table, &ai_key).await {
                Ok(Some(json)) => serde_json::from_str::<FileDescriptions>(&json).ok(),
                _ => None,
            }
        } else {
            None
        };
        let descriptions = match cached_desc {
            Some(desc) => desc,
            None => {
                let (desc, usage) = match state
                    .ai_client
                    .analyze_file(
                        analysis.language,
                        ExplanationLanguage::English,
                        path,
                        &source,
                        &iface_pairs,
                        &fn_pairs,
                    )
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
                total_usage.input_tokens += usage.input_tokens;
                total_usage.output_tokens += usage.output_tokens;
                if cache_enabled {
                    if let Ok(json_str) = serde_json::to_string(&desc) {
                        if let Err(e) = state
                            .dynamo
                            .put_cache(&state.cache_table, &ai_key, &json_str, 86400)
                            .await
                        {
                            tracing::warn!("Failed to cache AI result for {path}: {e}");
                        }
                    }
                }
                desc
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

        let annotated_happy_paths: Vec<AnnotatedHappyPath> = functions
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
            source_code: source.clone(),
            interfaces: annotated_interfaces,
            happy_paths: annotated_happy_paths,
        });
    }

    let response = AnalyzeResponse {
        owner: req.owner,
        repo: req.repo,
        git_ref: req.git_ref,
        files: file_results,
        token_usage: if total_usage.input_tokens > 0 || total_usage.output_tokens > 0 {
            Some(total_usage)
        } else {
            None
        },
    };

    // 6. Save complete analysis result to DynamoDB cache (24h TTL).
    // Strip source_code and token_usage to keep the item well under DynamoDB's 400KB limit
    // and to avoid replaying token counts on cache hits.
    if cache_enabled {
        if let Ok(mut cache_val) = serde_json::to_value(&response) {
            if let Some(obj) = cache_val.as_object_mut() {
                if let Some(files) = obj.get_mut("files").and_then(|f| f.as_array_mut()) {
                    for file in files.iter_mut() {
                        if let Some(file_obj) = file.as_object_mut() {
                            file_obj.insert(
                                "source_code".to_string(),
                                serde_json::Value::String(String::new()),
                            );
                        }
                    }
                }
                obj.remove("token_usage");
            }
            if let Ok(json_str) = serde_json::to_string(&cache_val) {
                let key = cache_key_analysis(&response.owner, &response.repo, &response.git_ref);
                if let Err(e) = state
                    .dynamo
                    .put_cache(&state.cache_table, &key, &json_str, 86400)
                    .await
                {
                    tracing::warn!("Failed to save analysis to DynamoDB cache: {e}");
                }
            }
        }
    }

    Json(response).into_response()
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

pub(crate) async fn fetch_tree_from_github(
    state: &AppState,
    owner: &str,
    repo: &str,
    git_ref: &str,
    github_token: &str,
    tree_cache_key: &str,
    cache_enabled: bool,
) -> Result<GitHubTree, Response> {
    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        owner, repo, git_ref
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
            return Err((
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": "GitHub API request failed"})),
            )
                .into_response());
        }
    };

    if !tree_resp.status().is_success() {
        let status = tree_resp.status();
        let body = tree_resp.text().await.unwrap_or_default();
        tracing::error!("GitHub tree API returned {status}: {body}");
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "GitHub tree API error"})),
        )
            .into_response());
    }

    let tree: GitHubTree = match tree_resp.json().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to parse GitHub tree response: {e}");
            return Err((
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": "invalid GitHub tree response"})),
            )
                .into_response());
        }
    };

    if cache_enabled {
        if let Ok(json_str) = serde_json::to_string(&tree) {
            if let Err(e) = state
                .dynamo
                .put_cache(&state.cache_table, tree_cache_key, &json_str, 3600)
                .await
            {
                tracing::warn!("Failed to cache tree: {e}");
            }
        }
    }

    Ok(tree)
}

pub(crate) async fn fetch_file_from_github(
    state: &AppState,
    owner: &str,
    repo: &str,
    git_ref: &str,
    path: &str,
    github_token: &str,
) -> Option<String> {
    let contents_url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
        owner, repo, path, git_ref
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
            return None;
        }
    };

    let contents: GitHubContents = match contents_resp.json().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to parse contents for {path}: {e}");
            return None;
        }
    };

    let decoded = match BASE64.decode(contents.content.replace('\n', "")) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("Failed to base64-decode {path}: {e}");
            return None;
        }
    };

    match String::from_utf8(decoded) {
        Ok(s) => Some(s),
        Err(e) => {
            tracing::warn!("Non-UTF8 file {path}: {e}");
            None
        }
    }
}

fn collect_supported_files(tree: GitHubTree) -> Vec<String> {
    tree.tree
        .into_iter()
        .filter(|entry| entry.kind.as_deref() == Some("blob"))
        .filter_map(|entry| entry.path)
        .filter(|path| is_supported_analysis_path(path))
        .take(5)
        .collect()
}

fn is_supported_analysis_path(path: &str) -> bool {
    matches!(
        language_kind_for_path(path),
        LanguageKind::TypeScript | LanguageKind::Python
    )
}

pub(crate) fn language_kind_for_path(path: &str) -> LanguageKind {
    path.rsplit('.')
        .next()
        .map(LanguageKind::from_extension)
        .unwrap_or(LanguageKind::Unknown)
}

pub(crate) fn analyze_source_file(
    path: &str,
    source: &str,
) -> Result<(AnalysisResult, Vec<FunctionDocInput>), String> {
    let file_path = FilePath::new(path.to_string());

    match language_kind_for_path(path) {
        LanguageKind::TypeScript => {
            let analyzer = TypeScriptAnalyzer::new();
            let (result, functions) = analyzer
                .analyze_with_functions(file_path, source)
                .map_err(|err| err.to_string())?;
            Ok((
                result,
                functions
                    .into_iter()
                    .map(|function| FunctionDocInput {
                        name: function.name,
                        line: function.line,
                        source_text: function.source_text,
                    })
                    .collect(),
            ))
        }
        LanguageKind::Python => {
            let analyzer = PythonAnalyzer::new();
            let (result, functions) = analyzer
                .analyze_with_functions(file_path, source)
                .map_err(|err| err.to_string())?;
            Ok((
                result,
                functions
                    .into_iter()
                    .map(|function| FunctionDocInput {
                        name: function.name,
                        line: function.line,
                        source_text: function.source_text,
                    })
                    .collect(),
            ))
        }
        other => Err(format!("unsupported language: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{
        analyze_source_file, cache_key_ai_result, cache_key_analysis, cache_key_file,
        cache_key_symbol, cache_key_tree, collect_supported_files, is_supported_analysis_path,
        GitHubTree, GitHubTreeEntry,
    };
    use codemap_core::LanguageKind;

    #[test]
    fn cache_key_analysis_format() {
        assert_eq!(
            cache_key_analysis("owner", "repo", "main"),
            "analysis:owner/repo:main"
        );
    }

    #[test]
    fn cache_key_analysis_with_sha() {
        assert_eq!(
            cache_key_analysis("acme", "myrepo", "abc1234"),
            "analysis:acme/myrepo:abc1234"
        );
    }

    #[test]
    fn cache_key_tree_format() {
        assert_eq!(
            cache_key_tree("owner", "repo", "main"),
            "tree:owner/repo:main"
        );
    }

    #[test]
    fn cache_key_file_format() {
        assert_eq!(
            cache_key_file("owner", "repo", "main", "src/index.ts"),
            "file:owner/repo:main:src/index.ts"
        );
    }

    #[test]
    fn cache_key_file_nested_path() {
        assert_eq!(
            cache_key_file("o", "r", "v1.0.0", "a/b/c.tsx"),
            "file:o/r:v1.0.0:a/b/c.tsx"
        );
    }

    #[test]
    fn cache_key_ai_result_format() {
        assert_eq!(
            cache_key_ai_result("owner", "repo", "main", "src/index.ts"),
            "ai:owner/repo:main:src/index.ts"
        );
    }

    #[test]
    fn cache_key_symbol_format() {
        assert_eq!(
            cache_key_symbol("owner", "repo", "main", "src/index.ts", "MyType", "en"),
            "symbol:owner/repo:main:src/index.ts:MyType:en"
        );
    }

    #[test]
    fn supported_analysis_paths_include_python() {
        assert!(is_supported_analysis_path("src/main.py"));
        assert!(is_supported_analysis_path("src/index.ts"));
        assert!(!is_supported_analysis_path("src/main.rs"));
    }

    #[test]
    fn collect_supported_files_keeps_combined_cap() {
        let tree = GitHubTree {
            tree: vec![
                GitHubTreeEntry {
                    path: Some("a.ts".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("b.py".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("c.tsx".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("d.py".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("e.ts".to_string()),
                    kind: Some("blob".to_string()),
                },
                GitHubTreeEntry {
                    path: Some("f.py".to_string()),
                    kind: Some("blob".to_string()),
                },
            ],
        };

        assert_eq!(
            collect_supported_files(tree),
            vec!["a.ts", "b.py", "c.tsx", "d.py", "e.ts"]
        );
    }

    #[test]
    fn analyze_source_file_dispatches_to_python() {
        let (analysis, functions) = analyze_source_file(
            "src/service.py",
            "class User:\n    pass\n\ndef run():\n    return User()\n",
        )
        .unwrap();

        assert_eq!(analysis.language, LanguageKind::Python);
        assert_eq!(analysis.interfaces.len(), 1);
        assert_eq!(functions.len(), 1);
        assert_eq!(functions[0].name, "run");
    }
}
