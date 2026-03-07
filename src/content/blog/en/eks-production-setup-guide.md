---
title: "Production-Level EKS Cluster Setup Guide"
description: "A practical guide to building production-grade EKS clusters from eksctl to Terraform, including networking setup"
pubDate: "2026-03-07T10:00:00+09:00"
lang: en
tags: ["AWS", "EKS", "Kubernetes", "Terraform", "DevOps", "Infrastructure"]
heroImage: "../../../assets/EksProductionSetupGuide.png"
---

## Introduction

This guide is for developers who understand the basics of Kubernetes
but have never built an AWS EKS cluster in practice.

Amazon EKS (Elastic Kubernetes Service) is a managed Kubernetes service provided by AWS.
Running a Kubernetes cluster on your own requires installing and managing the control plane
(API Server, etcd, Scheduler, etc.) yourself, but EKS handles that part for you.

The key advantages of EKS over self-managed Kubernetes are:

- **Managed Control Plane**: AWS guarantees etcd backups and API Server high availability
- **AWS Service Integration**: Native integration with IAM, ALB, Route53, ACM, and more
- **Easy Upgrades**: Cluster version upgrades can be performed safely and incrementally
- **Security**: Leverages AWS VPC networking and Security Groups as-is

This guide starts with quick cluster creation using eksctl,
then moves on to IaC (Infrastructure as Code) with Terraform,
and covers the essential networking setup (ALB, DNS, HTTPS) needed in production.

> This post is **Part 1** of the series.
> Part 2 will cover building a GitOps-based deployment pipeline using ArgoCD.

---

## Prerequisites

Before building an EKS cluster, install the necessary tools in your local environment.

### 1. Install and Configure AWS CLI

```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify installation
aws --version
```

Configure your AWS credentials:

```bash
aws configure
# AWS Access Key ID: [Enter your access key]
# AWS Secret Access Key: [Enter your secret key]
# Default region name: ap-northeast-2
# Default output format: json
```

### 2. Install kubectl

```bash
# macOS
brew install kubectl

# Linux
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# Verify installation
kubectl version --client
```

### 3. Install eksctl

```bash
# macOS
brew tap weaveworks/tap
brew install weaveworks/tap/eksctl

# Linux
ARCH=amd64
PLATFORM=$(uname -s)_$ARCH
curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$PLATFORM.tar.gz"
tar -xzf eksctl_$PLATFORM.tar.gz -C /tmp && sudo mv /tmp/eksctl /usr/local/bin

# Verify installation
eksctl version
```

### 4. Install Terraform

```bash
# macOS
brew tap hashicorp/tap
brew install hashicorp/tap/terraform

# Linux
wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform

# Verify installation
terraform version
```

### 5. IAM Permission Setup

The IAM user/role creating the EKS cluster needs at least the following permissions:

- `eks:*` - EKS cluster management
- `ec2:*` - VPC, subnet, security group, and EC2 instance management
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole` - Role creation and attachment
- `cloudformation:*` - Used internally by eksctl via CloudFormation
- `autoscaling:*` - Node group auto scaling

> **Caution**: In production environments, avoid using `AdministratorAccess`.
> The security best practice is to grant only the minimum required permissions.
> Use broad permissions only during initial setup, then gradually reduce them over time.

---

## Getting Started Quickly with eksctl

eksctl is a CLI tool for quickly creating EKS clusters.
It internally creates AWS CloudFormation stacks to provision the necessary resources.

### Creating a Cluster

The simplest approach is to create a cluster with a single command:

```bash
eksctl create cluster \
  --name my-eks-cluster \
  --region ap-northeast-2 \
  --version 1.31 \
  --nodegroup-name my-nodes \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 4 \
  --managed
```

Here is what each option means:

| Option | Description |
|--------|-------------|
| `--name` | Cluster name |
| `--region` | AWS region |
| `--version` | Kubernetes version |
| `--nodegroup-name` | Node group name |
| `--node-type` | EC2 instance type |
| `--nodes` | Initial number of nodes |
| `--nodes-min/max` | Auto scaling minimum/maximum node count |
| `--managed` | Use AWS managed node groups |

Cluster creation typically takes about 15-20 minutes.

For more granular configuration, you can use a YAML config file:

```yaml
# cluster-config.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: my-eks-cluster
  region: ap-northeast-2
  version: "1.31"

