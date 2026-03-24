"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  FileExplanation,
  FileExplanationStatus,
  NavigationTarget,
} from "@/types/analysis";

interface Props {
  selectedPath: string | null;
  explanation: FileExplanation | null;
  status: FileExplanationStatus;
  errorMessage?: string | null;
  active?: boolean;
  onNavigate: (target: NavigationTarget) => void;
}

interface ExplanationItem {
  key: string;
  label: string;
  line: number;
  description: string;
}

export interface AIExplanationHandle {
  moveCursor: (delta: number) => void;
  pageMove: (deltaPages: number) => void;
  goTop: () => void;
  goBottom: () => void;
  activateSelection: () => boolean;
}

export function getExplanationItems(
  explanation: FileExplanation | null,
): ExplanationItem[] {
  if (!explanation) return [];

  return [
    ...explanation.interfaces.map((iface) => ({
      key: `interface:${iface.name}`,
      label: iface.name,
      line: iface.line,
      description: iface.description,
    })),
    ...explanation.happy_paths.map((fn_) => ({
      key: `function:${fn_.name}`,
      label: fn_.name,
      line: fn_.line,
      description: fn_.summary,
    })),
  ];
}

function escapeAttributeValue(value: string) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export const AIExplanation = forwardRef<AIExplanationHandle, Props>(
  function AIExplanation(
    {
      selectedPath,
      explanation,
      status,
      errorMessage = null,
      active = false,
      onNavigate,
    },
    ref,
  ) {
    const items = getExplanationItems(explanation);
    const [cursorKey, setCursorKey] = useState<string | null>(items[0]?.key ?? null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      setCursorKey(items[0]?.key ?? null);
    }, [explanation?.path, status]);

    useEffect(() => {
      if (!active || !cursorKey) return;
      const element = containerRef.current?.querySelector<HTMLElement>(
        `[data-explanation-key="${escapeAttributeValue(cursorKey)}"]`,
      );
      element?.scrollIntoView({ block: "nearest" });
    }, [active, cursorKey, explanation?.path]);

    function getCursorIndex() {
      if (!items.length) return -1;
      if (!cursorKey) return 0;
      const index = items.findIndex((item) => item.key === cursorKey);
      return index >= 0 ? index : 0;
    }

    function setCursorByIndex(index: number) {
      if (!items.length) return;
      const next = items[Math.max(0, Math.min(index, items.length - 1))];
      setCursorKey(next?.key ?? null);
    }

    function activateSelection() {
      const item = items[getCursorIndex()];
      if (!item || !explanation) return false;
      onNavigate({ filePath: explanation.path, line: item.line });
      return true;
    }

    useImperativeHandle(
      ref,
      () => ({
        moveCursor: (delta) => setCursorByIndex(getCursorIndex() + delta),
        pageMove: (deltaPages) => {
          const firstItem = containerRef.current?.querySelector<HTMLElement>(
            "[data-explanation-key]",
          );
          const itemHeight = firstItem?.getBoundingClientRect().height || 44;
          const pageSize = Math.max(
            1,
            Math.floor(
              (containerRef.current?.clientHeight || itemHeight * 6) / itemHeight,
            ) - 1,
          );
          setCursorByIndex(getCursorIndex() + deltaPages * pageSize);
        },
        goTop: () => setCursorByIndex(0),
        goBottom: () => setCursorByIndex(items.length - 1),
        activateSelection,
      }),
      [items, cursorKey, explanation],
    );

    if (!selectedPath) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-gray-400 p-4">
          Select a file to see AI explanations.
        </div>
      );
    }

    if (status === "loading") {
      return (
        <div className="flex items-center justify-center h-full text-sm text-gray-400 p-4">
          Generating AI explanation…
        </div>
      );
    }

    if (status === "error") {
      return (
        <div className="flex items-center justify-center h-full text-sm text-red-500 p-4 text-center">
          {errorMessage ?? "Failed to load AI explanation."}
        </div>
      );
    }

    if (!explanation) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-gray-400 p-4">
          Select a file to see AI explanations.
        </div>
      );
    }

    const hasContent =
      explanation.overview.trim().length > 0 ||
      explanation.interfaces.length > 0 ||
      explanation.happy_paths.length > 0;

    if (!hasContent) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-gray-400 p-4">
          No AI explanation is available for this file.
        </div>
      );
    }

    return (
      <div ref={containerRef} className="h-full overflow-y-auto p-3 space-y-4">
        {explanation.overview && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Overview
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              {explanation.overview}
            </p>
          </section>
        )}

        {explanation.interfaces.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Interfaces &amp; Types
            </h3>
            <ul className="space-y-3">
              {explanation.interfaces.map((iface) => {
                const key = `interface:${iface.name}`;
                const isCursor = key === cursorKey;
                return (
                  <li key={iface.name} className="text-sm">
                    <button
                      type="button"
                      data-explanation-key={key}
                      className={`w-full rounded text-left px-2 py-1 ${
                        active && isCursor
                          ? "bg-blue-100 text-blue-800"
                          : "text-gray-800 hover:text-blue-600 hover:underline"
                      }`}
                      onClick={() => {
                        setCursorKey(key);
                        onNavigate({ filePath: explanation.path, line: iface.line });
                      }}
                    >
                      <span className="font-mono font-semibold">{iface.name}</span>
                      <span className="text-gray-400 font-normal ml-1 text-xs">
                        L{iface.line}
                      </span>
                    </button>
                    {iface.description && (
                      <p className="text-gray-600 mt-0.5 text-xs leading-relaxed px-2">
                        {iface.description}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {explanation.happy_paths.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Functions &amp; Methods
            </h3>
            <ul className="space-y-3">
              {explanation.happy_paths.map((fn_) => {
                const key = `function:${fn_.name}`;
                const isCursor = key === cursorKey;
                return (
                  <li key={fn_.name} className="text-sm">
                    <button
                      type="button"
                      data-explanation-key={key}
                      className={`w-full rounded text-left px-2 py-1 ${
                        active && isCursor
                          ? "bg-blue-100 text-blue-800"
                          : "text-gray-800 hover:text-blue-600 hover:underline"
                      }`}
                      onClick={() => {
                        setCursorKey(key);
                        onNavigate({ filePath: explanation.path, line: fn_.line });
                      }}
                    >
                      <span className="font-mono font-semibold">{fn_.name}</span>
                      <span className="text-gray-400 font-normal ml-1 text-xs">
                        L{fn_.line}
                      </span>
                    </button>
                    {fn_.summary && (
                      <p className="text-gray-600 mt-0.5 text-xs leading-relaxed px-2">
                        {fn_.summary}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    );
  },
);
