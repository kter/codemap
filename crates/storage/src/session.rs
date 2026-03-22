use std::collections::HashMap;

use aws_sdk_dynamodb::types::AttributeValue;

use crate::{DynamoStorage, StorageError};

/// A user session stored in DynamoDB.
pub struct Session {
    pub session_id: String,
    pub github_user_id: i64,
    pub github_login: String,
    pub github_access_token: String,
    /// Unix timestamp used as the DynamoDB TTL attribute.
    pub expires_at: i64,
}

impl DynamoStorage {
    pub async fn put_session(&self, table: &str, session: &Session) -> Result<(), StorageError> {
        self.client
            .put_item()
            .table_name(table)
            .item("session_id", AttributeValue::S(session.session_id.clone()))
            .item(
                "github_user_id",
                AttributeValue::N(session.github_user_id.to_string()),
            )
            .item(
                "github_login",
                AttributeValue::S(session.github_login.clone()),
            )
            .item(
                "github_access_token",
                AttributeValue::S(session.github_access_token.clone()),
            )
            .item(
                "expires_at",
                AttributeValue::N(session.expires_at.to_string()),
            )
            .send()
            .await
            .map_err(|e| StorageError::DynamoDb(e.to_string()))?;
        Ok(())
    }

    pub async fn get_session(
        &self,
        table: &str,
        session_id: &str,
    ) -> Result<Option<Session>, StorageError> {
        let result = self
            .client
            .get_item()
            .table_name(table)
            .key("session_id", AttributeValue::S(session_id.to_string()))
            .send()
            .await
            .map_err(|e| StorageError::DynamoDb(format!("{e:#?}")))?;

        let item = match result.item {
            Some(item) => item,
            None => return Ok(None),
        };

        Ok(Some(Session {
            session_id: get_str(&item, "session_id")?,
            github_user_id: get_i64(&item, "github_user_id")?,
            github_login: get_str(&item, "github_login")?,
            github_access_token: get_str(&item, "github_access_token")?,
            expires_at: get_i64(&item, "expires_at")?,
        }))
    }

    pub async fn delete_session(&self, table: &str, session_id: &str) -> Result<(), StorageError> {
        self.client
            .delete_item()
            .table_name(table)
            .key("session_id", AttributeValue::S(session_id.to_string()))
            .send()
            .await
            .map_err(|e| StorageError::DynamoDb(e.to_string()))?;
        Ok(())
    }
}

fn get_str(item: &HashMap<String, AttributeValue>, key: &str) -> Result<String, StorageError> {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .cloned()
        .ok_or_else(|| StorageError::DynamoDb(format!("missing field: {key}")))
}

fn get_i64(item: &HashMap<String, AttributeValue>, key: &str) -> Result<i64, StorageError> {
    item.get(key)
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| StorageError::DynamoDb(format!("missing field: {key}")))
}

#[cfg(test)]
mod tests {
    use super::{get_i64, get_str};
    use std::collections::HashMap;

    use aws_sdk_dynamodb::types::AttributeValue;

    fn item(pairs: Vec<(&str, AttributeValue)>) -> HashMap<String, AttributeValue> {
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    // --- get_str ---

    #[test]
    fn get_str_ok() {
        let i = item(vec![("key", AttributeValue::S("hello".to_string()))]);
        assert_eq!(get_str(&i, "key").unwrap(), "hello");
    }

    #[test]
    fn get_str_missing() {
        let i = item(vec![]);
        assert!(get_str(&i, "key").is_err());
    }

    #[test]
    fn get_str_wrong_type() {
        let i = item(vec![("key", AttributeValue::N("42".to_string()))]);
        assert!(get_str(&i, "key").is_err());
    }

    // --- get_i64 ---

    #[test]
    fn get_i64_ok() {
        let i = item(vec![("num", AttributeValue::N("42".to_string()))]);
        assert_eq!(get_i64(&i, "num").unwrap(), 42);
    }

    #[test]
    fn get_i64_missing() {
        let i = item(vec![]);
        assert!(get_i64(&i, "num").is_err());
    }

    #[test]
    fn get_i64_non_numeric() {
        let i = item(vec![("num", AttributeValue::N("bad".to_string()))]);
        assert!(get_i64(&i, "num").is_err());
    }
}
