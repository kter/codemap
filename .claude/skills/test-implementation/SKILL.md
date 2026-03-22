---
name: test-implementation
description: Implement unit tests and integration tests following best practices for Rust backends and Next.js frontends. Use this skill whenever the user asks to write tests, add test coverage, implement integration tests, write unit tests, improve test quality, check test best practices, or test a new feature or API endpoint. Also trigger when the user describes a testing gap, mentions that tests are missing, or wants to verify behavior of deployed services against a real API.
---

# Test Implementation

This skill helps you implement high-quality unit tests and integration tests. The goal is tests that are reliable, independent, and actually catch bugs — not tests that just pass green.

## Step 1: Understand what needs testing

Before writing any code, explore the codebase and answer:
- What features exist and which are already tested?
- What are the key happy paths and error paths?
- Which scenarios are too expensive/slow to test against real infrastructure (e.g., AWS API calls, DSQL connections, rate limits)?
- Which scenarios require a real deployed environment to verify end-to-end behavior?

This determines the split between unit tests and integration tests.

## Step 2: Decide unit test vs integration test

**Use unit tests when:**
- The scenario would require special conditions that are costly or impractical to trigger in a real environment (AWS service failures, DSQL connection errors, Bedrock rate limits)
- The logic is pure business logic with injectable dependencies (you can pass in a mock storage or mock AI client)
- You need to test boundary values precisely

**Use integration tests when:**
- You want to verify the full request/response cycle against a real deployed service
- The feature involves infrastructure (DynamoDB reads/writes, DSQL, S3, Lambda)
- You need to confirm that components work together correctly (not just in isolation)

## Step 3: Rust unit test patterns

### Test module placement

Rust unit tests live in the same file as the code under test:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_happy_path() {
        // ...
    }

    #[tokio::test]
    async fn test_async_handler() {
        // ...
    }
}
```

### Mocking dependencies with trait objects

The key pattern for unit tests is dependency injection + trait objects:

```rust
// Define a trait for the dependency
#[async_trait]
pub trait Storage: Send + Sync {
    async fn get_session(&self, token: &str) -> Result<Option<Session>, StorageError>;
}

// In tests, implement the trait with a mock
struct MockStorage {
    sessions: HashMap<String, Session>,
}

#[async_trait]
impl Storage for MockStorage {
    async fn get_session(&self, token: &str) -> Result<Option<Session>, StorageError> {
        Ok(self.sessions.get(token).cloned())
    }
}
```

### Testing Axum handlers

Use `axum::test` or `tower::ServiceExt` to test handlers without a running server:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

#[tokio::test]
async fn test_health_endpoint() {
    let app = build_router(test_state());
    let response = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
```

### Testing both success and error paths

Always test both success and failure:

```rust
#[tokio::test]
async fn test_returns_401_without_session() {
    let app = build_router(test_state());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/analyze")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_returns_200_with_valid_session() {
    let app = build_router(test_state_with_session("valid-token"));
    // ...
}
```

## Step 4: Next.js / TypeScript test patterns

### Vitest for unit tests

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('analyzeFile', () => {
  it('returns FileDescriptions on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [] }),
    });
    // ...
    expect(result).toBeDefined();
  });
});
```

### Testing React components

```typescript
import { render, screen } from '@testing-library/react';

it('renders analysis results', () => {
  render(<AnalysisResults results={mockResults} />);
  expect(screen.getByText('Analysis Results')).toBeInTheDocument();
});
```

## Step 5: Test organization for this project

```
crates/<crate>/src/
├── lib.rs (or main.rs)
└── <module>.rs  ← unit tests in #[cfg(test)] mod tests { }

crates/<crate>/tests/
└── integration_test.rs  ← integration tests (separate binary)

frontend/src/
└── <component>.test.ts  ← Vitest unit tests alongside components
```

## Step 6: Running tests

```bash
# All Rust tests
cargo test --workspace

# Specific crate
cargo test -p codemap-api

# With output
cargo test --workspace -- --nocapture

# Frontend tests
cd frontend && npm run test -- --run
```

## Step 7: Best practices checklist

Before considering tests done, verify:

- [ ] All happy paths tested
- [ ] All expected error paths tested (401, 403, 404, 500, etc.)
- [ ] No test depends on the side effects of another test (each test is independent)
- [ ] Async tests use `#[tokio::test]`
- [ ] Tests that use AWS SDK require `BehaviorVersion::latest()` in config
- [ ] Mock implementations are minimal — only implement what's needed for the test
- [ ] Test names clearly describe what's being tested and what the expected outcome is

## What to output

For each feature area, produce:
1. Test code with clearly named test functions
2. Any mock structs or helpers needed
3. Any updates needed to existing test infrastructure (e.g., `test_state()` helpers)
4. A brief explanation of which tests cover which scenarios and why they're structured that way
