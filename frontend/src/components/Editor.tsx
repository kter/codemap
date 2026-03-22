"use client";

import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface Props {
  value: string;
  language?: string;
}

export function Editor({ value, language = "typescript" }: Props) {
  return (
    <MonacoEditor
      height="400px"
      value={value}
      language={language}
      options={{ readOnly: true, minimap: { enabled: false } }}
    />
  );
}
