---
title: "실무 레벨 EKS 클러스터 구축 가이드"
description: "eksctl부터 Terraform까지, 프로덕션 수준의 EKS 클러스터를 구축하고 네트워킹을 설정하는 실무 가이드"
pubDate: 2026-03-07T10:00:00+09:00
tags:
  [
    "AWS",
    "EKS",
    "Kubernetes",
    "Terraform",
    "DevOps",
    "Infrastructure",
  ]
heroImage: "../../assets/EksProductionSetupGuide.png"
---

## 서론

이 글은 Kubernetes 기본 개념은 알지만,
실제로 AWS EKS 클러스터를 구축해 본 적 없는 개발자를 위한 실무 가이드다.

Amazon EKS(Elastic Kubernetes Service)는 AWS에서 제공하는 관리형 Kubernetes 서비스다.
자체적으로 Kubernetes 클러스터를 운영하려면 컨트롤 플레인(API Server, etcd, Scheduler 등)을
직접 설치하고 관리해야 하는데, EKS는 이 부분을 AWS가 대신 관리해 준다.

자체 관리 Kubernetes 대비 EKS의 핵심 장점은 다음과 같다:

- **관리형 컨트롤 플레인**: etcd 백업, API Server 고가용성을 AWS가 보장한다
- **AWS 서비스 통합**: IAM, ALB, Route53, ACM 등과 네이티브하게 연동된다
- **업그레이드 용이성**: 클러스터 버전 업그레이드를 단계적으로 안전하게 수행할 수 있다
- **보안**: AWS VPC 네트워킹, Security Group을 그대로 활용한다

이 글에서는 eksctl을 이용한 빠른 클러스터 생성부터 시작해서,
Terraform으로 IaC(Infrastructure as Code) 전환,
그리고 실무에서 반드시 필요한 네트워킹 설정(ALB, DNS, HTTPS)까지 다룬다.

> 이 글은 시리즈의 **Part 1**이다.
> Part 2에서는 ArgoCD를 활용한 GitOps 기반 배포 파이프라인 구축을 다룰 예정이다.

---

## 사전 준비

EKS 클러스터를 구축하기 전에 로컬 환경에 필요한 도구들을 설치한다.

### 1. AWS CLI 설치 및 설정

```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# 설치 확인
aws --version
```

AWS 자격 증명을 설정한다:

```bash
aws configure
# AWS Access Key ID: [액세스 키 입력]
# AWS Secret Access Key: [시크릿 키 입력]
# Default region name: ap-northeast-2
# Default output format: json
```

### 2. kubectl 설치

```bash
# macOS
brew install kubectl

# Linux
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# 설치 확인
kubectl version --client
```

### 3. eksctl 설치

```bash
# macOS
brew tap weaveworks/tap
brew install weaveworks/tap/eksctl

# Linux
ARCH=amd64
PLATFORM=$(uname -s)_$ARCH
curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$PLATFORM.tar.gz"
tar -xzf eksctl_$PLATFORM.tar.gz -C /tmp && sudo mv /tmp/eksctl /usr/local/bin

# 설치 확인
eksctl version
```

### 4. Terraform 설치

```bash
# macOS
brew tap hashicorp/tap
brew install hashicorp/tap/terraform

# Linux
wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform

# 설치 확인
terraform version
```

### 5. IAM 권한 설정

EKS 클러스터를 생성하는 IAM 사용자/역할에는 최소한 다음 권한이 필요하다:

