---
title: "Complete Guide to AWS CLI Setup and Resource Queries"
description: "A comprehensive guide to AWS CLI authentication methods (CloudShell, IAM Identity Center, access keys) and resource query commands for major services"
pubDate: 2026-02-08T14:50:00+09:00
lang: en
tags: ["AWS", "CLI", "IAM", "Cloud", "Infrastructure"]
heroImage: "../../../assets/AWSCliGuide.png"
---

## Introduction

AWS CLI (Command Line Interface) is a tool for managing AWS services from the command line.
It allows faster resource status checks than the web console and enables automation through scripts.

This article covers the following topics:
- Comparison and setup of AWS CLI authentication methods
- AWS recommended approaches: CloudShell, IAM Identity Center
- Resource query commands for major AWS services

---

## Choosing an Authentication Method

To use AWS CLI, authentication is required first. AWS **recommends temporary credentials over long-term access keys**.

| Method | Security | Installation | Recommended Use Case |
|--------|----------|-------------|---------------------|
| **CloudShell** | High | Not required | Quick tasks, ad-hoc queries |
| **IAM Identity Center** | High | Required | Organization environments, multi-account |
| **Access Keys + aws-vault** | Medium | Required | Local automation, CI/CD |
| **Access Keys (plaintext)** | Low | Required | Not recommended |

---

## Method 1: AWS CloudShell (Simplest)

**CloudShell** is an AWS CLI environment that can be used directly from the browser.
You can use CLI without any installation or authentication setup -- just log in to the AWS Console.

### How to Use

