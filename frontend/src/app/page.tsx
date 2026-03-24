"use client";

import { useEffect, useRef, useState } from "react";
import { AIExplanation, AIExplanationHandle } from "@/components/AIExplanation";
import { Editor, EditorHandle } from "@/components/Editor";
import { FileTree, FileTreeHandle } from "@/components/FileTree";
import { HelpDialog } from "@/components/HelpDialog";
import {
  AnalyzeResponse,
  ExplanationLanguage,
  FileExplanation,
  FileExplanationStatus,
  NavigationTarget,
  TokenUsage,
  TreeResponse,
} from "@/types/analysis";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPLANATION_LANGUAGE: ExplanationLanguage = "en";
const EXPLANATION_LANGUAGE_STORAGE_KEY =
  "codemap:settings:ai-explanation-language";

type Pane = "tree" | "editor" | "explanation";

interface User {
  login: string;
  github_user_id: number;
}

function cacheKey(owner: string, repo: string, ref: string) {
  return `codemap:result:${owner}/${repo}@${ref}`;
}

function explanationCacheKey(path: string, language: ExplanationLanguage) {
  return `${language}:${path}`;
}

function loadExplanationLanguage(): ExplanationLanguage {
  if (typeof window === "undefined") return DEFAULT_EXPLANATION_LANGUAGE;
  try {
    const value = localStorage.getItem(EXPLANATION_LANGUAGE_STORAGE_KEY);
    return value === "ja" || value === "en"
      ? value
      : DEFAULT_EXPLANATION_LANGUAGE;
  } catch {
    return DEFAULT_EXPLANATION_LANGUAGE;
  }
}

function clearResultCache() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("codemap:result:")) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore quota errors */
  }
}

function saveResultToCache(data: AnalyzeResponse) {
  try {
    localStorage.setItem(
      cacheKey(data.owner, data.repo, data.git_ref),
      JSON.stringify({ data, cachedAt: Date.now() }),
    );
  } catch {
    /* ignore quota errors */
  }
}

function loadResultFromCache(
  owner: string,
  repo: string,
  ref: string,
): AnalyzeResponse | null {
  try {
    const raw = localStorage.getItem(cacheKey(owner, repo, ref));
    if (!raw) return null;
    const { data, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(owner, repo, ref));
      return null;
    }
    return data as AnalyzeResponse;
  } catch {
    return null;
  }
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
}

function movePane(current: Pane, delta: number): Pane {
  const panes: Pane[] = ["tree", "editor", "explanation"];
  const index = panes.indexOf(current);
  const nextIndex = Math.max(0, Math.min(index + delta, panes.length - 1));
  return panes[nextIndex] ?? current;
}

