"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import type {
  ExplanationLanguage,
  FileResult,
  NavigationTarget,
  SymbolExplanationResponse,
} from "@/types/analysis";
import { resolveImports } from "@/lib/imports";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

export const NAVIGATION_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
] as const;

export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    rs: "rust",
    py: "python",
    css: "css",
    html: "html",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
    go: "go",
  };
  return map[ext] ?? "plaintext";
}

export function findDefinition(
  name: string,
  files: FileResult[],
): NavigationTarget | null {
  for (const file of files) {
    for (const iface of file.interfaces) {
      if (iface.name === name) return { filePath: file.path, line: iface.line };
    }
    for (const fn of file.happy_paths) {
      if (fn.name === name) return { filePath: file.path, line: fn.line };
    }
  }
  return null;
}

export interface ReferenceLocation {
  filePath: string;
  line: number;
  startColumn: number;
  endColumn: number;
}

export function findReferences(
  name: string,
  files: FileResult[],
): ReferenceLocation[] {
  const pattern = new RegExp(`\\b${name}\\b`, "g");
  const results: ReferenceLocation[] = [];
  for (const file of files) {
    const lines = file.source_code.split("\n");
    lines.forEach((line, idx) => {
      let m: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((m = pattern.exec(line)) !== null) {
        results.push({
          filePath: file.path,
          line: idx + 1,
          startColumn: m.index + 1,
          endColumn: m.index + name.length + 1,
        });
      }
    });
  }
  return results;
}

export function buildSymbolCacheKey(
  owner: string,
  repo: string,
  gitRef: string,
  path: string,
  symbol: string,
  lang: string,
): string {
  return `${owner}/${repo}@${gitRef}:${path}:${symbol}:${lang}`;
}

export interface EditorHandle {
  focus: () => void;
  moveCursor: (deltaLine: number, deltaColumn: number) => void;
  scrollLines: (count: number) => void;
  scrollPages: (count: number) => void;
  goTop: () => void;
  goBottom: () => void;
  goDefinition: () => void;
}

