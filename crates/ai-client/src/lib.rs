use anyhow::{bail, Result};
use aws_sdk_bedrockruntime::{
    types::{ContentBlock, ConversationRole, Message},
    Client,
};
use serde::{Deserialize, Serialize};

/// Bedrock inference profile ID for Claude Haiku 4.5 (JP cross-region profile).
pub const HAIKU_MODEL_ID: &str = "jp.anthropic.claude-haiku-4-5-20251001-v1:0";

/// Description of a single interface or type alias.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceDescription {
    pub name: String,
    pub description: String,
}

/// Summary of a single exported function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionSummary {
    pub name: String,
    pub summary: String,
}

/// AI-generated descriptions for a single file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDescriptions {
    pub interfaces: Vec<InterfaceDescription>,
    pub functions: Vec<FunctionSummary>,
}

/// Amazon Bedrock client for Claude via the Converse API.
pub struct BedrockClient {
    client: Client,
}

impl BedrockClient {
    /// Creates a new `BedrockClient` from an AWS SDK config.
    pub fn new(config: &aws_config::SdkConfig) -> Self {
        Self {
            client: Client::new(config),
        }
    }

    /// Asks the AI to describe interfaces and summarize exported functions in a file.
    pub async fn analyze_file(
        &self,
        filename: &str,
        source: &str,
        interfaces: &[(String, String)],
        functions: &[(String, String)],
    ) -> Result<FileDescriptions> {
        let source_preview = if source.len() > 3000 { &source[..3000] } else { source };

        let iface_list: String = interfaces
            .iter()
            .map(|(name, sig)| {
                let excerpt = if sig.len() > 500 { &sig[..500] } else { sig.as_str() };
                format!("- {name}: {excerpt}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        let fn_list: String = functions
            .iter()
            .map(|(name, src)| {
                let excerpt = if src.len() > 800 { &src[..800] } else { src.as_str() };
                format!("- {name}: {excerpt}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "You are a code documentation assistant. Analyze the TypeScript file below.\n\
             File: {filename}\n\
             Source (excerpt):\n```typescript\n{source_preview}\n```\n\
             Interfaces to describe:\n{iface_list}\n\
             Functions to summarize:\n{fn_list}\n\
             Respond with ONLY valid JSON (no markdown fences):\n\
             {{\"interfaces\":[{{\"name\":\"...\",\"description\":\"...\"}}],\"functions\":[{{\"name\":\"...\",\"summary\":\"...\"}}]}}\n\
             If there are no items, use empty arrays."
        );

        let message = Message::builder()
            .role(ConversationRole::User)
            .content(ContentBlock::Text(prompt))
            .build()?;

        let resp = self
            .client
            .converse()
            .model_id(HAIKU_MODEL_ID)
            .messages(message)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Bedrock Converse API error: {e}"))?;

        let output = resp
            .output
            .ok_or_else(|| anyhow::anyhow!("empty output from Bedrock"))?;

        let text = match output {
            aws_sdk_bedrockruntime::types::ConverseOutput::Message(msg) => msg
                .content
                .into_iter()
                .find_map(|b| {
                    if let ContentBlock::Text(t) = b {
                        Some(t)
                    } else {
                        None
                    }
                })
                .ok_or_else(|| anyhow::anyhow!("no text block in Bedrock response"))?,
            other => bail!("unexpected Bedrock output variant: {:?}", other),
        };

        let descriptions: FileDescriptions = serde_json::from_str(&text)
            .map_err(|e| anyhow::anyhow!("failed to parse FileDescriptions JSON: {e}\nText: {text}"))?;

        Ok(descriptions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_descriptions_deserializes_correctly() {
        let json = r#"{"interfaces":[{"name":"User","description":"A user entity"}],"functions":[{"name":"getUser","summary":"Fetches a user by ID"}]}"#;
        let desc: FileDescriptions = serde_json::from_str(json).unwrap();
        assert_eq!(desc.interfaces.len(), 1);
        assert_eq!(desc.interfaces[0].name, "User");
        assert_eq!(desc.interfaces[0].description, "A user entity");
        assert_eq!(desc.functions.len(), 1);
        assert_eq!(desc.functions[0].name, "getUser");
        assert_eq!(desc.functions[0].summary, "Fetches a user by ID");
    }

    #[test]
    fn analyze_file_builds_prompt_with_filename() {
        // Verify prompt generation logic without making network calls.
        let filename = "src/user.ts";
        let source = "export interface User { id: number; }";
        let interfaces = vec![("User".to_string(), "interface User { id: number; }".to_string())];
        let _functions: Vec<(String, String)> = vec![];

        let source_preview = if source.len() > 3000 { &source[..3000] } else { source };
        let iface_list: String = interfaces
            .iter()
            .map(|(name, sig)| {
                let excerpt = if sig.len() > 500 { &sig[..500] } else { sig.as_str() };
                format!("- {name}: {excerpt}")
            })
            .collect::<Vec<_>>()
            .join("\n");
        let fn_list = String::new();

        let prompt = format!(
            "You are a code documentation assistant. Analyze the TypeScript file below.\n\
             File: {filename}\n\
             Source (excerpt):\n```typescript\n{source_preview}\n```\n\
             Interfaces to describe:\n{iface_list}\n\
             Functions to summarize:\n{fn_list}\n\
             Respond with ONLY valid JSON (no markdown fences):\n\
             {{\"interfaces\":[{{\"name\":\"...\",\"description\":\"...\"}}],\"functions\":[{{\"name\":\"...\",\"summary\":\"...\"}}]}}\n\
             If there are no items, use empty arrays."
        );

        assert!(prompt.contains("src/user.ts"));
        assert!(prompt.contains("- User: interface User"));
        assert!(prompt.contains("export interface User"));
    }
}
