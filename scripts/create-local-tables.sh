#!/usr/bin/env bash
# Create local DynamoDB tables for development.
# Idempotent: existing tables are silently ignored.
set -euo pipefail

ENDPOINT="${AWS_ENDPOINT_URL_DYNAMODB:-http://localhost:8000}"
AWS_CMD="mise exec -- aws"
REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"

echo "Creating local DynamoDB tables at ${ENDPOINT} ..."

create_table() {
  local table_name="$1"
  local hash_key="$2"

  if ${AWS_CMD} dynamodb describe-table \
      --table-name "${table_name}" \
      --endpoint-url "${ENDPOINT}" \
      --region "${REGION}" \
      --output text \
      --query "Table.TableName" \
      2>/dev/null | grep -q "${table_name}"; then
    echo "  [skip] ${table_name} already exists"
    return
  fi

  ${AWS_CMD} dynamodb create-table \
    --table-name "${table_name}" \
    --attribute-definitions AttributeName="${hash_key}",AttributeType=S \
    --key-schema AttributeName="${hash_key}",KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --endpoint-url "${ENDPOINT}" \
    --region "${REGION}" \
    --output text \
    --query "TableDescription.TableName" \
    > /dev/null

  echo "  [ok]   ${table_name}"
}

create_table "codemap-local-sessions"  "session_id"
create_table "codemap-local-ai-cache"  "cache_key"

echo "Done."
