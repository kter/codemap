# ─────────────────────────────────────────────────────────────────────────────
#  CodeMap — Developer Makefile
#
#  Full deployment:
#    make deploy ENV=dev
#    make deploy ENV=prd
#
#  Note: frontend deploy requires `output: "export"` in frontend/next.config.ts
#        (static files are served from S3 via CloudFront)
# ─────────────────────────────────────────────────────────────────────────────

ENV     ?= dev
PROJECT := codemap

LAMBDA_FUNCTION := $(PROJECT)-$(ENV)-api
LAMBDA_ZIP      := bootstrap.zip

INFRA_DIR    := infra
FRONTEND_DIR := frontend

TF          := mise exec -- terraform -chdir=$(INFRA_DIR)
CARGO       := $(HOME)/.cargo/bin/cargo
CARGO_LAMBDA := mise exec -- cargo lambda
AWS         := mise exec -- aws --profile $(ENV) --region ap-northeast-1

.DEFAULT_GOAL := help

# ── Help ──────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Display available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}' | sort

# ── Rust / Backend ────────────────────────────────────────────────────────────

.PHONY: build
build: ## Build all crates (debug)
	$(CARGO) build --workspace

.PHONY: build-release
build-release: ## Build all crates (release)
	$(CARGO) build --workspace --release

.PHONY: build-lambda
build-lambda: ## Build Lambda binary for arm64 (release)
	$(CARGO_LAMBDA) build --release --arm64 -p codemap-api

.PHONY: test
test: ## Run all tests
	$(CARGO) test --workspace
	$(MAKE) frontend-test

.PHONY: test-verbose
test-verbose: ## Run all tests with stdout
	$(CARGO) test --workspace -- --nocapture
	$(MAKE) frontend-test

.PHONY: check
check: ## Run cargo check
	$(CARGO) check --workspace

.PHONY: clippy
clippy: ## Run Clippy linter (deny warnings)
	$(CARGO) clippy --workspace -- -D warnings

.PHONY: fmt
fmt: ## Format Rust code
	$(CARGO) fmt --all

.PHONY: fmt-check
fmt-check: ## Check Rust formatting without modifying files
	$(CARGO) fmt --all -- --check

.PHONY: clean
clean: ## Remove Rust build artifacts and Lambda zip
	$(CARGO) clean
	rm -f $(LAMBDA_ZIP)

# ── Frontend ──────────────────────────────────────────────────────────────────

.PHONY: frontend-install
frontend-install: ## Install frontend npm dependencies
	cd $(FRONTEND_DIR) && npm ci

.PHONY: frontend-build
frontend-build: ## Build frontend for production
	cd $(FRONTEND_DIR) && npm run build

.PHONY: frontend-type-check
frontend-type-check: ## Run TypeScript type check
	cd $(FRONTEND_DIR) && npm run type-check

.PHONY: frontend-test
frontend-test: ## Run frontend Jest tests
	cd $(FRONTEND_DIR) && npm test -- --runInBand

.PHONY: frontend-e2e-install
frontend-e2e-install: ## Install Playwright Chromium for frontend E2E
	cd $(FRONTEND_DIR) && npx playwright install chromium

.PHONY: frontend-e2e
frontend-e2e: ## Run frontend Playwright E2E tests
	cd $(FRONTEND_DIR) && npm run test:e2e

.PHONY: frontend-e2e-headed
frontend-e2e-headed: ## Run frontend Playwright E2E tests in headed mode
	cd $(FRONTEND_DIR) && npm run test:e2e:headed

.PHONY: frontend-dev
frontend-dev: ## Start frontend dev server
	cd $(FRONTEND_DIR) && npm run dev

.PHONY: frontend-clean
frontend-clean: ## Remove frontend build artifacts
	rm -rf $(FRONTEND_DIR)/.next $(FRONTEND_DIR)/out

# ── Terraform / Infrastructure ────────────────────────────────────────────────

.PHONY: tf-init
tf-init: ## Initialize Terraform backend and providers (ENV=dev|prd)
	$(TF) init

.PHONY: tf-plan
tf-plan: _require-env ## Preview infrastructure changes (ENV=dev|prd)
	$(TF) plan -var-file=$(ENV).tfvars

.PHONY: tf-apply
tf-apply: _require-env ## Apply infrastructure changes interactively (ENV=dev|prd)
	$(TF) apply -var-file=$(ENV).tfvars

.PHONY: tf-apply-auto
tf-apply-auto: _require-env ## Apply infrastructure changes without confirmation (ENV=dev|prd)
	$(TF) apply -var-file=$(ENV).tfvars -auto-approve

.PHONY: tf-destroy
tf-destroy: _require-env ## Destroy all infrastructure — CAUTION (ENV=dev|prd)
	$(TF) destroy -var-file=$(ENV).tfvars

.PHONY: tf-output
tf-output: _require-env ## Show Terraform outputs (ENV=dev|prd)
	$(TF) output

# ── Deployment ────────────────────────────────────────────────────────────────

.PHONY: _require-env
_require-env:
	@test "$(ENV)" = "dev" -o "$(ENV)" = "prd" || \
		(echo "ERROR: ENV must be 'dev' or 'prd'  →  make $(MAKECMDGOALS) ENV=dev" && exit 1)

$(LAMBDA_ZIP): build-lambda
	zip -j $(LAMBDA_ZIP) target/lambda/bootstrap/bootstrap

