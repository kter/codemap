#![cfg(test)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::anyhow;
use async_trait::async_trait;
use axum::http::{header, HeaderMap};
use axum::response::Response;
use codemap_ai_client::{FileDescriptions, TokenUsage, TourResult};
use codemap_core::{ExplanationLanguage, LanguageKind};
use codemap_storage::{Session, StorageError};
use serde::de::DeserializeOwned;

use crate::auth::{AppAiClient, AppState, AppStorage};

#[derive(Default)]
pub(crate) struct FakeStorage {
    sessions: Mutex<HashMap<String, Session>>,
    cache: Mutex<HashMap<(String, String), String>>,
}

impl FakeStorage {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn with_session(self, table: &str, session: Session) -> Self {
        self.sessions
            .lock()
            .unwrap()
            .insert(format!("{table}:{}", session.session_id), session);
        self
    }

    pub(crate) fn with_cache(self, table: &str, key: &str, value: &str) -> Self {
        self.cache
            .lock()
            .unwrap()
            .insert((table.to_string(), key.to_string()), value.to_string());
        self
    }

    pub(crate) fn cache_value(&self, table: &str, key: &str) -> Option<String> {
        self.cache
            .lock()
            .unwrap()
            .get(&(table.to_string(), key.to_string()))
            .cloned()
    }
}

#[async_trait]
impl AppStorage for FakeStorage {
    async fn get_session(
        &self,
        table: &str,
        session_id: &str,
    ) -> Result<Option<Session>, StorageError> {
        Ok(self
            .sessions
            .lock()
            .unwrap()
            .get(&format!("{table}:{session_id}"))
            .cloned())
    }

    async fn put_session(&self, table: &str, session: &Session) -> Result<(), StorageError> {
        self.sessions
            .lock()
            .unwrap()
            .insert(format!("{table}:{}", session.session_id), session.clone());
        Ok(())
    }

    async fn delete_session(&self, table: &str, session_id: &str) -> Result<(), StorageError> {
        self.sessions
            .lock()
            .unwrap()
            .remove(&format!("{table}:{session_id}"));
        Ok(())
    }

    async fn get_cache(&self, table: &str, key: &str) -> Result<Option<String>, StorageError> {
        Ok(self
            .cache
            .lock()
            .unwrap()
            .get(&(table.to_string(), key.to_string()))
            .cloned())
    }

    async fn put_cache(
        &self,
        table: &str,
        key: &str,
        data: &str,
        _ttl_secs: i64,
    ) -> Result<(), StorageError> {
        self.cache
            .lock()
            .unwrap()
            .insert((table.to_string(), key.to_string()), data.to_string());
        Ok(())
    }
}

pub(crate) struct FakeAiClient {
    pub(crate) check_health_result: Mutex<Result<(), String>>,
    pub(crate) analyze_file_result: Mutex<Result<(FileDescriptions, TokenUsage), String>>,
    pub(crate) summarize_file_result: Mutex<Result<(String, TokenUsage), String>>,
    pub(crate) explain_symbol_result: Mutex<Result<(String, TokenUsage), String>>,
    pub(crate) generate_tour_result: Mutex<Result<(TourResult, TokenUsage), String>>,
    pub(crate) analyze_file_calls: AtomicUsize,
    pub(crate) summarize_file_calls: AtomicUsize,
    pub(crate) explain_symbol_calls: AtomicUsize,
    pub(crate) generate_tour_calls: AtomicUsize,
}

impl Default for FakeAiClient {
    fn default() -> Self {
        Self {
            check_health_result: Mutex::new(Ok(())),
            analyze_file_result: Mutex::new(Ok((
                FileDescriptions {
                    overview: String::new(),
                    interfaces: Vec::new(),
                    functions: Vec::new(),
                },
                TokenUsage::default(),
            ))),
            summarize_file_result: Mutex::new(Ok((String::new(), TokenUsage::default()))),
            explain_symbol_result: Mutex::new(Ok((String::new(), TokenUsage::default()))),
            generate_tour_result: Mutex::new(Ok((
                TourResult {
                    title: String::new(),
                    stops: Vec::new(),
                },
                TokenUsage::default(),
            ))),
            analyze_file_calls: AtomicUsize::new(0),
            summarize_file_calls: AtomicUsize::new(0),
            explain_symbol_calls: AtomicUsize::new(0),
            generate_tour_calls: AtomicUsize::new(0),
        }
    }
}

