resource "aws_dynamodb_table" "sessions" {
  name         = "${var.project_name}-${var.environment}-sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"

  attribute {
    name = "session_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-sessions"
  }
}

resource "aws_dynamodb_table" "ai_cache" {
  name         = "${var.project_name}-${var.environment}-ai-cache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cache_key"

  attribute {
    name = "cache_key"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-ai-cache"
  }
}
