"use client";

import { useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import type { FileResult, NavigationTarget } from "@/types/analysis";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

interface Props {
  files: FileResult[];
  currentPath: string | null;
  revealLine?: number;
  language?: string;
  height?: string;
  onNavigate: (target: NavigationTarget) => void;
}

export function Editor({
  files,
  currentPath,
  revealLine,
  language = "typescript",
  height = "400px",
  onNavigate,
}: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);
  const filesRef = useRef(files);
  const onNavigateRef = useRef(onNavigate);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    if (revealLine != null && editorRef.current) {
      editorRef.current.revealLineInCenter(revealLine);
    }
  }, [revealLine]);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => d.dispose());
    };
  }, []);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    const defProvider = monaco.languages.registerDefinitionProvider(language, {
      provideDefinition(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
      ) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const name = word.word;

        for (const file of filesRef.current) {
          for (const iface of file.interfaces) {
            if (iface.name === name) {
              onNavigateRef.current({ filePath: file.path, line: iface.line });
              return [
                {
                  uri: monaco.Uri.parse(`inmemory://repo/${file.path}`),
                  range: {
                    startLineNumber: iface.line,
                    startColumn: 1,
                    endLineNumber: iface.line,
                    endColumn: 1,
                  },
                },
              ];
            }
          }
          for (const fn of file.happy_paths) {
            if (fn.name === name) {
              onNavigateRef.current({ filePath: file.path, line: fn.line });
              return [
                {
                  uri: monaco.Uri.parse(`inmemory://repo/${file.path}`),
                  range: {
                    startLineNumber: fn.line,
                    startColumn: 1,
                    endLineNumber: fn.line,
                    endColumn: 1,
                  },
                },
              ];
            }
          }
        }
        return null;
      },
    });

    const refProvider = monaco.languages.registerReferenceProvider(language, {
      provideReferences(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
      ) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const name = word.word;
        const pattern = new RegExp(`\\b${name}\\b`);

        const results: {
          uri: ReturnType<typeof monaco.Uri.parse>;
          range: {
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
          };
        }[] = [];

        for (const file of filesRef.current) {
          const lines = file.source_code.split("\n");
          lines.forEach((line, idx) => {
            const match = pattern.exec(line);
            if (match) {
              results.push({
                uri: monaco.Uri.parse(`inmemory://repo/${file.path}`),
                range: {
                  startLineNumber: idx + 1,
                  startColumn: match.index + 1,
                  endLineNumber: idx + 1,
                  endColumn: match.index + name.length + 1,
                },
              });
            }
          });
        }

        return results;
      },
    });

    disposablesRef.current = [defProvider, refProvider];
  };

  return (
    <MonacoEditor
      height={height}
      path={currentPath ? `inmemory://repo/${currentPath}` : undefined}
      value={files.find((f) => f.path === currentPath)?.source_code ?? ""}
      language={language}
      options={{ readOnly: true, minimap: { enabled: false } }}
      onMount={handleEditorMount}
      keepCurrentModel={true}
    />
  );
}
