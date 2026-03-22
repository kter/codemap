variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "bucket_id" {
  description = "S3 bucket name"
  type        = string
}

variable "bucket_arn" {
  description = "S3 bucket ARN"
  type        = string
}

variable "bucket_regional_domain_name" {
  description = "S3 bucket regional domain name"
  type        = string
}

variable "api_gateway_endpoint_url" {
  description = "API Gateway HTTP endpoint URL (without trailing slash)"
  type        = string
}

variable "domain_name" {
  description = "Custom domain name for the CloudFront distribution"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (must be in us-east-1) for the custom domain"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the DNS alias record"
  type        = string
}