managedNodeGroups:
  - name: app-nodes
    instanceType: t3.medium
    desiredCapacity: 2
    minSize: 1
    maxSize: 4
    volumeSize: 30
    labels:
      role: application
    tags:
      Environment: production
    iam:
      withAddonPolicies:
        albIngress: true
        cloudWatch: true
```

```bash
eksctl create cluster -f cluster-config.yaml
```

### Verifying kubeconfig

eksctl automatically configures kubeconfig after cluster creation.
You can immediately access the cluster with kubectl:

```bash
# Check current context
kubectl config current-context

# List nodes
kubectl get nodes

# Example output:
# NAME                                                STATUS   ROLES    AGE   VERSION
# ip-192-168-25-47.ap-northeast-2.compute.internal    Ready    <none>   5m    v1.31.2-eks-abcdef
# ip-192-168-68-112.ap-northeast-2.compute.internal   Ready    <none>   5m    v1.31.2-eks-abcdef
```

If you need to manually refresh the kubeconfig:

```bash
aws eks update-kubeconfig --name my-eks-cluster --region ap-northeast-2
```

### Deploying a Sample App to Verify

Deploy nginx to verify the cluster is working properly:

```yaml
# nginx-test.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-test
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-test
spec:
  type: LoadBalancer
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
```

```bash
kubectl apply -f nginx-test.yaml

# Check deployment status
kubectl get pods
kubectl get svc nginx-test

# Once an EXTERNAL-IP is assigned, verify access in your browser
# (A CLB is created, which takes 1-2 minutes)

# Clean up after verification
kubectl delete -f nginx-test.yaml
```

### Limitations of eksctl

eksctl is great for getting started quickly, but it has limitations in production environments:

- **No State Management**: Relies on CloudFormation, making it difficult to track infrastructure state as code
- **No Code Review**: Changes cannot be reviewed through PRs
- **Poor Reproducibility**: Reproducing the same environment across multiple accounts/regions is cumbersome
- **Limited Fine-Grained Control**: Difficult to precisely control network settings like VPCs and subnets

For these reasons, Terraform is the standard choice for production environments.

---

## Transitioning to IaC with Terraform

### Why Terraform

Terraform is a tool for managing infrastructure as code. Using Terraform for EKS cluster setup provides:

- **State Management**: Infrastructure state is precisely tracked via `terraform.tfstate`
- **Code Review**: Infrastructure changes can be reviewed by team members through PRs
- **Reproducibility**: The same code consistently builds dev/staging/prod environments
- **Plan Feature**: Preview what changes will occur before actually applying them

### Project Structure

```
eks-terraform/
├── main.tf          # Provider, data sources
├── vpc.tf           # VPC module
├── eks.tf           # EKS module
├── variables.tf     # Variable definitions
├── outputs.tf       # Output definitions
└── terraform.tfvars # Variable values (should be in .gitignore)
```

### Provider and Variable Configuration

```hcl
# main.tf
terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # In practice, use an S3 backend to manage state files remotely
  backend "s3" {
    bucket = "my-terraform-state-bucket"
    key    = "eks/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

provider "aws" {
  region = var.region
}
```

```hcl
# variables.tf
variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-2"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "my-eks-cluster"
}