impl FakeAiClient {
    pub(crate) fn analyze_file_call_count(&self) -> usize {
        self.analyze_file_calls.load(Ordering::SeqCst)
    }

    pub(crate) fn summarize_file_call_count(&self) -> usize {
        self.summarize_file_calls.load(Ordering::SeqCst)
    }

    pub(crate) fn explain_symbol_call_count(&self) -> usize {
        self.explain_symbol_calls.load(Ordering::SeqCst)
    }

    pub(crate) fn generate_tour_call_count(&self) -> usize {
        self.generate_tour_calls.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl AppAiClient for FakeAiClient {
    async fn check_health(&self) -> anyhow::Result<()> {
        self.check_health_result
            .lock()
            .unwrap()
            .clone()
            .map_err(|err| anyhow!(err))
    }

    async fn analyze_file(
        &self,
        _language: LanguageKind,
        _response_language: ExplanationLanguage,
        _filename: &str,
        _source: &str,
        _interfaces: &[(String, String)],
        _functions: &[(String, String)],
    ) -> anyhow::Result<(FileDescriptions, TokenUsage)> {
        self.analyze_file_calls.fetch_add(1, Ordering::SeqCst);
        self.analyze_file_result
            .lock()
            .unwrap()
            .clone()
            .map_err(|err| anyhow!(err))
    }

    async fn explain_symbol(
        &self,
        _response_language: ExplanationLanguage,
        _filename: &str,
        _symbol: &str,
        _source: &str,
        _context_files: &[(&str, &str)],
    ) -> anyhow::Result<(String, TokenUsage)> {
        self.explain_symbol_calls.fetch_add(1, Ordering::SeqCst);
        self.explain_symbol_result
            .lock()
            .unwrap()
            .clone()
            .map_err(|err| anyhow!(err))
    }

    async fn summarize_file(
        &self,
        _response_language: ExplanationLanguage,
        _filename: &str,
        _source: &str,
    ) -> anyhow::Result<(String, TokenUsage)> {
        self.summarize_file_calls.fetch_add(1, Ordering::SeqCst);
        self.summarize_file_result
            .lock()
            .unwrap()
            .clone()
            .map_err(|err| anyhow!(err))
    }

    async fn generate_tour(
        &self,
        _response_language: ExplanationLanguage,
        _query: &str,
        _files: &[(&str, &str)],
    ) -> anyhow::Result<(TourResult, TokenUsage)> {
        self.generate_tour_calls.fetch_add(1, Ordering::SeqCst);
        self.generate_tour_result
            .lock()
            .unwrap()
            .clone()
            .map_err(|err| anyhow!(err))
    }
}

pub(crate) fn test_state(
    storage: Arc<dyn AppStorage>,
    ai_client: Arc<dyn AppAiClient>,
) -> AppState {
    AppState {
        storage,
        cache_table: "cache".to_string(),
        github_client_id: "fake_client_id".to_string(),
        github_client_secret: "fake_secret".to_string(),
        sessions_table: "sessions".to_string(),
        frontend_url: "http://localhost:3000".to_string(),
        api_base_url: "http://localhost:8080".to_string(),
        http_client: reqwest::Client::new(),
        ai_client,
    }
}

pub(crate) fn session(session_id: &str) -> Session {
    Session {
        session_id: session_id.to_string(),
        github_user_id: 42,
        github_login: "testuser".to_string(),
        github_access_token: "token".to_string(),
        expires_at: i64::MAX,
    }
}

pub(crate) fn auth_headers(session_id: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::COOKIE,
        format!("session_id={session_id}").parse().unwrap(),
    );
    headers
}

pub(crate) async fn response_json<T: DeserializeOwned>(response: Response) -> T {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}
