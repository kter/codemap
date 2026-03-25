variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "sessions_table_name" {
  description = "DynamoDB sessions table name"
  type        = string
}

variable "sessions_table_arn" {
  description = "DynamoDB sessions table ARN"
  type        = string
}

variable "dsql_cluster_arn" {
  description = "Aurora DSQL cluster ARN (for IAM policy)"
  type        = string
}

variable "cache_table_name" {
  description = "DynamoDB AI cache table name"
  type        = string
}

variable "cache_table_arn" {
  description = "DynamoDB AI cache table ARN (for IAM policy)"
  type        = string
}

variable "frontend_url" {
  description = "Public CloudFront URL for CORS and OAuth redirects"
  type        = string
}

variable "api_base_url" {
  description = "API base URL (CloudFront /api path or API GW endpoint)"
  type        = string
  default     = ""
}

variable "lambda_zip_path" {
  description = "Path to the Lambda deployment zip (managed by CI/CD)"
  type        = string
  default     = "./placeholder.zip"
}
