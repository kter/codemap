use codemap_core::{FilePath, LanguageKind, SymbolName};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// An extracted interface or type definition from source code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedInterface {
    pub name: SymbolName,
    pub file: FilePath,
    pub line: u32,
    pub signature: String,
}

/// A single step in a happy-path execution trace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HappyPathStep {
    pub symbol: SymbolName,
    pub file: FilePath,
    pub line: u32,
}

/// The result of analyzing a single source file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub file: FilePath,
    pub language: LanguageKind,
    pub interfaces: Vec<ExtractedInterface>,
    pub happy_paths: Vec<Vec<HappyPathStep>>,
}

/// Errors that can occur during code analysis.
#[derive(Debug, Error)]
pub enum AnalyzerError {
    #[error("parse error in {file}: {message}")]
    ParseError { file: FilePath, message: String },

    #[error("unsupported language: {0}")]
    UnsupportedLanguage(LanguageKind),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Trait for language-specific code analyzers.
///
/// Implementors must be `Send + Sync` to allow use in async contexts.
pub trait LanguageAnalyzer: Send + Sync {
    /// Returns the language this analyzer handles.
    fn language(&self) -> LanguageKind;

    /// Analyzes the given source file and returns structured results.
    fn analyze(&self, file: FilePath, source: &str) -> Result<AnalysisResult, AnalyzerError>;
}
