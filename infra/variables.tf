variable "project_name" {
  description = "Name of the project used for resource naming and tagging"
  type        = string
  default     = "codemap"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prd"], var.environment)
    error_message = "environment must be one of: dev, prd"
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "ap-northeast-1"
}

variable "lambda_zip_path" {
  description = "Path to the Lambda deployment zip"
  type        = string
  default     = "./placeholder.zip"
}

