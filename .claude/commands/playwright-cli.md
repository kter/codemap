---
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction
allowed-tools: Bash
---

# playwright-cli

Playwright CLI を使ったブラウザ自動化ツール（MCPより低コスト、コンテキスト増加約1.3%）。

## ワークフロー

1. **確認**: `snapshot` / `click` / `screenshot` でブラウザ操作を対話的に確認
2. **実装**: 確認したフローを `@playwright/test` でテストコードとして実装
3. **検証**: `npx playwright test --headed` で実行、動画で動作確認

## Core Commands

```bash
playwright-cli open <url>              # ページを開く
playwright-cli snapshot                # 要素一覧をYAML形式で取得（refを確認）
playwright-cli click <ref>             # 要素をクリック
playwright-cli fill <ref> <text>       # テキスト入力
playwright-cli type <text>             # テキストタイプ
playwright-cli screenshot [ref]        # スクリーンショット取得
playwright-cli close                   # ページを閉じる
```

## Sessions

```bash
playwright-cli --session=<name> open <url>  # 名前付きセッションで開く
playwright-cli session-stop-all             # 全セッション停止
```

## DevTools

```bash
playwright-cli tracing-start           # トレース記録開始
playwright-cli tracing-stop            # トレース記録停止
playwright-cli console [min-level]     # コンソールメッセージ表示
```

## 使い方

まず `open` でページを開き、`snapshot` で要素の `ref` を確認してから操作する。

```bash
playwright-cli open https://example.com/
playwright-cli snapshot
# → ref: e3 のような識別子が表示される
playwright-cli click e3
playwright-cli snapshot  # 操作後の状態を確認
```

`.playwright-cli/` と `playwright-report/` は `.gitignore` に追加しておくこと。
