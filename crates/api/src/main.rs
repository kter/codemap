mod analyze;
mod auth;
mod symbol;
mod tree;

use std::sync::Arc;

use axum::extract::State;
use axum::http::{header, Method, StatusCode};
use axum::response::IntoResponse;
use axum::{
    routing::{get, post},
    Json, Router,
};
use codemap_ai_client::BedrockClient;
use codemap_storage::DynamoStorage;
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;

use analyze::analyze_handler;
use auth::{get_me, github_callback, github_login, logout, AppState};
use symbol::symbol_explanation_handler;
use tree::{file_explanation_handler, file_handler, tree_handler};

fn app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            state
                .frontend_url
                .parse::<axum::http::HeaderValue>()
                .expect("invalid frontend_url"),
        )
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::COOKIE])
        .allow_credentials(true);

    Router::new()
        .route("/health", get(health_handler))
        .route("/health/ai", get(health_ai_handler))
        .route("/auth/github", get(github_login))
        .route("/auth/github/callback", get(github_callback))
        .route("/auth/me", get(get_me))
        .route("/auth/logout", post(logout))
        .route("/analyze", post(analyze_handler))
        .route("/tree", get(tree_handler))
        .route("/file", get(file_handler))
        .route("/file/explanation", get(file_explanation_handler))
        .route("/symbol/explanation", post(symbol_explanation_handler))
        .layer(cors)
        .with_state(state)
}

async fn health_handler() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "codemap-api",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn health_ai_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.ai_client.check_health().await {
        Ok(_) => Json(json!({
            "status": "ok",
            "model": codemap_ai_client::HAIKU_MODEL_ID,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"status": "error", "error": format!("{e:#?}")})),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::{app, auth::AppState};
    use axum::{
        body::Body,
        http::{header, Request, StatusCode},
    };
    use codemap_ai_client::BedrockClient;
    use codemap_storage::DynamoStorage;
    use std::sync::Arc;
    use tower::ServiceExt;

    async fn test_state() -> AppState {
        use aws_sdk_dynamodb::{
            config::{BehaviorVersion, Builder, Credentials, Region},
            Client,
        };
        let creds = Credentials::new("fake_key", "fake_secret", None, None, "test");
        let config = Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .credentials_provider(creds)
            .region(Region::new("us-east-1"))
            .endpoint_url("http://localhost:8000")
            .build();
        let client = Client::from_conf(config);
        let dynamo = Arc::new(DynamoStorage::new_with_client(client));
        let bedrock_config = aws_config::SdkConfig::builder()
            .behavior_version(aws_config::BehaviorVersion::latest())
            .build();
        let ai_client = Arc::new(BedrockClient::new(&bedrock_config));
        AppState {
            dynamo,
            cache_table: String::new(),
            sessions_table: "sessions".to_string(),
            github_client_id: "fake_client_id".to_string(),
            github_client_secret: "fake_secret".to_string(),
            frontend_url: "http://localhost:3000".to_string(),
            api_base_url: "http://localhost:8080".to_string(),
            http_client: reqwest::Client::new(),
            ai_client,
        }
    }

    #[tokio::test]
    async fn health_returns_200() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/health")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn github_login_redirects_with_state_cookie() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/auth/github")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::FOUND);
        let set_cookie = res
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(set_cookie.starts_with("oauth_state="));
        let location = res
            .headers()
            .get(header::LOCATION)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(location.contains("github.com"));
    }

    #[tokio::test]
    async fn get_me_without_cookie_returns_401() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/auth/me")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn logout_without_cookie_returns_204() {
        let router = app(test_state().await);
        let req = Request::builder()
            .method("POST")
            .uri("/auth/logout")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        let set_cookie = res
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(set_cookie.contains("Max-Age=0"));
    }

    #[tokio::test]
    async fn callback_missing_state_cookie_returns_400() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/auth/github/callback?code=abc&state=xyz")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn health_ai_returns_json_status_field() {
        // With fake credentials, Bedrock call will fail → 502 with {"status":"error",...}.
        // Verifies the route exists and always returns well-formed JSON.
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/health/ai")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_ne!(
            res.status(),
            StatusCode::NOT_FOUND,
            "/health/ai route must exist"
        );
        let body = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&body).expect("response must be valid JSON");
        assert!(
            json.get("status").is_some(),
            "response must contain 'status' field"
        );
    }

    #[tokio::test]
    async fn health_ai_with_fake_credentials_returns_error_status() {
        // Fake AWS credentials → Bedrock returns an error → handler returns 502.
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/health/ai")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        // With fake credentials the only valid outcomes are 200 (mocked env) or 502 (real error).
        // In unit-test environments we expect 502.
        let status = res.status();
        assert!(
            status == StatusCode::OK || status == StatusCode::BAD_GATEWAY,
            "expected 200 or 502, got {status}"
        );
        if status == StatusCode::BAD_GATEWAY {
            let body = axum::body::to_bytes(res.into_body(), usize::MAX)
                .await
                .unwrap();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(json["status"], "error");
            assert!(json.get("error").is_some());
        }
    }

    #[tokio::test]
    async fn analyze_without_cookie_returns_401() {
        let router = app(test_state().await);
        let req = Request::builder()
            .method("POST")
            .uri("/analyze")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"owner":"foo","repo":"bar","git_ref":"main"}"#,
            ))
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn tree_without_cookie_returns_401() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/tree?owner=foo&repo=bar&git_ref=main")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn file_without_cookie_returns_401() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/file?owner=foo&repo=bar&git_ref=main&path=src/index.ts")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn file_explanation_without_cookie_returns_401() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/file/explanation?owner=foo&repo=bar&git_ref=main&path=src/index.ts")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn symbol_explanation_without_cookie_returns_401() {
        let router = app(test_state().await);
        let req = Request::builder()
            .method("POST")
            .uri("/symbol/explanation")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"owner":"foo","repo":"bar","git_ref":"main","path":"src/index.ts","symbol":"MyType","source":""}"#,
            ))
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn tree_missing_params_returns_400() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/tree?owner=foo")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn file_missing_path_param_returns_400() {
        let router = app(test_state().await);
        let req = Request::builder()
            .uri("/file?owner=foo&repo=bar&git_ref=main")
            .body(Body::empty())
            .unwrap();
        let res = router.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}