1. Log in to the [AWS Console](https://console.aws.amazon.com)
2. Click the **CloudShell icon** in the top menu bar (terminal icon)
3. Execute commands directly in the terminal

```bash
# Run directly in CloudShell (no authentication setup needed)
aws s3 ls
aws ec2 describe-instances --region ap-northeast-2
aws lambda list-functions
```

### Advantages

- **No installation required**: Only a browser is needed
- **Automatic authentication**: Uses the same permissions as your console login
- **Pre-installed tools**: AWS CLI, git, python, node, jq, etc.
- **1GB home directory**: Can store scripts and files (per region)
- **Free**: No additional cost

### Limitations

- Requires a browser (cannot automate with local scripts)
- Session timeout (after 20 minutes of inactivity)
- Available only in certain regions
- Outbound network restrictions (SSH, VPN, etc.)

### Recommended Use Cases

- Quick resource status checks
- One-time tasks
- Testing CLI commands
- Working without local environment setup

---

## Method 2: IAM Identity Center (Recommended for Organizations)

**IAM Identity Center** (formerly AWS SSO) is the recommended authentication method for organizations using AWS.
It uses temporary credentials without long-term access keys.

> **Free service**: Both IAM Identity Center and AWS Organizations are available at no additional cost.

### How Is This Different from a Bastion Host?

Both seem similar in that they "manage access through an intermediary," but **their purposes and targets are completely different.**

| Category | Bastion Host | IAM Identity Center |
|----------|-------------|---------------------|
| **Purpose** | SSH access to servers (EC2) | Authentication for AWS API/Console |
| **Target** | EC2 instances (Linux/Windows) | AWS services (S3, EC2, RDS, etc.) |
| **Access Method** | SSH (port 22) | HTTPS (AWS API) |
| **What It Protects** | Servers in private networks | AWS accounts/resources |
| **What It Does** | Work directly inside the server | Query/create/delete AWS resources |

**Analogy:**

```
Bastion Host        = Building entrance security gate -> Must pass through to get "inside" the server
IAM Identity Center = AWS management portal login -> Must authenticate to "use" AWS services
```

**Example Scenario:**

```bash
# Using IAM Identity Center (AWS API calls)
aws ec2 describe-instances      # List EC2 instances
aws s3 ls                       # List S3 buckets
aws rds describe-db-instances   # Query RDS instances
# -> Managing AWS resources from "outside" the server

# Using Bastion Host (server access)
ssh -J bastion@bastion.example.com ec2-user@10.0.1.50
# -> Getting "inside" the server to check logs, modify files, restart apps
```

**When You Need Both:**

```bash
# 1. Authenticate with AWS CLI via IAM Identity Center
aws sso login --profile production

# 2. Query EC2 instance information
aws ec2 describe-instances --query 'Reservations[*].Instances[*].[InstanceId,PrivateIpAddress]'

# 3. SSH into a private server through the Bastion Host
ssh -J ubuntu@bastion.example.com ubuntu@10.0.2.100

# 4. Work inside the server
tail -f /var/log/application.log
```

**Summary:**
- **AWS resource management** (create, query, delete) -> IAM Identity Center
- **Server internal tasks** (logs, configuration, deployment) -> Bastion Host (or SSM Session Manager)

### Prerequisites

The following are required to use IAM Identity Center:

1. Setup in the **Management Account**
2. **AWS Organizations** enabled
3. **IAM Identity Center** enabled
4. Users and permission sets created

> **If you get the "Unable to load your organization's root" error:**
> - You are accessing from a member account, not the management account
> - AWS Organizations is not enabled
> - Insufficient IAM permissions

### Administrator Initial Setup (One-time)

IAM Identity Center must be configured by the **management account administrator**. Regular users can skip this step and go to [CLI User Setup](#sso-setup).

#### Step 1: Enable AWS Organizations

```
AWS Console -> AWS Organizations -> Create organization
```

Skip this step if an organization already exists.

#### Step 2: Enable IAM Identity Center

```
AWS Console -> IAM Identity Center -> Enable
```

When enabled for the first time, an Identity Center directory is automatically created.

#### Step 3: Create Users

```
IAM Identity Center -> Users -> Add user
```

- Enter username and email
- An invitation is sent via email

#### Step 4: Create Permission Sets

```
IAM Identity Center -> Permission sets -> Create permission set
```

| Permission Set | Description |
|---------------|-------------|
| AdministratorAccess | Full administrator access |
| PowerUserAccess | Full access except IAM |
| ReadOnlyAccess | Read-only access |
| Custom | Select only the required permissions |

#### Step 5: Assign Users to AWS Accounts

```
IAM Identity Center -> AWS accounts -> Select account -> Assign users or groups
```

- Select users/groups
- Select permission sets
- Complete the assignment

#### Required IAM Permissions (for Administrators)

The following permissions are needed to set up IAM Identity Center in the management account:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sso:*",
        "sso-directory:*",
        "identitystore:*",
        "organizations:DescribeOrganization",
        "organizations:ListRoots",
        "organizations:ListAccounts",
        "organizations:ListAccountsForParent",
        "organizations:ListOrganizationalUnitsForParent"
      ],
      "Resource": "*"
    }
  ]
}
```

Or use the following AWS managed policies:
- `AWSSSOMasterAccountAdministrator`
- `AWSSSODirectoryAdministrator`

### AWS CLI Installation

```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Windows
# Download MSI from https://aws.amazon.com/cli/
```

### SSO Setup

```bash
aws configure sso
```

An interactive prompt will appear. Here is what each field means:

#### Step 1: Enter SSO Session Information

```
SSO session name (Recommended): my-company-sso
SSO start URL [None]: https://my-company.awsapps.com/start
SSO region [None]: ap-northeast-2
SSO registration scopes [sso:account:access]:
```

| Field | Description | How to Find |
|-------|-------------|-------------|
| **SSO session name** | Session name used locally. Set freely | Enter any name (e.g., `my-company-sso`) |
| **SSO start URL** | IAM Identity Center portal URL (auto-generated by AWS) | AWS Console -> IAM Identity Center -> Settings -> Portal URL |
| **SSO region** | Region where IAM Identity Center is enabled | AWS Console -> IAM Identity Center -> Settings -> Region |
| **SSO registration scopes** | Access scope. Use the default value | Just press Enter (default: `sso:account:access`) |

**What is the SSO start URL?**

When IAM Identity Center is enabled, **AWS automatically generates a portal URL**. There is no need to build your own SSO server.

```
# URL format auto-generated by AWS
https://d-xxxxxxxxxx.awsapps.com/start

