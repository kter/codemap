"use client";

import { useState } from "react";
import { SearchMatch, SearchResponse } from "@/types/analysis";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

interface SearchPanelProps {
  owner: string;
  repo: string;
  git_ref: string;
  onNavigate: (filePath: string, line: number) => void;
  onClose: () => void;
}

type SearchStatus = "idle" | "loading" | "ready" | "error";

export function SearchPanel({
  owner,
  repo,
  git_ref,
  onNavigate,
  onClose,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searchedFiles, setSearchedFiles] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setStatus("loading");
    setError(null);

    try {
      const resp = await fetch(
        `${API_BASE}/search?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&git_ref=${encodeURIComponent(git_ref)}&q=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Search failed: ${resp.status}`,
        );
      }

      const data: SearchResponse = await resp.json();
      setResults(data.matches);
      setSearchedFiles(data.searched_files);
      setTruncated(data.truncated);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setStatus("error");
    }
  }

  // Group results by file path
  const grouped = new Map<string, SearchMatch[]>();
  for (const match of results) {
    const arr = grouped.get(match.path) ?? [];
    arr.push(match);
    grouped.set(match.path, arr);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 border-b shrink-0 flex items-center justify-between">
        <span>Search</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close search"
        >
          ✕
        </button>
      </div>
      <form
        onSubmit={handleSearch}
        className="flex gap-2 px-3 py-2 border-b shrink-0"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search in repository…"
          className="flex-1 border rounded px-2 py-1 text-sm"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="border rounded px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          {status === "loading" ? "…" : "Search"}
        </button>
      </form>
      <div className="flex-1 overflow-y-auto text-sm">
        {status === "idle" && (
          <p className="px-3 py-4 text-gray-400 text-center">
            Type to search across all files.
          </p>
        )}
        {status === "error" && error && (
          <p className="px-3 py-4 text-red-600">{error}</p>
        )}
        {status === "ready" && results.length === 0 && (
          <p className="px-3 py-4 text-gray-400 text-center">
            No matches in {searchedFiles} file(s).
          </p>
        )}
        {status === "ready" && results.length > 0 && (
          <div>
            {truncated && (
              <p className="px-3 py-2 text-amber-600 text-xs">
                Results capped at 200
              </p>
            )}
            {Array.from(grouped.entries()).map(([path, fileMatches]) => (
              <div key={path}>
                <p className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                  {path} ({fileMatches.length}{" "}
                  {fileMatches.length !== 1 ? "matches" : "match"})
                </p>
                {fileMatches.map((match) => (
                  <button
                    key={`${match.path}:${match.line}`}
                    onClick={() => onNavigate(match.path, match.line)}
                    className="w-full text-left px-3 py-1 hover:bg-blue-50 font-mono text-xs flex gap-3"
                  >
                    <span className="text-gray-400 shrink-0 w-6 text-right">
                      {match.line}
                    </span>
                    <span className="text-gray-800 truncate">
                      {match.content}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