variable "cluster_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.31"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}
```

### VPC Module Configuration

An EKS cluster runs inside a VPC.
The standard practice is to separate public subnets (for load balancers) and private subnets (for worker nodes).

```hcl
# vpc.tf
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["${var.region}a", "${var.region}b", "${var.region}c"]
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnets = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]

  # Enable outbound connectivity from private subnets via NAT Gateway
  enable_nat_gateway   = true
  single_nat_gateway   = true  # Cost savings (for production, set to false for per-AZ NAT)
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tags required for EKS to identify subnets (mandatory)
  public_subnet_tags = {
    "kubernetes.io/role/elb"                    = 1
    "kubernetes.io/cluster/${var.cluster_name}"  = "shared"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"            = 1
    "kubernetes.io/cluster/${var.cluster_name}"  = "shared"
  }

  tags = {
    Environment = var.environment
    Terraform   = "true"
  }
}
```

> **Key Point**: Without subnet tags, the AWS Load Balancer Controller cannot discover the subnets.
> The `kubernetes.io/role/elb` (public) and `kubernetes.io/role/internal-elb` (private) tags must be configured.

### EKS Module Configuration

```hcl
# eks.tf
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  # Cluster endpoint access configuration
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Cluster add-ons
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = module.ebs_csi_irsa.iam_role_arn
    }
  }

  # Managed node group definitions
  eks_managed_node_groups = {
    # Node group for general workloads
    application = {
      name           = "app-nodes"
      instance_types = ["t3.medium"]
      capacity_type  = "ON_DEMAND"

      min_size     = 2
      max_size     = 6
      desired_size = 2

      disk_size = 30

      labels = {
        role = "application"
      }

      tags = {
        Environment = var.environment
      }
    }
  }

  # Grant admin permissions to the cluster creator
  enable_cluster_creator_admin_permissions = true

  tags = {
    Environment = var.environment
    Terraform   = "true"
  }
}

# IRSA for EBS CSI Driver
module "ebs_csi_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name             = "${var.cluster_name}-ebs-csi-driver"
  attach_ebs_csi_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
}
```

```hcl
# outputs.tf
output "cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data"
  value       = module.eks.cluster_certificate_authority_data
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}
```

<details>
<summary>Managed Node Groups vs Self-Managed Node Groups</summary>

| Category | Managed Node Groups | Self-Managed Node Groups |
|----------|-------------------|------------------------|
| Node Updates | Rolling updates via AWS Console/API | Manage Launch Templates manually |
| AMI Management | Automatically uses AWS-optimized AMIs | Select and manage AMIs yourself |
| Scaling | Easy management via EKS API | Configure ASG directly |
| Customization | Limited (extensible via Launch Templates) | Full flexibility |
| Recommended For | Most workloads | GPU, custom AMIs, and advanced requirements |

Unless you have a specific reason, using **managed node groups** is recommended.

</details>

### Terraform Workflow

```bash
# 1. Initialize - Download providers and modules
terraform init

# 2. Plan - Preview what resources will be created/changed/destroyed
terraform plan

# Example output:
# Plan: 45 to add, 0 to change, 0 to destroy.

# 3. Apply - Actually create resources (takes about 15-20 minutes)
terraform apply

# 4. Configure kubeconfig
aws eks update-kubeconfig --name my-eks-cluster --region ap-northeast-2

# 5. Verify
kubectl get nodes
```

### eksctl vs Terraform Comparison

| Category | eksctl | Terraform |
|----------|--------|-----------|
| Learning Curve | Low | Medium |
| Speed | Quick with a single command | Write code then apply |
| State Management | CloudFormation | terraform.tfstate |
| Code Review | Difficult | PR-based review possible |
| Reproducibility | Low | High |
| Fine-Grained Control | Limited | Full control over VPC, IAM, etc. |
| Team Collaboration | Inconvenient | Remote state + locking for collaboration |
| Best Suited For | PoC, learning, quick testing | Production, team operations |

---

## Production Networking Setup

Once the cluster is created, you need networking configuration to handle external traffic.
This section covers ALB (Application Load Balancer), DNS, and HTTPS setup.

### 1. Installing AWS Load Balancer Controller

The AWS Load Balancer Controller detects Kubernetes Ingress resources
and automatically creates AWS ALBs.

#### IRSA Configuration

The controller needs IAM permissions to manage AWS resources (ALBs, Target Groups, etc.).
IRSA (IAM Roles for Service Accounts) is used to grant permissions at the Pod level.

```hcl
# alb-controller.tf (add to Terraform)
module "lb_controller_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name                              = "${var.cluster_name}-aws-lb-controller"
  attach_load_balancer_controller_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

output "lb_controller_role_arn" {
  value = module.lb_controller_irsa.iam_role_arn
}
```

```bash
terraform apply
```

#### Installing the Controller with Helm

```bash
# Add Helm repository
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# Install AWS Load Balancer Controller
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=my-eks-cluster \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform output -raw lb_controller_role_arn) \
  --set region=ap-northeast-2 \
  --set vpcId=$(terraform output -raw vpc_id)

