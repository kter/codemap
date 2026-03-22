variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "lambda_invoke_arn" {
  description = "Lambda function invoke ARN"
  type        = string
}

variable "lambda_function_arn" {
  description = "Lambda function ARN"
  type        = string
}

variable "frontend_url" {
  description = "Public CloudFront URL for CORS allow_origins"
  type        = string
}

variable "domain_name" {
  description = "Custom domain name for the API Gateway"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the custom domain"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the DNS alias record"
  type        = string
}
