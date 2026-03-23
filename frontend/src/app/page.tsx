"use client";

import { useState, useEffect } from "react";
import { Editor } from "@/components/Editor";
import { FileTree } from "@/components/FileTree";
import { AIExplanation } from "@/components/AIExplanation";
import { AnalyzeResponse, NavigationTarget } from "@/types/analysis";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

interface User {
  login: string;
  github_user_id: number;
}

export default function Home() {
  const [repoInput, setRepoInput] = useState("");
  const [gitRef, setGitRef] = useState("main");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<number | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [hasAutoAnalyzed, setHasAutoAnalyzed] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data ?? null))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  async function analyzeRepo(owner: string, repo: string, ref: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedFile(null);
    try {
      const resp = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, git_ref: ref }),
      });
      if (resp.status === 401) {
        setUser(null);
        setError("Session expired. Please log in again.");
        return;
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(
          (body as { error?: string }).error ?? `Request failed: ${resp.status}`,
        );
        return;
      }
      const data: AnalyzeResponse = await resp.json();
      setResult(data);
      setSelectedFile(null);
      setRevealLine(undefined);
      window.history.replaceState(
        {},
        "",
        `?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !user || hasAutoAnalyzed) return;
    const params = new URLSearchParams(window.location.search);
    const owner = params.get("owner");
    const repo = params.get("repo");
    const ref = params.get("ref") ?? "main";
    if (owner && repo) {
      setHasAutoAnalyzed(true);
      setRepoInput(`${owner}/${repo}`);
      setGitRef(ref);
      analyzeRepo(owner, repo, ref);
    }
  }, [authLoading, user]);

  async function handleLogout() {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    setResult(null);
    setError(null);
    window.history.replaceState({}, "", "/");
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    const parts = repoInput.trim().split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError("Please enter a repo in owner/repo format.");
      return;
    }
    await analyzeRepo(parts[0], parts[1], gitRef);
  }

  function handleNavigate(target: NavigationTarget) {
    setSelectedFile(target.filePath);
    setRevealLine(target.line);
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <h1 className="text-4xl font-bold mb-4">CodeMap</h1>
        <p className="text-gray-600 mb-8">
          Visualize code interfaces and happy paths.
        </p>
        {error && <p className="mb-4 text-red-600">{error}</p>}
        <a
          href={`${API_BASE}/auth/github`}
          className="flex items-center gap-2 bg-gray-900 text-white rounded px-6 py-3 font-semibold hover:bg-gray-700"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-5 w-5 fill-current"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Login with GitHub
        </a>
      </main>
    );
  }

  if (result) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <header className="flex items-center gap-3 px-4 py-2 border-b bg-white shrink-0">
          <h1 className="text-lg font-bold">CodeMap</h1>
          <form
            onSubmit={handleAnalyze}
            className="flex items-center gap-2 flex-1"
          >
            <input
              type="text"
              placeholder="owner/repo"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              className="border rounded px-2 py-1 text-sm font-mono w-48"
              required
            />
            <input
              type="text"
              placeholder="git ref"
              value={gitRef}
              onChange={(e) => setGitRef(e.target.value)}
              className="border rounded px-2 py-1 text-sm font-mono w-28"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 text-white rounded px-3 py-1 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </form>
          {error && <p className="text-red-600 text-sm shrink-0">{error}</p>}
          <span className="text-sm text-gray-600 shrink-0">@{user.login}</span>
          <button
            onClick={handleLogout}
            className="border rounded px-3 py-1 text-sm hover:bg-gray-100 shrink-0"
          >
            Logout
          </button>
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <aside className="w-56 shrink-0 border-r overflow-y-auto bg-gray-50 flex flex-col">
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 border-b shrink-0">
              {result.owner}/{result.repo} @ {result.git_ref}
            </div>
            <FileTree
              files={result.files}
              selectedFile={selectedFile}
              onFileSelect={(path) => {
                setSelectedFile(path);
                setRevealLine(undefined);
              }}
            />
          </aside>

          <main className="flex-1 min-w-0 flex flex-col">
            {selectedFile ? (
              <div className="flex-1 min-h-0">
                <Editor
                  key={`${result.owner}/${result.repo}@${result.git_ref}`}
                  files={result.files}
                  currentPath={selectedFile}
                  revealLine={revealLine}
                  height="100%"
                  onNavigate={handleNavigate}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                Select a file.
              </div>
            )}
          </main>

          <aside className="w-72 shrink-0 border-l overflow-hidden">
            <AIExplanation
              file={result.files.find((f) => f.path === selectedFile) ?? null}
              onNavigate={handleNavigate}
            />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="flex w-full max-w-4xl justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">CodeMap</h1>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span>@{user.login}</span>
          <button
            onClick={handleLogout}
            className="border rounded px-3 py-1 hover:bg-gray-100"
          >
            Logout
          </button>
        </div>
      </div>

      <form
        onSubmit={handleAnalyze}
        className="flex flex-col gap-3 w-full max-w-lg"
      >
        <input
          type="text"
          placeholder="owner/repo (e.g. facebook/react)"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          className="border rounded px-3 py-2 font-mono"
          required
        />
        <input
          type="text"
          placeholder="git ref (branch, tag, or SHA)"
          value={gitRef}
          onChange={(e) => setGitRef(e.target.value)}
          className="border rounded px-3 py-2 font-mono"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white rounded px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {error && <p className="mt-4 text-red-600">{error}</p>}

      {loading && (
        <div className="mt-8 flex items-center gap-2 text-gray-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
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
          Analyzing repository…
        </div>
      )}
    </main>
  );
}
