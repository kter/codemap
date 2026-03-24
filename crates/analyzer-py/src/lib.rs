use codemap_analyzer::{
    AnalysisResult, AnalyzerError, ExtractedInterface, HappyPathStep, LanguageAnalyzer,
};
use codemap_core::{FilePath, LanguageKind, SymbolName};
use tree_sitter::{Node, Parser};

pub struct DiscoveredFunction {
    pub name: String,
    pub file: FilePath,
    pub line: u32,
    pub source_text: String,
}

pub struct PythonAnalyzer;

impl PythonAnalyzer {
    pub fn new() -> Self {
        Self
    }

    pub fn analyze_with_functions(
        &self,
        file: FilePath,
        source: &str,
    ) -> Result<(AnalysisResult, Vec<DiscoveredFunction>), AnalyzerError> {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_python::LANGUAGE.into())
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
        let mut interfaces = Vec::new();
        let mut functions = Vec::new();

        for i in 0..root.named_child_count() {
            let Some(child) = root.named_child(i) else {
                continue;
            };

            match child.kind() {
                "class_definition" => {
                    self.collect_class(
                        child,
                        file.clone(),
                        src_bytes,
                        &mut interfaces,
                        &mut functions,
                    );
                }
                "function_definition" => {
                    self.collect_function(child, file.clone(), src_bytes, &mut functions);
                }
                "decorated_definition" => {
                    self.collect_decorated_definition(
                        child,
                        file.clone(),
                        src_bytes,
                        &mut interfaces,
                        &mut functions,
                    );
                }
                "type_alias_statement" => {
                    if let Some(alias) = extract_type_alias(child, file.clone(), src_bytes) {
                        interfaces.push(alias);
                    }
                }
                "expression_statement" => {
                    self.collect_expression_statement(
                        child,
                        file.clone(),
                        src_bytes,
                        &mut interfaces,
                    );
                }
                _ => {}
            }
        }

        let happy_paths = functions
            .iter()
            .map(|function| {
                vec![HappyPathStep {
                    symbol: SymbolName::new(function.name.clone()),
                    file: function.file.clone(),
                    line: function.line,
                }]
            })
            .collect();

        let result = AnalysisResult {
            file,
            language: LanguageKind::Python,
            interfaces,
            happy_paths,
        };

