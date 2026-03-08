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

## 서론

[Part 1](/blog/kind-local-k8s-cluster-setup)에서 kind로 멀티 노드 클러스터를 구축하고,
Spring Boot 앱(marketplace)을 수동으로 배포했다.
이미지 빌드하고, `kind load`로 로드하고, Deployment YAML 작성해서 `kubectl apply` 하는 과정이었다.

동작은 하지만, 문제는 **매번 이 과정을 반복해야 한다**는 거다.
코드가 바뀔 때마다 이미지 태그 바꾸고, YAML 수정하고, `kubectl apply` 다시 치는 건 비효율적이다.
실수도 나기 쉽다 -- 태그를 안 바꾸거나, 잘못된 환경에 배포하거나.

이번 편에서는 ArgoCD를 설치해서 **Git push만 하면 자동으로 배포되는 GitOps 파이프라인**을 만든다.
배포 설정을 Git 저장소에 선언적으로 관리하고,
ArgoCD가 이 저장소를 감시하다가 변경이 생기면 자동으로 클러스터에 반영하는 구조다.

> 이 글은 **로컬 K8s 실습** 시리즈의 두 번째 글이다.
> - **Part 1**: [kind로 로컬 K8s 클러스터 구축하기](/blog/kind-local-k8s-cluster-setup)
> - **이 글**: ArgoCD로 GitOps 배포 파이프라인 만들기
> - **Part 3**: Loki + Grafana로 로그 모니터링 구성하기

---

## GitOps란

GitOps는 간단하다.
**Git 저장소가 배포의 Single Source of Truth(유일한 진실 공급원)**라는 개념이다.

기존 배포 방식과 비교하면 차이가 명확하다:

| 구분 | 기존 방식 | GitOps |
|------|----------|--------|
| 배포 트리거 | 사람이 `kubectl apply` 실행 | Git push → 자동 감지 |
| 상태 관리 | 클러스터에 직접 적용. 어디에도 기록 안 됨 | Git에 모든 상태가 선언적으로 기록됨 |
| 롤백 | 이전 YAML을 기억해야 함 | `git revert`하면 끝 |
| 감사(audit) | 누가 언제 뭘 바꿨는지 알 수 없음 | Git 커밋 히스토리로 전부 추적 가능 |

핵심 원칙은 세 가지다:

1. **선언적 정의**: 클러스터의 원하는 상태를 YAML로 선언한다
2. **Git = 진실**: Git에 있는 상태가 곧 클러스터의 바람직한 상태다
3. **자동 동기화**: Git과 클러스터 상태가 다르면 자동으로 맞춘다

ArgoCD는 이 GitOps 원칙을 구현하는 도구다.
Git 저장소를 주기적으로 폴링하면서 변경 사항이 있으면 클러스터에 자동으로 반영한다.
Flux도 비슷한 도구인데, ArgoCD는 웹 UI가 직관적이라 상태를 눈으로 확인하기 좋다.

---

## ArgoCD 설치

Helm으로 설치한다.
`kubectl apply`로 설치하는 방법도 있지만, Helm이 업그레이드/삭제 관리가 편하다.

### Helm 차트 추가

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
```

### ArgoCD 설치

```bash
helm install argocd argo/argo-cd -n argocd --create-namespace
```

`--create-namespace` 플래그가 `argocd` 네임스페이스를 자동으로 만들어준다.

설치가 끝나면 Pod 상태를 확인한다:

```bash
kubectl get pods -n argocd
```

```
NAME                                                READY   STATUS    RESTARTS   AGE
argocd-application-controller-0                     1/1     Running   0          60s
argocd-applicationset-controller-xxxxxxxxxx-xxxxx   1/1     Running   0          60s
argocd-dex-server-xxxxxxxxxx-xxxxx                  1/1     Running   0          60s
argocd-notifications-controller-xxxxxxxxxx-xxxxx    1/1     Running   0          60s
argocd-redis-xxxxxxxxxx-xxxxx                       1/1     Running   0          60s
argocd-repo-server-xxxxxxxxxx-xxxxx                 1/1     Running   0          60s
argocd-server-xxxxxxxxxx-xxxxx                      1/1     Running   0          60s
```

7개 Pod가 모두 `Running` 상태면 정상이다.
각 컴포넌트의 역할을 간단히 정리하면:

| 컴포넌트 | 역할 |
|----------|------|
| **application-controller** | Git과 클러스터 상태를 비교하고 동기화하는 핵심 컴포넌트 |
| **repo-server** | Git 저장소를 clone/pull하고, Helm/Kustomize 등을 렌더링 |
| **server** | 웹 UI와 API 서버 |
| **dex-server** | SSO 인증 (GitHub, LDAP 등 외부 인증 연동) |
| **redis** | 캐싱용 Redis |
| **notifications-controller** | Slack, 이메일 등 알림 관리 |
| **applicationset-controller** | ApplicationSet (여러 앱을 템플릿으로 관리) |

### 웹 UI 접속

ArgoCD 서버에 접속하려면 포트 포워딩이 필요하다:

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

이제 브라우저에서 [https://localhost:8080](https://localhost:8080)으로 접속할 수 있다.
자체 서명 인증서라 브라우저 경고가 뜨는데, 무시하고 진행하면 된다.

### 초기 비밀번호 확인

ArgoCD는 설치 시 admin 계정의 초기 비밀번호를 Secret에 저장한다.
다음 명령으로 확인할 수 있다:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
```