- `eks:*` - EKS 클러스터 관리
- `ec2:*` - VPC, 서브넷, 보안 그룹, EC2 인스턴스 관리
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole` - 역할 생성 및 연결
- `cloudformation:*` - eksctl이 내부적으로 CloudFormation을 사용
- `autoscaling:*` - 노드 그룹 오토스케일링

> **주의**: 프로덕션 환경에서는 `AdministratorAccess`를 쓰지 말고,
> 필요한 최소 권한만 부여하는 것이 보안 원칙이다.
> 초기 셋업 시에만 넓은 권한을 사용하고, 이후 점진적으로 줄여나가는 것을 권장한다.

---

## eksctl로 빠르게 시작하기

eksctl은 EKS 클러스터를 빠르게 생성할 수 있는 CLI 도구다.
내부적으로 AWS CloudFormation 스택을 생성해서 필요한 리소스를 프로비저닝한다.

### 클러스터 생성

가장 간단한 방법은 명령어 한 줄로 클러스터를 만드는 것이다:

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

각 옵션의 의미는 다음과 같다:

| 옵션 | 설명 |
|------|------|
| `--name` | 클러스터 이름 |
| `--region` | AWS 리전 |
| `--version` | Kubernetes 버전 |
| `--nodegroup-name` | 노드 그룹 이름 |
| `--node-type` | EC2 인스턴스 타입 |
| `--nodes` | 초기 노드 수 |
| `--nodes-min/max` | 오토스케일링 최소/최대 노드 수 |
| `--managed` | AWS 관리형 노드 그룹 사용 |

클러스터 생성에는 보통 15~20분 정도 소요된다.

더 세밀한 설정이 필요하면 YAML 설정 파일을 사용할 수도 있다:

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

### kubeconfig 확인

eksctl은 클러스터 생성 후 자동으로 kubeconfig를 설정한다.
바로 kubectl로 클러스터에 접근할 수 있다:

```bash
# 현재 컨텍스트 확인
kubectl config current-context

# 노드 목록 확인
kubectl get nodes

# 출력 예시:
# NAME                                                STATUS   ROLES    AGE   VERSION
# ip-192-168-25-47.ap-northeast-2.compute.internal    Ready    <none>   5m    v1.31.2-eks-abcdef
# ip-192-168-68-112.ap-northeast-2.compute.internal   Ready    <none>   5m    v1.31.2-eks-abcdef
```

만약 kubeconfig를 수동으로 갱신해야 한다면:

```bash
aws eks update-kubeconfig --name my-eks-cluster --region ap-northeast-2
```

### 샘플 앱 배포로 동작 확인

클러스터가 정상적으로 동작하는지 nginx를 배포해서 확인한다:

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

# 배포 상태 확인
kubectl get pods
kubectl get svc nginx-test

# EXTERNAL-IP가 할당되면 브라우저에서 접속 확인
# (CLB가 생성되므로 1~2분 소요)

# 확인 후 정리
kubectl delete -f nginx-test.yaml
```

### eksctl의 한계

eksctl은 빠른 시작에는 좋지만, 프로덕션 환경에서는 한계가 있다:

- **상태 관리 부재**: CloudFormation에 의존하므로 인프라 상태를 코드로 추적하기 어렵다
- **코드 리뷰 불가**: 변경 사항을 PR로 리뷰할 수 없다
- **재현성 부족**: 동일한 환경을 여러 계정/리전에 재현하기 번거롭다
- **세밀한 제어 한계**: VPC, 서브넷 등 네트워크 설정을 세밀하게 제어하기 어렵다

이런 이유로 프로덕션 환경에서는 Terraform을 사용하는 것이 일반적이다.

---

## Terraform으로 IaC 전환

### 왜 Terraform인가

Terraform은 인프라를 코드로 관리하는 도구다. EKS 클러스터 구축에 Terraform을 쓰면:

- **상태 관리**: `terraform.tfstate`로 인프라 상태를 정확히 추적한다
- **코드 리뷰**: PR 기반으로 인프라 변경을 팀원이 리뷰할 수 있다
- **재현성**: 동일한 코드로 dev/staging/prod 환경을 일관성 있게 구축한다
- **Plan 기능**: 실제 적용 전에 어떤 변경이 일어날지 미리 확인할 수 있다

### 프로젝트 구조

```
eks-terraform/
├── main.tf          # 프로바이더, 데이터 소스
├── vpc.tf           # VPC 모듈
├── eks.tf           # EKS 모듈
├── variables.tf     # 변수 정의
├── outputs.tf       # 출력값 정의
└── terraform.tfvars # 변수 값 (gitignore 대상)
```

### 프로바이더 및 변수 설정

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

  # 실무에서는 S3 백엔드를 사용해서 상태 파일을 원격 관리한다
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

### VPC 모듈 구성

EKS 클러스터는 VPC 내에서 실행된다.
퍼블릭 서브넷(로드밸런서용)과 프라이빗 서브넷(워커 노드용)을 분리하는 것이 기본이다.

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

  # NAT Gateway를 통해 프라이빗 서브넷에서 외부 통신 가능
  enable_nat_gateway   = true
  single_nat_gateway   = true  # 비용 절감 (프로덕션에서는 false로 AZ별 NAT 권장)
  enable_dns_hostnames = true
  enable_dns_support   = true

  # EKS가 서브넷을 식별하기 위한 태그 (필수)
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

