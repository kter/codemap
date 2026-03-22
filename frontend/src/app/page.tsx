"use client";

import { useState, useEffect } from "react";
import { AnalysisResults } from "@/components/AnalysisResults";
import { Editor } from "@/components/Editor";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

interface AnalyzeResponse {
  owner: string;
  repo: string;
  git_ref: string;
  files: Array<{
    path: string;
    interfaces: Array<{ name: string; line: number; signature: string; description: string }>;
    happy_paths: Array<{ name: string; line: number; summary: string }>;
  }>;
}

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
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data ?? null))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  async function handleLogout() {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    setUser(null);
    setResult(null);
    setError(null);
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSelectedFile(null);

    const parts = repoInput.trim().split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError("Please enter a repo in owner/repo format.");
      return;
    }
    const [owner, repo] = parts;

    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, git_ref: gitRef }),
      });

      if (resp.status === 401) {
        setUser(null);
        setError("Session expired. Please log in again.");
        return;
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Request failed: ${resp.status}`);
        return;
      }

      const data: AnalyzeResponse = await resp.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const selectedSource =
    selectedFile && result
      ? result.files.find((f) => f.path === selectedFile)?.interfaces
          .map((i) => i.signature)
          .join("\n\n") ?? ""
      : "";

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
        <p className="text-gray-600 mb-8">Visualize code interfaces and happy paths.</p>
        {error && <p className="mb-4 text-red-600">{error}</p>}
        <a
          href={`${API_BASE}/auth/github`}
          className="flex items-center gap-2 bg-gray-900 text-white rounded px-6 py-3 font-semibold hover:bg-gray-700"
        >
          <svg viewBox="0 0 16 16" className="h-5 w-5 fill-current" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Login with GitHub
        </a>
      </main>
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

      <form onSubmit={handleAnalyze} className="flex flex-col gap-3 w-full max-w-lg">
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

      {error && (
        <p className="mt-4 text-red-600">{error}</p>
      )}

      {loading && (
        <div className="mt-8 flex items-center gap-2 text-gray-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Analyzing repository…
        </div>
      )}

      {result && (
        <AnalysisResults data={result} onFileSelect={setSelectedFile} />
      )}

      {selectedFile && (
        <div className="w-full max-w-4xl mt-6">
          <p className="font-mono text-sm text-gray-500 mb-1">{selectedFile}</p>
          <Editor value={selectedSource} />
        </div>
      )}
    </main>
  );
}