# Can be changed to a custom URL (optional)
https://my-company.awsapps.com/start
```

**How to find the SSO start URL:**

```
AWS Console -> IAM Identity Center -> Settings -> "AWS access portal URL"
```

The administrator shares this URL with users after enabling IAM Identity Center.

#### Step 2: Browser Authentication

After entering the above information, a browser window opens automatically:

1. IAM Identity Center login page is displayed
2. Enter username/password (or MFA)
3. Click "Allow" to grant CLI access

#### Step 3: Select Account and Role

```
There are 2 AWS accounts available to you.
> Production (123456789012)
  Development (987654321098)

Using the role name "PowerUserAccess"
CLI default client Region [ap-northeast-2]:
CLI default output format [json]:
CLI profile name [PowerUserAccess-123456789012]: production
```

| Field | Description |
|-------|-------------|
| **AWS accounts** | Select from the list of accessible AWS accounts |
| **role name** | Permission set to use in that account (assigned by administrator) |
| **CLI default client Region** | Default region (e.g., `ap-northeast-2`) |
| **CLI default output format** | Output format (`json`, `table`, `text`) |
| **CLI profile name** | Profile name used locally. Set freely |

> **Tip:** If you need access to multiple accounts/roles, run `aws configure sso` multiple times to add profiles.

### Usage

```bash
# SSO login (when session expires)
aws sso login --profile production

# Execute commands
aws s3 ls --profile production
aws ec2 describe-instances --profile production

# Set default profile
export AWS_PROFILE=production
aws s3 ls  # --profile can be omitted
```

### Configuration File Example

**~/.aws/config**

```ini
[profile production]
sso_session = my-company-sso
sso_account_id = 123456789012
sso_role_name = PowerUserAccess
region = ap-northeast-2
output = json

[profile development]
sso_session = my-company-sso
sso_account_id = 987654321098
sso_role_name = PowerUserAccess
region = ap-northeast-2
output = json

[sso-session my-company-sso]
sso_start_url = https://my-company.awsapps.com/start
sso_region = ap-northeast-2
sso_registration_scopes = sso:account:access
```

### Advantages

- **No long-term access keys**: Minimizes exposure risk
- **Temporary credentials**: Automatically issued and renewed
- **MFA integration**: Applied at the Identity Center level
- **Centralized management**: Manage permissions in one place
- **Multi-account**: Easily switch between multiple AWS accounts

### Recommended Use Cases

- Organization/company AWS environments
- Multi-account management
- Environments requiring security compliance

---

## Method 3: IAM Access Keys (Legacy/Special Situations)

> **Note:** AWS recommends using IAM Identity Center or CloudShell whenever possible.
> Access keys should only be used in situations where SSO is not available, such as CI/CD pipelines and server automation.

### When Access Keys Are Needed

- CI/CD pipelines (GitHub Actions, Jenkins, etc.)
- Automation scripts running on servers
- Environments where IAM Identity Center is not configured
- Local development environments (when SSO is not supported)

### Creating Access Keys

1. AWS Console -> **IAM** -> **Users**
2. Select user -> **Security credentials** tab
3. Click **Create access key**
4. Use case: Select **Command Line Interface (CLI)**
5. Acknowledge the alternative recommendation warning and check the box
6. Click **Create access key**
7. Save the **Access Key ID** and **Secret Access Key**

> **Important:** The Secret Access Key can only be viewed at this point. Be sure to save it securely.

### Using aws-vault (Recommended)

If you must use access keys, manage them securely with **aws-vault**.
Instead of storing in plaintext, it encrypts and stores them in the OS keychain.

```bash
# Installation
brew install aws-vault          # macOS
choco install aws-vault         # Windows

# Add credentials (encrypted storage in keychain)
aws-vault add production
# Enter Access Key ID: AKIA...
# Enter Secret Access Key: ...

# Execute commands (temporary tokens issued automatically)
aws-vault exec production -- aws s3 ls
aws-vault exec production -- aws ec2 describe-instances

# Enter subshell
aws-vault exec production
```

**aws-vault Advantages:**

| Item | Plaintext Storage | aws-vault |
|------|-------------------|-----------|
| Storage method | ~/.aws/credentials (plaintext) | OS keychain (encrypted) |
| Exposure risk | Exposed when file is accessed | Keychain lock required |
| Session token | Uses long-term key directly | Temporary token auto-issued |
| MFA support | Manual | Automatic prompt |

### Plaintext Storage (Not Recommended)

Use only when SSO or aws-vault is not available.

```bash
aws configure
# AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
# AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# Default region name: ap-northeast-2
# Default output format: json
```

**~/.aws/credentials** (stored in plaintext - caution)

```ini
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**~/.aws/config**

