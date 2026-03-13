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

## 서론

Kubernetes 클러스터에 애플리케이션을 배포할 때,
가장 흔한 방법은 `kubectl apply -f deployment.yaml`을 직접 실행하는 것이다.
처음에는 간단하지만, 팀이 커지고 환경이 늘어나면 문제가 생긴다:

- 누가, 언제, 무엇을 배포했는지 추적이 안 된다
- 로컬 환경마다 kubectl 컨텍스트가 달라서 잘못된 클러스터에 배포하는 사고가 발생한다
- 롤백하려면 이전 YAML을 찾아서 다시 apply 해야 한다
- CI/CD 파이프라인에서 클러스터 접근 권한(kubeconfig)을 관리하는 게 보안 부담이 된다

**GitOps** 는 이런 문제를 근본적으로 해결하는 운영 모델이다.
핵심 원칙은 단순하다: **Git 저장소를 Single Source of Truth로 사용한다.**

Git에 선언된 상태 = 클러스터에 실제로 존재해야 하는 상태.
이 두 가지가 항상 일치하도록 자동으로 동기화하는 것이 GitOps의 전부다.

### 수동 배포 vs GitOps

| 구분 | 수동 배포 | GitOps |
|------|-----------|--------|
| 배포 방법 | `kubectl apply` 직접 실행 | Git push하면 자동 동기화 |
| 변경 추적 | 누가 뭘 했는지 알 수 없음 | Git 커밋 히스토리로 전체 추적 |
| 롤백 | 이전 YAML 파일을 찾아서 재적용 | `git revert` 한 번이면 끝 |
| 권한 관리 | kubectl 접근 권한을 여러 사람에게 부여 | Git 저장소 권한만 관리 |
| 환경 일관성 | 수동이라 환경 간 차이 발생 가능 | Git이 진실이므로 항상 일관 |

### 왜 ArgoCD인가

GitOps를 구현하는 대표적인 도구로 ArgoCD와 Flux가 있다.
이 글에서는 ArgoCD를 선택한다. 이유는 다음과 같다:

- **웹 UI 대시보드**: 배포 상태를 시각적으로 확인할 수 있다. Flux는 CLI 중심이다
- **멀티 클러스터 지원**: 하나의 ArgoCD로 여러 클러스터를 관리할 수 있다
- **커뮤니티 활성도**: CNCF Graduated 프로젝트로, GitHub 스타 수와 기여자 수가 압도적이다
- **학습 자료 풍부**: 문서화가 잘 되어 있고, 한국어 자료도 많다

> 이 글은 시리즈의 **Part 2** 다.
> [Part 1 (실무 레벨 EKS 클러스터 구축 가이드)](/blog/eks-production-setup-guide)에서 구축한 EKS 클러스터가 이미 있다는 전제로 진행한다.
> 특히 AWS Load Balancer Controller가 설치되어 있어야 ArgoCD 대시보드 외부 노출이 가능하다.

### Helm과 Argo CD — 역할이 어떻게 다를까?

Helm과 Argo CD를 처음 접하면 역할이 헷갈릴 수 있다. 한 줄로 정리하면: **Helm은 패키징 도구, Argo CD는 배포 자동화 도구** 다. 역할 레이어 자체가 다르다.

**Helm** 은 쿠버네티스용 패키지 매니저다 (apt, npm과 같은 개념):
- `values.yaml`로 환경별 설정을 변수화
- 여러 YAML을 **Chart** 라는 단위로 묶어서 관리
- `helm install / upgrade / rollback` 명령으로 배포
- 자체적으로 Git을 감시하거나 자동 동기화하지 않는다

**Argo CD** 는 GitOps 기반 배포 자동화 도구다:
- Git 저장소를 단일 진실의 원천(Source of Truth)으로 삼는다
- Git과 클러스터 상태를 **지속적으로 비교** 하고 차이가 생기면 자동 Sync
- 수동으로 `kubectl`이나 `helm` 명령을 직접 치지 않아도 된다
- 배포 이력을 UI에서 시각화

