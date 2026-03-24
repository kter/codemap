"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

interface Props {
  paths: string[];
  analyzedPaths?: Set<string>;
  selectedFile: string | null;
  active?: boolean;
  onFileSelect: (path: string) => void;
}

export type TreeNode =
  | { kind: "file"; path: string; name: string }
  | { kind: "dir"; path: string; name: string; children: TreeNode[] };

type DirMap = {
  files: { path: string; name: string }[];
  dirs: Map<string, DirMap>;
};

export interface VisibleTreeNode {
  kind: "file" | "dir";
  path: string;
  name: string;
  depth: number;
  parentPath: string | null;
  isOpen?: boolean;
}

export interface FileTreeHandle {
  moveCursor: (delta: number) => void;
  pageMove: (deltaPages: number) => void;
  goTop: () => void;
  goBottom: () => void;
  expandOrOpen: () => void;
  collapse: () => void;
}

export function buildTree(paths: string[]): TreeNode[] {
  const root: DirMap = { files: [], dirs: new Map() };

  for (const path of paths) {
    const segments = path.split("/");
    let current = root;
    const dirSegments: string[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i] as string;
      dirSegments.push(seg);
      if (!current.dirs.has(seg)) {
        current.dirs.set(seg, { files: [], dirs: new Map() });
      }
      current = current.dirs.get(seg)!;
    }
    const name = segments[segments.length - 1] as string;
    current.files.push({ path, name });
  }

  function toNodes(map: DirMap, parentSegments: string[] = []): TreeNode[] {
    const dirs: TreeNode[] = Array.from(map.dirs.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => ({
        kind: "dir" as const,
        name,
        path: [...parentSegments, name].join("/"),
        children: toNodes(child, [...parentSegments, name]),
      }));
    const fileNodes: TreeNode[] = map.files
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ kind: "file" as const, path: f.path, name: f.name }));
    return [...dirs, ...fileNodes];
  }

  return toNodes(root);
}

export function flattenVisibleNodes(
  nodes: TreeNode[],
  openDirs: Set<string>,
  depth = 0,
  parentPath: string | null = null,
): VisibleTreeNode[] {
  const visible: VisibleTreeNode[] = [];

  for (const node of nodes) {
    if (node.kind === "dir") {
      const isOpen = openDirs.has(node.path);
      visible.push({
        kind: "dir",
        path: node.path,
        name: node.name,
        depth,
        parentPath,
        isOpen,
      });
      if (isOpen) {
        visible.push(
          ...flattenVisibleNodes(node.children, openDirs, depth + 1, node.path),
        );
      }
    } else {
      visible.push({
        kind: "file",
        path: node.path,
        name: node.name,
        depth,
        parentPath,
      });
    }
  }

  return visible;
}

function collectAncestorDirs(path: string): string[] {
  const segments = path.split("/");
  const dirs: string[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    dirs.push(segments.slice(0, i + 1).join("/"));
  }
  return dirs;
}

function escapeAttributeValue(value: string) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function getScrollContainer(root: HTMLElement | null): HTMLElement | null {
  return root?.closest("[data-pane-scroll='tree']") as HTMLElement | null;
}