```ini
[default]
region = ap-northeast-2
output = json

[profile production]
region = ap-northeast-2
output = table
```

### Security Precautions

- **Never create root account keys**
- **Apply the principle of least privilege**
- **Rotate keys every 90 days**
- **Delete unused keys**
- **Never commit to Git**
- **Add ~/.aws to .gitignore**

---

## EC2 (Elastic Compute Cloud)

### Query Instances

```bash
# List all instances
aws ec2 describe-instances

# Query only running instances
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running"

# Filter by specific tag
aws ec2 describe-instances \
  --filters "Name=tag:Environment,Values=production"

# Output in simple table format
aws ec2 describe-instances \
  --query 'Reservations[*].Instances[*].[InstanceId,InstanceType,State.Name,PrivateIpAddress,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### Instance Status Summary

```bash
# Count by instance state
aws ec2 describe-instances \
  --query 'Reservations[*].Instances[*].State.Name' \
  --output text | tr '\t' '\n' | sort | uniq -c
```

### Query Security Groups

```bash
# All security groups
aws ec2 describe-security-groups

# Security groups for a specific VPC
aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=vpc-12345678"

# Output only security group names and IDs
aws ec2 describe-security-groups \
  --query 'SecurityGroups[*].[GroupId,GroupName,Description]' \
  --output table
```

### Query Volumes (EBS)

```bash
# All EBS volumes
aws ec2 describe-volumes

# Only available volumes (not attached)
aws ec2 describe-volumes \
  --filters "Name=status,Values=available"

# Volume summary information
aws ec2 describe-volumes \
  --query 'Volumes[*].[VolumeId,Size,State,VolumeType,Attachments[0].InstanceId]' \
  --output table
```

### Query AMIs

```bash
# List AMIs owned by me
aws ec2 describe-images --owners self

# Search AMIs by specific name pattern
aws ec2 describe-images \
  --owners self \
  --filters "Name=name,Values=my-app-*"
```

### Query Key Pairs

```bash
aws ec2 describe-key-pairs \
  --query 'KeyPairs[*].[KeyName,KeyPairId,CreateTime]' \
  --output table
```

---

## VPC (Virtual Private Cloud)

### Query VPCs

```bash
# All VPCs
aws ec2 describe-vpcs

# VPC summary
aws ec2 describe-vpcs \
  --query 'Vpcs[*].[VpcId,CidrBlock,State,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### Query Subnets

```bash
# All subnets
aws ec2 describe-subnets

# Subnets for a specific VPC
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=vpc-12345678"

# Subnet summary
aws ec2 describe-subnets \
  --query 'Subnets[*].[SubnetId,CidrBlock,AvailabilityZone,AvailableIpAddressCount,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### Query Internet Gateways

```bash
aws ec2 describe-internet-gateways \
  --query 'InternetGateways[*].[InternetGatewayId,Attachments[0].VpcId,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### Query NAT Gateways

```bash
aws ec2 describe-nat-gateways \
  --query 'NatGateways[*].[NatGatewayId,State,SubnetId,VpcId]' \
  --output table
```

### Query Route Tables

```bash
aws ec2 describe-route-tables \
  --query 'RouteTables[*].[RouteTableId,VpcId,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

---

## S3 (Simple Storage Service)

### List Buckets

```bash
# All buckets
aws s3 ls

# Bucket detailed information (API)
aws s3api list-buckets \
  --query 'Buckets[*].[Name,CreationDate]' \
  --output table
```

### Query Bucket Contents

```bash
# List objects in a bucket
aws s3 ls s3://my-bucket/

# List all objects recursively
aws s3 ls s3://my-bucket/ --recursive

# Summary information (total count, size)
aws s3 ls s3://my-bucket/ --recursive --summarize
```

### Query Bucket Policy

```bash
aws s3api get-bucket-policy --bucket my-bucket
```

### Bucket Versioning Status

```bash
aws s3api get-bucket-versioning --bucket my-bucket
```

### Bucket Encryption Settings

```bash
aws s3api get-bucket-encryption --bucket my-bucket
```

### Bucket Lifecycle Rules

```bash
aws s3api get-bucket-lifecycle-configuration --bucket my-bucket
```

---

## RDS (Relational Database Service)

### Query DB Instances

```bash
# All DB instances
aws rds describe-db-instances