| 구분 | Helm | Argo CD |
|------|------|---------|
| 역할 | 매니페스트 템플릿/패키징 | 배포 상태 관리/자동화 |
| 실행 방식 | CLI 명령 직접 실행 | Git 감시 → 자동 Sync |
| 상태 감시 | 없음 | 있음 (지속적 비교) |
| 롤백 | `helm rollback` | Git revert → 자동 반영 |
| UI | 없음 | 있음 |

둘은 경쟁 관계가 아니라 **보완 관계** 다. Argo CD가 Helm Chart를 렌더링 엔진으로 내부적으로 호출하는 구조로 함께 사용하는 것이 일반적이다:

```mermaid
flowchart LR
    A["Git\n(values.yaml + Chart)"] --> B["Argo CD\n변경 감지"]
    B --> C["Helm Chart 렌더링\n→ 클러스터에 적용"]
```

이 글에서도 Helm Chart를 Argo CD로 관리하는 방법을 다룰 예정이다.

---

## ArgoCD 설치

### 1. argocd 네임스페이스 생성

```bash
kubectl create namespace argocd
```

### 2. Helm으로 ArgoCD 설치

Helm 차트를 사용하면 values 파일로 설정을 관리할 수 있어 편리하다.

```bash
# ArgoCD Helm 저장소 추가
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
```

`argocd-values.yaml` 파일을 작성한다:

```yaml
# argocd-values.yaml
server:
  # Ingress로 외부 노출할 것이므로 insecure 모드 활성화
  # (TLS 종료를 ALB에서 처리)
  extraArgs:
    - --insecure

  ingress:
    enabled: true
    ingressClassName: alb
    annotations:
      alb.ingress.kubernetes.io/scheme: internet-facing
      alb.ingress.kubernetes.io/target-type: ip
      alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS": 443}]'
      alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:ap-northeast-2:ACCOUNT_ID:certificate/CERTIFICATE_ID
      alb.ingress.kubernetes.io/ssl-redirect: "443"
      alb.ingress.kubernetes.io/healthcheck-path: /healthz
    hosts:
      - argocd.example.com
    paths:
      - /
    pathType: Prefix

  # 리소스 제한 설정
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

# Redis HA는 프로덕션에서 권장하지만 초기에는 비활성화
redis-ha:
  enabled: false

# 컨트롤러 리소스 설정
controller:
  resources:
    requests:
      cpu: 250m
      memory: 256Mi
    limits:
      cpu: "1"
      memory: 1Gi

# repo-server 리소스 설정
repoServer:
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

> **참고**: `certificate-arn`에는 ACM에서 발급한 인증서 ARN을 입력한다.
> Part 1에서 설정한 AWS Load Balancer Controller가 이 어노테이션을 읽어서 ALB를 자동 생성한다.

Helm으로 설치한다:

```bash
helm install argocd argo/argo-cd \
  --namespace argocd \
  --values argocd-values.yaml \
  --version 7.7.12
```

설치 상태를 확인한다:

```bash
kubectl get pods -n argocd
```

모든 Pod가 Running 상태가 되면 설치 완료다:

```
NAME                                               READY   STATUS    RESTARTS   AGE
argocd-application-controller-0                     1/1     Running   0          2m
argocd-dex-server-xxx-xxx                           1/1     Running   0          2m
argocd-redis-xxx-xxx                                1/1     Running   0          2m
argocd-repo-server-xxx-xxx                          1/1     Running   0          2m
argocd-server-xxx-xxx                               1/1     Running   0          2m
```

### 3. 초기 admin 비밀번호 확인 및 변경

ArgoCD는 설치 시 admin 계정의 초기 비밀번호를 자동 생성한다.
다음 명령어로 확인할 수 있다:

```bash
# 초기 비밀번호 확인
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

보안을 위해 반드시 비밀번호를 변경한다:

```bash
# argocd CLI로 비밀번호 변경
argocd account update-password \
  --current-password <초기_비밀번호> \
  --new-password <새_비밀번호>
```

변경 후 초기 비밀번호 Secret을 삭제한다:

```bash
kubectl -n argocd delete secret argocd-initial-admin-secret
```

### 4. argocd CLI 설치 및 로그인

```bash
# macOS
brew install argocd

# Linux
curl -sSL -o argocd-linux-amd64 \
  https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo install -m 555 argocd-linux-amd64 /usr/local/bin/argocd
rm argocd-linux-amd64

# 설치 확인
argocd version --client
```

