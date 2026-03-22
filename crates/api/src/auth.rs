use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::{
        header::{LOCATION, SET_COOKIE},
        HeaderMap, StatusCode,
    },
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use codemap_ai_client::BedrockClient;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use codemap_storage::{DsqlStorage, DynamoStorage, Session};

const SESSION_TTL_SECS: i64 = 30 * 24 * 3600; // 30 days
const OAUTH_STATE_TTL_SECS: u64 = 300; // 5 minutes

#[derive(Clone)]
pub struct AppState {
    pub dynamo: Arc<DynamoStorage>,
    pub dsql: Option<Arc<DsqlStorage>>,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub sessions_table: String,
    pub frontend_url: String,
    pub api_base_url: String,
    pub http_client: reqwest::Client,
    pub ai_client: Arc<BedrockClient>,
}

// ---------------------------------------------------------------------------
// GET /auth/github — start OAuth flow
// ---------------------------------------------------------------------------

pub async fn github_login(State(state): State<AppState>) -> Response {
    let oauth_state = Uuid::new_v4().to_string();

    let github_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}/auth/github/callback&scope=read:user&state={}",
        state.github_client_id,
        state.api_base_url,
        oauth_state,
    );

    let state_cookie = format!(
        "oauth_state={}; HttpOnly; SameSite=Lax; Max-Age={}; Path=/",
        oauth_state, OAUTH_STATE_TTL_SECS,
    );

    (
        StatusCode::FOUND,
        [(SET_COOKIE, state_cookie), (LOCATION, github_url)],
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// GET /auth/github/callback
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CallbackParams {
    code: String,
    state: String,
}

#[derive(Deserialize)]
struct GitHubTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GitHubUser {
    id: i64,
    login: String,
}

pub async fn github_callback(
    Query(params): Query<CallbackParams>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    // Verify state cookie
    let stored_state = match extract_cookie(&headers, "oauth_state") {
        Some(s) => s,
        None => return error_response(StatusCode::BAD_REQUEST, "missing oauth_state cookie"),
    };

    if stored_state != params.state {
        return error_response(StatusCode::BAD_REQUEST, "oauth state mismatch");
    }

    // Exchange code for access token
    let token_resp = match state
        .http_client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", state.github_client_id.as_str()),
            ("client_secret", state.github_client_secret.as_str()),
            ("code", params.code.as_str()),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("GitHub token request failed: {e}");
            return error_response(StatusCode::BAD_GATEWAY, "GitHub token request failed");
        }
    };

    let token: GitHubTokenResponse = match token_resp.json().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to parse GitHub token response: {e}");
            return error_response(StatusCode::BAD_GATEWAY, "invalid GitHub token response");
        }
    };

    // Fetch GitHub user
    let user: GitHubUser = match state
        .http_client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token.access_token))
        .header("User-Agent", "codemap/1.0")
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(u) => u,
            Err(e) => {
                tracing::error!("Failed to parse GitHub user: {e}");
                return error_response(StatusCode::BAD_GATEWAY, "invalid GitHub user response");
            }
        },
        Err(e) => {
            tracing::error!("GitHub user request failed: {e}");
            return error_response(StatusCode::BAD_GATEWAY, "GitHub user request failed");
        }
    };

    // Create session
    let session_id = Uuid::new_v4().to_string();
    let expires_at = Utc::now().timestamp() + SESSION_TTL_SECS;

    let session = Session {
        session_id: session_id.clone(),
        github_user_id: user.id,
        github_login: user.login,
        github_access_token: token.access_token,
        expires_at,
    };

    if let Err(e) = state
        .dynamo
        .put_session(&state.sessions_table, &session)
        .await
    {
        tracing::error!("Failed to store session: {e}");
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "session storage failed");
    }

    let session_cookie = format!(
        "session_id={}; HttpOnly; Secure; SameSite=Lax; Max-Age={}; Path=/",
        session_id, SESSION_TTL_SECS,
    );
    let clear_state_cookie = "oauth_state=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/".to_string();

    let mut response =
        (StatusCode::FOUND, [(LOCATION, state.frontend_url.clone())]).into_response();
    let headers = response.headers_mut();
    headers.append(SET_COOKIE, session_cookie.parse().unwrap());
    headers.append(SET_COOKIE, clear_state_cookie.parse().unwrap());
    response
}

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct MeResponse {
    login: String,
    github_user_id: i64,
}

pub async fn get_me(headers: HeaderMap, State(state): State<AppState>) -> Response {
    let session_id = match extract_cookie(&headers, "session_id") {
        Some(s) => s,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "not authenticated"})),
            )
                .into_response()
        }
    };

    match state
        .dynamo
        .get_session(&state.sessions_table, &session_id)
        .await
    {
        Ok(Some(session)) => Json(MeResponse {
            login: session.github_login,
            github_user_id: session.github_user_id,
        })
        .into_response(),
        Ok(None) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "session not found"})),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("get_session failed: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "storage error"})),
            )
                .into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

pub async fn logout(headers: HeaderMap, State(state): State<AppState>) -> Response {
    if let Some(session_id) = extract_cookie(&headers, "session_id") {
        if let Err(e) = state
            .dynamo
            .delete_session(&state.sessions_table, &session_id)
            .await
        {
            tracing::warn!("delete_session failed: {e}");
        }
    }

    let clear_cookie = "session_id=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/".to_string();
    (StatusCode::NO_CONTENT, [(SET_COOKIE, clear_cookie)]).into_response()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie_header = headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{}=", name);
    cookie_header.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix(&prefix).map(|v| v.to_string())
    })
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::extract_cookie;
    use axum::http::HeaderMap;

    fn headers_with_cookie(val: &str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(axum::http::header::COOKIE, val.parse().unwrap());
        map
    }

    #[test]
    fn extract_cookie_found() {
        let h = headers_with_cookie("session_id=abc");
        assert_eq!(extract_cookie(&h, "session_id"), Some("abc".to_string()));
    }

    #[test]
    fn extract_cookie_multiple() {
        let h = headers_with_cookie("a=1; session_id=xyz; b=2");
        assert_eq!(extract_cookie(&h, "session_id"), Some("xyz".to_string()));
    }

    #[test]
    fn extract_cookie_not_found() {
        let h = headers_with_cookie("other=abc");
        assert_eq!(extract_cookie(&h, "session_id"), None);
    }

    #[test]
    fn extract_cookie_no_header() {
        let h = HeaderMap::new();
        assert_eq!(extract_cookie(&h, "session_id"), None);
    }

    #[test]
    fn extract_cookie_prefix_match() {
        // "not_session_id=abc" must NOT match "session_id"
        let h = headers_with_cookie("not_session_id=abc");
        assert_eq!(extract_cookie(&h, "session_id"), None);
    }
}
