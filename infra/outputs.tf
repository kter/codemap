output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = module.api_gateway.endpoint_url
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name"
  value       = module.cloudfront.domain_name
}

output "s3_bucket_name" {
  description = "S3 bucket name for frontend assets"
  value       = module.s3.bucket_id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (used for cache invalidation)"
  value       = module.cloudfront.distribution_id
}

output "frontend_url" {
  description = "Custom domain URL for the frontend"
  value       = local.frontend_url
}

output "api_custom_domain_url" {
  description = "Custom domain URL for the API"
  value       = module.api_gateway.custom_domain_url
}