Ingress를 설정했다면 도메인으로 로그인한다:

```bash
argocd login argocd.example.com --grpc-web
# Username: admin
# Password: <변경한_비밀번호>
```

Ingress 없이 테스트하고 싶다면 포트 포워딩을 사용할 수도 있다:

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
argocd login localhost:8080 --insecure
```

---

## 첫 번째 앱 배포

### Git 저장소 구조

GitOps에서는 애플리케이션 소스 코드 저장소와 Kubernetes 매니페스트 저장소를 분리하는 것이 일반적이다.
이를 **Config Repository** 패턴이라고 부른다.

```
# 매니페스트 저장소 구조
k8s-manifests/
├── apps/
│   └── my-app/
│       ├── deployment.yaml
│       ├── service.yaml
│       └── ingress.yaml
└── README.md
```

간단한 예시 매니페스트를 작성한다:

```yaml
# apps/my-app/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
---
# apps/my-app/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: default
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
```

### ArgoCD Application CRD 작성

ArgoCD에서 앱을 관리하려면 `Application` 리소스를 생성해야 한다.
이 CRD(Custom Resource Definition)가 "어떤 Git 저장소의 어떤 경로를 어떤 클러스터에 배포할지"를 정의한다.

```yaml
# argocd-apps/my-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default

  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: apps/my-app

  destination:
    server: https://kubernetes.default.svc
    namespace: default

  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### Sync 정책 이해하기

ArgoCD의 동기화 정책은 세 가지 핵심 개념으로 구성된다:

| 정책 | 설명 | 언제 사용하나 |
|------|------|--------------|
| **Manual Sync** | 사용자가 명시적으로 Sync 버튼을 눌러야 배포 | 프로덕션 환경에서 배포 전 검토가 필요할 때 |
| **Auto Sync** | Git 변경 감지 시 자동 배포 | dev/staging 환경 또는 GitOps를 완전히 신뢰할 때 |
| **Self-Heal** | 누군가 kubectl로 직접 변경해도 Git 상태로 자동 복구 | 클러스터 상태를 Git과 항상 일치시키고 싶을 때 |
| **Prune** | Git에서 삭제된 리소스를 클러스터에서도 자동 삭제 | 리소스 정리를 자동화하고 싶을 때 |

> **주의**: `prune: true`는 Git에서 YAML을 삭제하면 클러스터의 실제 리소스도 삭제한다.
> 처음에는 `prune: false`로 시작하고, 운영에 익숙해진 후 활성화하는 것을 권장한다.

### argocd CLI로 앱 생성 및 동기화

YAML 파일 대신 CLI로도 앱을 생성할 수 있다:

```bash
# 앱 생성
argocd app create my-app \
  --repo https://github.com/your-org/k8s-manifests.git \
  --path apps/my-app \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace default \
  --sync-policy automated \
  --auto-prune \
  --self-heal

# 앱 상태 확인
argocd app get my-app

# 수동 동기화 (Auto Sync를 설정하지 않은 경우)
argocd app sync my-app

# 앱 목록 확인
argocd app list
```

### 대시보드에서 배포 상태 확인

웹 브라우저에서 `https://argocd.example.com`에 접속하면 대시보드를 볼 수 있다.
대시보드에서는 다음을 시각적으로 확인할 수 있다:

- **Sync Status**: Git과 클러스터 상태가 일치하는지 (Synced / OutOfSync)
- **Health Status**: 배포된 리소스가 정상인지 (Healthy / Degraded / Progressing)
- **Resource Tree**: Deployment -> ReplicaSet -> Pod 관계를 트리로 표시
- **Diff View**: Git과 클러스터 사이의 차이점을 보여줌

---

## Helm Chart 관리

실무에서는 순수 Kubernetes 매니페스트보다 Helm 차트를 많이 사용한다.
ArgoCD는 Helm 차트를 네이티브하게 지원한다.

### Helm 기반 앱을 ArgoCD로 배포하는 방법

Helm 차트 저장소에서 직접 배포하는 방법과,
Git 저장소에 Helm 차트를 포함시켜 배포하는 방법 두 가지가 있다.