        Ok((result, functions))
    }

    fn collect_decorated_definition(
        &self,
        node: Node<'_>,
        file: FilePath,
        src_bytes: &[u8],
        interfaces: &mut Vec<ExtractedInterface>,
        functions: &mut Vec<DiscoveredFunction>,
    ) {
        let Some(definition) = node.child_by_field_name("definition") else {
            return;
        };

        match definition.kind() {
            "class_definition" => {
                let _is_dataclass = has_decorator(node, src_bytes, "dataclass");
                self.collect_class(definition, file, src_bytes, interfaces, functions);
            }
            "function_definition" => {
                self.collect_function(definition, file, src_bytes, functions);
            }
            _ => {}
        }
    }

    fn collect_class(
        &self,
        node: Node<'_>,
        file: FilePath,
        src_bytes: &[u8],
        interfaces: &mut Vec<ExtractedInterface>,
        functions: &mut Vec<DiscoveredFunction>,
    ) {
        let Some(name_node) = node.child_by_field_name("name") else {
            return;
        };
        let Ok(name) = name_node.utf8_text(src_bytes) else {
            return;
        };
        if is_private_name(name) {
            return;
        }

        let _is_typed_dict = is_typed_dict_class(node, src_bytes);
        interfaces.push(ExtractedInterface {
            name: SymbolName::new(name.to_string()),
            file: file.clone(),
            line: node.start_position().row as u32 + 1,
            signature: node.utf8_text(src_bytes).unwrap_or("").to_string(),
        });

        let Some(body) = node.child_by_field_name("body") else {
            return;
        };
        for i in 0..body.named_child_count() {
            let Some(child) = body.named_child(i) else {
                continue;
            };
            match child.kind() {
                "function_definition" => {
                    self.collect_function(child, file.clone(), src_bytes, functions);
                }
                "decorated_definition" => {
                    if let Some(definition) = child.child_by_field_name("definition") {
                        if definition.kind() == "function_definition" {
                            self.collect_function(definition, file.clone(), src_bytes, functions);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn collect_function(
        &self,
        node: Node<'_>,
        file: FilePath,
        src_bytes: &[u8],
        functions: &mut Vec<DiscoveredFunction>,
    ) {
        let Some(name_node) = node.child_by_field_name("name") else {
            return;
        };
        let Ok(name) = name_node.utf8_text(src_bytes) else {
            return;
        };
        if is_private_name(name) {
            return;
        }

        functions.push(DiscoveredFunction {
            name: name.to_string(),
            file,
            line: node.start_position().row as u32 + 1,
            source_text: node.utf8_text(src_bytes).unwrap_or("").to_string(),
        });
    }

    fn collect_expression_statement(
        &self,
        node: Node<'_>,
        file: FilePath,
        src_bytes: &[u8],
        interfaces: &mut Vec<ExtractedInterface>,
    ) {
        for i in 0..node.named_child_count() {
            let Some(child) = node.named_child(i) else {
                continue;
            };
            if child.kind() != "assignment" {
                continue;
            }
            if let Some(interface) = extract_assignment_interface(child, file.clone(), src_bytes) {
                interfaces.push(interface);
            }
        }
    }
}

fn extract_type_alias(
    node: Node<'_>,
    file: FilePath,
    src_bytes: &[u8],
) -> Option<ExtractedInterface> {
    let left = node.child_by_field_name("left")?;
    let alias_name = extract_type_alias_name(left, src_bytes)?;
    if is_private_name(&alias_name) {
        return None;
    }

    Some(ExtractedInterface {
        name: SymbolName::new(alias_name),
        file,
        line: node.start_position().row as u32 + 1,
        signature: node.utf8_text(src_bytes).unwrap_or("").to_string(),
    })
}

fn extract_type_alias_name(node: Node<'_>, src_bytes: &[u8]) -> Option<String> {
    if node.kind() == "identifier" {
        return node.utf8_text(src_bytes).ok().map(ToString::to_string);
    }

    for i in 0..node.named_child_count() {
        let child = node.named_child(i)?;
        if let Some(name) = extract_type_alias_name(child, src_bytes) {
            return Some(name);
        }
    }

    None
}

fn extract_assignment_interface(
    node: Node<'_>,
    file: FilePath,
    src_bytes: &[u8],
) -> Option<ExtractedInterface> {
    let left = node.child_by_field_name("left")?;
    let right = node.child_by_field_name("right")?;
    let name = extract_identifier(left, src_bytes)?;
    if is_private_name(&name) {
        return None;
    }

    let is_type_alias = node
        .child_by_field_name("type")
        .and_then(|type_node| type_node.utf8_text(src_bytes).ok())
        .map(|type_name| type_name.contains("TypeAlias"))
        .unwrap_or(false);

    let is_typed_dict = is_typed_dict_assignment(right, src_bytes);
    let looks_like_alias = is_type_alias || is_typed_dict || looks_like_type_expression(right);
    if !looks_like_alias {
        return None;
    }

    Some(ExtractedInterface {
        name: SymbolName::new(name),
        file,
        line: node.start_position().row as u32 + 1,
        signature: node.utf8_text(src_bytes).unwrap_or("").to_string(),
    })
}

fn has_decorator(node: Node<'_>, src_bytes: &[u8], expected: &str) -> bool {
    for i in 0..node.named_child_count() {
        let Some(child) = node.named_child(i) else {
            continue;
        };
        if child.kind() != "decorator" {
            continue;
        }
        if let Ok(text) = child.utf8_text(src_bytes) {
            let normalized = text.trim_start_matches('@');
            if normalized == expected || normalized.starts_with(&format!("{expected}(")) {
                return true;
            }
            if normalized.ends_with(&format!(".{expected}"))
                || normalized.contains(&format!(".{expected}("))
            {
                return true;
            }
        }
    }
    false
}

fn is_typed_dict_class(node: Node<'_>, src_bytes: &[u8]) -> bool {
    let Some(superclasses) = node.child_by_field_name("superclasses") else {
        return false;
    };

    let Ok(text) = superclasses.utf8_text(src_bytes) else {
        return false;
    };
    text.contains("TypedDict")
}

fn is_typed_dict_assignment(node: Node<'_>, src_bytes: &[u8]) -> bool {
    if node.kind() != "call" {
        return false;
    }

    let Some(function) = node.child_by_field_name("function") else {
        return false;
    };
    let Some(name) = extract_identifier(function, src_bytes) else {
        return false;
    };
    name == "TypedDict"
}

fn looks_like_type_expression(node: Node<'_>) -> bool {
    match node.kind() {
        "identifier" | "attribute" | "subscript" | "generic_type" | "union_type"
        | "member_type" | "type" => true,
        "call" => false,
        _ => false,
    }
}

fn extract_identifier(node: Node<'_>, src_bytes: &[u8]) -> Option<String> {
    match node.kind() {
        "identifier" => node.utf8_text(src_bytes).ok().map(ToString::to_string),
        "attribute" => {
            for i in 0..node.named_child_count() {
                let child = node.named_child(i)?;
                if child.kind() == "identifier" {
                    return child.utf8_text(src_bytes).ok().map(ToString::to_string);
                }
            }
            None
        }
        _ => {
            for i in 0..node.named_child_count() {
                let child = node.named_child(i)?;
                if let Some(name) = extract_identifier(child, src_bytes) {
                    return Some(name);
                }
            }
            None
        }
    }
}

fn is_private_name(name: &str) -> bool {
    name.starts_with('_')
}

impl Default for PythonAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageAnalyzer for PythonAnalyzer {
    fn language(&self) -> LanguageKind {
        LanguageKind::Python
    }

    fn analyze(&self, file: FilePath, source: &str) -> Result<AnalysisResult, AnalyzerError> {
        let (result, _) = self.analyze_with_functions(file, source)?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PY: &str = r#"
from dataclasses import dataclass
from typing import TypeAlias, TypedDict

type UserId = int
AliasViaAnnotation: TypeAlias = list[str]
Payload = dict[str, str]

class User(TypedDict):
    id: int
    name: str

@dataclass
class Account:
    id: int
    email: str

def create_user(user_id: UserId) -> Account:
    return Account(id=user_id, email="a@example.com")

def _private_helper() -> None:
    return None

class Service:
    def run(self) -> Account:
        return create_user(1)

    def _internal(self) -> None:
        return None
"#;

    #[test]
    fn language_is_python() {
        let analyzer = PythonAnalyzer::new();
        assert_eq!(analyzer.language(), LanguageKind::Python);
    }

    #[test]
    fn analyze_returns_empty_result() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/main.py".to_string());
        let result = analyzer.analyze(file, "").unwrap();
        assert!(result.interfaces.is_empty());
        assert!(result.happy_paths.is_empty());
    }

    #[test]
    fn analyze_preserves_file_path() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/main.py".to_string());
        let result = analyzer.analyze(file.clone(), "").unwrap();
        assert_eq!(result.file, file);
    }

    #[test]
    fn default_constructor_works() {
        let analyzer = PythonAnalyzer::default();
        assert_eq!(analyzer.language(), LanguageKind::Python);
    }

    #[test]
    fn extracts_class_declarations() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/models.py".to_string());
        let (result, _) = analyzer.analyze_with_functions(file, SAMPLE_PY).unwrap();
        let names: Vec<&str> = result.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"Account"));
    }

    #[test]
    fn extracts_typed_dict_declarations() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/models.py".to_string());
        let (result, _) = analyzer.analyze_with_functions(file, SAMPLE_PY).unwrap();
        let names: Vec<&str> = result.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"User"));
    }

    #[test]
    fn extracts_type_aliases() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/models.py".to_string());
        let (result, _) = analyzer.analyze_with_functions(file, SAMPLE_PY).unwrap();
        let names: Vec<&str> = result.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"UserId"));
        assert!(names.contains(&"AliasViaAnnotation"));
        assert!(names.contains(&"Payload"));
    }

    #[test]
    fn extracts_public_functions_and_methods() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/models.py".to_string());
        let (_, functions) = analyzer.analyze_with_functions(file, SAMPLE_PY).unwrap();
        let names: Vec<&str> = functions.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"create_user"));
        assert!(names.contains(&"run"));
    }

    #[test]
    fn excludes_private_functions_and_methods() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/models.py".to_string());
        let (_, functions) = analyzer.analyze_with_functions(file, SAMPLE_PY).unwrap();
        let names: Vec<&str> = functions.iter().map(|f| f.name.as_str()).collect();
        assert!(!names.contains(&"_private_helper"));
        assert!(!names.contains(&"_internal"));
    }

    #[test]
    fn preserves_line_numbers() {
        let analyzer = PythonAnalyzer::new();
        let file = FilePath::new("src/models.py".to_string());
        let (result, functions) = analyzer.analyze_with_functions(file, SAMPLE_PY).unwrap();
        let account = result
            .interfaces
            .iter()
            .find(|interface| interface.name.as_str() == "Account")
            .unwrap();
        let run = functions
            .iter()
            .find(|function| function.name == "run")
            .unwrap();
        assert_eq!(account.line, 14);
        assert_eq!(run.line, 25);
    }
}
