"use client";

import { FileResult } from "@/types/analysis";

interface Props {
  file: FileResult | null;
}

export function AIExplanation({ file }: Props) {
  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 p-4">
        Select a file to see AI explanations.
      </div>
    );
  }

  const hasContent = file.interfaces.length > 0 || file.happy_paths.length > 0;

  if (!hasContent) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 p-4">
        No symbols found in this file.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      {file.interfaces.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Interfaces &amp; Types
          </h3>
          <ul className="space-y-3">
            {file.interfaces.map((iface) => (
              <li key={iface.name} className="text-sm">
                <div className="font-mono font-semibold text-gray-800">
                  {iface.name}
                  <span className="text-gray-400 font-normal ml-1 text-xs">
                    L{iface.line}
                  </span>
                </div>
                {iface.description && (
                  <p className="text-gray-600 mt-0.5 text-xs leading-relaxed">
                    {iface.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {file.happy_paths.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Exported Functions
          </h3>
          <ul className="space-y-3">
            {file.happy_paths.map((fn_) => (
              <li key={fn_.name} className="text-sm">
                <div className="font-mono font-semibold text-gray-800">
                  {fn_.name}
                  <span className="text-gray-400 font-normal ml-1 text-xs">
                    L{fn_.line}
                  </span>
                </div>
                {fn_.summary && (
                  <p className="text-gray-600 mt-0.5 text-xs leading-relaxed">
                    {fn_.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