**방법 1: 외부 Helm 저장소에서 직접 배포**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx-ingress
  namespace: argocd
spec:
  project: default
  source:
    chart: ingress-nginx
    repoURL: https://kubernetes.github.io/ingress-nginx
    targetRevision: 4.11.3
    helm:
      values: |
        controller:
          replicaCount: 2
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
  destination:
    server: https://kubernetes.default.svc
    namespace: ingress-nginx
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
```

**방법 2: Git 저장소의 Helm 차트 배포**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: charts/my-app
    helm:
      valueFiles:
        - values-prod.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: default
```

### values 파일 분리 전략

환경별로 values 파일을 분리하면 하나의 Helm 차트로 여러 환경을 관리할 수 있다:

```
charts/my-app/
├── Chart.yaml
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
├── values.yaml          # 기본값 (공통 설정)
├── values-dev.yaml      # 개발 환경 오버라이드
├── values-staging.yaml  # 스테이징 환경 오버라이드
└── values-prod.yaml     # 프로덕션 환경 오버라이드
```

### 환경별 values override 예시

```yaml
# values.yaml (기본값)
replicaCount: 1
image:
  repository: 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app
  tag: latest
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 200m
    memory: 256Mi
ingress:
  enabled: false
```

```yaml
# values-dev.yaml
replicaCount: 1
image:
  tag: dev-latest
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 100m
    memory: 128Mi
```

```yaml
# values-staging.yaml
replicaCount: 2
image:
  tag: staging-latest
ingress:
  enabled: true
  host: staging.example.com
```

```yaml
# values-prod.yaml
replicaCount: 3
image:
  tag: v1.2.3
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: "1"
    memory: 1Gi
ingress:
  enabled: true
  host: app.example.com
```

### ArgoCD Application에서 Helm values 지정하기

여러 values 파일을 조합할 수도 있다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: charts/my-app
    helm:
      valueFiles:
        - values.yaml
        - values-prod.yaml
      # 추가로 개별 파라미터를 오버라이드할 수도 있다
      parameters:
        - name: image.tag
          value: v1.2.4
  destination:
    server: https://kubernetes.default.svc
    namespace: production
```

> **팁**: `parameters`로 지정한 값은 values 파일보다 우선순위가 높다.
> CI/CD 파이프라인에서 이미지 태그만 동적으로 변경할 때 유용하다.

---

## App of Apps 패턴

### 패턴 개념

마이크로서비스 아키텍처에서는 수십 개의 서비스를 각각 ArgoCD Application으로 관리해야 한다.
이때 하나하나 수동으로 생성하면 관리가 어렵다.

**App of Apps** 패턴은 상위(root) Application이 하위 Application들을 관리하는 구조다.
root Application을 하나만 생성하면, 그 안에 정의된 하위 Application YAML들을 ArgoCD가 자동으로 생성해 준다.

```
Root Application (apps)
├── Application: frontend
├── Application: backend-api
├── Application: backend-worker
├── Application: redis
└── Application: monitoring
```

### 디렉토리 구조

```
k8s-manifests/
├── argocd-apps/           # Root Application이 바라보는 경로
│   ├── frontend.yaml      # 하위 Application 정의
│   ├── backend-api.yaml
│   ├── backend-worker.yaml
│   ├── redis.yaml
│   └── monitoring.yaml
├── apps/                  # 실제 Kubernetes 매니페스트
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── ingress.yaml
│   ├── backend-api/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── backend-worker/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   └── redis/
│       ├── deployment.yaml
│       └── service.yaml
└── monitoring/
    ├── prometheus/
    └── grafana/
```

### 상위(root) Application YAML

```yaml
# root-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: apps
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: argocd-apps  # 하위 Application YAML들이 있는 디렉토리
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd  # Application 리소스는 argocd 네임스페이스에 생성
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### 하위 Application YAML

```yaml
# argocd-apps/frontend.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: frontend
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: apps/frontend
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

```yaml
# argocd-apps/backend-api.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: backend-api
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: apps/backend-api
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### 마이크로서비스에서의 활용

이 패턴의 핵심 장점은 **새 서비스 추가가 Git에 YAML 파일 하나 추가하는 것으로 끝난다** 는 점이다.