출력된 문자열이 비밀번호다.
로그인 정보:

- **Username**: `admin`
- **Password**: 위 명령으로 확인한 문자열

로그인하면 ArgoCD 대시보드가 나온다.
아직 Application을 등록하지 않았으니 빈 화면일 거다.

> **팁**: 비밀번호를 변경하고 싶다면 ArgoCD CLI를 설치해서 `argocd account update-password` 명령을 사용할 수 있다.
> 하지만 로컬 실습에서는 초기 비밀번호 그대로 써도 충분하다.

---

## marketplace-deploy 프로젝트 구성

GitOps에서 중요한 패턴 하나가 **앱 코드 저장소와 배포 설정 저장소를 분리**하는 거다.

```
marketplace/              ← 앱 소스 코드 (Spring Boot)
marketplace-deploy/       ← 배포 설정 (Helm chart, values)
```

왜 분리할까?

- **관심사 분리**: 개발자는 앱 코드에 집중, 배포 설정은 별도 관리
- **배포 이력 분리**: 앱 코드 커밋과 배포 설정 변경 커밋이 섞이지 않는다
- **권한 분리**: 프로덕션에서는 배포 설정 저장소에 대한 접근 권한을 별도로 관리할 수 있다
- **ArgoCD 감시 대상이 명확**: 배포 저장소만 감시하면 된다. 앱 코드 변경은 CI에서 이미지 빌드 후 배포 저장소의 태그만 업데이트

### 프로젝트 구조

