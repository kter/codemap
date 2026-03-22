use codemap_analyzer::{
    AnalysisResult, AnalyzerError, ExtractedInterface, HappyPathStep, LanguageAnalyzer,
};
use codemap_core::{FilePath, LanguageKind, SymbolName};
use streaming_iterator::StreamingIterator;
use tree_sitter::{Language, Parser, Query, QueryCursor};

/// An exported function or arrow function extracted from a TypeScript file.
pub struct ExportedFunction {
    pub name: String,
    pub file: FilePath,
    pub line: u32,
    pub source_text: String,
}

/// TypeScript/TSX language analyzer backed by tree-sitter.
pub struct TypeScriptAnalyzer;

impl TypeScriptAnalyzer {
    /// Creates a new `TypeScriptAnalyzer`.
    pub fn new() -> Self {
        Self
    }

    /// Analyzes the file and returns both the `AnalysisResult` and extracted functions.
    pub fn analyze_with_functions(
        &self,
        file: FilePath,
        source: &str,
    ) -> Result<(AnalysisResult, Vec<ExportedFunction>), AnalyzerError> {
        let lang = ts_language(&file);

        let mut parser = Parser::new();
        parser
            .set_language(&lang)
            .map_err(|e| AnalyzerError::ParseError {
                file: file.clone(),
                message: e.to_string(),
            })?;

        let tree = parser
            .parse(source, None)
            .ok_or_else(|| AnalyzerError::ParseError {
                file: file.clone(),
                message: "tree-sitter parse returned None".to_string(),
            })?;

        let root = tree.root_node();
        let src_bytes = source.as_bytes();

        // --- interfaces ---
        let iface_query_str = "(interface_declaration name: (type_identifier) @name) @iface";
        let iface_query =
            Query::new(&lang, iface_query_str).map_err(|e| AnalyzerError::ParseError {
                file: file.clone(),
                message: e.to_string(),
            })?;
        let iface_name_idx = iface_query.capture_index_for_name("name").unwrap();
        let iface_node_idx = iface_query.capture_index_for_name("iface").unwrap();

        let mut interfaces: Vec<ExtractedInterface> = Vec::new();
        let mut cursor = QueryCursor::new();
        let mut iface_matches = cursor.matches(&iface_query, root, src_bytes);
        while let Some(m) = iface_matches.next() {
            let name_node = m.nodes_for_capture_index(iface_name_idx).next().unwrap();
            let iface_node = m.nodes_for_capture_index(iface_node_idx).next().unwrap();
            let name = name_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let signature = iface_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let line = iface_node.start_position().row as u32 + 1;
            interfaces.push(ExtractedInterface {
                name: SymbolName::new(name),
                file: file.clone(),
                line,
                signature,
            });
        }

        // --- type aliases ---
        let alias_query_str = "(type_alias_declaration name: (type_identifier) @name) @alias";
        let alias_query =
            Query::new(&lang, alias_query_str).map_err(|e| AnalyzerError::ParseError {
                file: file.clone(),
                message: e.to_string(),
            })?;
        let alias_name_idx = alias_query.capture_index_for_name("name").unwrap();
        let alias_node_idx = alias_query.capture_index_for_name("alias").unwrap();

        let mut cursor2 = QueryCursor::new();
        let mut alias_matches = cursor2.matches(&alias_query, root, src_bytes);
        while let Some(m) = alias_matches.next() {
            let name_node = m.nodes_for_capture_index(alias_name_idx).next().unwrap();
            let alias_node = m.nodes_for_capture_index(alias_node_idx).next().unwrap();
            let name = name_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let signature = alias_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let line = alias_node.start_position().row as u32 + 1;
            interfaces.push(ExtractedInterface {
                name: SymbolName::new(name),
                file: file.clone(),
                line,
                signature,
            });
        }

        // --- exported functions ---
        let fn_query_str =
            "(export_statement declaration: (function_declaration name: (identifier) @name)) @fn";
        let fn_query = Query::new(&lang, fn_query_str).map_err(|e| AnalyzerError::ParseError {
            file: file.clone(),
            message: e.to_string(),
        })?;
        let fn_name_idx = fn_query.capture_index_for_name("name").unwrap();
        let fn_node_idx = fn_query.capture_index_for_name("fn").unwrap();

        let mut exported_fns: Vec<ExportedFunction> = Vec::new();
        let mut cursor3 = QueryCursor::new();
        let mut fn_matches = cursor3.matches(&fn_query, root, src_bytes);
        while let Some(m) = fn_matches.next() {
            let name_node = m.nodes_for_capture_index(fn_name_idx).next().unwrap();
            let fn_node = m.nodes_for_capture_index(fn_node_idx).next().unwrap();
            let name = name_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let source_text = fn_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let line = fn_node.start_position().row as u32 + 1;
            exported_fns.push(ExportedFunction {
                name,
                file: file.clone(),
                line,
                source_text,
            });
        }

        // --- exported arrow functions ---
        let arrow_query_str = "(export_statement declaration: (lexical_declaration
  (variable_declarator name: (identifier) @name value: (arrow_function)))) @arrow";
        let arrow_query =
            Query::new(&lang, arrow_query_str).map_err(|e| AnalyzerError::ParseError {
                file: file.clone(),
                message: e.to_string(),
            })?;
        let arrow_name_idx = arrow_query.capture_index_for_name("name").unwrap();
        let arrow_node_idx = arrow_query.capture_index_for_name("arrow").unwrap();

        let mut cursor4 = QueryCursor::new();
        let mut arrow_matches = cursor4.matches(&arrow_query, root, src_bytes);
        while let Some(m) = arrow_matches.next() {
            let name_node = m.nodes_for_capture_index(arrow_name_idx).next().unwrap();
            let arrow_node = m.nodes_for_capture_index(arrow_node_idx).next().unwrap();
            let name = name_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let source_text = arrow_node.utf8_text(src_bytes).unwrap_or("").to_string();
            let line = arrow_node.start_position().row as u32 + 1;
            exported_fns.push(ExportedFunction {
                name,
                file: file.clone(),
                line,
                source_text,
            });
        }

        // Convert exported functions to happy path steps
        let happy_paths: Vec<Vec<HappyPathStep>> = exported_fns
            .iter()
            .map(|f| {
                vec![HappyPathStep {
                    symbol: SymbolName::new(f.name.clone()),
                    file: f.file.clone(),
                    line: f.line,
                }]
            })
            .collect();

        let result = AnalysisResult {
            file,
            language: LanguageKind::TypeScript,
            interfaces,
            happy_paths,
        };

        Ok((result, exported_fns))
    }
}