1. `argocd-apps/` 디렉토리에 새 Application YAML을 추가한다
2. `apps/` 디렉토리에 해당 서비스의 매니페스트를 추가한다
3. Git에 push한다
4. root Application이 자동으로 새 하위 Application을 생성하고, 그 Application이 서비스를 배포한다

ArgoCD 대시보드에서 별도 작업을 할 필요가 전혀 없다.

---

## 멀티 환경 구성

### ApplicationSet 소개

App of Apps 패턴이 유용하지만, 환경마다(dev/staging/prod) 거의 동일한 Application YAML을 복붙하게 되는 문제가 있다.
**ApplicationSet** 은 이 반복을 제거하기 위해 만들어진 ArgoCD의 기능이다.

하나의 ApplicationSet 정의로 여러 Application을 자동 생성할 수 있다.
템플릿과 Generator의 조합으로 동작한다.

### Generator 종류

| Generator | 설명 | 사용 사례 |
|-----------|------|-----------|
| **List** | 명시적인 값 목록에서 생성 | 환경 목록이 고정적일 때 |
| **Git Directory** | Git 저장소의 디렉토리 구조에서 자동 생성 | 디렉토리만 추가하면 자동 반영하고 싶을 때 |
| **Git File** | Git 저장소의 설정 파일에서 생성 | JSON/YAML 파일로 환경을 정의할 때 |
| **Cluster** | 등록된 클러스터 목록에서 생성 | 멀티 클러스터 배포 시 |
| **Matrix** | 두 Generator를 조합해서 생성 | 환경 x 서비스 조합이 필요할 때 |

### 환경별 디렉토리 구조

```
k8s-manifests/
├── envs/
│   ├── dev/
│   │   ├── my-app/
│   │   │   ├── deployment.yaml
│   │   │   └── service.yaml
│   │   └── another-app/
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   ├── staging/
│   │   ├── my-app/
│   │   │   ├── deployment.yaml
│   │   │   └── service.yaml
│   │   └── another-app/
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   └── prod/
│       ├── my-app/
│       │   ├── deployment.yaml
│       │   └── service.yaml
│       └── another-app/
│           ├── deployment.yaml
│           └── service.yaml
└── applicationsets/
    └── multi-env.yaml
```

### Git Directory Generator 예시

```yaml
# applicationsets/multi-env.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: multi-env-apps
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - git:
        repoURL: https://github.com/your-org/k8s-manifests.git
        revision: main
        directories:
          - path: "envs/*/*"  # envs/dev/my-app, envs/prod/my-app 등
  template:
    metadata:
      # 경로에서 환경명과 앱 이름을 추출
      name: "{{ index .path.segments 1 }}-{{ index .path.segments 2 }}"
    spec:
      project: default
      source:
        repoURL: https://github.com/your-org/k8s-manifests.git
        targetRevision: main
        path: "{{ .path.path }}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{ index .path.segments 1 }}"  # 환경명을 네임스페이스로 사용
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

이 ApplicationSet 하나로 `envs/` 아래 모든 디렉토리 조합에 대해 Application이 자동 생성된다.

예를 들어 다음과 같은 Application들이 만들어진다:
- `dev-my-app` (envs/dev/my-app)
- `dev-another-app` (envs/dev/another-app)
- `staging-my-app` (envs/staging/my-app)
- `prod-my-app` (envs/prod/my-app)

새 환경이나 새 서비스를 추가하려면 해당 디렉토리를 만들고 매니페스트를 넣기만 하면 된다.

### List Generator 예시

환경이 고정적이고 각각 다른 클러스터에 배포해야 할 때는 List Generator가 적합하다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: my-app-envs
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - list:
        elements:
          - env: dev
            cluster: https://kubernetes.default.svc
            namespace: dev
            values_file: values-dev.yaml
          - env: staging
            cluster: https://kubernetes.default.svc
            namespace: staging
            values_file: values-staging.yaml
          - env: prod
            cluster: https://prod-cluster-api.example.com
            namespace: production
            values_file: values-prod.yaml
  template:
    metadata:
      name: "my-app-{{ .env }}"
    spec:
      project: default
      source:
        repoURL: https://github.com/your-org/k8s-manifests.git
        targetRevision: main
        path: charts/my-app
        helm:
          valueFiles:
            - "{{ .values_file }}"
      destination:
        server: "{{ .cluster }}"
        namespace: "{{ .namespace }}"
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

---

## CI/CD 전체 파이프라인

GitOps에서 가장 중요한 원칙은 **CI와 CD의 분리** 다.

- **CI (Continuous Integration)**: 코드 빌드, 테스트, 이미지 빌드 및 레지스트리 푸시
- **CD (Continuous Deployment)**: Git 저장소 상태를 클러스터에 동기화

전통적인 CI/CD에서는 CI 파이프라인이 `kubectl apply`까지 직접 수행한다.
GitOps에서는 CI 파이프라인이 **매니페스트 저장소의 이미지 태그만 업데이트** 하고, CD는 ArgoCD가 담당한다.

### 전체 흐름

```
1. 개발자가 애플리케이션 소스 코드를 Push
2. GitHub Actions가 트리거됨
3. 테스트 실행
4. Docker 이미지 빌드
5. ECR에 이미지 Push
6. 매니페스트 저장소의 이미지 태그 업데이트 (Git Push)
7. ArgoCD가 변경 감지 → 자동 배포
```

### GitHub Actions 워크플로우 전체 예시

```yaml
# .github/workflows/ci.yaml
name: CI Pipeline