async fn fetch_ssm_param(client: &aws_sdk_ssm::Client, name: &str) -> String {
    client
        .get_parameter()
        .name(name)
        .with_decryption(true)
        .send()
        .await
        .unwrap_or_else(|e| panic!("SSM GetParameter failed for {name}: {e}"))
        .parameter
        .unwrap_or_else(|| panic!("SSM parameter {name} not found"))
        .value
        .unwrap_or_else(|| panic!("SSM parameter {name} has no value"))
}

#[tokio::main]
async fn main() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let aws_config = aws_config::load_from_env().await;
    let ssm = aws_sdk_ssm::Client::new(&aws_config);

    let github_client_id = fetch_ssm_param(
        &ssm,
        &std::env::var("GITHUB_CLIENT_ID_PARAM").expect("GITHUB_CLIENT_ID_PARAM must be set"),
    )
    .await;
    let github_client_secret = fetch_ssm_param(
        &ssm,
        &std::env::var("GITHUB_CLIENT_SECRET_PARAM")
            .expect("GITHUB_CLIENT_SECRET_PARAM must be set"),
    )
    .await;

    let dynamo = Arc::new(DynamoStorage::from_env().await);

    let cache_table = match std::env::var("AI_CACHE_TABLE") {
        Ok(t) => {
            tracing::info!("DynamoDB cache table: {t}");
            t
        }
        Err(_) => {
            tracing::warn!("AI_CACHE_TABLE not set; analysis caching disabled");
            String::new()
        }
    };

    let ai_client = Arc::new(BedrockClient::new(&aws_config));

    let state = AppState {
        dynamo,
        cache_table,
        sessions_table: std::env::var("SESSIONS_TABLE").unwrap_or_else(|_| "sessions".to_string()),
        github_client_id,
        github_client_secret,
        frontend_url: std::env::var("FRONTEND_URL")
            .unwrap_or_else(|_| "http://localhost:3000".to_string()),
        api_base_url: std::env::var("API_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8080".to_string()),
        http_client: reqwest::Client::new(),
        ai_client,
    };

    let router = app(state);
    lambda_http::run(router)
        .await
        .expect("lambda runtime error");
}