marketplace-deploy 저장소(https://github.com/rhcwlq89/marketplace-deploy.git)의 구조는 다음과 같다:

```
marketplace-deploy/
└── helm/
    └── marketplace/
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
            ├── deployment.yaml
            ├── service.yaml
            └── ingress.yaml
```

Helm 차트 하나로 Deployment, Service, Ingress를 모두 관리하는 구조다.
각 파일을 하나씩 살펴보자.

### Chart.yaml

```yaml
apiVersion: v2
name: marketplace
description: Marketplace Spring Boot application
type: application
version: 0.1.0
appVersion: "v1"
```

| 필드 | 설명 |
|------|------|
| `apiVersion: v2` | Helm 3 차트 형식 |
| `name` | 차트 이름. 리소스 이름에 사용된다 |
| `type: application` | 배포용 차트. `library` 타입은 공통 템플릿용 |
| `version` | 차트 자체의 버전 |
| `appVersion` | 배포하는 앱의 버전. 이미지 태그와 맞추면 관리하기 편하다 |

### values.yaml

```yaml
replicaCount: 2

image:
  repository: marketplace
  tag: v2
  pullPolicy: Never  # kind load로 직접 로드했으므로

service:
  type: ClusterIP
  port: 8080

ingress:
  enabled: true
  host: marketplace.local

resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi

env:
  SPRING_PROFILES_ACTIVE: local
```

각 값의 의미를 정리하면:

| 값 | 설명 |
|----|------|
| `replicaCount: 2` | Pod 2개를 띄운다. 워커 노드가 2개니까 각각 하나씩 배포된다 |
| `image.pullPolicy: Never` | `kind load`로 로드한 이미지를 사용하므로 레지스트리에서 Pull하지 않는다 |
| `service.type: ClusterIP` | 클러스터 내부에서만 접근. Ingress를 통해 외부에 노출한다 |
| `resources.requests` | Pod 스케줄링 시 최소 보장 리소스. 스케줄러가 이 값을 보고 노드를 선택한다 |
| `resources.limits` | Pod가 사용할 수 있는 최대 리소스. 초과하면 OOMKilled(메모리) 또는 throttle(CPU) |
| `env` | Spring Boot 프로필을 `local`로 설정한다 |

`requests`와 `limits`의 차이가 중요하다.
`requests`는 "최소 이만큼은 필요하다"이고, `limits`는 "이 이상은 쓸 수 없다"이다.
`requests`만 설정하면 리소스를 무제한으로 쓸 수 있고,
`limits`만 설정하면 `requests`가 `limits`와 같은 값으로 자동 설정된다.
둘 다 설정하는 게 가장 안전하다.

### deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Chart.Name }}
  labels:
    app: {{ .Chart.Name }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .Chart.Name }}
  template:
    metadata:
      labels:
        app: {{ .Chart.Name }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: 8080
          env:
            {{- range $key, $value := .Values.env }}
            - name: {{ $key }}
              value: "{{ $value }}"
            {{- end }}
          resources:
            requests:
              cpu: {{ .Values.resources.requests.cpu }}
              memory: {{ .Values.resources.requests.memory }}
            limits:
              cpu: {{ .Values.resources.limits.cpu }}
              memory: {{ .Values.resources.limits.memory }}
          readinessProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 30
```

Helm 템플릿 문법(`{{ }}`)으로 values.yaml의 값을 주입하는 구조다.
`{{ .Chart.Name }}`은 Chart.yaml의 `name` 필드(marketplace)가 들어간다.

몇 가지 중요한 부분을 짚고 넘어가자:

**readinessProbe와 livenessProbe**

| Probe | 역할 | 실패 시 동작 |
|-------|------|-------------|
| `readinessProbe` | Pod가 트래픽을 받을 준비가 됐는지 확인 | Service 엔드포인트에서 제거 (트래픽 차단) |
| `livenessProbe` | Pod가 살아있는지 확인 | Pod 재시작 |

Spring Boot Actuator의 `/actuator/health` 엔드포인트를 사용한다.
`initialDelaySeconds`가 readiness는 30초, liveness는 60초로 다른 이유가 있다.
Spring Boot 앱은 기동에 시간이 좀 걸린다.
liveness를 너무 일찍 체크하면 앱이 아직 뜨는 중인데 "죽었다"고 판단해서 재시작시키는 악순환이 생긴다.
그래서 liveness의 초기 지연을 더 길게 잡는 거다.

**env 순회 문법**

```yaml
{{- range $key, $value := .Values.env }}
- name: {{ $key }}
  value: "{{ $value }}"
{{- end }}
```

values.yaml의 `env` 맵을 순회하면서 환경 변수를 주입한다.
나중에 환경 변수를 추가하고 싶으면 values.yaml의 `env` 섹션에 키-값을 추가하기만 하면 된다.
템플릿을 수정할 필요가 없어서 관리가 편하다.

### service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Chart.Name }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: 8080
      protocol: TCP
  selector:
    app: {{ .Chart.Name }}
```

Service는 Pod 앞에 놓이는 로드밸런서다.
`selector`가 `app: marketplace` 라벨을 가진 Pod들을 찾아서 트래픽을 분배한다.
`ClusterIP` 타입이므로 클러스터 내부에서만 접근 가능하다.
외부 접근은 Ingress가 담당한다.

### ingress.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Chart.Name }}
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: {{ .Values.ingress.host }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ .Chart.Name }}
                port:
                  number: {{ .Values.service.port }}
```

`marketplace.local` 호스트로 들어오는 요청을 marketplace Service로 라우팅한다.
Part 1에서 설치한 Nginx Ingress Controller가 이 Ingress 규칙을 읽고 실제 라우팅을 수행한다.

로컬에서 `marketplace.local`로 접근하려면 `/etc/hosts`에 다음을 추가해야 한다:

```
127.0.0.1 marketplace.local
```

---

## ArgoCD Application 등록

이제 ArgoCD에게 "이 Git 저장소를 감시하고, 변경이 생기면 클러스터에 반영해라"고 알려줄 차례다.
이걸 Application 리소스로 정의한다.

### Application YAML 작성

`argocd-application.yaml` 파일을 만든다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: marketplace
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/rhcwlq89/marketplace-deploy.git
    targetRevision: HEAD
    path: helm/marketplace
    helm:
      valueFiles:
        - values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      selfHeal: true
      prune: true
```

이 YAML 하나가 GitOps 파이프라인의 핵심이다.
각 필드의 의미를 자세히 살펴보자:

