import { resolveImports } from "./imports";

const knownPaths = new Set([
  "src/types.ts",
  "src/utils.ts",
  "src/components/Button.tsx",
  "src/components/index.tsx",
  "src/lib/helpers.ts",
]);

describe("resolveImports", () => {
  it("resolves relative ./ import with .ts extension", () => {
    const source = `import { User } from './types';`;
    const result = resolveImports(source, "src/index.ts", knownPaths);
    expect(result).toContain("src/types.ts");
  });

  it("resolves ../ relative import", () => {
    const source = `import { helper } from '../lib/helpers';`;
    const result = resolveImports(
      source,
      "src/components/Button.tsx",
      knownPaths,
    );
    expect(result).toContain("src/lib/helpers.ts");
  });

  it("resolves @/ alias import", () => {
    const source = `import { Button } from '@/components/Button';`;
    const result = resolveImports(source, "src/app/page.tsx", knownPaths);
    expect(result).toContain("src/components/Button.tsx");
  });

  it("resolves directory via index.tsx", () => {
    const source = `import { Button } from './components';`;
    const result = resolveImports(source, "src/index.ts", knownPaths);
    expect(result).toContain("src/components/index.tsx");
  });

  it("skips node_modules specifiers", () => {
    const source = `import React from 'react'; import { useState } from 'react';`;
    const result = resolveImports(source, "src/index.ts", knownPaths);
    expect(result).toHaveLength(0);
  });

  it("deduplicates repeated imports of the same path", () => {
    const source = `
      import { User } from './types';
      import type { User } from './types';
    `;
    const result = resolveImports(source, "src/index.ts", knownPaths);
    const count = result.filter((p) => p === "src/types.ts").length;
    expect(count).toBe(1);
  });
});
