# Local K8s Practice Blog Series Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write a 3-part blog series covering local Kubernetes hands-on practice (kind + ArgoCD GitOps + Loki/Grafana monitoring), in both Korean and English.

**Architecture:** Each part is a separate blog post (KO + EN). Posts follow the existing blog conventions: Korean uses 반말 체, unquoted pubDate, multi-line tags; English uses practical tone, quoted pubDate, `lang: en`, single-line tags, extra `../` in heroImage path.

**Tech Stack:** Astro blog, Markdown content files

---

### Task 1: Generate Hero Images

**Files:**
- Create: `src/assets/KindLocalK8sCluster.png`
- Create: `src/assets/KindArgoCdGitops.png`
- Create: `src/assets/KindLokiGrafanaMonitoring.png`

**Step 1:** Generate 3 hero images for each blog post. Use a consistent style matching existing hero images in `src/assets/`. Simple, clean illustrations representing:
1. Local K8s cluster (kind logo + cluster nodes)
2. ArgoCD GitOps pipeline (ArgoCD logo + Git → deploy flow)
3. Loki + Grafana monitoring (log flow + dashboard)

**Step 2:** Save images to `src/assets/`.

**Step 3: Commit**
```bash
git add src/assets/KindLocalK8sCluster.png src/assets/KindArgoCdGitops.png src/assets/KindLokiGrafanaMonitoring.png
git commit -m "feat: 로컬 K8s 실습 시리즈 히어로 이미지 추가"
```

---

### Task 2: Write Part 1 Korean — kind로 로컬 K8s 클러스터 구축하기

**Files:**
- Create: `src/content/blog/kind-local-k8s-cluster-setup.md`

**Step 1:** Write the blog post with this structure:

```
---
title: "kind로 로컬 K8s 클러스터 구축하기"
description: "kind를 사용해 로컬에서 멀티 노드 Kubernetes 클러스터를 구축하고 Spring Boot 앱을 배포하는 실습 가이드"
pubDate: 2026-03-08T09:00:00+09:00
tags:
  [
    "Kubernetes",
    "kind",
    "Docker",
    "DevOps",
    "Spring Boot",
  ]
heroImage: "../../assets/KindLocalK8sCluster.png"
---
```

**Content outline (반말 체):**

1. **서론** — 왜 로컬 K8s 환경이 필요한가? (EKS는 비용, minikube는 단일 노드, kind는 멀티 노드 + 가볍고 빠름)
   - 시리즈 안내 박스 (Part 1/2/3 링크)
2. **사전 준비** — Docker (Orbstack), kind, kubectl, helm 설치
3. **kind 클러스터 생성** — kind config YAML (control-plane 1 + worker 2, 포트 매핑 80/443), `kind create cluster` 명령어
4. **Nginx Ingress Controller 설치** — kind 전용 manifest, 동작 확인
5. **marketplace 이미지 빌드** — multi-stage Dockerfile 설명, `docker build -t marketplace:v1 .`
6. **kind로 이미지 로드** — `kind load docker-image marketplace:v1 --name marketplace`, 왜 레지스트리 없이 되는지
7. **트러블슈팅: Redis/Kafka auto-config 문제** — v1→v2→v3 과정, local 프로파일에서 Redis/Kafka exclude 필요했던 이유, 해결 방법
8. **정리** — 다음 편 예고 (ArgoCD GitOps)

**Reference files for actual commands/configs:**
- kind config: k8s-practice-progress.md
- Dockerfile: `/Users/ihojong/Documents/code/marketplace/Dockerfile`
- marketplace-deploy git log for v1→v2→v3 history

**Step 2: Commit**
```bash
git add src/content/blog/kind-local-k8s-cluster-setup.md
git commit -m "feat: 로컬 K8s 실습 Part 1 - kind 클러스터 구축 (KO)"
```

---

### Task 3: Write Part 1 English

**Files:**
- Create: `src/content/blog/en/kind-local-k8s-cluster-setup.md`

**Step 1:** Translate Part 1 to English with these conventions:
- `lang: en` in frontmatter
- Quoted pubDate: `"2026-03-08T09:00:00+09:00"`
- Single-line tags array
- heroImage: `"../../../assets/KindLocalK8sCluster.png"` (extra `../`)
- Practical, clear English tone

**Step 2: Commit**
```bash
git add src/content/blog/en/kind-local-k8s-cluster-setup.md
git commit -m "feat: Local K8s Practice Part 1 - kind cluster setup (EN)"
```

---

### Task 4: Write Part 2 Korean — ArgoCD로 GitOps 배포 파이프라인 만들기

**Files:**
- Create: `src/content/blog/kind-argocd-gitops-pipeline.md`

**Step 1:** Write the blog post:

```
---
title: "ArgoCD로 로컬 GitOps 배포 파이프라인 만들기"
description: "kind 클러스터에 ArgoCD를 설치하고 marketplace-deploy 프로젝트로 GitOps 자동 배포 파이프라인을 구축하는 실습 가이드"
pubDate: 2026-03-08T10:00:00+09:00
tags:
  [
    "Kubernetes",
    "ArgoCD",
    "GitOps",
    "Helm",
    "DevOps",
    "kind",
  ]
heroImage: "../../assets/KindArgoCdGitops.png"
---
```

**Content outline (반말 체):**

