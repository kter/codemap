mod analyze;
mod auth;

use std::sync::Arc;

use axum::http::{header, Method};
use axum::{
    routing::{get, post},
    Json, Router,
};
use codemap_ai_client::BedrockClient;
use codemap_storage::{DsqlStorage, DynamoStorage};
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;

use analyze::analyze_handler;
use auth::{get_me, github_callback, github_login, logout, AppState};

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
        .route("/auth/github", get(github_login))
        .route("/auth/github/callback", get(github_callback))
        .route("/auth/me", get(get_me))
        .route("/auth/logout", post(logout))
        .route("/analyze", post(analyze_handler))
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
            dsql: None,
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

    let dsql = match std::env::var("DSQL_ENDPOINT") {
        Ok(endpoint) => match DsqlStorage::connect(&endpoint).await {
            Ok(s) => {
                tracing::info!("Connected to Aurora DSQL at {endpoint}");
                Some(Arc::new(s))
            }
            Err(e) => {
                tracing::error!("Failed to connect to Aurora DSQL: {e}");
                None
            }
        },
        Err(_) => {
            tracing::warn!("DSQL_ENDPOINT not set; analysis caching disabled");
            None
        }
    };

    let ai_client = Arc::new(BedrockClient::new(&aws_config));

    let state = AppState {
        dynamo,
        dsql,
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
