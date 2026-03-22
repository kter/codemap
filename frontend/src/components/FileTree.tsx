"use client";

import { FileResult } from "@/types/analysis";

interface Props {
  files: FileResult[];
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
}

export function FileTree({ files, selectedFile, onFileSelect }: Props) {
  return (
    <ul className="flex flex-col py-1">
      {files.map((file) => (
        <li key={file.path}>
          <button
            className={`w-full text-left px-3 py-1.5 text-sm font-mono truncate hover:bg-gray-100 ${
              file.path === selectedFile
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-gray-700"
            }`}
            title={file.path}
            onClick={() => onFileSelect(file.path)}
          >
            {file.path}
          </button>
        </li>
      ))}
    </ul>
  );
}
