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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<TokenUsage>,
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
        match state.storage.get_cache(&state.cache_table, &key).await {
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
        Ok((explanation, usage)) => {
            // 5. Cache write — store without token_usage so cache hits return None.
            if cache_enabled {
                let cacheable = SymbolExplanationResponse {
                    symbol: req.symbol.clone(),
                    explanation: explanation.clone(),
                    token_usage: None,
                };
                if let Ok(json_str) = serde_json::to_string(&cacheable) {
                    if let Err(e) = state
                        .storage
                        .put_cache(&state.cache_table, &key, &json_str, 86400)
                        .await
                    {
                        tracing::warn!(
                            "Failed to cache symbol explanation for {}: {e}",
                            req.symbol
                        );
                    }
                }
            }
            Json(SymbolExplanationResponse {
                symbol: req.symbol,
                explanation,
                token_usage: Some(usage),
            })
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("{e:#?}")})),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyze::cache_key_symbol;
    use crate::test_support::{
        auth_headers, response_json, session, test_state, FakeAiClient, FakeStorage,
    };
    use axum::{extract::State, Json};
    use codemap_ai_client::TokenUsage;
    use std::sync::Arc;

    fn request(
        symbol: &str,
        explanation_language: ExplanationLanguage,
    ) -> SymbolExplanationRequest {
        SymbolExplanationRequest {
            owner: "acme".to_string(),
            repo: "demo".to_string(),
            git_ref: "main".to_string(),
            path: "src/user.ts".to_string(),
            symbol: symbol.to_string(),
            source: "export interface User { id: number }".to_string(),
            context_files: Vec::new(),
            explanation_language,
        }
    }

    #[tokio::test]
    async fn symbol_explanation_handler_returns_cached_response() {
        let session_id = "session-symbol-cache";
        let storage = Arc::new(
            FakeStorage::new()
                .with_session("sessions", session(session_id))
                .with_cache(
                    "cache",
                    &cache_key_symbol("acme", "demo", "main", "src/user.ts", "User", "en"),
                    &serde_json::to_string(&SymbolExplanationResponse {
                        symbol: "User".to_string(),
                        explanation: "Cached symbol".to_string(),
                        token_usage: None,
                    })
                    .unwrap(),
                ),
        );
        let ai = Arc::new(FakeAiClient::default());

        let response = symbol_explanation_handler(
            auth_headers(session_id),
            State(test_state(storage, ai.clone())),
            Json(request("User", ExplanationLanguage::English)),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: SymbolExplanationResponse = response_json(response).await;
        assert_eq!(body.explanation, "Cached symbol");
        assert!(body.token_usage.is_none());
        assert_eq!(ai.explain_symbol_call_count(), 0);
    }

    #[tokio::test]
    async fn symbol_explanation_handler_calls_ai_and_caches_without_token_usage() {
        let session_id = "session-symbol-ai";
        let storage = Arc::new(FakeStorage::new().with_session("sessions", session(session_id)));
        let ai = Arc::new(FakeAiClient::default());
        *ai.explain_symbol_result.lock().unwrap() = Ok((
            "AI generated symbol".to_string(),
            TokenUsage {
                input_tokens: 2,
                output_tokens: 4,
            },
        ));

        let response = symbol_explanation_handler(
            auth_headers(session_id),
            State(test_state(storage.clone(), ai.clone())),
            Json(request("User", ExplanationLanguage::Japanese)),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: SymbolExplanationResponse = response_json(response).await;
        assert_eq!(body.explanation, "AI generated symbol");
        assert_eq!(body.token_usage.unwrap().output_tokens, 4);
        assert_eq!(ai.explain_symbol_call_count(), 1);

        let cached = storage
            .cache_value(
                "cache",
                &cache_key_symbol("acme", "demo", "main", "src/user.ts", "User", "ja"),
            )
            .unwrap();
        let cached_body: SymbolExplanationResponse = serde_json::from_str(&cached).unwrap();
        assert!(cached_body.token_usage.is_none());
    }
}
