# Design: Local K8s Practice Blog Series

## Overview

3-part blog series covering local Kubernetes hands-on practice using kind, ArgoCD GitOps, and Loki+Grafana log monitoring. Separate from the existing EKS production series — this is a local practice series.

## Series Structure

### Part 1: kind로 로컬 K8s 클러스터 구축하기
- kind 설치 (brew), Orbstack as Docker runtime
- kind 클러스터 생성 (marketplace: control-plane 1 + worker 2)
- 포트 매핑 (80, 443 for Ingress)
- Nginx Ingress Controller 설치
- marketplace Spring Boot 앱 이미지 빌드 (multi-stage Dockerfile)
- `kind load docker-image`로 이미지 로드
- v1→v2→v3 과정에서 Redis/Kafka exclude 수정 이슈

### Part 2: ArgoCD로 GitOps 배포 파이프라인 만들기
- ArgoCD Helm 설치
- marketplace-deploy 프로젝트 구성 (Helm Chart + ArgoCD Application)
- ArgoCD Application 등록 (automated sync, selfHeal, prune)
- GitOps 파이프라인 동작: values.yaml 태그 변경 → push → ArgoCD 자동 배포
- marketplace 2 pods 배포 확인

### Part 3: Loki + Grafana로 로그 모니터링 구성하기
- Loki, Promtail, Grafana Helm 설치
- ArgoCD에서 안 보이는 트러블슈팅
- Grafana Explore에서 app name으로 로그 검색 확인

## Blog Rules
- pubDate with time, KST (+09:00)
- Korean version (src/content/blog/) + English version (src/content/blog/en/)
- Korean: 반말 체, English: practical tone
- Hero images in src/assets/

## Reference
- Existing series: kubernetes-basics-guide.md, eks-production-setup-guide.md, eks-argocd-gitops-pipeline-guide.md
- Practice notes: k8s-practice-progress.md
- marketplace-deploy repo: https://github.com/rhcwlq89/marketplace-deploy.git
