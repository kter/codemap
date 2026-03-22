data "aws_region" "current" {}

output "cluster_endpoint" {
  description = "Aurora DSQL cluster endpoint"
  value       = "${aws_dsql_cluster.main.identifier}.dsql.${data.aws_region.current.name}.on.aws"
}

output "cluster_arn" {
  description = "Aurora DSQL cluster ARN"
  value       = aws_dsql_cluster.main.arn
}