on:
  push:
    branches: [main]

env:
  AWS_REGION: ap-northeast-2
  ECR_REPOSITORY: my-app
  MANIFEST_REPO: your-org/k8s-manifests

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # OIDC 토큰 발급용
      contents: read

    steps:
      # 1. 소스 코드 체크아웃
      - name: Checkout source code
        uses: actions/checkout@v4

      # 2. AWS 인증 (OIDC 방식 권장)
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-role
          aws-region: ${{ env.AWS_REGION }}

      # 3. ECR 로그인
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      # 4. 이미지 태그 생성 (커밋 SHA 사용)
      - name: Set image tag
        id: tag
        run: echo "IMAGE_TAG=${GITHUB_SHA::8}" >> $GITHUB_OUTPUT

      # 5. Docker 이미지 빌드 및 푸시
      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ steps.tag.outputs.IMAGE_TAG }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

      # 6. 매니페스트 저장소의 이미지 태그 업데이트
      - name: Update manifest repository
        env:
          IMAGE_TAG: ${{ steps.tag.outputs.IMAGE_TAG }}
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        run: |
          # 매니페스트 저장소 클론
          git clone https://x-access-token:${{ secrets.MANIFEST_REPO_TOKEN }}@github.com/${{ env.MANIFEST_REPO }}.git
          cd k8s-manifests

          # kustomize로 이미지 태그 업데이트
          cd apps/my-app
          kustomize edit set image $ECR_REGISTRY/$ECR_REPOSITORY=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

          # 또는 yq를 사용하는 방법
          # yq eval ".spec.template.spec.containers[0].image = \"$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG\"" \
          #   -i deployment.yaml

          # 변경사항 커밋 및 푸시
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add .
          git commit -m "chore: update my-app image to $IMAGE_TAG"
          git push
```

> **핵심 포인트**: CI 파이프라인은 클러스터에 대한 접근 권한이 필요 없다.
> `kubectl`도, `kubeconfig`도 사용하지 않는다.
> CI가 하는 일은 이미지 빌드와 매니페스트 저장소 업데이트뿐이다.
> 실제 배포는 클러스터 안에서 동작하는 ArgoCD가 Pull 방식으로 수행한다.

### kustomize를 활용한 이미지 태그 관리

매니페스트 저장소에서 kustomize를 사용하면 이미지 태그 관리가 깔끔해진다:

```yaml
# apps/my-app/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
images:
  - name: 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app
    newTag: abc12345  # CI에서 이 부분만 업데이트