# Verify installation
kubectl get deployment -n kube-system aws-load-balancer-controller
```

### 2. Creating an ALB with Ingress Resources

Once the AWS Load Balancer Controller is installed, you can create ALBs by defining Ingress resources.

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: default
  annotations:
    # Specify to create an ALB
    alb.ingress.kubernetes.io/scheme: internet-facing
    # Create ALB in public subnets
    alb.ingress.kubernetes.io/target-type: ip
    # Health check path
    alb.ingress.kubernetes.io/healthcheck-path: /health
    # Listener port
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}]'
spec:
  ingressClassName: alb
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-service
                port:
                  number: 80
```

Here is a summary of the key annotations:

| Annotation | Description |
|-----------|-------------|
| `alb.ingress.kubernetes.io/scheme` | `internet-facing` (public) or `internal` (private) |
| `alb.ingress.kubernetes.io/target-type` | `ip` (direct Pod IP) or `instance` (via NodePort) |
| `alb.ingress.kubernetes.io/healthcheck-path` | Health check endpoint path |
| `alb.ingress.kubernetes.io/listen-ports` | Listener ports and protocols |
| `alb.ingress.kubernetes.io/certificate-arn` | ACM certificate ARN (for HTTPS) |
| `alb.ingress.kubernetes.io/ssl-redirect` | HTTP to HTTPS redirect port |

```bash
kubectl apply -f ingress.yaml

# Verify ALB creation (takes 1-2 minutes)
kubectl get ingress app-ingress
```

### 3. External DNS Configuration

External DNS automatically registers the hostnames defined in Ingress resources into Route53.
This eliminates the need to manage DNS records manually.

#### IRSA Configuration

```hcl
# external-dns.tf
module "external_dns_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name                     = "${var.cluster_name}-external-dns"
  attach_external_dns_policy    = true
  external_dns_hosted_zone_arns = ["arn:aws:route53:::hostedzone/ZXXXXXXXXXX"]  # Your actual hosted zone ARN

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:external-dns"]
    }
  }
}

output "external_dns_role_arn" {
  value = module.external_dns_irsa.iam_role_arn
}
```

#### Installing External DNS with Helm

```bash
helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/
helm repo update

helm install external-dns external-dns/external-dns \
  -n kube-system \
  --set provider.name=aws \
  --set policy=sync \
  --set registry=txt \
  --set txtOwnerId=my-eks-cluster \
  --set domainFilters[0]=example.com \
  --set serviceAccount.create=true \
  --set serviceAccount.name=external-dns \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform output -raw external_dns_role_arn)

# Verify
kubectl get pods -n kube-system -l app.kubernetes.io/name=external-dns
```