# Instance summary
aws rds describe-db-instances \
  --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceClass,Engine,DBInstanceStatus,Endpoint.Address]' \
  --output table
```

### Query DB Clusters (Aurora)

```bash
aws rds describe-db-clusters \
  --query 'DBClusters[*].[DBClusterIdentifier,Engine,Status,Endpoint]' \
  --output table
```

### Query DB Snapshots

```bash
# Manual snapshots
aws rds describe-db-snapshots \
  --snapshot-type manual \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,DBInstanceIdentifier,SnapshotCreateTime,Status]' \
  --output table

# Automated snapshots
aws rds describe-db-snapshots --snapshot-type automated
```

### Query Parameter Groups

```bash
aws rds describe-db-parameter-groups \
  --query 'DBParameterGroups[*].[DBParameterGroupName,DBParameterGroupFamily,Description]' \
  --output table
```

### Query Subnet Groups

```bash
aws rds describe-db-subnet-groups \
  --query 'DBSubnetGroups[*].[DBSubnetGroupName,VpcId,SubnetGroupStatus]' \
  --output table
```

---

## Lambda

### List Functions

```bash
# All functions
aws lambda list-functions

# Function summary
aws lambda list-functions \
  --query 'Functions[*].[FunctionName,Runtime,MemorySize,Timeout,LastModified]' \
  --output table
```

### Specific Function Details

```bash
aws lambda get-function --function-name my-function
```

### Query Function Configuration

```bash
aws lambda get-function-configuration --function-name my-function
```

### Query Function Aliases

```bash
aws lambda list-aliases --function-name my-function
```

### Query Function Versions

```bash
aws lambda list-versions-by-function --function-name my-function
```

### Query Event Source Mappings

```bash
aws lambda list-event-source-mappings \
  --function-name my-function
```

---

## ECS (Elastic Container Service)

### Query Clusters

```bash
# List cluster ARNs
aws ecs list-clusters

# Cluster detailed information
aws ecs describe-clusters \
  --clusters my-cluster \
  --query 'clusters[*].[clusterName,status,runningTasksCount,pendingTasksCount,activeServicesCount]' \
  --output table
```

### Query Services

```bash
# List services
aws ecs list-services --cluster my-cluster

# Service detailed information
aws ecs describe-services \
  --cluster my-cluster \
  --services my-service \
  --query 'services[*].[serviceName,status,runningCount,desiredCount]' \
  --output table
```

### Query Tasks

```bash
# List running tasks
aws ecs list-tasks --cluster my-cluster

# Task detailed information
aws ecs describe-tasks \
  --cluster my-cluster \
  --tasks <task-arn>
```

### Query Task Definitions

```bash
# List task definitions
aws ecs list-task-definitions

# Specific task definition details
aws ecs describe-task-definition --task-definition my-task:1
```

---

## EKS (Elastic Kubernetes Service)

### Query Clusters

```bash
# List clusters
aws eks list-clusters

# Cluster detailed information
aws eks describe-cluster --name my-cluster

# Cluster summary
aws eks describe-cluster --name my-cluster \
  --query 'cluster.[name,status,version,endpoint]' \
  --output table
```

### Query Node Groups

```bash
# List node groups
aws eks list-nodegroups --cluster-name my-cluster

# Node group details
aws eks describe-nodegroup \
  --cluster-name my-cluster \
  --nodegroup-name my-nodegroup
```

### Query Fargate Profiles

```bash
aws eks list-fargate-profiles --cluster-name my-cluster
```

---

## IAM (Identity and Access Management)

### Query Users

```bash
# All users
aws iam list-users \
  --query 'Users[*].[UserName,UserId,CreateDate]' \
  --output table

# Specific user information
aws iam get-user --user-name my-user
```

### Query Roles

```bash
# All roles
aws iam list-roles \
  --query 'Roles[*].[RoleName,CreateDate]' \
  --output table

