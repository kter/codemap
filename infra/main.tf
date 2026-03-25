locals {
  domain_suffix   = var.environment == "prd" ? "devtools.site" : "${var.environment}.devtools.site"
  hosted_zone_name = local.domain_suffix
  frontend_domain = "codemap.${local.domain_suffix}"
  api_domain      = "api.codemap.${local.domain_suffix}"
  frontend_url    = "https://${local.frontend_domain}"
  api_base_url    = "https://${local.api_domain}"
}

data "aws_route53_zone" "main" {
  name         = local.hosted_zone_name
  private_zone = false
}

module "dynamodb" {
  source       = "./modules/dynamodb"
  project_name = var.project_name
  environment  = var.environment
}

module "s3" {
  source       = "./modules/s3"
  project_name = var.project_name
  environment  = var.environment
}

module "lambda" {
  source       = "./modules/lambda"
  project_name = var.project_name
  environment  = var.environment

  sessions_table_name = module.dynamodb.sessions_table_name
  sessions_table_arn  = module.dynamodb.sessions_table_arn

  dsql_endpoint    = module.dsql.cluster_endpoint
  dsql_cluster_arn = module.dsql.cluster_arn

  cache_table_name = module.dynamodb.ai_cache_table_name
  cache_table_arn  = module.dynamodb.ai_cache_table_arn

  frontend_url         = local.frontend_url
  api_base_url         = local.api_base_url
  lambda_zip_path      = var.lambda_zip_path
}

module "api_gateway" {
  source       = "./modules/api-gateway"
  project_name = var.project_name
  environment  = var.environment

  lambda_invoke_arn   = module.lambda.invoke_arn
  lambda_function_arn = module.lambda.function_arn
  frontend_url        = local.frontend_url

  domain_name         = local.api_domain
  acm_certificate_arn = module.acm_api.certificate_arn
  hosted_zone_id      = data.aws_route53_zone.main.zone_id
}

module "cloudfront" {
  source       = "./modules/cloudfront"
  project_name = var.project_name
  environment  = var.environment

  bucket_id                   = module.s3.bucket_id
  bucket_arn                  = module.s3.bucket_arn
  bucket_regional_domain_name = module.s3.bucket_regional_domain_name
  api_gateway_endpoint_url    = module.api_gateway.endpoint_url

  domain_name         = local.frontend_domain
  acm_certificate_arn = module.acm_cloudfront.certificate_arn
  hosted_zone_id      = data.aws_route53_zone.main.zone_id
}

module "dsql" {
  source       = "./modules/dsql"
  project_name = var.project_name
  environment  = var.environment
}

module "acm_cloudfront" {
  source         = "./modules/acm"
  domain_name    = local.frontend_domain
  hosted_zone_id = data.aws_route53_zone.main.zone_id

  providers = {
    aws = aws.us_east_1
  }
}

module "acm_api" {
  source         = "./modules/acm"
  domain_name    = local.api_domain
  hosted_zone_id = data.aws_route53_zone.main.zone_id
}
