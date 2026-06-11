use std::time::Duration;

use axum::{
    extract::{MatchedPath, Request},
    http::{self, HeaderMap, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};
use lambda_http::{request::RequestContext, RequestExt};
use tracing::Span;
use uuid::Uuid;

pub(crate) const REQUEST_ID_HEADER_NAME: &str = "x-request-id";

pub(crate) fn request_id_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(REQUEST_ID_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
}

pub(crate) fn request_id_or_unknown(headers: &HeaderMap) -> &str {
    request_id_from_headers(headers).unwrap_or("unknown")
}

pub(crate) fn request_id_from_request<B>(request: &http::Request<B>) -> String {
    request_id_from_headers(request.headers())
        .map(str::to_owned)
        .or_else(|| request_context_request_id(request))
        .or_else(|| {
            request
                .lambda_context_ref()
                .map(|context| context.request_id.to_string())
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

pub(crate) fn route_from_request<B>(request: &http::Request<B>) -> String {
    request
        .extensions()
        .get::<MatchedPath>()
        .map(|path: &MatchedPath| path.as_str().to_string())
        .unwrap_or_else(|| request.uri().path().to_string())
}

pub(crate) async fn trace_request(request: Request, next: Next) -> Response {
    let start = std::time::Instant::now();
    let method = request.method().to_string();
    let route = route_from_request(&request);
    let request_id = request_id_or_unknown(request.headers()).to_owned();

    let span = tracing::info_span!(
        "request",
        method = %method,
        route = %route,
        request_id = %request_id,
    );

    let response = next.run(request).await;
    log_http_response(response.status(), start.elapsed(), &span);
    response
}

pub(crate) async fn attach_request_id(mut request: Request, next: Next) -> Response {
    let request_id = request_id_from_request(&request);
    set_request_id_header(request.headers_mut(), &request_id);

    let mut response = next.run(request).await;
    set_request_id_header(response.headers_mut(), &request_id);
    response
}

pub(crate) fn log_http_response(status: StatusCode, latency: Duration, span: &Span) {
    let latency_ms = latency.as_millis() as u64;

    if status.is_server_error() {
        tracing::error!(
            parent: span,
            event = "http.request.complete",
            status = status.as_u16(),
            latency_ms,
            outcome = "server_error",
            "request completed"
        );
    } else if status.is_client_error() {
        tracing::warn!(
            parent: span,
            event = "http.request.complete",
            status = status.as_u16(),
            latency_ms,
            outcome = "client_error",
            "request completed"
        );
    } else {
        tracing::info!(
            parent: span,
            event = "http.request.complete",
            status = status.as_u16(),
            latency_ms,
            outcome = "success",
            "request completed"
        );
    }
}

fn set_request_id_header(headers: &mut HeaderMap, request_id: &str) {
    if headers.contains_key(REQUEST_ID_HEADER_NAME) {
        return;
    }

    if let Ok(value) = HeaderValue::from_str(request_id) {
        headers.insert(HeaderName::from_static(REQUEST_ID_HEADER_NAME), value);
    }
}

fn request_context_request_id<B>(request: &http::Request<B>) -> Option<String> {
    match request.request_context_ref()? {
        RequestContext::ApiGatewayV1(context) => context.request_id.clone(),
        RequestContext::ApiGatewayV2(context) => context.request_id.clone(),
        RequestContext::WebSocket(context) => context.request_id.clone(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, middleware, routing::get, Router};
    use tower::ServiceExt;

    #[test]
    fn request_id_from_headers_returns_value_when_present() {
        let mut headers = HeaderMap::new();
        headers.insert(REQUEST_ID_HEADER_NAME, "abc-123".parse().unwrap());
        assert_eq!(request_id_from_headers(&headers), Some("abc-123"));
    }

    #[test]
    fn request_id_from_headers_ignores_empty_value() {
        let mut headers = HeaderMap::new();
        headers.insert(REQUEST_ID_HEADER_NAME, "".parse().unwrap());
        assert_eq!(request_id_from_headers(&headers), None);
    }

    #[test]
    fn request_id_or_unknown_falls_back_when_missing() {
        assert_eq!(request_id_or_unknown(&HeaderMap::new()), "unknown");
    }

    #[test]
    fn route_from_request_falls_back_to_uri_path() {
        let request = http::Request::builder()
            .uri("/some/path?x=1")
            .body(())
            .unwrap();
        assert_eq!(route_from_request(&request), "/some/path");
    }

    fn test_router() -> Router {
        Router::new()
            .route("/ping", get(|| async { "pong" }))
            .layer(middleware::from_fn(attach_request_id))
    }

    #[tokio::test]
    async fn attach_request_id_generates_id_when_absent() {
        let response = test_router()
            .oneshot(
                http::Request::builder()
                    .uri("/ping")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let header = response
            .headers()
            .get(REQUEST_ID_HEADER_NAME)
            .expect("response must carry x-request-id");
        assert!(!header.to_str().unwrap().is_empty());
    }

    #[tokio::test]
    async fn attach_request_id_preserves_incoming_id() {
        let response = test_router()
            .oneshot(
                http::Request::builder()
                    .uri("/ping")
                    .header(REQUEST_ID_HEADER_NAME, "client-supplied-id")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response
                .headers()
                .get(REQUEST_ID_HEADER_NAME)
                .unwrap()
                .to_str()
                .unwrap(),
            "client-supplied-id"
        );
    }
}