# Policies for a specific role
aws iam list-attached-role-policies --role-name my-role
aws iam list-role-policies --role-name my-role
```

### Query Policies

```bash
# Customer managed policies
aws iam list-policies --scope Local \
  --query 'Policies[*].[PolicyName,Arn,AttachmentCount]' \
  --output table

# Specific policy document
aws iam get-policy-version \
  --policy-arn arn:aws:iam::123456789012:policy/my-policy \
  --version-id v1
```

### Query Groups

```bash
aws iam list-groups \
  --query 'Groups[*].[GroupName,CreateDate]' \
  --output table
```

### Query Access Keys

```bash
# Access keys for a specific user
aws iam list-access-keys --user-name my-user

# Access key last used information
aws iam get-access-key-last-used --access-key-id AKIAIOSFODNN7EXAMPLE
```

---

## CloudWatch

### Query Alarms

```bash
# All alarms
aws cloudwatch describe-alarms

# Alarms by state
aws cloudwatch describe-alarms \
  --state-value ALARM \
  --query 'MetricAlarms[*].[AlarmName,StateValue,MetricName]' \
  --output table
```

### Query Log Groups

```bash
# All log groups
aws logs describe-log-groups \
  --query 'logGroups[*].[logGroupName,storedBytes,retentionInDays]' \
  --output table

# Streams for a specific log group
aws logs describe-log-streams \
  --log-group-name /aws/lambda/my-function \
  --order-by LastEventTime \
  --descending
```

### Query Recent Logs

```bash
# Recent log events
aws logs get-log-events \
  --log-group-name /aws/lambda/my-function \
  --log-stream-name '2024/01/01/[$LATEST]abc123' \
  --limit 50
```

### Query Metrics

```bash
# List available metrics
aws cloudwatch list-metrics --namespace AWS/EC2

# Query metric statistics
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-1234567890abcdef0 \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average
```

---

## DynamoDB

### Query Tables

```bash
# List tables
aws dynamodb list-tables

# Table detailed information
aws dynamodb describe-table --table-name my-table

# Table summary
aws dynamodb describe-table --table-name my-table \
  --query 'Table.[TableName,TableStatus,ItemCount,TableSizeBytes]' \
  --output table
```

### Scan Tables

```bash
# Query table items (caution: may incur costs on large tables)
aws dynamodb scan --table-name my-table --limit 10
```

### Query Global Tables

```bash
aws dynamodb list-global-tables
```

### Query Backups

```bash
aws dynamodb list-backups --table-name my-table
```

---

## SQS (Simple Queue Service)

### Query Queues

```bash
# All queues
aws sqs list-queues

# Queue attributes
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/123456789012/my-queue \
  --attribute-names All
```

### Queue Message Count

```bash
aws sqs get-queue-attributes \
  --queue-url <queue-url> \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

---

## SNS (Simple Notification Service)

### Query Topics

```bash
# All topics
aws sns list-topics

# Topic attributes
aws sns get-topic-attributes --topic-arn arn:aws:sns:ap-northeast-2:123456789012:my-topic
```

### Query Subscriptions

```bash
# All subscriptions
aws sns list-subscriptions

# Subscriptions for a specific topic
aws sns list-subscriptions-by-topic --topic-arn <topic-arn>
```

---

## Route 53

### Query Hosted Zones

```bash
# All hosted zones
aws route53 list-hosted-zones \
  --query 'HostedZones[*].[Id,Name,ResourceRecordSetCount]' \
  --output table
```

### Query DNS Records

```bash
aws route53 list-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --query 'ResourceRecordSets[*].[Name,Type,TTL]' \
  --output table
```

### Query Health Checks

```bash
aws route53 list-health-checks \
  --query 'HealthChecks[*].[Id,HealthCheckConfig.FullyQualifiedDomainName,HealthCheckConfig.Type]' \
  --output table
```

---

## CloudFront

### Query Distributions

```bash
# All distributions
aws cloudfront list-distributions \
  --query 'DistributionList.Items[*].[Id,DomainName,Status,Origins.Items[0].DomainName]' \
  --output table
```

### Distribution Details

```bash
aws cloudfront get-distribution --id E1234567890ABC
```

### List Cache Invalidations

```bash
aws cloudfront list-invalidations --distribution-id E1234567890ABC
```