```

ArgoCD Application에서는 kustomize를 자동으로 감지한다. 별도 설정이 필요 없다.

### ArgoCD Image Updater (대안)

매니페스트 저장소를 CI에서 직접 업데이트하는 대신,
**ArgoCD Image Updater** 를 사용하면 ECR의 새 이미지 태그를 자동으로 감지해서 배포할 수도 있다.

```bash
# ArgoCD Image Updater 설치
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/stable/manifests/install.yaml
```

Application에 어노테이션을 추가한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  annotations:
    argocd-image-updater.argoproj.io/image-list: >
      my-app=123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app
    argocd-image-updater.argoproj.io/my-app.update-strategy: semver
    argocd-image-updater.argoproj.io/write-back-method: git
spec:
  # ... 나머지 설정
```

> Image Updater는 편리하지만, 매니페스트 저장소의 Git 커밋 히스토리가 자동 생성 커밋으로 채워진다는 단점이 있다.
> 팀 컨벤션에 맞는 방법을 선택하면 된다.

---

## 운영 팁

### Rollback 방법

ArgoCD에서 롤백하는 방법은 세 가지다:

**1. Git revert (권장)**

GitOps의 철학에 가장 부합하는 방법이다.
매니페스트 저장소에서 문제가 된 커밋을 revert하면 ArgoCD가 자동으로 이전 상태로 동기화한다.

```bash
cd k8s-manifests
git revert HEAD
git push
# ArgoCD가 자동으로 이전 상태로 배포
```

**2. ArgoCD CLI**

```bash
# 배포 히스토리 확인
argocd app history my-app

# 특정 리비전으로 롤백
argocd app rollback my-app <REVISION_NUMBER>
```

**3. ArgoCD UI**

대시보드에서 앱 클릭 -> History and Rollback -> 원하는 리비전 선택 -> Rollback 버튼 클릭.

> **주의**: CLI나 UI를 통한 롤백은 Git과 상태가 불일치하게 된다.
> Auto Sync가 켜져 있으면 곧 다시 최신 Git 상태로 동기화된다.
> 따라서 CLI/UI 롤백은 긴급 상황에서 임시로 사용하고,
> 근본적인 수정은 반드시 Git을 통해 진행해야 한다.

### Slack 알림 설정 (ArgoCD Notifications)

ArgoCD Notifications를 설정하면 배포 성공/실패를 Slack으로 받을 수 있다.

```yaml
# argocd-notifications-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  service.slack: |
    token: $slack-token

  template.app-sync-succeeded: |
    slack:
      attachments: |
        [{
          "color": "#18be52",
          "title": "{{ .app.metadata.name }} 배포 성공",
          "text": "리비전: {{ .app.status.sync.revision }}",
          "fields": [{
            "title": "환경",
            "value": "{{ .app.spec.destination.namespace }}",
            "short": true
          }]
        }]

  template.app-sync-failed: |
    slack:
      attachments: |
        [{
          "color": "#E96D76",
          "title": "{{ .app.metadata.name }} 배포 실패",
          "text": "동기화 중 오류가 발생했다. ArgoCD 대시보드를 확인하라.",
          "fields": [{
            "title": "환경",
            "value": "{{ .app.spec.destination.namespace }}",
            "short": true
          }]
        }]

  trigger.on-sync-succeeded: |
    - when: app.status.operationState.phase in ['Succeeded']
      send: [app-sync-succeeded]

  trigger.on-sync-failed: |
    - when: app.status.operationState.phase in ['Error', 'Failed']
      send: [app-sync-failed]
```

Slack 토큰을 Secret으로 저장한다:

```bash
kubectl -n argocd create secret generic argocd-notifications-secret \
  --from-literal=slack-token=xoxb-your-slack-bot-token
```

Application에 알림을 활성화한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  annotations:
    notifications.argoproj.io/subscribe.on-sync-succeeded.slack: "#deployments"
    notifications.argoproj.io/subscribe.on-sync-failed.slack: "#deployments"
```

### Health Check 커스터마이징

ArgoCD는 기본적으로 Kubernetes 리소스의 상태를 자동으로 판단한다.
하지만 CRD(Custom Resource Definition)를 사용하거나, 특수한 Health 기준이 필요한 경우 커스텀 Health Check를 설정할 수 있다.

`argocd-cm` ConfigMap에 Lua 스크립트로 정의한다:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  # 커스텀 Health Check 예시: Job이 Complete 상태일 때만 Healthy
  resource.customizations.health.batch_Job: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.succeeded ~= nil and obj.status.succeeded > 0 then
        hs.status = "Healthy"
        hs.message = "Job completed successfully"
      elseif obj.status.failed ~= nil and obj.status.failed > 0 then
        hs.status = "Degraded"
        hs.message = "Job failed"
      else
        hs.status = "Progressing"
        hs.message = "Job is running"
      end
    end
    return hs
```