1. **서론** — 이전 편 요약, 이제 배포 자동화할 차례 (시리즈 박스)
2. **ArgoCD 설치** — Helm으로 설치 (`helm install argocd argo/argo-cd -n argocd`), UI 접속 (port-forward), 초기 비밀번호 확인
3. **marketplace-deploy 프로젝트 구조** — Helm Chart 구조 설명 (Chart.yaml, values.yaml, templates/)
   - deployment.yaml: replicas, image, env, health probe 설명
   - service.yaml: ClusterIP, port 설명
   - ingress.yaml: nginx, host 설명
   - values.yaml: replicaCount 2, image tag, pullPolicy Never 등
4. **ArgoCD Application 등록** — Application CRD YAML, automated sync + selfHeal + prune 설명
5. **GitOps 파이프라인 동작 확인** — values.yaml 태그 변경 → git push → ArgoCD 자동 감지 → 배포 확인, ArgoCD UI 스크린샷 설명
6. **정리** — CI는 수동(docker build + kind load), CD는 ArgoCD 자동화, 다음 편 예고

**Reference files:**
- All files in marketplace-deploy/helm/marketplace/
- marketplace-deploy git log
- k8s-practice-progress.md

**Step 2: Commit**
```bash
git add src/content/blog/kind-argocd-gitops-pipeline.md
git commit -m "feat: 로컬 K8s 실습 Part 2 - ArgoCD GitOps 파이프라인 (KO)"
```

---

### Task 5: Write Part 2 English

**Files:**
- Create: `src/content/blog/en/kind-argocd-gitops-pipeline.md`

**Step 1:** Translate Part 2 to English (same conventions as Task 3).

**Step 2: Commit**
```bash
git add src/content/blog/en/kind-argocd-gitops-pipeline.md
git commit -m "feat: Local K8s Practice Part 2 - ArgoCD GitOps pipeline (EN)"
```

---

### Task 6: Write Part 3 Korean — Loki + Grafana로 로그 모니터링 구성하기

**Files:**
- Create: `src/content/blog/kind-loki-grafana-log-monitoring.md`

**Step 1:** Write the blog post:

```
---
title: "Loki + Grafana로 K8s 로그 모니터링 구성하기"
description: "kind 클러스터에 Loki, Promtail, Grafana를 설치하고 Spring Boot 앱 로그를 수집·조회하는 실습 가이드"
pubDate: 2026-03-08T11:00:00+09:00
tags:
  [
    "Kubernetes",
    "Loki",
    "Grafana",
    "Promtail",
    "Monitoring",
    "DevOps",
    "kind",
  ]
heroImage: "../../assets/KindLokiGrafanaMonitoring.png"
---
```

**Content outline (반말 체):**

1. **서론** — 앱 배포까지 했으니 이제 로그 모니터링 (시리즈 박스)
   - Loki + Promtail + Grafana 스택 소개 (ELK 대비 경량, K8s 네이티브)
2. **모니터링 스택 설치**
   - kube-prometheus-stack Helm 설치 (prometheus-values.yaml 설명: Grafana adminPassword, Loki datasource 추가)
   - loki-stack Helm 설치 (loki-values.yaml 설명: Promtail 활성화, Grafana 비활성화로 충돌 방지)
   - monitoring namespace 사용
3. **트러블슈팅: ArgoCD에서 안 보이는 문제** — loki-stack datasource 자동등록 비활성화 (git log: `fix: loki-stack datasource 자동등록 비활성화`)
4. **Grafana 접속 및 로그 확인** — port-forward로 Grafana 접속, Explore에서 Loki datasource 선택, app name으로 marketplace 로그 검색
5. **ServiceMonitor 설정** — marketplace-servicemonitor.yaml 설명 (Prometheus 메트릭 수집 연동, actuator/prometheus 엔드포인트)
6. **정리** — 전체 시리즈 요약 (kind → ArgoCD → 모니터링), 로컬 실습으로 DevOps 파이프라인 전체를 경험

**Reference files:**
- marketplace-deploy/helm/monitoring/ (loki-values.yaml, prometheus-values.yaml, marketplace-servicemonitor.yaml)
- marketplace-deploy git log (트러블슈팅 커밋 히스토리)

**Step 2: Commit**
```bash
git add src/content/blog/kind-loki-grafana-log-monitoring.md
git commit -m "feat: 로컬 K8s 실습 Part 3 - Loki + Grafana 로그 모니터링 (KO)"
```

---

### Task 7: Write Part 3 English

**Files:**
- Create: `src/content/blog/en/kind-loki-grafana-log-monitoring.md`

**Step 1:** Translate Part 3 to English (same conventions as Task 3).

**Step 2: Commit**
```bash
git add src/content/blog/en/kind-loki-grafana-log-monitoring.md
git commit -m "feat: Local K8s Practice Part 3 - Loki + Grafana monitoring (EN)"
```

---

### Task 8: Update existing blog series links

**Files:**
- Modify: `src/content/blog/kubernetes-basics-guide.md` (시리즈 안내 박스에 로컬 실습 시리즈 언급 추가)

**Step 1:** Add a note in the series box mentioning the local practice series as a companion.

**Step 2: Commit**
```bash
git add src/content/blog/kubernetes-basics-guide.md
git commit -m "feat: K8s 기본 개념 글에 로컬 실습 시리즈 링크 추가"
```