---

## Elastic Load Balancing

### Query ALB/NLB

```bash
# All load balancers
aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[*].[LoadBalancerName,Type,State.Code,DNSName]' \
  --output table
```

### Query Target Groups

```bash
# List target groups
aws elbv2 describe-target-groups \
  --query 'TargetGroups[*].[TargetGroupName,Protocol,Port,TargetType]' \
  --output table

# Target health check
aws elbv2 describe-target-health --target-group-arn <target-group-arn>
```

### Query Listeners

```bash
aws elbv2 describe-listeners \
  --load-balancer-arn <lb-arn> \
  --query 'Listeners[*].[Protocol,Port,DefaultActions[0].Type]' \
  --output table
```

### Query Classic ELB

```bash
aws elb describe-load-balancers \
  --query 'LoadBalancerDescriptions[*].[LoadBalancerName,DNSName,Scheme]' \
  --output table
```

---

## ElastiCache

### Query Clusters

```bash
# Redis/Memcached clusters
aws elasticache describe-cache-clusters \
  --query 'CacheClusters[*].[CacheClusterId,Engine,CacheNodeType,CacheClusterStatus]' \
  --output table
```

### Query Replication Groups (Redis)

```bash
aws elasticache describe-replication-groups \
  --query 'ReplicationGroups[*].[ReplicationGroupId,Status,NodeGroups[0].PrimaryEndpoint.Address]' \
  --output table
```

---

## Secrets Manager

### List Secrets

```bash
aws secretsmanager list-secrets \
  --query 'SecretList[*].[Name,LastChangedDate,LastAccessedDate]' \
  --output table
```

### Secret Details

```bash
aws secretsmanager describe-secret --secret-id my-secret
```

---

## Systems Manager (SSM)

### Query Parameters

```bash
# List parameters
aws ssm describe-parameters \
  --query 'Parameters[*].[Name,Type,LastModifiedDate]' \
  --output table

# Get parameter value
aws ssm get-parameter --name /my/parameter --with-decryption
```

### Query Managed Instances

```bash
aws ssm describe-instance-information \
  --query 'InstanceInformationList[*].[InstanceId,PingStatus,LastPingDateTime,PlatformName]' \
  --output table
```

---

## Useful Tips

### Output Formats

```bash
# JSON (default)
aws ec2 describe-instances --output json

# Table
aws ec2 describe-instances --output table

# Text
aws ec2 describe-instances --output text

# YAML
aws ec2 describe-instances --output yaml
```

### JMESPath Queries

```bash
# Extract specific fields only
--query 'Items[*].{Name: Name, Status: Status}'

# Filtering
--query 'Items[?Status==`ACTIVE`]'

# First item
--query 'Items[0]'

# Sorting
--query 'sort_by(Items, &Name)'
```

### Pagination

```bash
# Limit maximum number of items
aws s3api list-objects-v2 --bucket my-bucket --max-items 100

# Automatic pagination (all results)
aws s3api list-objects-v2 --bucket my-bucket --no-paginate
```

### Processing Results with jq

```bash
# Install jq
brew install jq  # macOS
apt install jq   # Ubuntu

# Usage example
aws ec2 describe-instances | jq '.Reservations[].Instances[] | {id: .InstanceId, state: .State.Name}'
```

### Full Resource Query Script

```bash
#!/bin/bash
# Key resource summary script

echo "=== EC2 Instances ==="
aws ec2 describe-instances \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,InstanceType]' \
  --output table

echo -e "\n=== RDS Instances ==="
aws rds describe-db-instances \
  --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus,Engine]' \
  --output table

echo -e "\n=== S3 Buckets ==="
aws s3 ls

echo -e "\n=== Lambda Functions ==="
aws lambda list-functions \
  --query 'Functions[*].[FunctionName,Runtime]' \
  --output table

echo -e "\n=== ECS Clusters ==="
aws ecs list-clusters
```

---

## Conclusion

Using AWS CLI allows you to check resource status faster than the console.

Key takeaways:
- Use the `--query` option to extract only the information you need
- Use `--output table` for better readability
- Use `--filters` to query only the resources you want
- Save frequently used commands as aliases or scripts

Once you become familiar with CLI commands, operational efficiency improves significantly.
