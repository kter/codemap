"use client";

import { AnalyzeResponse } from "@/types/analysis";

interface Props {
  data: AnalyzeResponse;
  onFileSelect: (path: string) => void;
}

export function AnalysisResults({ data, onFileSelect }: Props) {
  return (
    <div className="w-full max-w-4xl mt-8 space-y-6">
      <h2 className="text-2xl font-semibold">
        {data.owner}/{data.repo} @ {data.git_ref}
      </h2>
      {data.files.length === 0 && (
        <p className="text-gray-500">No supported source files found.</p>
      )}
      {data.files.map((file) => (
        <div key={file.path} className="border rounded-lg p-4 space-y-4">
          <button
            className="text-lg font-mono font-semibold text-blue-600 hover:underline text-left"
            onClick={() => onFileSelect(file.path)}
          >
            {file.path}
          </button>

          {file.interfaces.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Interfaces & Types
              </h3>
              <ul className="space-y-2">
                {file.interfaces.map((iface) => (
                  <li key={iface.name} className="text-sm">
                    <span className="font-mono font-semibold">{iface.name}</span>
                    <span className="text-gray-400 ml-1">(L{iface.line})</span>
                    {iface.description && (
                      <p className="text-gray-600 mt-0.5">{iface.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {file.happy_paths.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Functions &amp; Methods
              </h3>
              <ul className="space-y-2">
                {file.happy_paths.map((fn_) => (
                  <li key={fn_.name} className="text-sm">
                    <span className="font-mono font-semibold">{fn_.name}</span>
                    <span className="text-gray-400 ml-1">(L{fn_.line})</span>
                    {fn_.summary && (
                      <p className="text-gray-600 mt-0.5">{fn_.summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