**source 섹션**

| 필드 | 설명 |
|------|------|
| `repoURL` | 감시할 Git 저장소 URL |
| `targetRevision: HEAD` | 항상 최신 커밋을 추적한다. 특정 브랜치나 태그를 지정할 수도 있다 |
| `path` | 저장소 내에서 Helm 차트가 위치한 경로 |
| `helm.valueFiles` | 사용할 values 파일. 환경별로 분리하면 `values-dev.yaml`, `values-prod.yaml` 등을 사용할 수 있다 |

**destination 섹션**

| 필드 | 설명 |
|------|------|
| `server` | 배포 대상 클러스터. `https://kubernetes.default.svc`는 ArgoCD가 설치된 같은 클러스터를 의미 |
| `namespace` | 리소스를 배포할 네임스페이스 |

**syncPolicy 섹션**

이 부분이 자동화의 핵심이다:

| 옵션 | 설명 |
|------|------|
| `automated` | Git 변경 감지 시 자동으로 동기화한다. 이 옵션이 없으면 수동으로 Sync 버튼을 눌러야 한다 |
| `selfHeal: true` | 누군가 `kubectl`로 직접 클러스터를 변경해도 Git 상태로 되돌린다. "Git이 진실"이라는 원칙을 강제하는 옵션 |
| `prune: true` | Git에서 리소스를 삭제하면 클러스터에서도 삭제한다. 이 옵션이 없으면 Git에서 파일을 지워도 클러스터에 리소스가 남는다 |

`selfHeal`이 왜 중요할까?
실무에서는 "급하니까 `kubectl edit`으로 잠깐만 바꿀게"라고 하는 경우가 생긴다.
이렇게 하면 Git과 클러스터 상태가 어긋나는 **드리프트(drift)**가 발생한다.
`selfHeal`이 켜져 있으면 ArgoCD가 이런 수동 변경을 감지하고 Git 상태로 되돌려버린다.
처음에는 불편할 수 있지만, 장기적으로 환경의 일관성을 보장하는 강력한 장치다.

### Application 등록

```bash
kubectl apply -f argocd-application.yaml
```

```
application.argoproj.io/marketplace created
```

등록 후 상태를 확인한다:

```bash
kubectl get applications -n argocd
```

```
NAME          SYNC STATUS   HEALTH STATUS
marketplace   Synced        Healthy
```

`Synced` + `Healthy`면 Git 저장소의 상태가 클러스터에 정상적으로 반영된 거다.

