output "sessions_table_name" {
  description = "Sessions DynamoDB table name"
  value       = aws_dynamodb_table.sessions.name
}

output "ai_cache_table_name" {
  description = "AI cache DynamoDB table name"
  value       = aws_dynamodb_table.ai_cache.name
}

output "sessions_table_arn" {
  description = "Sessions DynamoDB table ARN"
  value       = aws_dynamodb_table.sessions.arn
}

output "ai_cache_table_arn" {
  description = "AI cache DynamoDB table ARN"
  value       = aws_dynamodb_table.ai_cache.arn
}
