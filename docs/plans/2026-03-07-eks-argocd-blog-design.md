# EKS + ArgoCD Blog Posts Design

## Overview
Two-part blog series covering production-level EKS setup and GitOps pipeline with ArgoCD.
Target audience: developers who know Kubernetes basics but lack hands-on EKS/ArgoCD experience.

## Part 1: Production-Level EKS Cluster Setup

**Filename:** `eks-production-setup-guide.md` (ko) + `en/eks-production-setup-guide.md` (en)
**Tags:** AWS, EKS, Kubernetes, Terraform, DevOps, Infrastructure

### Sections
1. **Introduction** — What is EKS, advantages over self-managed K8s
2. **Prerequisites** — AWS CLI, kubectl, eksctl, Terraform, IAM user setup
3. **Quick Start with eksctl** — Cluster creation, node groups, kubeconfig, sample app deployment
4. **IaC with Terraform** — VPC module, EKS module, node groups, differences from eksctl
5. **Production Networking** — AWS Load Balancer Controller (IRSA), Ingress/ALB, External DNS + Route53, ACM TLS
6. **Operational Tips** — Cluster upgrades, node group management, cost optimization (Spot, Karpenter)

## Part 2: Building a GitOps Pipeline with ArgoCD on EKS

**Filename:** `eks-argocd-gitops-pipeline-guide.md` (ko) + `en/eks-argocd-gitops-pipeline-guide.md` (en)
**Tags:** AWS, EKS, ArgoCD, GitOps, CI/CD, DevOps, Kubernetes

### Sections
1. **Introduction** — What is GitOps, manual vs GitOps, why ArgoCD (vs Flux)
2. **ArgoCD Installation** — Helm install on EKS, Ingress for dashboard, initial account setup
3. **First App Deployment** — Git repo connection, Application CRD, Sync policies, dashboard verification
4. **Helm Chart Management** — Values file separation, per-environment overrides (dev/staging/prod)
5. **App of Apps Pattern** — Managing multiple microservices, directory structure examples
6. **Multi-Environment Setup** — ApplicationSet for dev/staging/prod, environment-based Git directory strategy
7. **Full CI/CD Pipeline** — GitHub Actions CI (build → test → image push → manifest update) → ArgoCD auto-deploy, Image Updater
8. **Operational Tips** — Rollback strategy, Slack notifications, custom health checks

## Decisions
- Split into 2 posts: infra vs deployment (Approach A)
- Both eksctl and Terraform covered (eksctl for concepts, Terraform for production)
- Networking covers ALB Ingress Controller, External DNS, ACM TLS
- ArgoCD covers full GitOps pipeline including CI integration with GitHub Actions
- Each post written in both Korean and English
