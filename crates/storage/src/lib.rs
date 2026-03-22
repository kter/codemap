pub mod session;
pub use session::Session;

use aws_sdk_dsql::auth_token::{AuthTokenGenerator, Config as DsqlAuthConfig};
use rustls::{ClientConfig, RootCertStore};
use thiserror::Error;
use tokio_postgres_rustls::MakeRustlsConnect;

/// Errors that can occur in storage operations.
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("DSQL error: {0}")]
    Dsql(#[from] tokio_postgres::Error),

    #[error("DynamoDB error: {0}")]
    DynamoDb(String),

    #[error("other storage error: {0}")]
    Other(String),
}

/// SQL schema applied on first connection.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS analysis_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner       TEXT NOT NULL,
    repo        TEXT NOT NULL,
    git_ref     TEXT NOT NULL,
    user_id     BIGINT NOT NULL,
    result_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_owner_repo_ref
    ON analysis_results (owner, repo, git_ref);
";

// ---------------------------------------------------------------------------
// DsqlStorage
// ---------------------------------------------------------------------------

/// Aurora DSQL storage client (rustls TLS + IAM auth).
pub struct DsqlStorage {
    client: tokio_postgres::Client,
}

fn make_tls() -> Result<MakeRustlsConnect, StorageError> {
    let mut root_store = RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    for cert in native.certs {
        root_store.add(cert).ok();
    }
    if root_store.is_empty() {
        return Err(StorageError::Other("no TLS root certificates found".into()));
    }
    let config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    Ok(MakeRustlsConnect::new(config))
}

impl DsqlStorage {
    /// Connects to Aurora DSQL using IAM authentication and rustls TLS.
    ///
    /// `endpoint` is the Aurora DSQL cluster endpoint, e.g.
    /// `<id>.dsql.ap-northeast-1.on.aws`.
    pub async fn connect(endpoint: &str) -> Result<Self, StorageError> {
        let aws_config = aws_config::load_from_env().await;

        // Generate a short-lived IAM auth token for the admin user.
        let generator = AuthTokenGenerator::new(
            DsqlAuthConfig::builder()
                .hostname(endpoint)
                .build()
                .map_err(|e| StorageError::Other(format!("DSQL auth config: {e}")))?,
        );
        let token = generator
            .db_connect_admin_auth_token(&aws_config)
            .await
            .map_err(|e| StorageError::Other(format!("DSQL token generation failed: {e}")))?;
        let password = token.as_str();

        // tokio-postgres connection string; TLS is enforced by the connector.
        let conn_str = format!(
            "host={} user=admin password={} dbname=postgres",
            endpoint, password
        );

        let tls = make_tls()?;
        let (client, connection) = tokio_postgres::connect(&conn_str, tls).await?;

        // Drive the connection in a background task.
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                tracing::error!("DSQL connection error: {e}");
            }
        });

        let storage = Self { client };
        storage.run_migrations().await?;
        Ok(storage)
    }

    async fn run_migrations(&self) -> Result<(), StorageError> {
        self.client.batch_execute(SCHEMA).await?;
        Ok(())
    }

    /// Returns a cached `AnalyzeResponse` JSON for the given repo ref,
    /// if one exists and was stored within the last 24 hours.
    pub async fn get_cached_analysis(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<Option<serde_json::Value>, StorageError> {
        let row = self
            .client
            .query_opt(
                "SELECT result_json FROM analysis_results \
                 WHERE owner = $1 AND repo = $2 AND git_ref = $3 \
                   AND created_at > NOW() - INTERVAL '24 hours'",
                &[&owner, &repo, &git_ref],
            )
            .await?;

        Ok(row.map(|r| {
            let json: tokio_postgres::types::Json<serde_json::Value> = r.get(0);
            json.0
        }))
    }

    /// Upserts an analysis result, resetting `created_at` on conflict.
    pub async fn save_analysis(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
        user_id: i64,
        result: &serde_json::Value,
    ) -> Result<(), StorageError> {
        let json = tokio_postgres::types::Json(result);
        self.client
            .execute(
                "INSERT INTO analysis_results (owner, repo, git_ref, user_id, result_json) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (owner, repo, git_ref) DO UPDATE \
                   SET result_json = EXCLUDED.result_json, \
                       created_at  = NOW(), \
                       user_id     = EXCLUDED.user_id",
                &[&owner, &repo, &git_ref, &user_id, &json],
            )
            .await?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// DynamoStorage
// ---------------------------------------------------------------------------

/// Returns `true` if the given Unix timestamp is in the past (expired).
pub(crate) fn is_expired(expires_at: i64, now: i64) -> bool {
    expires_at <= now
}

/// DynamoDB storage client.
pub struct DynamoStorage {
    client: aws_sdk_dynamodb::Client,
}

impl DynamoStorage {
    /// Creates a `DynamoStorage` from the ambient AWS environment configuration.
    pub async fn from_env() -> Self {
        let config = aws_config::load_from_env().await;
        let client = aws_sdk_dynamodb::Client::new(&config);
        Self { client }
    }

    /// Creates a `DynamoStorage` from a pre-built SDK client (useful in tests).
    pub fn new_with_client(client: aws_sdk_dynamodb::Client) -> Self {
        Self { client }
    }

    /// Returns the cached string value for `key`, or `None` if absent or expired.
    ///
    /// TTL is checked client-side to handle DynamoDB's lazy deletion lag.
    pub async fn get_cache(&self, table: &str, key: &str) -> Result<Option<String>, StorageError> {
        let result = self
            .client
            .get_item()
            .table_name(table)
            .key(
                "cache_key",
                aws_sdk_dynamodb::types::AttributeValue::S(key.to_string()),
            )
            .send()
            .await
            .map_err(|e| StorageError::DynamoDb(e.to_string()))?;

        let item = match result.item {
            Some(item) => item,
            None => return Ok(None),
        };

        // Check TTL manually; DynamoDB may not have deleted the item yet.
        if let Some(exp_attr) = item.get("expires_at") {
            if let Ok(exp_str) = exp_attr.as_n() {
                if let Ok(exp_val) = exp_str.parse::<i64>() {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                    if is_expired(exp_val, now) {
                        return Ok(None);
                    }
                }
            }
        }

        match item.get("data").and_then(|v| v.as_s().ok()) {
            Some(data) => Ok(Some(data.clone())),
            None => Ok(None),
        }
    }

    /// Stores `data` under `key` with a TTL of `ttl_secs` seconds from now.
    pub async fn put_cache(
        &self,
        table: &str,
        key: &str,
        data: &str,
        ttl_secs: i64,
    ) -> Result<(), StorageError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let expires_at = now + ttl_secs;

        self.client
            .put_item()
            .table_name(table)
            .item(
                "cache_key",
                aws_sdk_dynamodb::types::AttributeValue::S(key.to_string()),
            )
            .item(
                "data",
                aws_sdk_dynamodb::types::AttributeValue::S(data.to_string()),
            )
            .item(
                "expires_at",
                aws_sdk_dynamodb::types::AttributeValue::N(expires_at.to_string()),
            )
            .send()
            .await
            .map_err(|e| StorageError::DynamoDb(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::is_expired;

    #[test]
    fn is_expired_past_timestamp_returns_true() {
        assert!(is_expired(1000, 2000));
    }

    #[test]
    fn is_expired_future_timestamp_returns_false() {
        assert!(!is_expired(2000, 1000));
    }

    #[test]
    fn is_expired_exact_boundary_returns_true() {
        // expires_at == now is treated as expired
        assert!(is_expired(1000, 1000));
    }
}
