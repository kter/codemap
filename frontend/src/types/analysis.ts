export interface AnnotatedInterface {
  name: string;
  line: number;
  signature: string;
  description: string;
}

export interface AnnotatedHappyPath {
  name: string;
  line: number;
  summary: string;
}

export interface FileResult {
  path: string;
  source_code: string;
  interfaces: AnnotatedInterface[];
  happy_paths: AnnotatedHappyPath[];
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AnalyzeResponse {
  owner: string;
  repo: string;
  git_ref: string;
  files: FileResult[];
  token_usage?: TokenUsage;
}

export type ExplanationLanguage = "en" | "ja";

export type FileExplanationKind = "structured" | "summary";

export interface FileExplanation {
  path: string;
  kind: FileExplanationKind;
  overview: string;
  interfaces: AnnotatedInterface[];
  happy_paths: AnnotatedHappyPath[];
  token_usage?: TokenUsage;
}

export interface SymbolExplanationResponse {
  symbol: string;
  explanation: string;
  token_usage?: TokenUsage;
}

export type FileExplanationStatus = "idle" | "loading" | "ready" | "error";

export interface NavigationTarget {
  filePath: string;
  line: number; // 1-based
}

export interface TreeResponse {
  owner: string;
  repo: string;
  git_ref: string;
  paths: string[];
}

export interface TourStop {
  file_path: string;
  line_start: number;
  line_end: number;
  explanation: string;
}

export interface TourResponse {
  query: string;
  title: string;
  stops: TourStop[];
  token_usage?: TokenUsage;
}

export type TourStatus = "idle" | "loading" | "playing" | "finished";

export interface SearchMatch {
  path: string;
  line: number;
  content: string;
}

export interface SearchResponse {
  matches: SearchMatch[];
  searched_files: number;
  truncated: boolean;
}
