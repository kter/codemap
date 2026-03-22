# AGENTS.md

## Scope

Instructions for the entire repository.

More specific instructions may exist in nested `AGENTS.md` files. When instructions conflict, the nearer file takes precedence.

## Overview

CodeMap — a code visualization tool (interfaces, happy paths) built on a serverless stack.
- `crates/`: Rust workspace (Axum + Lambda)
  - `core/`: shared domain types
  - `api/`: Axum Lambda handler (binary: `bootstrap`)
  - `analyzer/`: LanguageAnalyzer trait + result types
  - `analyzer-ts/`: TypeScript analysis via tree-sitter
  - `ai-client/`: Anthropic API client
  - `storage/`: DsqlStorage (Aurora DSQL) + DynamoStorage (DynamoDB sessions)
- `frontend/`: Next.js 15 App Router (Monaco Editor, Tailwind v4)
- `infra/`: Terraform (AWS: API GW, Lambda, CloudFront, S3, Aurora DSQL, DynamoDB)

## Shared Rules

- The root `Makefile` is the canonical entry point for project commands.
- Use the tool versions defined in `.mise.toml`.
- Add or update tests for every new feature and bug fix.
- Add reusable workflow shortcuts to the root `Makefile`.
- Run cross-stack workflows, deployment, and Terraform operations from the repository root.
- Use root `make` targets for project workflows. Do not run direct `aws`, `terraform apply`, or deployment commands.
- Do not run `mise exec -- terraform destroy` or any destructive infrastructure commands without explicit user confirmation.

## Common Commands

```bash
make dev
make test
make install-hooks
make deploy ENV=dev
make tf-plan ENV=dev
```

## Tech Stack Notes

- Lambda runtime: `provided.al2023`, binary must be named `bootstrap`
- TLS: `rustls-tls` (no OpenSSL in Lambda)
- Aurora DSQL: serverless, IAM auth token via `aws_sdk_dsql::auth_token`
- tree-sitter 0.24: use `LANGUAGE_TYPESCRIPT.into()`, `StreamingIterator` for query matches
- Monaco Editor: use `dynamic(() => import(...), { ssr: false })` in `"use client"` component
- Tailwind v4: `@import "tailwindcss"` (no directives)
- Terraform: run via `mise exec -- terraform` (not in PATH by default)
