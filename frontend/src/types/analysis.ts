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

export interface AnalyzeResponse {
  owner: string;
  repo: string;
  git_ref: string;
  files: FileResult[];
}

export type ExplanationLanguage = "en" | "ja";

export type FileExplanationKind = "structured" | "summary";

export interface FileExplanation {
  path: string;
  kind: FileExplanationKind;
  overview: string;
  interfaces: AnnotatedInterface[];
  happy_paths: AnnotatedHappyPath[];
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
