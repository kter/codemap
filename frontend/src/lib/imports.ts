/**
 * Resolves TypeScript/JS import specifiers in source to known file paths.
 * Returns the subset of imported paths that exist in knownPaths.
 */
export function resolveImports(
  source: string,
  currentPath: string,
  knownPaths: Set<string>,
): string[] {
  const specifiers = extractSpecifiers(source);
  const dir = currentPath.includes("/")
    ? currentPath.slice(0, currentPath.lastIndexOf("/"))
    : "";
  const results = new Set<string>();
  for (const spec of specifiers) {
    const resolved = resolveSpecifier(spec, dir, knownPaths);
    if (resolved) results.add(resolved);
  }
  return [...results];
}

function extractSpecifiers(source: string): string[] {
  const specs: string[] = [];
  // static import: import ... from "..."
  const staticRe = /from\s+['"]([^'"]+)['"]/g;
  // dynamic import: import("...")
  const dynamicRe = /import\(['"]([^'"]+)['"]\)/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(source))) if (m[1]) specs.push(m[1]);
  while ((m = dynamicRe.exec(source))) if (m[1]) specs.push(m[1]);
  return specs;
}

function resolveSpecifier(
  spec: string,
  dir: string,
  knownPaths: Set<string>,
): string | null {
  // Skip node_modules (bare specifiers not starting with . or aliased paths)
  if (!spec.startsWith(".") && !spec.startsWith("@/") && !spec.startsWith("~/"))
    return null;

  let base: string;
  if (spec.startsWith("@/") || spec.startsWith("~/")) {
    base = "src/" + spec.slice(2);
  } else {
    base = joinPath(dir, spec);
  }
  base = normalizePath(base);

  // Try candidates: as-is, .ts, .tsx, /index.ts, /index.tsx
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  return candidates.find((c) => knownPaths.has(c)) ?? null;
}

function joinPath(dir: string, rel: string): string {
  return dir ? `${dir}/${rel}` : rel;
}

function normalizePath(path: string): string {
  const parts = path.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part !== ".") stack.push(part);
  }
  return stack.join("/");
}
