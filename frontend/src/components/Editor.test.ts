import {
  detectLanguage,
  findDefinition,
  findReferences,
  NAVIGATION_LANGUAGES,
} from "./Editor";

describe("detectLanguage", () => {
  it("maps .ts to typescript", () => {
    expect(detectLanguage("src/index.ts")).toBe("typescript");
  });

  it("maps .tsx to typescript", () => {
    expect(detectLanguage("src/App.tsx")).toBe("typescript");
  });

  it("maps .js to javascript", () => {
    expect(detectLanguage("lib/utils.js")).toBe("javascript");
  });

  it("maps .json to json", () => {
    expect(detectLanguage("package.json")).toBe("json");
  });

  it("maps .md to markdown", () => {
    expect(detectLanguage("README.md")).toBe("markdown");
  });

  it("maps .rs to rust", () => {
    expect(detectLanguage("src/main.rs")).toBe("rust");
  });

  it("maps .py to python", () => {
    expect(detectLanguage("src/main.py")).toBe("python");
  });

  it("returns plaintext for unknown extension", () => {
    expect(detectLanguage("binary.wasm")).toBe("plaintext");
  });

  it("returns plaintext for file with no extension", () => {
    expect(detectLanguage("Makefile")).toBe("plaintext");
  });
});

describe("NAVIGATION_LANGUAGES", () => {
  it("includes python", () => {
    expect(NAVIGATION_LANGUAGES).toContain("python");
  });
});

// Sample data shared across findDefinition/findReferences tests
const sampleFiles = [
  {
    path: "src/types.ts",
    source_code:
      "interface IUser { id: number; }\nexport type UserId = number;",
    interfaces: [
      {
        name: "IUser",
        line: 1,
        signature: "interface IUser {}",
        description: "",
      },
      {
        name: "UserId",
        line: 2,
        signature: "type UserId = number",
        description: "",
      },
    ],
    happy_paths: [],
  },
  {
    path: "src/utils.ts",
    source_code: "export function getUser(id: UserId): IUser { return null!; }",
    interfaces: [],
    happy_paths: [{ name: "getUser", line: 1, summary: "Fetches user by ID" }],
  },
];

describe("findDefinition", () => {
  it("finds interface by name", () => {
    expect(findDefinition("IUser", sampleFiles)).toEqual({
      filePath: "src/types.ts",
      line: 1,
    });
  });

  it("finds type alias by name", () => {
    expect(findDefinition("UserId", sampleFiles)).toEqual({
      filePath: "src/types.ts",
      line: 2,
    });
  });

  it("finds exported function in happy_paths", () => {
    expect(findDefinition("getUser", sampleFiles)).toEqual({
      filePath: "src/utils.ts",
      line: 1,
    });
  });

  it("returns null for unknown symbol", () => {
    expect(findDefinition("NonExistent", sampleFiles)).toBeNull();
  });

  it("returns null for empty files array", () => {
    expect(findDefinition("IUser", [])).toBeNull();
  });

  it("prefers first match when symbol appears in multiple files", () => {
    const dup = [
      { ...sampleFiles[0], path: "a.ts" },
      { ...sampleFiles[0], path: "b.ts" },
    ];
    expect(findDefinition("IUser", dup)?.filePath).toBe("a.ts");
  });
});

describe("findReferences", () => {
  it("finds all occurrences of symbol across files", () => {
    const refs = findReferences("IUser", sampleFiles);
    // IUser appears in src/types.ts line 1 and src/utils.ts line 1
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.filePath === "src/types.ts")).toBe(true);
    expect(refs.some((r) => r.filePath === "src/utils.ts")).toBe(true);
  });

  it("returns correct line and column for a match", () => {
    const refs = findReferences("IUser", sampleFiles);
    const typeRef = refs.find(
      (r) => r.filePath === "src/types.ts" && r.line === 1,
    );
    expect(typeRef).toBeDefined();
    expect(typeRef!.startColumn).toBe("interface ".length + 1);
  });

  it("does NOT match partial words", () => {
    const files = [
      {
        path: "a.ts",
        source_code: "const MyUserName = 'x'; const User = 'y';",
        interfaces: [],
        happy_paths: [],
      },
    ];
    const refs = findReferences("User", files);
    // Should match standalone "User" but NOT "MyUserName"
    expect(refs.length).toBe(1);
    expect(refs[0].startColumn).toBe(
      "const MyUserName = 'x'; const ".length + 1,
    );
  });

  it("returns empty array for unknown symbol", () => {
    expect(findReferences("Unknown", sampleFiles)).toHaveLength(0);
  });

  it("returns empty array when source_code is empty", () => {
    const files = [
      { path: "a.ts", source_code: "", interfaces: [], happy_paths: [] },
    ];
    expect(findReferences("IUser", files)).toHaveLength(0);
  });
});