### RBAC 설정 (프로젝트별 권한 분리)

팀이 커지면 모든 사람이 admin 권한을 갖는 것은 위험하다.
ArgoCD의 RBAC을 설정해서 프로젝트별로 권한을 분리할 수 있다.

먼저 ArgoCD Project를 생성한다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-frontend
  namespace: argocd
spec:
  description: "프론트엔드 팀 프로젝트"
  # 허용할 소스 저장소
  sourceRepos:
    - https://github.com/your-org/frontend-manifests.git
  # 허용할 배포 대상
  destinations:
    - namespace: frontend-*
      server: https://kubernetes.default.svc
  # 허용할 클러스터 리소스 종류
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  # 허용할 네임스페이스 리소스 종류
  namespaceResourceWhitelist:
    - group: apps
      kind: Deployment
    - group: ""
      kind: Service
    - group: networking.k8s.io
      kind: Ingress
```

`argocd-rbac-cm` ConfigMap에 역할별 정책을 설정한다:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  policy.csv: |
    # 프론트엔드 팀: team-frontend 프로젝트의 앱만 관리 가능
    p, role:frontend-team, applications, get, team-frontend/*, allow
    p, role:frontend-team, applications, sync, team-frontend/*, allow
    p, role:frontend-team, applications, override, team-frontend/*, allow
    p, role:frontend-team, logs, get, team-frontend/*, allow

    # 백엔드 팀: team-backend 프로젝트의 앱만 관리 가능
    p, role:backend-team, applications, get, team-backend/*, allow
    p, role:backend-team, applications, sync, team-backend/*, allow

    # 읽기 전용 역할: 모든 앱 조회만 가능
    p, role:readonly, applications, get, */*, allow
    p, role:readonly, logs, get, */*, allow

    # SSO 그룹과 역할 매핑
    g, frontend-devs, role:frontend-team
    g, backend-devs, role:backend-team
    g, viewers, role:readonly

  policy.default: role:readonly
```

> **팁**: `policy.default: role:readonly`로 설정하면, 명시적으로 역할이 할당되지 않은 사용자는
> 읽기 전용 권한만 갖게 된다. 보안 원칙상 기본 권한은 최소로 유지하는 것이 좋다.

---

## 마무리

이 글에서 다룬 내용을 정리하면 다음과 같다:

1. **GitOps 개념**: Git을 Single Source of Truth로 사용하는 운영 모델
2. **ArgoCD 설치**: Helm으로 EKS에 설치하고, ALB Ingress로 대시보드 외부 노출
3. **첫 번째 앱 배포**: Application CRD 작성, Sync 정책(Auto/Manual, Self-Heal, Prune) 이해
4. **Helm Chart 관리**: 환경별 values 파일 분리, ArgoCD에서 Helm 파라미터 지정
5. **App of Apps 패턴**: 상위 Application이 하위 Application들을 자동 관리
6. **ApplicationSet**: Generator를 활용한 멀티 환경 자동 구성
7. **CI/CD 파이프라인**: GitHub Actions에서 이미지 빌드 후 매니페스트 저장소만 업데이트, ArgoCD가 배포
8. **운영 팁**: Rollback, Slack 알림, Health Check, RBAC 설정

GitOps의 가장 큰 장점은 **클러스터에 직접 접근하지 않아도 배포가 가능하다** 는 점이다.
개발자는 Git에 코드를 push하기만 하면 되고,
운영자는 Git 히스토리만 보면 클러스터의 현재 상태를 정확히 알 수 있다.

[Part 1 (실무 레벨 EKS 클러스터 구축 가이드)](/blog/eks-production-setup-guide)에서 EKS 클러스터를 구축하고,
이 Part 2에서 ArgoCD 기반 GitOps 파이프라인을 설정했다면,
프로덕션 수준의 Kubernetes 운영 환경이 완성된 것이다.
