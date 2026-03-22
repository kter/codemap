"use client";

import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

interface Props {
  value: string;
  language?: string;
  height?: string;
}

export function Editor({
  value,
  language = "typescript",
  height = "400px",
}: Props) {
  return (
    <MonacoEditor
      height={height}
      value={value}
      language={language}
      options={{ readOnly: true, minimap: { enabled: false } }}
    />
  );
}
