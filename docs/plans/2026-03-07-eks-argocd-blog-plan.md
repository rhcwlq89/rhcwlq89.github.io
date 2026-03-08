# EKS + ArgoCD Blog Posts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write a two-part blog series covering production-level EKS setup and GitOps with ArgoCD.

**Architecture:** 4 markdown files total — 2 Korean posts in `src/content/blog/`, 2 English posts in `src/content/blog/en/`. Each post follows the existing frontmatter format with title, description, pubDate, tags, and lang fields.

**Tech Stack:** Astro blog, Markdown content

---

### Task 1: Write Part 1 Korean version

**Files:**
- Create: `src/content/blog/eks-production-setup-guide.md`

**Step 1: Write the Korean blog post**

Frontmatter format:
```yaml
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
```

Sections to write:
1. Introduction — EKS overview, managed control plane advantages
2. Prerequisites — AWS CLI, kubectl, eksctl, Terraform install, IAM setup
3. Quick Start with eksctl — cluster create, node groups, kubeconfig, sample app
4. IaC with Terraform — VPC module, EKS module, node groups, eksctl vs Terraform comparison
5. Production Networking — AWS LB Controller (IRSA), Ingress/ALB, External DNS + Route53, ACM TLS
6. Operational Tips — cluster upgrades, node group mgmt, cost optimization (Spot, Karpenter)

**Step 2: Commit**
```bash
git add src/content/blog/eks-production-setup-guide.md
git commit -m "feat: add EKS production setup guide (Korean)"
```

---

### Task 2: Write Part 1 English version

**Files:**
- Create: `src/content/blog/en/eks-production-setup-guide.md`

**Step 1: Write the English blog post**

Frontmatter format:
```yaml
---
title: "Production-Level EKS Cluster Setup Guide"
description: "A practical guide to building production-grade EKS clusters from eksctl to Terraform, including networking setup"
pubDate: "2026-03-07T10:00:00+09:00"
lang: en
tags: ["AWS", "EKS", "Kubernetes", "Terraform", "DevOps", "Infrastructure"]
heroImage: "../../../assets/EksProductionSetupGuide.png"
---
```

Same sections as Korean version, translated to natural English.
Note: `heroImage` path has extra `../` for `en/` subdirectory.

**Step 2: Commit**
```bash
git add src/content/blog/en/eks-production-setup-guide.md
git commit -m "feat: add EKS production setup guide (English)"
```

---

### Task 3: Write Part 2 Korean version

**Files:**
- Create: `src/content/blog/eks-argocd-gitops-pipeline-guide.md`

**Step 1: Write the Korean blog post**

Frontmatter format:
```yaml
---
title: "ArgoCD로 구축하는 GitOps 배포 파이프라인"
description: "EKS 위에 ArgoCD를 설치하고 GitHub Actions와 연계한 완전한 GitOps CI/CD 파이프라인을 구축하는 가이드"
pubDate: 2026-03-07T11:00:00+09:00
tags:
  [
    "AWS",
    "EKS",
    "ArgoCD",
    "GitOps",
    "CI/CD",
    "DevOps",
    "Kubernetes",
  ]
heroImage: "../../assets/EksArgoCdGitopsGuide.png"
---
```

Sections to write:
1. Introduction — GitOps concept, manual vs GitOps, why ArgoCD
2. ArgoCD Installation — Helm install, Ingress dashboard, account setup
3. First App Deployment — Git repo, Application CRD, Sync policies
4. Helm Chart Management — values separation, per-env overrides
5. App of Apps Pattern — multi-service management, directory structure
6. Multi-Environment Setup — ApplicationSet, env-based directory strategy
7. Full CI/CD Pipeline — GitHub Actions CI → ArgoCD deploy, Image Updater
8. Operational Tips — rollback, Slack notifications, health checks

**Step 2: Commit**
```bash
git add src/content/blog/eks-argocd-gitops-pipeline-guide.md
git commit -m "feat: add ArgoCD GitOps pipeline guide (Korean)"
```

---

### Task 4: Write Part 2 English version

**Files:**
- Create: `src/content/blog/en/eks-argocd-gitops-pipeline-guide.md`

**Step 1: Write the English blog post**

Frontmatter format:
```yaml
---
title: "Building a GitOps Pipeline with ArgoCD on EKS"
description: "A guide to installing ArgoCD on EKS and building a complete GitOps CI/CD pipeline with GitHub Actions"
pubDate: "2026-03-07T11:00:00+09:00"
lang: en
tags: ["AWS", "EKS", "ArgoCD", "GitOps", "CI/CD", "DevOps", "Kubernetes"]
heroImage: "../../../assets/EksArgoCdGitopsGuide.png"
---
```

Same sections as Korean version, translated to natural English.

**Step 2: Commit**
```bash
git add src/content/blog/en/eks-argocd-gitops-pipeline-guide.md
git commit -m "feat: add ArgoCD GitOps pipeline guide (English)"
```

---

### Notes
- heroImage files (`EksProductionSetupGuide.png`, `EksArgoCdGitopsGuide.png`) are referenced but not created — placeholder images can be added later
- Part 2 pubDate is set 1 hour after Part 1 to maintain ordering
- Korean posts omit `lang` field (defaults to "ko" per content config)
- English posts use `lang: en` and extra `../` in heroImage path
