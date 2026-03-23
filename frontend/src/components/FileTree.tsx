"use client";

import { useState } from "react";
import { FileResult } from "@/types/analysis";

interface Props {
  files: FileResult[];
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
}

type TreeNode =
  | { kind: "file"; path: string; name: string }
  | { kind: "dir"; name: string; children: TreeNode[] };

type DirMap = {
  files: { path: string; name: string }[];
  dirs: Map<string, DirMap>;
};

function buildTree(files: FileResult[]): TreeNode[] {
  const root: DirMap = { files: [], dirs: new Map() };

  for (const file of files) {
    const segments = file.path.split("/");
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i] as string;
      if (!current.dirs.has(seg)) {
        current.dirs.set(seg, { files: [], dirs: new Map() });
      }
      current = current.dirs.get(seg)!;
    }
    const name = segments[segments.length - 1] as string;
    current.files.push({ path: file.path, name });
  }

  function toNodes(map: DirMap): TreeNode[] {
    const dirs: TreeNode[] = Array.from(map.dirs.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => ({
        kind: "dir" as const,
        name,
        children: toNodes(child),
      }));
    const fileNodes: TreeNode[] = map.files
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ kind: "file" as const, path: f.path, name: f.name }));
    return [...dirs, ...fileNodes];
  }

  return toNodes(root);
}

function TreeItem({
  node,
  depth,
  selectedFile,
  onFileSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.kind === "dir") {
    return (
      <li>
        <button
          className="w-full text-left py-1 text-sm font-mono text-gray-500 hover:bg-gray-100"
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          onClick={() => setOpen(!open)}
        >
          {open ? "▾" : "▸"} {node.name}/
        </button>
        {open && (
          <ul>
            {node.children.map((child) => (
              <TreeItem
                key={child.kind === "file" ? child.path : `dir:${child.name}`}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onFileSelect={onFileSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        className={`w-full text-left py-1.5 text-sm font-mono hover:bg-gray-100 ${
          node.path === selectedFile
            ? "bg-blue-50 text-blue-700 font-semibold"
            : "text-gray-700"
        }`}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        title={node.path}
        onClick={() => onFileSelect(node.path)}
      >
        {node.name}
      </button>
    </li>
  );
}

export function FileTree({ files, selectedFile, onFileSelect }: Props) {
  const nodes = buildTree(files);
  return (
    <ul className="flex flex-col py-1">
      {nodes.map((node) => (
        <TreeItem
          key={node.kind === "file" ? node.path : `dir:${node.name}`}
          node={node}
          depth={0}
          selectedFile={selectedFile}
          onFileSelect={onFileSelect}
        />
      ))}
    </ul>
  );
}
