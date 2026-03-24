use serde::{Deserialize, Serialize};
use std::fmt;

/// A Git commit SHA.
///
/// # Examples
///
/// ```
/// use codemap_core::CommitSha;
///
/// let sha = CommitSha::new("abc123def456".to_string());
/// assert_eq!(sha.as_str(), "abc123def456");
/// assert_eq!(sha.to_string(), "abc123def456");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CommitSha(String);

impl CommitSha {
    /// Creates a new `CommitSha`.
    pub fn new(sha: String) -> Self {
        Self(sha)
    }

    /// Returns the SHA as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CommitSha {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A file path within a repository.
///
/// # Examples
///
/// ```
/// use codemap_core::FilePath;
///
/// let path = FilePath::new("src/main.rs".to_string());
/// assert_eq!(path.as_str(), "src/main.rs");
/// assert_eq!(path.to_string(), "src/main.rs");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FilePath(String);

impl FilePath {
    /// Creates a new `FilePath`.
    pub fn new(path: String) -> Self {
        Self(path)
    }

    /// Returns the path as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for FilePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A symbol name (function, class, interface, etc.).
///
/// # Examples
///
/// ```
/// use codemap_core::SymbolName;
///
/// let name = SymbolName::new("MyInterface".to_string());
/// assert_eq!(name.as_str(), "MyInterface");
/// assert_eq!(name.to_string(), "MyInterface");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SymbolName(String);

impl SymbolName {
    /// Creates a new `SymbolName`.
    pub fn new(name: String) -> Self {
        Self(name)
    }

    /// Returns the name as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SymbolName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// The programming language of a file.
///
/// # Examples
///
/// ```
/// use codemap_core::LanguageKind;
///
/// assert_eq!(LanguageKind::from_extension("ts"), LanguageKind::TypeScript);
/// assert_eq!(LanguageKind::from_extension("js"), LanguageKind::JavaScript);
/// assert_eq!(LanguageKind::from_extension("rs"), LanguageKind::Rust);
/// assert_eq!(LanguageKind::from_extension("py"), LanguageKind::Python);
/// assert_eq!(LanguageKind::from_extension("go"), LanguageKind::Unknown);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LanguageKind {
    TypeScript,
    JavaScript,
    Rust,
    Python,
    Unknown,
}

impl LanguageKind {
    /// Returns the `LanguageKind` for the given file extension.
    pub fn from_extension(ext: &str) -> Self {
        match ext {
            "ts" | "tsx" => Self::TypeScript,
            "js" | "jsx" | "mjs" | "cjs" => Self::JavaScript,
            "rs" => Self::Rust,
            "py" => Self::Python,
            _ => Self::Unknown,
        }
    }
}

impl fmt::Display for LanguageKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::TypeScript => "TypeScript",
            Self::JavaScript => "JavaScript",
            Self::Rust => "Rust",
            Self::Python => "Python",
            Self::Unknown => "Unknown",
        };
        write!(f, "{s}")
    }
}

/// The language used for AI-generated explanations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum ExplanationLanguage {
    #[default]
    #[serde(rename = "en")]
    English,
    #[serde(rename = "ja")]
    Japanese,
}

impl ExplanationLanguage {
    /// Returns a human-readable label for prompts and UI.
    pub fn label(self) -> &'static str {
        match self {
            Self::English => "English",
            Self::Japanese => "Japanese",
        }
    }

    /// Returns a prompt instruction that constrains the response language.
    pub fn prompt_instruction(self) -> &'static str {
        match self {
            Self::English => {
                "Write all descriptions and summaries in English. Preserve code identifiers as-is."
            }
            Self::Japanese => {
                "Write all descriptions and summaries in Japanese. Preserve code identifiers as-is."
            }
        }
    }
}
