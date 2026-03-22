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
  interfaces: AnnotatedInterface[];
  happy_paths: AnnotatedHappyPath[];
}

export interface AnalyzeResponse {
  owner: string;
  repo: string;
  git_ref: string;
  files: FileResult[];
}