interface Props {
  files: FileResult[];
  content: string;
  currentPath: string | null;
  revealLine?: number;
  revealNonce?: number;
  height?: string;
  onNavigate: (target: NavigationTarget) => void;
  onPushNavigation?: (target: NavigationTarget) => void;
  onPopNavigation?: () => void;
  onCursorLineChange?: (line: number) => void;
  owner?: string;
  repo?: string;
  gitRef?: string;
  fileContents?: Map<string, string>;
  symbolExplanationCache?: Map<string, string>;
  onSymbolExplanation?: (cacheKey: string, text: string) => void;
  explanationLanguage?: ExplanationLanguage;
  onTokenUsage?: (inputTokens: number, outputTokens: number) => void;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  {
    files,
    content,
    currentPath,
    revealLine,
    revealNonce,
    height = "400px",
    onNavigate,
    onPushNavigation,
    onPopNavigation,
    onCursorLineChange,
    owner = "",
    repo = "",
    gitRef = "",
    fileContents = new Map(),
    symbolExplanationCache = new Map(),
    onSymbolExplanation,
    explanationLanguage = "en",
    onTokenUsage,
  },
  ref,
) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);
  const preCreatedModelsRef = useRef<{ dispose: () => void }[]>([]);
  const filesRef = useRef(files);
  const onNavigateRef = useRef(onNavigate);
  const onPushNavigationRef = useRef(onPushNavigation);
  const onPopNavigationRef = useRef(onPopNavigation);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  const currentPathRef = useRef(currentPath);
  const ownerRef = useRef(owner);
  const repoRef = useRef(repo);
  const gitRefRef = useRef(gitRef);
  const fileContentsRef = useRef(fileContents);
  const symbolExplanationCacheRef = useRef(symbolExplanationCache);
  const onSymbolExplanationRef = useRef(onSymbolExplanation);
  const explanationLanguageRef = useRef(explanationLanguage);
  const onTokenUsageRef = useRef(onTokenUsage);
  const inflightSymbolRef = useRef(
    new Map<string, Promise<{ contents: { value: string }[] } | null>>(),
  );

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    onPushNavigationRef.current = onPushNavigation;
  }, [onPushNavigation]);

  useEffect(() => {
    onPopNavigationRef.current = onPopNavigation;
  }, [onPopNavigation]);

  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    ownerRef.current = owner;
  }, [owner]);

  useEffect(() => {
    repoRef.current = repo;
  }, [repo]);

  useEffect(() => {
    gitRefRef.current = gitRef;
  }, [gitRef]);

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    symbolExplanationCacheRef.current = symbolExplanationCache;
  }, [symbolExplanationCache]);

  useEffect(() => {
    onSymbolExplanationRef.current = onSymbolExplanation;
  }, [onSymbolExplanation]);

  useEffect(() => {
    explanationLanguageRef.current = explanationLanguage;
  }, [explanationLanguage]);

  useEffect(() => {
    onTokenUsageRef.current = onTokenUsage;
  }, [onTokenUsage]);

  useEffect(() => {
    if (revealLine != null && editorRef.current) {
      editorRef.current.revealLineInCenter(revealLine);
      editorRef.current.setPosition({ lineNumber: revealLine, column: 1 });
    }
  }, [revealLine, revealNonce]);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => d.dispose());
      preCreatedModelsRef.current.forEach((m) => m.dispose());
    };
  }, []);

  function clampPosition(lineNumber: number, column: number) {
    const model = editorRef.current?.getModel();
    if (!model) return null;
    const safeLine = Math.max(1, Math.min(lineNumber, model.getLineCount()));
    const maxColumn = model.getLineMaxColumn(safeLine);
    return {
      lineNumber: safeLine,
      column: Math.max(1, Math.min(column, maxColumn)),
    };
  }

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      moveCursor: (deltaLine, deltaColumn) => {
        const position = editorRef.current?.getPosition();
        if (!position) return;
        const next = clampPosition(
          position.lineNumber + deltaLine,
          position.column + deltaColumn,
        );
        if (!next) return;
        editorRef.current?.setPosition(next);
        editorRef.current?.revealPositionInCenter(next);
      },
      scrollLines: (count) => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco) return;
        const lineHeight = editor.getOption(
          monaco.editor.EditorOption.lineHeight,
        );
        editor.setScrollTop(editor.getScrollTop() + count * lineHeight);
      },
      scrollPages: (count) => {
        const editor = editorRef.current;
        if (!editor) return;
        const pageHeight = Math.max(
          1,
          Math.floor(editor.getLayoutInfo().height * 0.9),
        );
        editor.setScrollTop(editor.getScrollTop() + count * pageHeight);
      },
      goTop: () => {
        const next = clampPosition(1, 1);
        if (!next) return;
        editorRef.current?.setPosition(next);
        editorRef.current?.revealPositionInCenter(next);
      },
      goBottom: () => {
        const model = editorRef.current?.getModel();
        if (!model) return;
        const next = clampPosition(model.getLineCount(), 1);
        if (!next) return;
        editorRef.current?.setPosition(next);
        editorRef.current?.revealPositionInCenter(next);
      },
      goDefinition: () => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const position = editor?.getPosition();
        const path = currentPathRef.current;
        if (!model || !position || !path) return;
        const word = model.getWordAtPosition(position);
        if (!word) return;
        const target = findDefinition(word.word, filesRef.current);
        if (!target) return;
        onPushNavigationRef.current?.({
          filePath: path,
          line: position.lineNumber,
        });
        onNavigateRef.current(target);
      },
    }),
    [],
  );

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    const createdModels: { dispose: () => void }[] = [];
    for (const file of filesRef.current) {
      if (!file.source_code) continue;
      const uri = monaco.Uri.parse(`inmemory://repo/${file.path}`);
      if (!monaco.editor.getModel(uri)) {
        const model = monaco.editor.createModel(
          file.source_code,
          detectLanguage(file.path),
          uri,
        );
        createdModels.push(model);
      }
    }
    preCreatedModelsRef.current = createdModels;

    const defObj = {
      provideDefinition(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
      ) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const target = findDefinition(word.word, filesRef.current);
        if (!target) return null;
        onNavigateRef.current(target);
        return [
          {
            uri: monaco.Uri.parse(`inmemory://repo/${target.filePath}`),
            range: {
              startLineNumber: target.line,
              startColumn: 1,
              endLineNumber: target.line,
              endColumn: 1,
            },
          },
        ];
      },
    };

    const refObj = {
      provideReferences(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
      ) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        return findReferences(word.word, filesRef.current).map(
          (refLocation) => ({
            uri: monaco.Uri.parse(`inmemory://repo/${refLocation.filePath}`),
            range: {
              startLineNumber: refLocation.line,
              startColumn: refLocation.startColumn,
              endLineNumber: refLocation.line,
              endColumn: refLocation.endColumn,
            },
          }),
        );
      },
    };

    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

    const hoverObj = {
      provideHover(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
      ) {
        const word = model.getWordAtPosition(position);
        if (!word?.word || !currentPathRef.current) return null;
        const symbol = word.word;
        const path = currentPathRef.current;
        const lang = explanationLanguageRef.current;
        const key = buildSymbolCacheKey(
          ownerRef.current,
          repoRef.current,
          gitRefRef.current,
          path,
          symbol,
          lang,
        );

        const cached = symbolExplanationCacheRef.current.get(key);
        if (cached) {
          return { contents: [{ value: `**${symbol}**\n\n${cached}` }] };
        }

        const inflight = inflightSymbolRef.current.get(key);
        if (inflight) return inflight;

        const source = model.getValue();
        const importedPaths = resolveImports(
          source,
          path,
          new Set(fileContentsRef.current.keys()),
        );
        const contextFiles = importedPaths
          .map((p) => ({
            path: p,
            content: fileContentsRef.current.get(p) ?? "",
          }))
          .filter((f) => f.content.length > 0);

        const promise = fetch(`${API_BASE}/symbol/explanation`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: ownerRef.current,
            repo: repoRef.current,
            git_ref: gitRefRef.current,
            path,
            symbol,
            source: source.slice(0, 3000),
            context_files: contextFiles,
            explanation_language: lang,
          }),
        })
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((data: SymbolExplanationResponse) => {
            if (data.token_usage) {
              onTokenUsageRef.current?.(
                data.token_usage.input_tokens,
                data.token_usage.output_tokens,
              );
            }
            onSymbolExplanationRef.current?.(key, data.explanation);
            inflightSymbolRef.current.delete(key);
            return {
              contents: [{ value: `**${symbol}**\n\n${data.explanation}` }],
            };
          })
          .catch(() => {
            inflightSymbolRef.current.delete(key);
            return null;
          });

        inflightSymbolRef.current.set(key, promise);
        return promise;
      },
    };

    const providers = NAVIGATION_LANGUAGES.flatMap((lang) => [
      monaco.languages.registerDefinitionProvider(lang, defObj),
      monaco.languages.registerReferenceProvider(lang, refObj),
      monaco.languages.registerHoverProvider(lang, hoverObj),
    ]);

    let hoverDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
      onCursorLineChangeRef.current?.(event.position.lineNumber);
      if (hoverDebounceTimer) clearTimeout(hoverDebounceTimer);
      hoverDebounceTimer = setTimeout(() => {
        hoverDebounceTimer = null;
        editor.trigger("cursor", "editor.action.showHover", null);
      }, 600);
    });

    const modelDisposable = editor.onDidChangeModel(() => {
      const line = editor.getPosition()?.lineNumber ?? 1;
      onCursorLineChangeRef.current?.(line);
      if (hoverDebounceTimer) {
        clearTimeout(hoverDebounceTimer);
        hoverDebounceTimer = null;
      }
    });

    disposablesRef.current = [
      ...providers,
      cursorDisposable,
      modelDisposable,
      {
        dispose: () => {
          if (hoverDebounceTimer) clearTimeout(hoverDebounceTimer);
        },
      },
    ];
    onCursorLineChangeRef.current?.(editor.getPosition()?.lineNumber ?? 1);
  };

  const language = currentPath ? detectLanguage(currentPath) : "plaintext";

  return (
    <MonacoEditor
      height={height}
      path={currentPath ? `inmemory://repo/${currentPath}` : undefined}
      value={content}
      language={language}
      options={{ readOnly: true, minimap: { enabled: false } }}
      onMount={handleEditorMount}
      keepCurrentModel={true}
    />
  );
});
