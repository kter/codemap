data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.project_name}-${var.environment}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_dynamodb" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [var.sessions_table_arn, var.cache_table_arn]
  }
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name   = "dynamodb-sessions"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_dynamodb.json
}

resource "aws_iam_role_policy_attachment" "lambda_vpc_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "lambda_dsql" {
  statement {
    effect    = "Allow"
    actions   = ["dsql:DbConnectAdmin"]
    resources = [var.dsql_cluster_arn]
  }
}

resource "aws_iam_role_policy" "lambda_dsql" {
  name   = "dsql-connect"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_dsql.json
}

data "aws_iam_policy_document" "lambda_bedrock" {
  statement {
    effect  = "Allow"
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
      "arn:aws:bedrock:*:*:inference-profile/jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    ]
  }
}

resource "aws_iam_role_policy" "lambda_bedrock" {
  name   = "bedrock-invoke"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_bedrock.json
}

data "aws_iam_policy_document" "lambda_ssm" {
  statement {
    effect  = "Allow"
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:*:*:parameter/codemap/${var.environment}/github/*",
    ]
  }
}

resource "aws_iam_role_policy" "lambda_ssm" {
  name   = "ssm-github-params"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_ssm.json
}

resource "aws_security_group" "lambda" {
  name        = "${var.project_name}-${var.environment}-lambda-sg"
  description = "Security group for Lambda function"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-lambda-sg"
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.project_name}-${var.environment}-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}-${var.environment}-api"
  role          = aws_iam_role.lambda.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 60
  filename      = var.lambda_zip_path

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      SESSIONS_TABLE             = var.sessions_table_name
      AI_CACHE_TABLE             = var.cache_table_name
      GITHUB_CLIENT_ID_PARAM     = "/codemap/${var.environment}/github/client_id"
      GITHUB_CLIENT_SECRET_PARAM = "/codemap/${var.environment}/github/client_secret"
      FRONTEND_URL               = var.frontend_url
      API_BASE_URL               = var.api_base_url
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_vpc_execution,
    aws_cloudwatch_log_group.lambda,
  ]
}
