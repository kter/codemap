import { detectLanguage } from "./Editor";

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

  it("returns plaintext for unknown extension", () => {
    expect(detectLanguage("binary.wasm")).toBe("plaintext");
  });

  it("returns plaintext for file with no extension", () => {
    expect(detectLanguage("Makefile")).toBe("plaintext");
  });
});