.PHONY: deploy-backend
deploy-backend: _require-env $(LAMBDA_ZIP) ## Build and deploy Lambda function (ENV=dev|prd)
	@echo "==> Deploying Lambda: $(LAMBDA_FUNCTION)"
	$(AWS) lambda update-function-code \
		--function-name $(LAMBDA_FUNCTION) \
		--zip-file fileb://$(LAMBDA_ZIP) \
		--output json | jq '{FunctionName, CodeSize, LastUpdateStatus}'

.PHONY: deploy-frontend
deploy-frontend: _require-env ## Build frontend and sync to S3, then invalidate CloudFront (ENV=dev|prd)
	@echo "==> Fetching Terraform outputs for ENV=$(ENV)"
	@API_BASE=$$($(TF) output -raw api_custom_domain_url) && \
	S3_BUCKET=$$($(TF) output -raw s3_bucket_name) && \
	CF_DIST_ID=$$($(TF) output -raw cloudfront_distribution_id) && \
	echo "==> Building frontend with NEXT_PUBLIC_API_BASE_URL=$$API_BASE" && \
	cd $(FRONTEND_DIR) && NEXT_PUBLIC_API_BASE_URL=$$API_BASE npm run build && \
	cd .. && \
	echo "==> Syncing to s3://$$S3_BUCKET" && \
	$(AWS) s3 sync $(FRONTEND_DIR)/out/ s3://$$S3_BUCKET/ --delete && \
	echo "==> Invalidating CloudFront distribution $$CF_DIST_ID" && \
	INVALIDATION_ID=$$($(AWS) cloudfront create-invalidation \
		--distribution-id $$CF_DIST_ID \
		--paths "/*" \
		--output text --query 'Invalidation.Id') && \
	echo "    Invalidation ID: $$INVALIDATION_ID"

.PHONY: deploy
deploy: _require-env ## Full deployment: backend + frontend (ENV=dev|prd)
	@echo "================================================"
	@echo "  Deploying CodeMap to $(ENV)"
	@echo "================================================"
	$(MAKE) deploy-backend ENV=$(ENV)
	$(MAKE) deploy-frontend ENV=$(ENV)
	@echo ""
	@echo "Deployment to $(ENV) complete!"

# ── CI / Verification ─────────────────────────────────────────────────────────

.PHONY: lint
lint: clippy fmt-check frontend-type-check ## Run all lint checks (Rust + TypeScript)

.PHONY: verify
verify: fmt-check clippy test ## Pre-commit check: format + lint + tests

# Aliases for lefthook / Claude hooks
.PHONY: format-check
format-check: fmt-check ## Check formatting (alias for fmt-check, used by lefthook)

.PHONY: test-lint
test-lint: lint ## Run all lint checks (alias for lint, used by lefthook)

.PHONY: test-unit
test-unit: test ## Run all unit tests (alias for test)

.PHONY: test-integration-full
test-integration-full: ## Run integration tests (cargo test --workspace; expand as needed)
	$(CARGO) test --workspace

.PHONY: stop-hook-unit-tests
stop-hook-unit-tests: ## Run unit tests for Claude/Codex Stop hooks
	$(CARGO) test --workspace

.PHONY: install-hooks
install-hooks: ## Install git hooks via lefthook
	mise exec -- lefthook install
	@echo "Git hooks installed via lefthook."

.PHONY: dev
dev: ## Show instructions to start frontend + backend locally
	@echo "Run in separate terminals:"
	@echo "  make frontend-dev"
	@echo "  # Backend: cargo lambda watch (requires cargo-lambda)"

# ── Claude Code Hooks ──────────────────────────────────────────────────────────

.PHONY: claude-pre-tool-use
claude-pre-tool-use: ## Block destructive Claude Bash commands (CLAUDE_HOOK_COMMAND=...)
	@python3 scripts/claude_pre_tool_use_guard.py

.PHONY: claude-post-tool-use
claude-post-tool-use: ## Run hook-safe format/lint for a single edited file (FILE_PATH=...)
	@if [ -z "$(FILE_PATH)" ]; then \
		echo "FILE_PATH is required"; \
		exit 1; \
	fi
	@file_path="$(FILE_PATH)"; \
	case "$$file_path" in \
		*.rs) \
			$(CARGO) fmt --all ;; \
		frontend/*.ts|frontend/*.tsx|frontend/*.js|frontend/*.jsx) \
			rel_path="$${file_path#frontend/}"; \
			cd frontend && npx prettier --write "$$rel_path" ;; \
		*.ts|*.tsx|*.js|*.jsx) \
			cd frontend && npx prettier --write "$$file_path" ;; \
		*) \
			true ;; \
	esac

# ── Utilities ─────────────────────────────────────────────────────────────────

.PHONY: logs
logs: _require-env ## Tail Lambda CloudWatch logs (ENV=dev|prd)
	$(AWS) logs tail /aws/lambda/$(LAMBDA_FUNCTION) --follow

.PHONY: smoke
smoke: _require-env ## Bedrock 疎通確認: /health/ai を curl (ENV=dev|prd)
	@API_URL=$$($(TF) output -raw api_custom_domain_url) && \
	echo "==> Testing $$API_URL/health/ai" && \
	curl -sf "$$API_URL/health/ai" | python3 -m json.tool

.PHONY: check-logs
check-logs: _require-env ## 直近10分の Lambda エラーのみ抽出 (ENV=dev|prd)
	$(AWS) logs filter-log-events \
		--log-group-name /aws/lambda/$(LAMBDA_FUNCTION) \
		--start-time $$(python3 -c "import time; print(int((time.time()-600)*1000))") \
		--filter-pattern "ERROR" \
		--output text
