use anyhow::{bail, Result};
use aws_sdk_bedrockruntime::{
    types::{ContentBlock, ConversationRole, Message},
    Client,
};
use codemap_core::{ExplanationLanguage, LanguageKind};
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
    #[serde(default)]
    pub overview: String,
    pub interfaces: Vec<InterfaceDescription>,
    pub functions: Vec<FunctionSummary>,
}

/// Cumulative token usage returned from a single Bedrock Converse call.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// A single stop in a code tour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TourStop {
    pub file_path: String,
    pub line_start: u32,
    pub line_end: u32,
    pub explanation: String,
}

/// AI-generated code tour result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TourResult {
    pub title: String,
    pub stops: Vec<TourStop>,
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

    /// Performs a minimal Bedrock Converse call to verify connectivity and permissions.
    pub async fn check_health(&self) -> Result<()> {
        use aws_sdk_bedrockruntime::types::InferenceConfiguration;
        let message = Message::builder()
            .role(ConversationRole::User)
            .content(ContentBlock::Text("Reply with: ok".to_string()))
            .build()?;
        self.client
            .converse()
            .model_id(HAIKU_MODEL_ID)
            .messages(message)
            .inference_config(InferenceConfiguration::builder().max_tokens(5).build())
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Bedrock health check failed: {e:#?}"))?;
        Ok(())
    }

    /// Asks the AI to describe interfaces and summarize exported functions in a file.
    pub async fn analyze_file(
        &self,
        language: LanguageKind,
        response_language: ExplanationLanguage,
        filename: &str,
        source: &str,
        interfaces: &[(String, String)],
        functions: &[(String, String)],
    ) -> Result<(FileDescriptions, TokenUsage)> {
        let source_preview = if source.len() > 3000 {
            &source[..3000]
        } else {
            source
        };

        let iface_list: String = interfaces
            .iter()
            .map(|(name, sig)| {
                let excerpt = if sig.len() > 500 {
                    &sig[..500]
                } else {
                    sig.as_str()
                };
                format!("- {name}: {excerpt}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        let fn_list: String = functions
            .iter()
            .map(|(name, src)| {
                let excerpt = if src.len() > 800 {
                    &src[..800]
                } else {
                    src.as_str()
                };
                format!("- {name}: {excerpt}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        let language_name = match language {
            LanguageKind::Python => "Python",
            _ => "TypeScript",
        };
        let language_tag = match language {
            LanguageKind::Python => "python",
            _ => "typescript",
        };

        let prompt = build_analyze_prompt(
            language_name,
            language_tag,
            response_language,
            filename,
            source_preview,
            &iface_list,
            &fn_list,
        );

        let (text, usage) = self.converse_text(prompt).await?;

        // Strip markdown code fences if the model wraps its output (e.g. ```json ... ```).
        let json_text = strip_code_fences(&text);
        let descriptions: FileDescriptions = serde_json::from_str(json_text).map_err(|e| {
            anyhow::anyhow!("failed to parse FileDescriptions JSON: {e}\nText: {text}")
        })?;

        Ok((descriptions, usage))
    }

    /// Asks the AI to explain a single symbol (function, type, variable) in context.
    pub async fn explain_symbol(
        &self,
        response_language: ExplanationLanguage,
        filename: &str,
        symbol: &str,
        source: &str,
        context_files: &[(&str, &str)],
    ) -> Result<(String, TokenUsage)> {
        let source_preview = if source.len() > 2000 {
            &source[..2000]
        } else {
            source
        };
        let prompt = build_symbol_prompt(
            response_language,
            filename,
            symbol,
            source_preview,
            context_files,
        );
        let (text, usage) = self.converse_text(prompt).await?;
        let json_text = strip_code_fences(&text);
        let result: SymbolExplanation = serde_json::from_str(json_text).map_err(|e| {
            anyhow::anyhow!("failed to parse SymbolExplanation JSON: {e}\nText: {text}")
        })?;
        Ok((result.explanation, usage))
    }

    /// Asks the AI to generate a short explanation for a file when no structured analyzer exists.
    pub async fn summarize_file(
        &self,
        response_language: ExplanationLanguage,
        filename: &str,
        source: &str,
    ) -> Result<(String, TokenUsage)> {
        let source_preview = if source.len() > 3000 {
            &source[..3000]
        } else {
            source
        };

        let prompt = build_summary_prompt(response_language, filename, source_preview);

        let (text, usage) = self.converse_text(prompt).await?;
        let json_text = strip_code_fences(&text);
        let summary: FileOverview = serde_json::from_str(json_text)
            .map_err(|e| anyhow::anyhow!("failed to parse FileOverview JSON: {e}\nText: {text}"))?;

        Ok((summary.overview, usage))
    }

    /// Asks the AI to generate a guided code tour based on a user query.
    pub async fn generate_tour(
        &self,
        response_language: ExplanationLanguage,
        query: &str,
        files: &[(&str, &str)],
    ) -> Result<(TourResult, TokenUsage)> {
        let prompt = build_tour_prompt(response_language, query, files);
        let (text, usage) = self.converse_text(prompt).await?;
        let json_text = strip_code_fences(&text);
        let result: TourResult = serde_json::from_str(json_text)
            .map_err(|e| anyhow::anyhow!("failed to parse TourResult JSON: {e}\nText: {text}"))?;
        Ok((result, usage))
    }

    async fn converse_text(&self, prompt: String) -> Result<(String, TokenUsage)> {
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
            .map_err(|e| anyhow::anyhow!("Bedrock Converse API error: {e:#?}"))?;

        let usage = resp
            .usage
            .map(|u| TokenUsage {
                input_tokens: u.input_tokens.max(0) as u32,
                output_tokens: u.output_tokens.max(0) as u32,
            })
            .unwrap_or_default();

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

        Ok((text, usage))
    }
}

fn build_analyze_prompt(
    language_name: &str,
    language_tag: &str,
    response_language: ExplanationLanguage,
    filename: &str,
    source_preview: &str,
    iface_list: &str,
    fn_list: &str,
) -> String {
    format!(
        "You are a code documentation assistant. Analyze the {language_name} file below.\n\
         File: {filename}\n\
         Source (excerpt):\n```{language_tag}\n{source_preview}\n```\n\
         Interfaces to describe:\n{iface_list}\n\
         Functions to summarize:\n{fn_list}\n\
         {language_instruction}\n\
         Respond with ONLY valid JSON (no markdown fences):\n\
         {{\"overview\":\"...\",\"interfaces\":[{{\"name\":\"...\",\"description\":\"...\"}}],\"functions\":[{{\"name\":\"...\",\"summary\":\"...\"}}]}}\n\
         Keep overview to 1-2 sentences. If there are no items, use empty arrays.",
        language_instruction = response_language.prompt_instruction(),
    )
}

fn build_summary_prompt(
    response_language: ExplanationLanguage,
    filename: &str,
    source_preview: &str,
) -> String {
    format!(
        "You are a code documentation assistant. Summarize the purpose of the file below.\n\
         File: {filename}\n\
         Source (excerpt):\n```\n{source_preview}\n```\n\
         {language_instruction}\n\
         Respond with ONLY valid JSON (no markdown fences):\n\
         {{\"overview\":\"...\"}}\n\
         Keep overview to 1-2 sentences.",
        language_instruction = response_language.prompt_instruction(),
    )
}

#[derive(Debug, Deserialize)]
struct FileOverview {
    overview: String,
}

#[derive(Debug, Deserialize)]
struct SymbolExplanation {
    explanation: String,
}

fn build_symbol_prompt(
    response_language: ExplanationLanguage,
    filename: &str,
    symbol: &str,
    source_preview: &str,
    context_files: &[(&str, &str)],
) -> String {
    let context_section = if context_files.is_empty() {
        String::new()
    } else {
        let excerpts = context_files
            .iter()
            .map(|(path, content)| {
                let excerpt = if content.len() > 500 {
                    &content[..500]
                } else {
                    content
                };
                format!("## {path}\n```typescript\n{excerpt}\n```")
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        format!("Context from imported files:\n{excerpts}\n\n")
    };
    format!(
        "You are a code documentation assistant. Explain what the symbol `{symbol}` means in the context of the file below.\n\
         File: {filename}\n\
         Source (excerpt):\n```typescript\n{source_preview}\n```\n\n\
         {context_section}\
         {language_instruction}\n\
         Respond with ONLY valid JSON (no markdown fences):\n\
         {{\"explanation\":\"...\"}}\n\
         Keep explanation to 2-3 sentences. Explain what the symbol is and when it's used.",
        language_instruction = response_language.prompt_instruction(),
    )
}

fn build_tour_prompt(
    response_language: ExplanationLanguage,
    query: &str,
    files: &[(&str, &str)],
) -> String {
    let file_sections: String = files
        .iter()
        .map(|(path, source)| {
            let preview = if source.len() > 4000 {
                &source[..4000]
            } else {
                source
            };
            let numbered: String = preview
                .lines()
                .enumerate()
                .map(|(i, line)| format!("{:>4} | {}", i + 1, line))
                .collect::<Vec<_>>()
                .join("\n");
            format!("=== FILE: {path} ===\n{numbered}\n")
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are a senior engineer giving a code tour. The user wants to understand: \"{query}\"\n\n\
         Below are relevant source files with line numbers.\n\n\
         {file_sections}\n\n\
         Create a guided tour of 3 to 12 stops that walks through the code to answer the query.\n\
         Each stop must reference an exact file_path and line range (line_start, line_end) from the files above.\n\
         Keep each explanation to 1-3 sentences.\n\n\
         {language_instruction}\n\
         Respond with ONLY valid JSON (no markdown fences):\n\
         {{\"title\":\"...\",\"stops\":[{{\"file_path\":\"...\",\"line_start\":1,\"line_end\":5,\"explanation\":\"...\"}}]}}\n\
         The title should be a short summary of the tour (under 60 characters).",
        language_instruction = response_language.prompt_instruction(),
    )
}

/// Strips markdown code fences from a string, returning the inner content.
/// Handles ` ```json `, ` ``` `, and leading/trailing whitespace.
fn strip_code_fences(s: &str) -> &str {
    let s = s.trim();
    // Remove opening fence (```json or ```)
    let s = if let Some(rest) = s.strip_prefix("```") {
        // Skip optional language tag (e.g. "json\n")
        if let Some(newline) = rest.find('\n') {
            &rest[newline + 1..]
        } else {
            rest
        }
    } else {
        s
    };
    // Remove closing fence
    let s = if let Some(stripped) = s.trim_end().strip_suffix("```") {
        stripped
    } else {
        s
    };
    s.trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_usage_default_is_zero() {
        let usage = TokenUsage::default();
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.output_tokens, 0);
    }

    #[test]
    fn token_usage_serializes_and_deserializes() {
        let usage = TokenUsage {
            input_tokens: 123,
            output_tokens: 456,
        };
        let json = serde_json::to_string(&usage).unwrap();
        assert!(json.contains("\"input_tokens\":123"));
        assert!(json.contains("\"output_tokens\":456"));
        let restored: TokenUsage = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.input_tokens, 123);
        assert_eq!(restored.output_tokens, 456);
    }

    #[test]
    fn strip_code_fences_plain_json() {
        let input = r#"{"overview":"","interfaces":[],"functions":[]}"#;
        assert_eq!(strip_code_fences(input), input);
    }

    #[test]
    fn strip_code_fences_with_json_tag() {
        let input = "```json\n{\"overview\":\"\",\"interfaces\":[],\"functions\":[]}\n```";
        assert_eq!(
            strip_code_fences(input),
            r#"{"overview":"","interfaces":[],"functions":[]}"#
        );
    }

    #[test]
    fn strip_code_fences_without_language_tag() {
        let input = "```\n{\"overview\":\"\",\"interfaces\":[],\"functions\":[]}\n```";
        assert_eq!(
            strip_code_fences(input),
            r#"{"overview":"","interfaces":[],"functions":[]}"#
        );
    }

    #[test]
    fn strip_code_fences_with_surrounding_whitespace() {
        let input = "  ```json\n{\"a\":1}\n```  ";
        assert_eq!(strip_code_fences(input), r#"{"a":1}"#);
    }

    #[test]
    fn file_descriptions_deserializes_correctly() {
        let json = r#"{"overview":"Handles user records","interfaces":[{"name":"User","description":"A user entity"}],"functions":[{"name":"getUser","summary":"Fetches a user by ID"}]}"#;
        let desc: FileDescriptions = serde_json::from_str(json).unwrap();
        assert_eq!(desc.overview, "Handles user records");
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
        let interfaces = vec![(
            "User".to_string(),
            "interface User { id: number; }".to_string(),
        )];
        let _functions: Vec<(String, String)> = vec![];
        let language_name = "TypeScript";
        let language_tag = "typescript";

        let source_preview = if source.len() > 3000 {
            &source[..3000]
        } else {
            source
        };
        let iface_list: String = interfaces
            .iter()
            .map(|(name, sig)| {
                let excerpt = if sig.len() > 500 {
                    &sig[..500]
                } else {
                    sig.as_str()
                };
                format!("- {name}: {excerpt}")
            })
            .collect::<Vec<_>>()
            .join("\n");
        let fn_list = String::new();

        let prompt = build_analyze_prompt(
            language_name,
            language_tag,
            ExplanationLanguage::English,
            filename,
            source_preview,
            &iface_list,
            &fn_list,
        );

        assert!(prompt.contains("src/user.ts"));
        assert!(prompt.contains("- User: interface User"));
        assert!(prompt.contains("export interface User"));
        assert!(prompt.contains("\"overview\":\"...\""));
        assert!(prompt.contains("Write all descriptions and summaries in English"));
    }

    #[test]
    fn analyze_file_prompt_can_target_python() {
        let filename = "src/user.py";
        let source = "class User:\n    pass";
        let language_name = "Python";
        let language_tag = "python";

        let prompt = build_analyze_prompt(
            language_name,
            language_tag,
            ExplanationLanguage::Japanese,
            filename,
            source,
            "",
            "",
        );

        assert!(prompt.contains("Analyze the Python file below"));
        assert!(prompt.contains("```python"));
        assert!(prompt.contains("Write all descriptions and summaries in Japanese"));
    }

    #[test]
    fn file_descriptions_defaults_missing_overview() {
        let json = r#"{"interfaces":[],"functions":[]}"#;
        let desc: FileDescriptions = serde_json::from_str(json).unwrap();
        assert_eq!(desc.overview, "");
    }

    #[test]
    fn summarize_file_prompt_requests_overview_only() {
        let filename = "README.md";
        let source = "# Project\nA short description.";
        let prompt = build_summary_prompt(ExplanationLanguage::English, filename, source);

        assert!(prompt.contains("Summarize the purpose of the file below"));
        assert!(prompt.contains("\"overview\":\"...\""));
        assert!(prompt.contains("Write all descriptions and summaries in English"));
    }

    #[test]
    fn summarize_file_prompt_can_target_japanese() {
        let prompt = build_summary_prompt(
            ExplanationLanguage::Japanese,
            "README.md",
            "# Project\nA short description.",
        );

        assert!(prompt.contains("Write all descriptions and summaries in Japanese"));
    }

    #[test]
    fn symbol_prompt_contains_symbol_and_filename() {
        let prompt = build_symbol_prompt(
            ExplanationLanguage::English,
            "src/user.ts",
            "UserService",
            "export class UserService { getUser(id: number) {} }",
            &[],
        );
        assert!(prompt.contains("UserService"));
        assert!(prompt.contains("src/user.ts"));
        assert!(prompt.contains("\"explanation\":\"...\""));
    }

    #[test]
    fn symbol_prompt_includes_context_file() {
        let context = [("src/types.ts", "export interface User { id: number; }")];
        let prompt = build_symbol_prompt(
            ExplanationLanguage::English,
            "src/user.ts",
            "User",
            "import { User } from './types';",
            &context,
        );
        assert!(prompt.contains("src/types.ts"));
        assert!(prompt.contains("Context from imported files"));
        assert!(prompt.contains("export interface User"));
    }

    #[test]
    fn symbol_prompt_respects_language() {
        let prompt = build_symbol_prompt(
            ExplanationLanguage::Japanese,
            "src/user.ts",
            "getUser",
            "export function getUser() {}",
            &[],
        );
        assert!(prompt.contains("Write all descriptions and summaries in Japanese"));
    }

    #[test]
    fn symbol_explanation_deserializes_correctly() {
        let json = r#"{"explanation":"UserService manages user CRUD operations."}"#;
        let result: SymbolExplanation = serde_json::from_str(json).unwrap();
        assert_eq!(
            result.explanation,
            "UserService manages user CRUD operations."
        );
    }

    #[test]
    fn tour_result_deserializes_correctly() {
        let json = r#"{"title":"Auth flow","stops":[{"file_path":"src/auth.ts","line_start":1,"line_end":5,"explanation":"Entry point."}]}"#;
        let result: TourResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.title, "Auth flow");
        assert_eq!(result.stops.len(), 1);
        assert_eq!(result.stops[0].file_path, "src/auth.ts");
        assert_eq!(result.stops[0].line_start, 1);
        assert_eq!(result.stops[0].line_end, 5);
        assert_eq!(result.stops[0].explanation, "Entry point.");
    }

    #[test]
    fn tour_prompt_contains_query_and_files() {
        let files = [(
            "src/auth.ts",
            "import { OAuth } from './oauth';\nexport async function login() {\n  return;\n}\n",
        )];
        let prompt = build_tour_prompt(ExplanationLanguage::English, "Explain auth flow", &files);
        assert!(prompt.contains("Explain auth flow"));
        assert!(prompt.contains("=== FILE: src/auth.ts ==="));
        assert!(prompt.contains("   1 | import { OAuth }"));
        assert!(prompt.contains("\"title\":\"...\""));
        assert!(prompt.contains("\"stops\""));
        assert!(prompt.contains("Write all descriptions and summaries in English"));
    }

    #[test]
    fn tour_prompt_respects_language() {
        let files = [("src/main.ts", "console.log('hello');")];
        let prompt =
            build_tour_prompt(ExplanationLanguage::Japanese, "Explain entry point", &files);
        assert!(prompt.contains("Write all descriptions and summaries in Japanese"));
    }

    #[test]
    fn tour_stop_serializes_correctly() {
        let stop = TourStop {
            file_path: "src/index.ts".to_string(),
            line_start: 10,
            line_end: 20,
            explanation: "Main entry.".to_string(),
        };
        let json = serde_json::to_string(&stop).unwrap();
        assert!(json.contains("\"file_path\":\"src/index.ts\""));
        assert!(json.contains("\"line_start\":10"));
    }
}