fn ts_language(file: &FilePath) -> Language {
    if file.as_str().ends_with(".tsx") {
        tree_sitter_typescript::LANGUAGE_TSX.into()
    } else {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
    }
}

impl Default for TypeScriptAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageAnalyzer for TypeScriptAnalyzer {
    fn language(&self) -> LanguageKind {
        LanguageKind::TypeScript
    }

    fn analyze(&self, file: FilePath, source: &str) -> Result<AnalysisResult, AnalyzerError> {
        let (result, _) = self.analyze_with_functions(file, source)?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codemap_core::{FilePath, LanguageKind};

    #[test]
    fn language_is_typescript() {
        let analyzer = TypeScriptAnalyzer::new();
        assert_eq!(analyzer.language(), LanguageKind::TypeScript);
    }

    #[test]
    fn analyze_returns_empty_result() {
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/index.ts".to_string());
        let result = analyzer.analyze(file, "").unwrap();
        assert!(result.interfaces.is_empty());
        assert!(result.happy_paths.is_empty());
    }

    #[test]
    fn analyze_preserves_file_path() {
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/index.ts".to_string());
        let result = analyzer.analyze(file.clone(), "").unwrap();
        assert_eq!(result.file, file);
    }

    #[test]
    fn default_constructor_works() {
        let analyzer = TypeScriptAnalyzer::default();
        assert_eq!(analyzer.language(), LanguageKind::TypeScript);
    }

    const SAMPLE_TS: &str = r#"
export interface User {
    id: number;
    name: string;
}

export type UserId = number;

export function getUser(id: UserId): User {
    return { id, name: "Alice" };
}

export const createUser = (name: string): User => {
    return { id: 1, name };
};

function internalHelper() {
    return 42;
}
"#;

    #[test]
    fn extracts_interface() {
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/user.ts".to_string());
        let (result, _) = analyzer.analyze_with_functions(file, SAMPLE_TS).unwrap();
        let names: Vec<&str> = result.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(
            names.contains(&"User"),
            "expected 'User' in interfaces, got: {names:?}"
        );
    }

    #[test]
    fn extracts_type_alias() {
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/user.ts".to_string());
        let (result, _) = analyzer.analyze_with_functions(file, SAMPLE_TS).unwrap();
        let names: Vec<&str> = result.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(
            names.contains(&"UserId"),
            "expected 'UserId' in interfaces, got: {names:?}"
        );
    }

    #[test]
    fn extracts_exported_function() {
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/user.ts".to_string());
        let (_, fns) = analyzer.analyze_with_functions(file, SAMPLE_TS).unwrap();
        let names: Vec<&str> = fns.iter().map(|f| f.name.as_str()).collect();
        assert!(
            names.contains(&"getUser"),
            "expected 'getUser' in functions, got: {names:?}"
        );
    }

    #[test]
    fn extracts_exported_arrow_function() {
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/user.ts".to_string());
        let (_, fns) = analyzer.analyze_with_functions(file, SAMPLE_TS).unwrap();
        let names: Vec<&str> = fns.iter().map(|f| f.name.as_str()).collect();
        assert!(
            names.contains(&"createUser"),
            "expected 'createUser' in functions, got: {names:?}"
        );
    }

    #[test]
    fn tsx_file_uses_tsx_parser() {
        let tsx_source = r#"
export interface ButtonProps {
    label: string;
    onClick: () => void;
}
export const Button = ({ label, onClick }: ButtonProps) => {
    return <button onClick={onClick}>{label}</button>;
};
"#;
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/Button.tsx".to_string());
        let (result, _) = analyzer.analyze_with_functions(file, tsx_source).unwrap();
        let names: Vec<&str> = result.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(
            names.contains(&"ButtonProps"),
            "expected 'ButtonProps', got: {names:?}"
        );
    }

    #[test]
    fn non_exported_function_not_included() {
        let analyzer = TypeScriptAnalyzer::new();
        let file = FilePath::new("src/user.ts".to_string());
        let (_, fns) = analyzer.analyze_with_functions(file, SAMPLE_TS).unwrap();
        let names: Vec<&str> = fns.iter().map(|f| f.name.as_str()).collect();
        assert!(
            !names.contains(&"internalHelper"),
            "expected 'internalHelper' NOT in functions, got: {names:?}"
        );
    }
}