ArgoCD 웹 UI([https://localhost:8080](https://localhost:8080))에서 확인하면 더 직관적이다.
marketplace Application 카드가 초록색으로 표시되고,
클릭하면 Deployment, Service, Ingress, Pod 등 모든 리소스의 관계도가 트리 형태로 보인다.

---

## GitOps 파이프라인 동작 확인

실제로 Git push만으로 배포가 되는지 확인해보자.

### 이미지 태그 변경

marketplace-deploy 저장소에서 `values.yaml`의 이미지 태그를 변경한다:

```yaml
image:
  repository: marketplace
  tag: v3    # 기존 v2에서 v3으로 변경
  pullPolicy: Never
```

> **전제**: 새 이미지(`marketplace:v3`)는 미리 빌드해서 `kind load`로 로드해 둬야 한다.
> CI가 자동화되어 있지 않은 로컬 환경에서는 이 부분은 수동이다.
>
> ```bash
> docker build -t marketplace:v3 .
> kind load docker-image marketplace:v3 --name marketplace
> ```

### Git push

```bash
cd marketplace-deploy
git add helm/marketplace/values.yaml
git commit -m "chore: update image tag to v3"
git push origin main
```

### ArgoCD 자동 동기화 확인

ArgoCD는 기본적으로 **3분 간격**으로 Git 저장소를 폴링한다.
변경을 감지하면 자동으로 Sync를 수행한다.

> **팁**: 3분을 기다리기 싫다면 웹 UI에서 `Refresh` 버튼을 누르거나,
> ArgoCD CLI로 `argocd app sync marketplace`를 실행하면 즉시 동기화된다.

동기화가 완료되면 Pod가 새로 뜨는 걸 확인할 수 있다:

```bash
kubectl get pods -w
```

```
NAME                           READY   STATUS              RESTARTS   AGE
marketplace-xxxxxxxxxx-aaaaa   1/1     Running             0          5h
marketplace-xxxxxxxxxx-bbbbb   1/1     Running             0          5h
marketplace-xxxxxxxxxx-ccccc   0/1     ContainerCreating   0          5s
marketplace-xxxxxxxxxx-ddddd   0/1     ContainerCreating   0          5s
marketplace-xxxxxxxxxx-ccccc   1/1     Running             0          35s
marketplace-xxxxxxxxxx-ddddd   1/1     Running             0          35s
marketplace-xxxxxxxxxx-aaaaa   1/1     Terminating         0          5h
marketplace-xxxxxxxxxx-bbbbb   1/1     Terminating         0          5h
```

Kubernetes의 **Rolling Update** 전략에 의해,
새 Pod가 먼저 뜨고(`ContainerCreating` → `Running`),
이전 Pod가 종료되는(`Terminating`) 과정이 보인다.
서비스 중단 없이 업데이트가 진행되는 거다.

배포된 이미지 태그를 확인한다:

```bash
kubectl get deployment marketplace -o jsonpath="{.spec.template.spec.containers[0].image}"
```

```
marketplace:v3
```

v3 이미지로 정상 교체된 걸 확인할 수 있다.

### 전체 흐름 정리

GitOps 파이프라인의 전체 흐름을 정리하면:

```
개발자: values.yaml에서 image.tag를 v3으로 수정
  ↓
개발자: git commit & push
  ↓
ArgoCD: Git 저장소 폴링 → 변경 감지
  ↓
ArgoCD: Helm 차트 렌더링 (values.yaml 반영)
  ↓
ArgoCD: 렌더링 결과와 클러스터 현재 상태 비교 (diff)
  ↓
ArgoCD: 차이가 있으면 kubectl apply 수행
  ↓
Kubernetes: Rolling Update로 Pod 교체
  ↓
결과: 새 이미지로 서비스 운영 중 (무중단)
```

개발자가 하는 일은 **values.yaml 수정 → push** 딱 두 단계다.
나머지는 ArgoCD가 전부 자동으로 처리한다.

---

### selfHeal 동작 확인

`selfHeal: true`가 실제로 어떻게 동작하는지도 확인해보자.

수동으로 replica 수를 변경한다:

```bash
kubectl scale deployment marketplace --replicas=1
```

잠시 후 다시 확인하면:

```bash
kubectl get pods
```

```
NAME                           READY   STATUS    RESTARTS   AGE
marketplace-xxxxxxxxxx-aaaaa   1/1     Running   0          2m
marketplace-xxxxxxxxxx-bbbbb   1/1     Running   0          15s
```

ArgoCD가 "Git에는 `replicaCount: 2`로 되어있는데 클러스터는 1개네?"라고 감지하고,
자동으로 다시 2개로 복원한 거다.

이게 selfHeal의 힘이다.
운영 중에 누군가 실수로 설정을 바꿔도 Git 상태로 자동 복원된다.
"Git이 진실"이라는 원칙이 기술적으로 강제되는 셈이다.

---

## 정리

이 글에서 다룬 내용을 정리한다:

| 단계 | 내용 |
|------|------|
| GitOps 개념 | Git = Single Source of Truth. 선언적 상태 관리 |
| ArgoCD 설치 | Helm으로 설치, 웹 UI 접속, 초기 비밀번호 확인 |
| 배포 저장소 구성 | marketplace-deploy 프로젝트에 Helm 차트 작성 |
| Application 등록 | ArgoCD에 Git 저장소 연결, 자동 동기화 설정 |
| 동작 확인 | values.yaml 변경 → push → 자동 배포 확인 |

현재 구성의 CI/CD 상태를 정리하면:

```
CI (빌드):  수동 — docker build → kind load
CD (배포):  자동 — ArgoCD가 Git 변경 감지 → 자동 동기화
```

CI 부분이 아직 수동이다.
프로덕션 환경에서는 GitHub Actions 같은 CI 도구로 이 부분도 자동화한다.
코드 push → 이미지 빌드 → 레지스트리 push → 배포 저장소의 태그 업데이트까지 전부 자동으로 돌아가는 구조다.

하지만 로컬 실습에서는 이 정도면 충분하다.
핵심 개념인 "Git push → 자동 배포"를 직접 체험하는 게 목적이니까.

다음 편에서는 이 클러스터에 **Loki + Grafana**를 설치해서
Pod 로그를 수집하고 시각화하는 모니터링 환경을 구성한다.
배포까지는 자동화했으니, 이제 "배포된 앱이 잘 돌아가고 있는지" 확인할 차례다.