> **핵심 포인트**: 서브넷 태그가 없으면 AWS Load Balancer Controller가 서브넷을 찾지 못한다.
> `kubernetes.io/role/elb` (퍼블릭)과 `kubernetes.io/role/internal-elb` (프라이빗) 태그는 반드시 설정해야 한다.

### EKS 모듈 구성

```hcl
# eks.tf
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  # 클러스터 엔드포인트 접근 설정
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # 클러스터 애드온
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

  # 관리형 노드 그룹 정의
  eks_managed_node_groups = {
    # 일반 워크로드용 노드 그룹
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

  # 클러스터 생성자에게 admin 권한 부여
  enable_cluster_creator_admin_permissions = true

  tags = {
    Environment = var.environment
    Terraform   = "true"
  }
}

# EBS CSI Driver용 IRSA
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
<summary>관리형 노드 그룹 vs 자체 관리 노드 그룹</summary>

| 항목 | 관리형 노드 그룹 | 자체 관리 노드 그룹 |
|------|------------------|---------------------|
| 노드 업데이트 | AWS 콘솔/API로 롤링 업데이트 | 직접 Launch Template 관리 |
| AMI 관리 | AWS 최적화 AMI 자동 사용 | 직접 AMI 선택 및 관리 |
| 스케일링 | EKS API로 간편 관리 | ASG 직접 설정 |
| 커스터마이징 | 제한적 (Launch Template으로 확장 가능) | 완전한 자유도 |
| 권장 대상 | 대부분의 워크로드 | GPU, 특수 AMI 등 고급 요구사항 |

특별한 이유가 없다면 **관리형 노드 그룹**을 사용하는 것을 권장한다.

</details>

### Terraform 워크플로우

```bash
# 1. 초기화 - 프로바이더와 모듈 다운로드
terraform init

# 2. 계획 - 어떤 리소스가 생성/변경/삭제되는지 미리 확인
terraform plan

# 출력 예시:
# Plan: 45 to add, 0 to change, 0 to destroy.

# 3. 적용 - 실제로 리소스 생성 (약 15~20분 소요)
terraform apply

# 4. kubeconfig 설정
aws eks update-kubeconfig --name my-eks-cluster --region ap-northeast-2

# 5. 확인
kubectl get nodes
```

### eksctl vs Terraform 비교

| 항목 | eksctl | Terraform |
|------|--------|-----------|
| 학습 곡선 | 낮음 | 중간 |
| 속도 | 명령어 한 줄로 빠르게 | 코드 작성 후 적용 |
| 상태 관리 | CloudFormation | terraform.tfstate |
| 코드 리뷰 | 어려움 | PR 기반 리뷰 가능 |
| 재현성 | 낮음 | 높음 |
| 세밀한 제어 | 제한적 | VPC, IAM 등 완전 제어 |
| 팀 협업 | 불편 | 원격 상태 + 잠금으로 협업 |
| 적합한 상황 | PoC, 학습, 빠른 테스트 | 프로덕션, 팀 운영 |

---

## 네트워킹 실무 설정

클러스터를 만들었으면 외부 트래픽을 받기 위한 네트워킹 설정이 필요하다.
여기서는 ALB(Application Load Balancer), DNS, HTTPS 설정을 다룬다.

### 1. AWS Load Balancer Controller 설치

AWS Load Balancer Controller는 Kubernetes Ingress 리소스를 감지해서
자동으로 AWS ALB를 생성해 주는 컨트롤러다.

#### IRSA 설정

컨트롤러가 AWS 리소스(ALB, Target Group 등)를 관리하려면 IAM 권한이 필요하다.
IRSA(IAM Roles for Service Accounts)를 사용해서 Pod 단위로 권한을 부여한다.

```hcl
# alb-controller.tf (Terraform에 추가)
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

#### Helm으로 컨트롤러 설치

```bash
# Helm 리포지토리 추가
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# AWS Load Balancer Controller 설치
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=my-eks-cluster \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform output -raw lb_controller_role_arn) \
  --set region=ap-northeast-2 \
  --set vpcId=$(terraform output -raw vpc_id)

# 설치 확인
kubectl get deployment -n kube-system aws-load-balancer-controller
```

### 2. Ingress 리소스로 ALB 생성

