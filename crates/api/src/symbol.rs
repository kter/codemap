use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use codemap_core::ExplanationLanguage;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::analyze::cache_key_symbol;
use crate::auth::{require_github_token, AppState};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SymbolExplanationRequest {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub path: String,
    pub symbol: String,
    pub source: String,
    #[serde(default)]
    pub context_files: Vec<ContextFile>,
    #[serde(default)]
    pub explanation_language: ExplanationLanguage,
}

#[derive(Deserialize)]
pub struct ContextFile {
    pub path: String,
    pub content: String,
}

#[derive(Serialize, Deserialize)]
pub struct SymbolExplanationResponse {
    pub symbol: String,
    pub explanation: String,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn symbol_explanation_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(req): Json<SymbolExplanationRequest>,
) -> Response {
    // 1. Auth
    if let Err(r) = require_github_token(&headers, &state).await {
        return r;
    }

    // 2. Validate symbol
    if req.symbol.is_empty() || req.symbol.len() > 200 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "symbol must be between 1 and 200 characters"})),
        )
            .into_response();
    }

    // 3. Cache key + DynamoDB lookup
    let lang_str = match req.explanation_language {
        ExplanationLanguage::Japanese => "ja",
        ExplanationLanguage::English => "en",
    };
    let key = cache_key_symbol(
        &req.owner,
        &req.repo,
        &req.git_ref,
        &req.path,
        &req.symbol,
        lang_str,
    );
    let cache_enabled = !state.cache_table.is_empty();
    if cache_enabled {
        match state.dynamo.get_cache(&state.cache_table, &key).await {
            Ok(Some(cached)) => {
                if let Ok(resp) = serde_json::from_str::<SymbolExplanationResponse>(&cached) {
                    return Json(resp).into_response();
                }
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(
                    "DynamoDB symbol cache lookup failed for {}: {e}",
                    req.symbol
                );
            }
        }
    }

    // 4. AI call
    let context: Vec<(&str, &str)> = req
        .context_files
        .iter()
        .map(|f| (f.path.as_str(), f.content.as_str()))
        .collect();

    match state
        .ai_client
        .explain_symbol(
            req.explanation_language,
            &req.path,
            &req.symbol,
            &req.source,
            &context,
        )
        .await
    {
        Ok(explanation) => {
            let resp = SymbolExplanationResponse {
                symbol: req.symbol,
                explanation,
            };
            // 5. Cache write
            if cache_enabled {
                if let Ok(json_str) = serde_json::to_string(&resp) {
                    if let Err(e) = state
                        .dynamo
                        .put_cache(&state.cache_table, &key, &json_str, 86400)
                        .await
                    {
                        tracing::warn!(
                            "Failed to cache symbol explanation for {}: {e}",
                            resp.symbol
                        );
                    }
                }
            }
            Json(resp).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("{e:#?}")})),
        )
            .into_response(),
    }
}
