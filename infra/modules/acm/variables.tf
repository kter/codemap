variable "domain_name" {
  description = "Domain name for the ACM certificate"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for DNS validation records"
  type        = string
}