export default function Home() {
  const [repoInput, setRepoInput] = useState("");
  const [gitRef, setGitRef] = useState("main");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<number | undefined>(undefined);
  const [revealNonce, setRevealNonce] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [hasAutoAnalyzed, setHasAutoAnalyzed] = useState(false);
  const [treePaths, setTreePaths] = useState<string[] | null>(null);
  const [fileContents, setFileContents] = useState(new Map<string, string>());
  const [fileExplanations, setFileExplanations] = useState(
    new Map<string, FileExplanation>(),
  );
  const [fileExplanationStatus, setFileExplanationStatus] = useState(
    new Map<string, FileExplanationStatus>(),
  );
  const [fileExplanationErrors, setFileExplanationErrors] = useState(
    new Map<string, string>(),
  );
  const [symbolExplanations, setSymbolExplanations] = useState(
    new Map<string, string>(),
  );
  const [fileLoading, setFileLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [activePane, setActivePane] = useState<Pane>("tree");
  const [sessionTokens, setSessionTokens] = useState({ input: 0, output: 0 });
  const [navigationStack, setNavigationStack] = useState<NavigationTarget[]>(
    [],
  );
  const [explanationLanguage, setExplanationLanguage] =
    useState<ExplanationLanguage>(loadExplanationLanguage);
  const treeRef = useRef<FileTreeHandle | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const explanationRef = useRef<AIExplanationHandle | null>(null);
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const pendingGRef = useRef(false);
  const pendingGTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentEditorLocationRef = useRef<NavigationTarget | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data ?? null))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        EXPLANATION_LANGUAGE_STORAGE_KEY,
        explanationLanguage,
      );
    } catch {
      /* ignore quota errors */
    }
    setSymbolExplanations(new Map());
  }, [explanationLanguage]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const owner = params.get("owner");
    const repo = params.get("repo");
    const ref = params.get("ref") ?? "main";
    if (!owner || !repo) return;
    setRepoInput(`${owner}/${repo}`);
    setGitRef(ref);
    const cached = loadResultFromCache(owner, repo, ref);
    if (cached) {
      setResult(cached);
      setActivePane("tree");
      const initial = new Map<string, string>();
      cached.files.forEach((f) => {
        if (f.source_code) initial.set(f.path, f.source_code);
      });
      setFileContents(initial);
      setFileExplanations(new Map());
      setFileExplanationStatus(new Map());
      setFileExplanationErrors(new Map());
    }
  }, []);

  useEffect(() => {
    if (!result) {
      setNavigationStack([]);
      setActivePane("tree");
      return;
    }
    if (selectedFile) {
      currentEditorLocationRef.current = {
        filePath: selectedFile,
        line: revealLine ?? currentEditorLocationRef.current?.line ?? 1,
      };
    }
  }, [result, selectedFile, revealLine]);

  useEffect(() => {
    if (!result) return;
    if (activePane === "editor" && selectedFile) {
      const id = window.requestAnimationFrame(() => {
        editorRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [activePane, result, selectedFile]);

  useEffect(() => {
    return () => {
      if (pendingGTimerRef.current) clearTimeout(pendingGTimerRef.current);
    };
  }, []);

  async function fetchAllTree(owner: string, repo: string, ref: string) {
    try {
      const resp = await fetch(
        `${API_BASE}/tree?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&git_ref=${encodeURIComponent(ref)}`,
        { credentials: "include" },
      );
      if (!resp.ok) return;
      const data: TreeResponse = await resp.json();
      setTreePaths(data.paths);
    } catch {
      /* ignore background failures */
    }
  }

  async function analyzeRepo(
    owner: string,
    repo: string,
    ref: string,
    clearPrevious = true,
  ) {
    setLoading(true);
    setError(null);
    if (clearPrevious) {
      setResult(null);
      setSelectedFile(null);
      setTreePaths(null);
      setFileContents(new Map());
      setFileExplanations(new Map());
      setFileExplanationStatus(new Map());
      setFileExplanationErrors(new Map());
      setSymbolExplanations(new Map());
      setNavigationStack([]);
      setActivePane("tree");
      setSessionTokens({ input: 0, output: 0 });
    }
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
          (body as { error?: string }).error ??
            `Request failed: ${resp.status}`,
        );
        return;
      }
      const data: AnalyzeResponse = await resp.json();
      addTokenUsage(data.token_usage);
      setResult(data);
      saveResultToCache(data);
      setSelectedFile(null);
      setRevealLine(undefined);
      setRevealNonce(0);
      setActivePane("tree");
      setNavigationStack([]);

      const initial = new Map<string, string>();
      data.files.forEach((f) => {
        if (f.source_code) initial.set(f.path, f.source_code);
      });
      setFileContents(initial);
      setFileExplanations(new Map());
      setFileExplanationStatus(new Map());
      setFileExplanationErrors(new Map());
      setSymbolExplanations(new Map());

      fetchAllTree(owner, repo, ref);

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
      analyzeRepo(owner, repo, ref, false);
    }
  }, [authLoading, user, hasAutoAnalyzed]);

  useEffect(() => {
    if (!result || !selectedFile) return;
    const explanationKey = explanationCacheKey(
      selectedFile,
      explanationLanguage,
    );
    if (fileExplanations.has(explanationKey)) return;
    const currentStatus = fileExplanationStatus.get(explanationKey);
    if (currentStatus === "loading" || currentStatus === "error") return;

    let cancelled = false;

    setFileExplanationStatus((prev) => {
      const next = new Map(prev);
      next.set(explanationKey, "loading");
      return next;
    });
    setFileExplanationErrors((prev) => {
      const next = new Map(prev);
      next.delete(explanationKey);
      return next;
    });

    fetch(
      `${API_BASE}/file/explanation?owner=${encodeURIComponent(result.owner)}&repo=${encodeURIComponent(result.repo)}&git_ref=${encodeURIComponent(result.git_ref)}&path=${encodeURIComponent(selectedFile)}&explanation_language=${encodeURIComponent(explanationLanguage)}`,
      { credentials: "include" },
    )
      .then(async (resp) => {
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ??
              `Failed to load explanation: ${resp.status}`,
          );
        }
        return (await resp.json()) as FileExplanation;
      })
      .then((data) => {
        if (cancelled) return;
        addTokenUsage(data.token_usage);
        setFileExplanations((prev) => new Map(prev).set(explanationKey, data));
        setFileExplanationStatus((prev) => {
          const next = new Map(prev);
          next.set(explanationKey, "ready");
          return next;
        });
        setFileExplanationErrors((prev) => {
          const next = new Map(prev);
          next.delete(explanationKey);
          return next;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setFileExplanationStatus((prev) => {
          const next = new Map(prev);
          next.set(explanationKey, "error");
          return next;
        });
        setFileExplanationErrors((prev) => {
          const next = new Map(prev);
          next.set(
            explanationKey,
            err instanceof Error
              ? err.message
              : "Failed to load AI explanation.",
          );
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [result, selectedFile, explanationLanguage]);

  useEffect(() => {
    function clearPendingG() {
      pendingGRef.current = false;
      if (pendingGTimerRef.current) {
        clearTimeout(pendingGTimerRef.current);
        pendingGTimerRef.current = null;
      }
    }

    function queuePendingG() {
      clearPendingG();
      pendingGRef.current = true;
      pendingGTimerRef.current = setTimeout(() => {
        pendingGRef.current = false;
        pendingGTimerRef.current = null;
      }, 500);
    }

    function handleLineScroll(delta: number) {
      if (activePane === "tree") {
        treeRef.current?.moveCursor(delta);
        return;
      }
      if (activePane === "editor") {
        editorRef.current?.scrollLines(delta);
        return;
      }
      explanationRef.current?.moveCursor(delta);
    }

    function handlePageScroll(deltaPages: number) {
      if (activePane === "tree") {
        treeRef.current?.pageMove(deltaPages);
        return;
      }
      if (activePane === "editor") {
        editorRef.current?.scrollPages(deltaPages);
        return;
      }
      explanationRef.current?.pageMove(deltaPages);
    }

    function handleGoTop() {
      if (activePane === "tree") {
        treeRef.current?.goTop();
        return;
      }
      if (activePane === "editor") {
        editorRef.current?.goTop();
        return;
      }
      explanationRef.current?.goTop();
    }

    function handleGoBottom() {
      if (activePane === "tree") {
        treeRef.current?.goBottom();
        return;
      }
      if (activePane === "editor") {
        editorRef.current?.goBottom();
        return;
      }
      explanationRef.current?.goBottom();
    }

    function pushCurrentEditorLocation() {
      const current = currentEditorLocationRef.current;
      if (!current) return;
      setNavigationStack((prev) => [...prev, current]);
    }

    function handlePopNavigation() {
      setNavigationStack((prev) => {
        const target = prev[prev.length - 1];
        if (!target) return prev;
        setSelectedFile(target.filePath);
        setRevealLine(target.line);
        setRevealNonce((nonce) => nonce + 1);
        setActivePane("editor");
        currentEditorLocationRef.current = target;
        return prev.slice(0, -1);
      });
    }

    function handleKeyDown(e: KeyboardEvent) {
      const editorHasEventTarget =
        activePane === "editor" &&
        e.target instanceof Node &&
        editorPaneRef.current?.contains(e.target);

      if (e.key === "Escape") {
        clearPendingG();
        setShowHelp(false);
        if (result) setActivePane("editor");
        return;
      }

      if (isEditableTarget(e.target) && !editorHasEventTarget) return;

      if (e.key === "?") {
        e.preventDefault();
        clearPendingG();
        setShowHelp(true);
        return;
      }

      if (showHelp || !result) return;

      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        clearPendingG();

        const lower = e.key.toLowerCase();
        if (lower === "e") {
          e.preventDefault();
          handleLineScroll(1);
          return;
        }
        if (lower === "y") {
          e.preventDefault();
          handleLineScroll(-1);
          return;
        }
        if (lower === "f") {
          e.preventDefault();
          handlePageScroll(1);
          return;
        }
        if (lower === "b") {
          e.preventDefault();
          handlePageScroll(-1);
          return;
        }
        if (lower === "t") {
          e.preventDefault();
          handlePopNavigation();
          return;
        }
        if (e.key === "]" || e.code === "BracketRight") {
          e.preventDefault();
          if (activePane === "editor") {
            editorRef.current?.goDefinition();
            return;
          }
          if (activePane === "explanation") {
            pushCurrentEditorLocation();
            if (explanationRef.current?.activateSelection()) {
              setActivePane("editor");
            }
          }
          return;
        }

        return;
      }

      if (pendingGRef.current) {
        if (e.key === "Shift") return;
        clearPendingG();
        if (e.key === "g") {
          e.preventDefault();
          handleGoTop();
          return;
        }
        if (e.key === "t") {
          e.preventDefault();
          setActivePane((prev) => movePane(prev, 1));
          return;
        }
        if (e.key === "T") {
          e.preventDefault();
          setActivePane((prev) => movePane(prev, -1));
          return;
        }
      }

      if (e.key === "g") {
        e.preventDefault();
        queuePendingG();
        return;
      }

      if (e.key === "G") {
        e.preventDefault();
        handleGoBottom();
        return;
      }

      if (activePane === "tree") {
        if (e.key === "j") {
          e.preventDefault();
          treeRef.current?.moveCursor(1);
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          treeRef.current?.moveCursor(-1);
          return;
        }
        if (e.key === "h") {
          e.preventDefault();
          treeRef.current?.collapse();
          return;
        }
        if (e.key === "l" || e.key === "Enter") {
          e.preventDefault();
          treeRef.current?.expandOrOpen();
        }
        return;
      }

      if (activePane === "editor") {
        if (e.key === "h") {
          e.preventDefault();
          editorRef.current?.moveCursor(0, -1);
          return;
        }
        if (e.key === "j") {
          e.preventDefault();
          editorRef.current?.moveCursor(1, 0);
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          editorRef.current?.moveCursor(-1, 0);
          return;
        }
        if (e.key === "l") {
          e.preventDefault();
          editorRef.current?.moveCursor(0, 1);
        }
        return;
      }

      if (e.key === "j") {
        e.preventDefault();
        explanationRef.current?.moveCursor(1);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        explanationRef.current?.moveCursor(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        explanationRef.current?.activateSelection();
        setActivePane("editor");
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      clearPendingG();
    };
  }, [activePane, result, showHelp]);

  async function handleLogout() {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    clearResultCache();
    setUser(null);
    setResult(null);
    setError(null);
    setSelectedFile(null);
    setFileExplanations(new Map());
    setFileExplanationStatus(new Map());
    setFileExplanationErrors(new Map());
    setNavigationStack([]);
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

  function addTokenUsage(usage: TokenUsage | undefined) {
    if (!usage) return;
    setSessionTokens((prev) => ({
      input: prev.input + usage.input_tokens,
      output: prev.output + usage.output_tokens,
    }));
  }

  function handleSymbolExplanation(key: string, text: string) {
    setSymbolExplanations((prev) => new Map(prev).set(key, text));
  }

  function handlePushNavigation(target: NavigationTarget) {
    setNavigationStack((prev) => [...prev, target]);
  }

  function handleNavigate(target: NavigationTarget) {
    setSelectedFile(target.filePath);
    setRevealLine(target.line);
    setRevealNonce((n) => n + 1);
    setActivePane("editor");
    currentEditorLocationRef.current = target;
  }

  async function handleFileSelect(path: string) {
    const explanationKey = explanationCacheKey(path, explanationLanguage);
    if (fileExplanationStatus.get(explanationKey) === "error") {
      setFileExplanationStatus((prev) => {
        const next = new Map(prev);
        next.delete(explanationKey);
        return next;
      });
      setFileExplanationErrors((prev) => {
        const next = new Map(prev);
        next.delete(explanationKey);
        return next;
      });
    }
    setSelectedFile(path);
    setRevealLine(undefined);
    setActivePane("editor");
    currentEditorLocationRef.current = { filePath: path, line: 1 };
    if (fileContents.has(path)) return;
    setFileLoading(true);
    try {
      if (!result) return;
      const resp = await fetch(
        `${API_BASE}/file?owner=${encodeURIComponent(result.owner)}&repo=${encodeURIComponent(result.repo)}&git_ref=${encodeURIComponent(result.git_ref)}&path=${encodeURIComponent(path)}`,
        { credentials: "include" },
      );
      if (!resp.ok) return;
      const data = await resp.json();
      setFileContents((prev) => new Map(prev).set(data.path, data.content));
    } finally {
      setFileLoading(false);
    }
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
    const displayPaths = treePaths ?? result.files.map((f) => f.path);
    const analyzedPaths = new Set(result.files.map((f) => f.path));
    const currentContent = fileContents.get(selectedFile ?? "") ?? "";
    const currentExplanationKey = selectedFile
      ? explanationCacheKey(selectedFile, explanationLanguage)
      : null;
    const currentExplanation = selectedFile
      ? (fileExplanations.get(currentExplanationKey ?? "") ?? null)
      : null;
    const currentExplanationStatus = selectedFile
      ? (fileExplanationStatus.get(currentExplanationKey ?? "") ?? "idle")
      : "idle";
    const currentExplanationError = selectedFile
      ? (fileExplanationErrors.get(currentExplanationKey ?? "") ?? null)
      : null;

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
          {(sessionTokens.input > 0 || sessionTokens.output > 0) && (
            <span
              className="text-xs text-gray-500 font-mono shrink-0"
              title="入力トークン / 出力トークン (セッション合計)"
            >
              ↑{sessionTokens.input.toLocaleString()} ↓
              {sessionTokens.output.toLocaleString()}
            </span>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600 shrink-0">
            <span>AI explanation</span>
            <select
              aria-label="AI explanation language"
              value={explanationLanguage}
              onChange={(e) =>
                setExplanationLanguage(e.target.value as ExplanationLanguage)
              }
              className="border rounded px-2 py-1 bg-white"
            >
              <option value="en">English</option>
              <option value="ja">Japanese</option>
            </select>
          </label>
          <span className="text-sm text-gray-600 shrink-0">@{user.login}</span>
          <button
            onClick={() => setShowHelp(true)}
            className="border rounded px-2 py-1 text-sm hover:bg-gray-100 shrink-0"
            aria-label="利用ガイド"
          >
            ?
          </button>
          <button
            onClick={handleLogout}
            className="border rounded px-3 py-1 text-sm hover:bg-gray-100 shrink-0"
          >
            Logout
          </button>
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <aside
            data-pane-scroll="tree"
            className={`w-56 shrink-0 border-r overflow-y-auto bg-gray-50 flex flex-col ${
              activePane === "tree" ? "ring-2 ring-inset ring-blue-300" : ""
            }`}
            onMouseDown={() => setActivePane("tree")}
          >
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 border-b shrink-0">
              {result.owner}/{result.repo} @ {result.git_ref}
            </div>
            <FileTree
              ref={treeRef}
              paths={displayPaths}
              analyzedPaths={analyzedPaths}
              selectedFile={selectedFile}
              active={activePane === "tree"}
              onFileSelect={handleFileSelect}
            />
          </aside>

          <main
            ref={editorPaneRef}
            className={`flex-1 min-w-0 flex flex-col ${
              activePane === "editor" ? "ring-2 ring-inset ring-blue-300" : ""
            }`}
            onMouseDown={() => setActivePane("editor")}
          >
            {selectedFile ? (
              <div className="flex-1 min-h-0">
                {fileLoading && !fileContents.has(selectedFile) ? (
                  <div className="flex items-center justify-center h-full text-sm text-gray-400">
                    Loading…
                  </div>
                ) : (
                  <Editor
                    ref={editorRef}
                    key={`${result.owner}/${result.repo}@${result.git_ref}`}
                    files={result.files}
                    content={currentContent}
                    currentPath={selectedFile}
                    revealLine={revealLine}
                    revealNonce={revealNonce}
                    height="100%"
                    onNavigate={handleNavigate}
                    onPushNavigation={handlePushNavigation}
                    onPopNavigation={() => {
                      /* kept for compatibility */
                    }}
                    onCursorLineChange={(line) => {
                      if (!selectedFile) return;
                      currentEditorLocationRef.current = {
                        filePath: selectedFile,
                        line,
                      };
                    }}
                    owner={result.owner}
                    repo={result.repo}
                    gitRef={result.git_ref}
                    fileContents={fileContents}
                    symbolExplanationCache={symbolExplanations}
                    onSymbolExplanation={handleSymbolExplanation}
                    explanationLanguage={explanationLanguage}
                    onTokenUsage={(i, o) =>
                      addTokenUsage({ input_tokens: i, output_tokens: o })
                    }
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                Select a file.
              </div>
            )}
          </main>

          <aside
            data-pane-scroll="explanation"
            className={`w-72 shrink-0 border-l overflow-hidden ${
              activePane === "explanation"
                ? "ring-2 ring-inset ring-blue-300"
                : ""
            }`}
            onMouseDown={() => setActivePane("explanation")}
          >
            <AIExplanation
              ref={explanationRef}
              active={activePane === "explanation"}
              selectedPath={selectedFile}
              explanation={currentExplanation}
              status={currentExplanationStatus}
              errorMessage={currentExplanationError}
              onNavigate={handleNavigate}
            />
          </aside>
        </div>
        <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
      </div>
    );
  }

  return (
    <>
      <main className="flex min-h-screen flex-col items-center p-8">
        <div className="flex w-full max-w-4xl justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">CodeMap</h1>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <label className="flex items-center gap-2">
              <span>AI explanation</span>
              <select
                aria-label="AI explanation language"
                value={explanationLanguage}
                onChange={(e) =>
                  setExplanationLanguage(e.target.value as ExplanationLanguage)
                }
                className="border rounded px-2 py-1 bg-white"
              >
                <option value="en">English</option>
                <option value="ja">Japanese</option>
              </select>
            </label>
            <span>@{user.login}</span>
            <button
              onClick={() => setShowHelp(true)}
              className="border rounded px-2 py-1 hover:bg-gray-100"
              aria-label="利用ガイド"
            >
              ?
            </button>
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
            <svg
              className="animate-spin h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
            >
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
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