AWS Load Balancer Controller가 설치되면 Ingress 리소스를 생성해서 ALB를 만들 수 있다.

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: default
  annotations:
    # ALB를 생성하도록 지정
    alb.ingress.kubernetes.io/scheme: internet-facing
    # 퍼블릭 서브넷에 ALB 생성
    alb.ingress.kubernetes.io/target-type: ip
    # 헬스체크 경로
    alb.ingress.kubernetes.io/healthcheck-path: /health
    # 리스너 포트
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

주요 어노테이션을 정리하면:

| 어노테이션 | 설명 |
|-----------|------|
| `alb.ingress.kubernetes.io/scheme` | `internet-facing` (외부 공개) 또는 `internal` (내부 전용) |
| `alb.ingress.kubernetes.io/target-type` | `ip` (Pod IP 직접) 또는 `instance` (NodePort 경유) |
| `alb.ingress.kubernetes.io/healthcheck-path` | 헬스체크 엔드포인트 경로 |
| `alb.ingress.kubernetes.io/listen-ports` | 리스너 포트 및 프로토콜 |
| `alb.ingress.kubernetes.io/certificate-arn` | ACM 인증서 ARN (HTTPS용) |
| `alb.ingress.kubernetes.io/ssl-redirect` | HTTP → HTTPS 리다이렉트 포트 |

```bash
kubectl apply -f ingress.yaml

# ALB 생성 확인 (1~2분 소요)
kubectl get ingress app-ingress
```

### 3. External DNS 설정

External DNS는 Ingress에 설정한 호스트명을 Route53에 자동으로 등록해 주는 도구다.
수동으로 DNS 레코드를 관리할 필요가 없어진다.

#### IRSA 설정

```hcl
# external-dns.tf
module "external_dns_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name                     = "${var.cluster_name}-external-dns"
  attach_external_dns_policy    = true
  external_dns_hosted_zone_arns = ["arn:aws:route53:::hostedzone/ZXXXXXXXXXX"]  # 실제 호스팅 존 ARN

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

#### Helm으로 External DNS 설치

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

# 확인
kubectl get pods -n kube-system -l app.kubernetes.io/name=external-dns
```

이제 Ingress에 `host: app.example.com`을 설정하면,
External DNS가 자동으로 Route53에 A 레코드(ALB의 DNS를 가리키는 Alias)를 생성한다.

### 4. ACM 인증서로 HTTPS 적용

프로덕션 환경에서 HTTPS는 필수다.
AWS ACM(Certificate Manager)으로 무료 SSL 인증서를 발급하고 ALB에 적용한다.

#### 인증서 발급

```bash
# ACM 인증서 요청 (DNS 검증 방식 권장)
aws acm request-certificate \
  --domain-name "*.example.com" \
  --validation-method DNS \
  --region ap-northeast-2

# 출력된 CertificateArn을 기록해 둔다
# arn:aws:acm:ap-northeast-2:123456789012:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

DNS 검증을 위해 ACM 콘솔에서 제공하는 CNAME 레코드를 Route53에 추가한다.
검증이 완료되면 인증서 상태가 `Issued`로 변경된다.

> **팁**: Terraform으로도 ACM 인증서 발급 및 DNS 검증을 자동화할 수 있다.
> `aws_acm_certificate` + `aws_route53_record` + `aws_acm_certificate_validation` 리소스를 조합하면 된다.

#### Ingress에 HTTPS 설정

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
    # HTTPS 설정
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:ap-northeast-2:123456789012:certificate/xxxxxxxx
    # HTTP → HTTPS 자동 리다이렉트
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

이렇게 설정하면:
1. HTTP(80)로 접근 시 자동으로 HTTPS(443)로 리다이렉트된다
2. HTTPS 통신에 ACM 인증서가 사용된다
3. ALB에서 TLS 종료(termination)가 이루어지므로 Pod는 HTTP만 처리하면 된다

---

## 운영 팁

클러스터를 구축한 후 실무에서 알아두면 좋은 운영 팁을 정리한다.

### 1. 클러스터 버전 업그레이드

EKS 클러스터 업그레이드는 반드시 **컨트롤 플레인 → 노드 그룹** 순서로 진행한다.

```bash
# 1단계: 컨트롤 플레인 업그레이드 (Terraform 사용 시)
# eks.tf에서 cluster_version을 변경 후
terraform apply