export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree(
  { paths, analyzedPaths, selectedFile, active = false, onFileSelect },
  ref,
) {
  const nodes = useMemo(() => buildTree(paths), [paths]);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [cursorPath, setCursorPath] = useState<string | null>(null);
  const rootRef = useRef<HTMLUListElement | null>(null);

  const visibleNodes = useMemo(
    () => flattenVisibleNodes(nodes, openDirs),
    [nodes, openDirs],
  );

  useEffect(() => {
    if (selectedFile) {
      setOpenDirs((prev) => {
        const next = new Set(prev);
        let changed = false;
        collectAncestorDirs(selectedFile).forEach((dir) => {
          if (!next.has(dir)) {
            next.add(dir);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setCursorPath((prev) => (prev === selectedFile ? prev : selectedFile));
      return;
    }

    setCursorPath((prev) => prev ?? visibleNodes[0]?.path ?? null);
  }, [selectedFile, visibleNodes]);

  useEffect(() => {
    if (!active || !cursorPath) return;
    const element = rootRef.current?.querySelector<HTMLElement>(
      `[data-tree-path="${escapeAttributeValue(cursorPath)}"]`,
    );
    element?.scrollIntoView({ block: "nearest" });
  }, [active, cursorPath, openDirs]);

  function getCursorIndex() {
    if (!visibleNodes.length) return -1;
    if (!cursorPath) return 0;
    const index = visibleNodes.findIndex((node) => node.path === cursorPath);
    return index >= 0 ? index : 0;
  }

  function setCursorByIndex(index: number) {
    if (!visibleNodes.length) return;
    const next = visibleNodes[Math.max(0, Math.min(index, visibleNodes.length - 1))];
    setCursorPath(next?.path ?? null);
  }

  function moveCursor(delta: number) {
    if (!visibleNodes.length) return;
    setCursorByIndex(getCursorIndex() + delta);
  }

  function pageMove(deltaPages: number) {
    if (!visibleNodes.length) return;
    const root = rootRef.current;
    const container = getScrollContainer(root);
    const firstItem = root?.querySelector<HTMLElement>("[data-tree-path]");
    const itemHeight = firstItem?.getBoundingClientRect().height || 28;
    const pageSize = Math.max(
      1,
      Math.floor((container?.clientHeight || itemHeight * 10) / itemHeight) - 1,
    );
    setCursorByIndex(getCursorIndex() + deltaPages * pageSize);
  }

  function expandOrOpen() {
    const current = visibleNodes[getCursorIndex()];
    if (!current) return;
    if (current.kind === "dir") {
      setOpenDirs((prev) => new Set(prev).add(current.path));
      return;
    }
    onFileSelect(current.path);
  }

  function collapse() {
    const current = visibleNodes[getCursorIndex()];
    if (!current) return;

    if (current.kind === "dir" && current.isOpen) {
      setOpenDirs((prev) => {
        const next = new Set(prev);
        next.delete(current.path);
        return next;
      });
      return;
    }

    if (current.parentPath) {
      setCursorPath(current.parentPath);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      moveCursor,
      pageMove,
      goTop: () => setCursorByIndex(0),
      goBottom: () => setCursorByIndex(visibleNodes.length - 1),
      expandOrOpen,
      collapse,
    }),
    [visibleNodes, cursorPath],
  );

  function handleDirClick(path: string) {
    setCursorPath(path);
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNode(node: TreeNode, depth: number) {
    if (node.kind === "dir") {
      const isOpen = openDirs.has(node.path);
      const isCursor = cursorPath === node.path;
      return (
        <li key={`dir:${node.path}`}>
          <button
            type="button"
            data-tree-path={node.path}
            className={`w-full text-left py-1 text-sm font-mono hover:bg-gray-100 ${
              active && isCursor ? "bg-blue-100 text-blue-800" : "text-gray-500"
            }`}
            style={{ paddingLeft: `${depth * 12 + 12}px` }}
            onClick={() => handleDirClick(node.path)}
          >
            {isOpen ? "▾" : "▸"} {node.name}/
          </button>
          {isOpen && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}
        </li>
      );
    }

    const isAnalyzed = analyzedPaths?.has(node.path);
    const isSelected = node.path === selectedFile;
    const isCursor = cursorPath === node.path;

    return (
      <li key={node.path}>
        <button
          type="button"
          data-tree-path={node.path}
          className={`w-full text-left py-1.5 text-sm font-mono hover:bg-gray-100 ${
            active && isCursor
              ? "bg-blue-100 text-blue-800"
              : isSelected
                ? "bg-blue-50 text-blue-700 font-semibold"
                : isAnalyzed
                  ? "text-gray-700 font-semibold"
                  : "text-gray-700"
          }`}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          title={node.path}
          onClick={() => {
            setCursorPath(node.path);
            onFileSelect(node.path);
          }}
        >
          {node.name}
        </button>
      </li>
    );
  }

  return <ul ref={rootRef} className="flex flex-col py-1">{nodes.map((node) => renderNode(node, 0))}</ul>;
});