Now, when you set `host: app.example.com` in an Ingress resource,
External DNS will automatically create an A record (Alias pointing to the ALB's DNS) in Route53.

### 4. Applying HTTPS with ACM Certificates

HTTPS is mandatory in production environments.
Use AWS ACM (Certificate Manager) to issue free SSL certificates and apply them to the ALB.

#### Issuing a Certificate

```bash
# Request ACM certificate (DNS validation method recommended)
aws acm request-certificate \
  --domain-name "*.example.com" \
  --validation-method DNS \
  --region ap-northeast-2

# Note the CertificateArn from the output
# arn:aws:acm:ap-northeast-2:123456789012:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Add the CNAME record provided by the ACM console to Route53 for DNS validation.
Once validation is complete, the certificate status changes to `Issued`.

> **Tip**: You can also automate ACM certificate issuance and DNS validation with Terraform.
> Combine the `aws_acm_certificate` + `aws_route53_record` + `aws_acm_certificate_validation` resources.

#### Configuring HTTPS on Ingress

```yaml
# ingress-https.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: default
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/healthcheck-path: /health
    # HTTPS configuration
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:ap-northeast-2:123456789012:certificate/xxxxxxxx
    # Automatic HTTP to HTTPS redirect
    alb.ingress.kubernetes.io/ssl-redirect: "443"
spec:
  ingressClassName: alb
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-service
                port:
                  number: 80
```

With this configuration:
1. HTTP (port 80) requests are automatically redirected to HTTPS (port 443)
2. The ACM certificate is used for HTTPS communication
3. TLS termination occurs at the ALB, so Pods only need to handle HTTP

---

## Operational Tips

Here are practical operational tips to keep in mind after building your cluster.

### 1. Cluster Version Upgrades

EKS cluster upgrades must follow the order: **control plane first, then node groups**.

```bash
# Step 1: Upgrade the control plane (when using Terraform)
# Change cluster_version in eks.tf, then
terraform apply

# Step 2: Upgrade node groups
# The AMI for eks_managed_node_groups is automatically updated to the latest version
# Nodes are replaced sequentially via rolling updates
```

Key considerations during upgrades:
- Only upgrade one minor version at a time (e.g., 1.30 to 1.31)
- Check for deprecated API usage before upgrading
- Set up PodDisruptionBudgets (PDBs) to prevent service interruptions

### 2. Node Group Management

To change instance types or settings of a node group, the safe approach is to create a new node group and delete the existing one:

```hcl
# Add new node group -> Delete old node group (Blue/Green approach)
eks_managed_node_groups = {
  # application_v1 = { ... }  # Target for deletion (do not comment out first)
  application_v2 = {
    name           = "app-nodes-v2"
    instance_types = ["t3.large"]  # Changed instance type
    min_size       = 2
    max_size       = 6
    desired_size   = 2
  }
}
```

Order: Create new node group -> Verify workload migration -> Delete old node group

### 3. Cost Optimization

EKS costs are broadly divided into **cluster costs** ($0.10/hour) and **EC2 instance costs**.
Here is how to reduce instance costs.

#### Using Spot Instances

For interruptible workloads, Spot instances can reduce costs by up to 90%:

```hcl
eks_managed_node_groups = {
  # On-Demand: For critical workloads
  critical = {
    instance_types = ["t3.medium"]
    capacity_type  = "ON_DEMAND"
    min_size       = 2
    max_size       = 4
    desired_size   = 2
    labels = {
      workload-type = "critical"
    }
  }

  # Spot: For batch jobs, development environments, etc.
  spot = {
    instance_types = ["t3.medium", "t3.large", "t3a.medium", "t3a.large"]
    capacity_type  = "SPOT"
    min_size       = 0
    max_size       = 10
    desired_size   = 2
    labels = {
      workload-type = "flexible"
    }
    taints = [
      {
        key    = "spot"
        value  = "true"
        effect = "NO_SCHEDULE"
      }
    ]
  }
}
```

> **Spot Instance Tip**: Specifying multiple types in `instance_types` increases the probability
> of securing Spot capacity.
> Set taints so that only Pods with tolerations are scheduled on Spot nodes.

#### Brief Introduction to Karpenter

Karpenter is an open-source node autoscaler developed by AWS
that provides faster and more flexible scaling than Cluster Autoscaler.

- Provisions the required instances immediately without node groups
- Automatically selects the optimal instance type based on Pod resource requests
- Automatically consolidates nodes for cost optimization

Consider adopting Karpenter once your cluster has reached a certain level of maturity.

### 4. Basic Monitoring Setup

To monitor cluster health, you should at minimum enable CloudWatch Container Insights.

```bash
# Install CloudWatch agent (Amazon CloudWatch Observability add-on)
aws eks create-addon \
  --cluster-name my-eks-cluster \
  --addon-name amazon-cloudwatch-observability \
  --region ap-northeast-2
```

Once Container Insights is enabled, the following metrics are available in CloudWatch:

- CPU/memory utilization (cluster, node, and Pod level)
- Network traffic
- Container restart count
- Pod status

> For more advanced monitoring, consider building a Prometheus + Grafana stack.
> This topic will be covered in a separate post.

---

## Conclusion

Here is a summary of what this guide covered:

1. **eksctl**: A CLI tool for quickly creating EKS clusters. Best suited for PoC and learning
2. **Terraform**: Manage everything from VPC to EKS as code in production. Great for team collaboration and reproducibility
3. **Networking**: Set up ALB, automatic DNS, and HTTPS using AWS Load Balancer Controller + External DNS + ACM
4. **Operations**: Version upgrade order, node group management, cost optimization, and monitoring are the key areas

Building an EKS cluster is just the beginning.
To deploy actual applications, you need a CI/CD pipeline.

**Part 2** covers building a GitOps-based deployment pipeline using ArgoCD.
It will include practical, immediately applicable content such as
Helm chart management, environment-specific deployment strategies, and auto-sync configuration.
