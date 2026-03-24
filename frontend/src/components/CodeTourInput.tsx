"use client";

import { useState } from "react";

interface CodeTourInputProps {
  onSubmit: (query: string) => void;
  loading: boolean;
  disabled?: boolean;
}

export function CodeTourInput({
  onSubmit,
  loading,
  disabled = false,
}: CodeTourInputProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="border rounded px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-50 shrink-0"
      >
        Tour
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1 shrink-0">
      <input
        type="text"
        placeholder="e.g. Explain the auth flow"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="border rounded px-2 py-1 text-sm w-56"
        autoFocus
        disabled={loading}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setExpanded(false);
            setQuery("");
          }
        }}
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        className="bg-blue-600 text-white rounded px-2 py-1 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
        ) : (
          "Go"
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          setExpanded(false);
          setQuery("");
        }}
        className="text-gray-400 hover:text-gray-600 text-sm px-1"
        disabled={loading}
      >
        x
      </button>
    </form>
  );
}
