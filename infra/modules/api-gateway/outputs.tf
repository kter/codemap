output "endpoint_url" {
  description = "API Gateway HTTP endpoint URL"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "api_id" {
  description = "API Gateway API ID"
  value       = aws_apigatewayv2_api.main.id
}

output "custom_domain_url" {
  description = "Custom domain URL for the API"
  value       = "https://${aws_apigatewayv2_domain_name.main.domain_name}"
}
