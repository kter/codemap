---
name: create-pr
description: Handles the complete git workflow for any code changes: creates a feature branch, stages and commits changes, pushes to remote, creates a pull request via `gh`, writes a descriptive PR body, and asks the user to review. Use this skill whenever the user says "commit", "push", "create a PR", "make a pull request", "プルリクエストを作って", "コミットして", "ブランチ作って", "変更をプッシュして", or similar. Also trigger proactively at the end of a coding task when significant changes have been made — offer to create a PR before ending the session.
---

# Create PR Workflow

This skill handles the full git workflow: feature branch → commit → push → pull request with description → user review request.

## When to run this skill

- User explicitly requests: "commit", "push", "create PR", "プルリクエスト", "コミット", etc.
- After completing a significant coding session, proactively offer: "変更内容をコミットしてプルリクエストを作成しましょうか？"

---

## Step 1: Understand the changes

Run these in parallel to understand what's been modified:

```bash
git status
git diff
git log --oneline -5
```

From this, identify:
- Which files changed and for what purpose
- Whether you're already on a feature branch (if so, skip Step 2)
- Whether there's anything sensitive (`.env`, credentials, tfstate) that must NOT be staged

If there are no changes (`git status` shows clean working tree), tell the user and stop.

---

## Step 2: Create a feature branch

Generate a branch name that describes the change. Format: `<type>/<short-kebab-description>`

| Type | Use when |
|------|----------|
| `feature/` | New functionality |
| `fix/` | Bug fix |
| `refactor/` | Code restructuring without behavior change |
| `chore/` | Config, dependencies, tooling |
| `docs/` | Documentation only |

Rules:
- Lowercase letters, numbers, hyphens only
- Under 50 characters
- Reflects the *what*, not just the *how*

Examples: `feature/add-dsql-caching`, `fix/lambda-timeout`, `chore/update-terraform-providers`

```bash
git checkout -b <branch-name>
```

Skip this step if already on a non-main branch.

---

## Step 3: Stage and commit

Stage only the files that are part of this change. Never use `git add -A` or `git add .` — it can accidentally include secrets, tfstate, or build artifacts.

```bash
git add <file1> <file2> ...
```

Write the commit message to explain *why*, not just *what*:

```bash
git commit -m "$(cat <<'EOF'
<type>: <concise summary under 72 chars>

<optional body: explain the motivation, context, or tradeoffs>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

**Safety rules:**
- Never use `--no-verify` to skip pre-commit hooks. If a hook fails, fix the underlying issue and retry.
- Never commit `.env`, credentials, `*.tfstate`, or `bootstrap.zip`.
- If unsure whether a file should be included, ask the user.

---

## Step 4: Push to remote

```bash
git push -u origin <branch-name>
```

If push fails due to a missing remote, tell the user and stop rather than force-pushing.

---

## Step 5: Create the pull request

Use `gh pr create` with a body that follows the project's PR template structure. Fill in every section with real content — never leave placeholder text.

```bash
gh pr create --title "<concise PR title>" --body "$(cat <<'EOF'
## 概要

<1–3 sentences: what this PR does and why it's needed>

## 変更内容

<bullet list of specific changes made>
-
-

## テスト方法

<how to verify the changes work correctly>
- [ ]

## チェックリスト

- [ ] テストを追加・更新した
- [ ] ドキュメントを更新した
EOF
)"
```

---

## Step 6: Report to the user

After the PR is created:

1. Show the PR URL
2. Briefly summarize what was committed (branch name, commit message)
3. Ask the user to review:

> プルリクエストを作成しました。
> PR: <URL>
> ご確認・レビューをお願いします。

---

## Edge cases

| Situation | Action |
|-----------|--------|
| Already on a feature branch | Skip Step 2, continue from Step 3 |
| Working tree is clean | Inform the user, stop |
| Pre-commit hook fails | Fix the issue, re-stage, create a NEW commit (do not amend) |
| Push rejected | Diagnose the cause; do not force-push without explicit user permission |
| Sensitive files in diff | Warn the user, do not stage them |
