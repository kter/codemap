# Aurora DSQL is a serverless distributed SQL service.
# It uses IAM authentication and a public TLS endpoint — no VPC placement needed.

resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = false

  tags = {
    Name = "${var.project_name}-${var.environment}"
  }
}

# IAM policy document granting Lambda permission to generate admin auth tokens.
data "aws_iam_policy_document" "lambda_dsql" {
  statement {
    effect    = "Allow"
    actions   = ["dsql:DbConnectAdmin"]
    resources = [aws_dsql_cluster.main.arn]
  }
}

resource "aws_iam_policy" "lambda_dsql" {
  name        = "${var.project_name}-${var.environment}-lambda-dsql"
  description = "Allow Lambda to generate Aurora DSQL admin auth tokens"
  policy      = data.aws_iam_policy_document.lambda_dsql.json
}
