# Kubernetes Basics Blog Post Design

## Overview
A single blog post covering all Kubernetes fundamentals needed to understand the EKS + ArgoCD series (Part 1 & 2). Serves as "Part 0" of the series.

**Target audience:** Developers who know Docker basics but have little to no Kubernetes experience.

## Structure

**Filename:** `kubernetes-basics-guide.md` (ko) + `en/kubernetes-basics-guide.md` (en)
**Tags:** Kubernetes, DevOps, Container, Infrastructure
**pubDate:** 2026-03-07T09:00:00+09:00 (1 hour before Part 1)

### Sections
1. **Introduction** — What is K8s, why needed (container orchestration), purpose of this post (prereq for EKS series)
2. **Architecture** — Control plane (API Server, etcd, Scheduler, Controller Manager) vs Worker nodes (kubelet, kube-proxy, container runtime)
3. **Core Objects** — Pod, ReplicaSet, Deployment, Namespace, ConfigMap, Secret (concept + short YAML each)
4. **Networking** — Service types (ClusterIP, NodePort, LoadBalancer) comparison, Ingress concept
5. **Storage** — PV / PVC concept, StorageClass brief
6. **Deployment Strategies** — Rolling update mechanism, What is Helm (package manager analogy)
7. **kubectl Commands** — get, describe, apply, delete, logs, exec essentials
8. **YAML Manifest Structure** — apiVersion, kind, metadata, spec, Label/Selector mechanism
9. **Conclusion** — Link to EKS Part 1