# 2단계: 노드 그룹 업그레이드
# eks_managed_node_groups의 AMI가 자동으로 최신 버전으로 업데이트됨
# 롤링 업데이트로 노드가 순차적으로 교체된다
```

업그레이드 시 주의사항:
- 한 번에 한 마이너 버전씩만 올린다 (예: 1.30 → 1.31)
- 업그레이드 전에 Deprecated API 사용 여부를 확인한다
- PodDisruptionBudget(PDB)을 설정해서 서비스 중단을 방지한다

### 2. 노드 그룹 관리

노드 그룹의 인스턴스 타입이나 설정을 변경하려면 새 노드 그룹을 만들고 기존 것을 삭제하는 방식이 안전하다:

```hcl
# 새 노드 그룹 추가 → 기존 노드 그룹 삭제 (Blue/Green 방식)
eks_managed_node_groups = {
  # application_v1 = { ... }  # 삭제 대상 (먼저 주석 처리하지 말 것)
  application_v2 = {
    name           = "app-nodes-v2"
    instance_types = ["t3.large"]  # 변경된 인스턴스 타입
    min_size       = 2
    max_size       = 6
    desired_size   = 2
  }
}
```

순서: 새 노드 그룹 생성 → 워크로드 마이그레이션 확인 → 기존 노드 그룹 삭제

### 3. 비용 최적화

EKS의 비용은 크게 **클러스터 비용**($0.10/시간)과 **EC2 인스턴스 비용**으로 나뉜다.
인스턴스 비용을 줄이는 방법을 알아보자.

#### Spot 인스턴스 활용

중단 가능한 워크로드에는 Spot 인스턴스를 활용하면 최대 90%까지 비용을 절감할 수 있다:

```hcl
eks_managed_node_groups = {
  # On-Demand: 핵심 워크로드용
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

  # Spot: 배치 작업, 개발 환경 등
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

> **Spot 인스턴스 팁**: `instance_types`에 여러 타입을 지정하면
> Spot 용량 확보 확률이 높아진다.
> taint를 설정해서 Spot 노드에는 tolerations이 있는 Pod만 스케줄링되도록 한다.

#### Karpenter 간략 소개

Karpenter는 AWS가 개발한 오픈소스 노드 오토스케일러로,
Cluster Autoscaler보다 더 빠르고 유연한 스케일링을 제공한다.

- 노드 그룹 없이 필요한 인스턴스를 즉시 프로비저닝한다
- Pod의 리소스 요청에 맞는 최적의 인스턴스 타입을 자동 선택한다
- 비용 최적화를 위해 자동으로 노드를 통합(consolidation)한다

Karpenter 도입은 클러스터가 어느 정도 성숙한 단계에서 고려하면 좋다.

### 4. 모니터링 기본 설정

클러스터 상태를 모니터링하려면 최소한 CloudWatch Container Insights를 활성화해야 한다.

```bash
# CloudWatch 에이전트 설치 (Amazon CloudWatch Observability 애드온)
aws eks create-addon \
  --cluster-name my-eks-cluster \
  --addon-name amazon-cloudwatch-observability \
  --region ap-northeast-2
```

Container Insights가 활성화되면 다음 지표를 CloudWatch에서 확인할 수 있다:

- CPU/메모리 사용률 (클러스터, 노드, Pod 레벨)
- 네트워크 트래픽
- 컨테이너 재시작 횟수
- Pod 상태

> 더 고급 모니터링이 필요하면 Prometheus + Grafana 스택을 구축하는 것을 권장한다.
> 이 부분은 별도 글에서 다룰 예정이다.

---

## 마무리

이 글에서 다룬 내용을 정리하면:

1. **eksctl**: EKS 클러스터를 빠르게 생성하는 CLI 도구. PoC나 학습에 적합하다
2. **Terraform**: 프로덕션 환경에서 VPC부터 EKS까지 코드로 관리. 팀 협업과 재현성에 유리하다
3. **네트워킹**: AWS Load Balancer Controller + External DNS + ACM으로 ALB, 자동 DNS, HTTPS를 설정한다
4. **운영**: 버전 업그레이드 순서, 노드 그룹 관리, 비용 최적화, 모니터링이 핵심이다

EKS 클러스터를 구축하는 것은 시작일 뿐이다.
실제 애플리케이션을 배포하려면 CI/CD 파이프라인이 필요하다.

**Part 2**에서는 ArgoCD를 활용한 GitOps 기반 배포 파이프라인 구축을 다룬다.
Helm 차트 관리, 환경별 배포 전략, 자동 동기화 설정 등
실무에서 바로 적용할 수 있는 내용을 다룰 예정이다.
