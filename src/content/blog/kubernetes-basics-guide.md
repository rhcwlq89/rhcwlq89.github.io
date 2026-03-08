---
title: "Kubernetes 기본 개념 총정리"
description: "쿠버네티스 아키텍처부터 핵심 오브젝트, 네트워킹, 배포 전략까지 실무에 필요한 기본 개념을 정리한 가이드"
pubDate: 2026-03-07T09:00:00+09:00
tags:
  [
    "Kubernetes",
    "DevOps",
    "Container",
    "Infrastructure",
  ]
heroImage: "../../assets/KubernetesBasicsGuide.png"
---

## 서론

Kubernetes(쿠버네티스, 줄여서 K8s)는 컨테이너 오케스트레이션 도구다.
Docker로 컨테이너를 만드는 건 알겠는데, 컨테이너가 수십, 수백 개로 늘어나면 어떻게 관리할까?

컨테이너가 많아지면 수동 관리의 한계가 드러난다:

- 어떤 서버에 컨테이너를 배치할지 일일이 결정해야 한다
- 컨테이너가 죽으면 수동으로 재시작해야 한다
- 트래픽이 몰리면 수동으로 컨테이너를 늘려야 한다
- 새 버전을 배포할 때 하나씩 교체해야 한다

Kubernetes는 이 문제를 자동으로 해결한다:

- **자동 스케줄링**: 리소스 상황에 맞춰 컨테이너를 적절한 노드에 배치한다
- **셀프힐링**: 컨테이너가 죽으면 자동으로 재시작한다
- **오토스케일링**: 부하에 따라 컨테이너 수를 자동으로 조절한다
- **로드밸런싱**: 트래픽을 여러 컨테이너에 분산한다
- **롤링 업데이트**: 무중단으로 새 버전을 배포한다

이 글의 목적은 EKS + ArgoCD 시리즈를 읽기 전에 필요한 Kubernetes 기본 개념을 정리하는 것이다.
Docker 기본은 알지만 K8s 경험이 적은 개발자를 대상으로 한다.

> 이 글은 시리즈의 **기본 개념 편**이다.
> - **이 글**: Kubernetes 기본 개념 총정리
> - **Part 1**: EKS 클러스터 구축 실무 가이드
> - **Part 2**: ArgoCD를 활용한 GitOps 기반 배포 파이프라인 (예정)
>
> 로컬에서 직접 실습해보고 싶다면 **로컬 K8s 실습 시리즈**도 참고하자:
> - kind로 로컬 K8s 클러스터 구축하기
> - ArgoCD로 GitOps 배포 파이프라인 만들기
> - Loki + Grafana로 로그 모니터링 구성하기

---

## 클러스터란

**클러스터(Cluster)** 는 Kubernetes가 관리하는 서버(머신)들의 묶음이다.

단어 자체가 "군집"이라는 뜻인데, 여러 대의 서버를 하나의 시스템처럼 묶어서 사용하는 개념이다. 개발자가 "이 컨테이너를 실행해줘"라고 요청하면, 클러스터가 알아서 적절한 서버에 배치하고 관리한다. 개발자는 개별 서버를 신경 쓸 필요가 없다.

클러스터를 구성하는 서버 각각을 **노드(Node)** 라고 부르고, 노드는 역할에 따라 두 종류로 나뉜다:

| 노드 종류 | 역할 | 비유 |
|-----------|------|------|
| **컨트롤 플레인 노드** | 클러스터 전체를 관리하고 명령을 내린다 | 관제탑 |
| **워커 노드** | 실제 애플리케이션(컨테이너)을 실행한다 | 활주로의 비행기 |

프로덕션 환경에서는 보통 컨트롤 플레인 3대 + 워커 노드 여러 대로 구성하고, 로컬 실습(kind, minikube 등)에서는 1~3대 정도로 간단하게 구성한다.

---

## 아키텍처

클러스터의 내부를 좀 더 자세히 들여다보자. 크게 **컨트롤 플레인**(Control Plane)과 **워커 노드**(Worker Node)로 구성된다.

### 컨트롤 플레인

클러스터의 두뇌 역할을 한다. 전체 클러스터의 상태를 관리하고 의사결정을 내린다.

| 구성 요소 | 역할 |
|-----------|------|
| **API Server** | 모든 요청의 진입점. kubectl 명령어, 내부 컴포넌트 간 통신 모두 API Server를 거친다 |
| **etcd** | 클러스터의 모든 상태 데이터를 저장하는 키-값 저장소. 클러스터의 "데이터베이스"다 |
| **Scheduler** | 새로 생성된 Pod를 어떤 노드에 배치할지 결정한다. 리소스 상황, 제약 조건 등을 고려한다 |
| **Controller Manager** | 원하는 상태(desired state)와 현재 상태(current state)를 지속적으로 비교하고 맞추는 역할을 한다 |

### 워커 노드

실제로 컨테이너가 실행되는 서버다. 각 워커 노드에는 다음 컴포넌트가 실행된다.

| 구성 요소 | 역할 |
|-----------|------|
| **kubelet** | 노드에서 Pod의 실행을 관리하는 에이전트. API Server의 지시를 받아 컨테이너를 생성/삭제한다 |
| **kube-proxy** | 네트워크 라우팅을 담당한다. Service로 들어오는 트래픽을 적절한 Pod로 전달한다 |
| **Container Runtime** | 실제 컨테이너를 실행하는 런타임. containerd, CRI-O 등이 있다 |

### 전체 구조도

```
┌─────────────────────────────────────────────────────────┐
│                   Control Plane                         │
│                                                         │
│  ┌────────────┐  ┌────────┐  ┌───────────┐  ┌────────┐ │
│  │ API Server │  │  etcd  │  │ Scheduler │  │Controller│ │
│  │            │  │        │  │           │  │ Manager │ │
│  └─────┬──────┘  └────────┘  └───────────┘  └────────┘ │
└────────┼────────────────────────────────────────────────┘
         │
         │  kubectl, API 요청
         │
┌────────┼────────────────────────────────────────────────┐
│        ▼         Worker Node 1                          │
│  ┌─────────┐  ┌────────────┐  ┌───────────────────┐    │
│  │ kubelet │  │ kube-proxy │  │ Container Runtime │    │
│  └────┬────┘  └────────────┘  └───────────────────┘    │
│       │                                                 │
│  ┌────▼────┐  ┌─────────┐  ┌─────────┐                │
│  │  Pod A  │  │  Pod B  │  │  Pod C  │                │
│  └─────────┘  └─────────┘  └─────────┘                │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│                  Worker Node 2                          │
│  ┌─────────┐  ┌────────────┐  ┌───────────────────┐    │
│  │ kubelet │  │ kube-proxy │  │ Container Runtime │    │
│  └────┬────┘  └────────────┘  └───────────────────┘    │
│       │                                                 │
│  ┌────▼────┐  ┌─────────┐                              │
│  │  Pod D  │  │  Pod E  │                              │
│  └─────────┘  └─────────┘                              │
└─────────────────────────────────────────────────────────┘
```

핵심 동작 흐름을 예로 들면:

1. 사용자가 `kubectl apply -f deployment.yaml` 실행
2. **API Server**가 요청을 받고 etcd에 저장
3. **Controller Manager**가 "Deployment에 Pod 3개가 필요한데 지금 0개다"를 감지
4. **Scheduler**가 각 Pod를 어떤 노드에 배치할지 결정
5. 해당 노드의 **kubelet**이 컨테이너를 실행

---

## 핵심 오브젝트

Kubernetes에서 관리하는 리소스를 "오브젝트"라고 부른다.
가장 중요한 오브젝트들을 하나씩 살펴보자.

### Pod

Pod는 Kubernetes에서 가장 작은 배포 단위다.
하나의 Pod에는 1개 이상의 컨테이너가 포함된다.
같은 Pod 내의 컨테이너는 네트워크와 스토리지를 공유한다.

```yaml
apiVersion: v1            # Core API 그룹
kind: Pod                 # 리소스 종류: Pod
metadata:
  name: my-app            # Pod 이름 (클러스터 내에서 유일해야 함)
  labels:
    app: my-app           # Service가 이 Pod를 찾을 때 사용하는 라벨
spec:
  containers:
    - name: app           # 컨테이너 이름
      image: nginx:1.27   # 사용할 이미지:태그
      ports:
        - containerPort: 80   # 컨테이너가 리슨하는 포트
      resources:
        requests:             # 최소 보장 리소스 (스케줄링 기준)
          memory: "64Mi"      # 메모리 64MiB 요청
          cpu: "250m"         # CPU 0.25코어 요청
        limits:               # 최대 사용 가능 리소스 (초과 시 제한/종료)
          memory: "128Mi"     # 메모리 128MiB 제한
          cpu: "500m"         # CPU 0.5코어 제한
```

> 실무에서는 Pod를 직접 생성하는 일은 거의 없다.
> Deployment를 통해 Pod를 관리하는 것이 일반적이다.

### ReplicaSet

ReplicaSet은 지정된 수의 Pod 복제본(replica)을 항상 유지하는 역할을 한다.
Pod가 삭제되거나 장애가 발생하면 자동으로 새 Pod를 생성한다.

```yaml
apiVersion: apps/v1          # apps 그룹의 v1 API
kind: ReplicaSet             # 리소스 종류: ReplicaSet
metadata:
  name: my-app-rs            # ReplicaSet 이름
spec:
  replicas: 3                # 유지할 Pod 복제본 수
  selector:
    matchLabels:
      app: my-app            # 이 라벨을 가진 Pod를 관리 대상으로 선택
  template:                  # 생성할 Pod의 템플릿
    metadata:
      labels:
        app: my-app          # Pod에 부여할 라벨 (selector와 일치해야 함)
    spec:
      containers:
        - name: app
          image: nginx:1.27
          ports:
            - containerPort: 80
```

> ReplicaSet도 직접 만들 일은 거의 없다.
> Deployment가 ReplicaSet을 자동으로 관리하기 때문이다.

### Deployment

Deployment는 실무에서 가장 많이 사용하는 오브젝트다.
ReplicaSet을 관리하면서 롤링 업데이트와 롤백 기능을 제공한다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 3                    # Pod 3개 유지
  selector:
    matchLabels:
      app: my-app                # 관리할 Pod 선택 기준
  template:                      # Pod 템플릿 시작
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:1.0.0    # 배포할 이미지
          ports:
            - containerPort: 8080
          env:
            - name: NODE_ENV
              value: "production"  # 환경변수 주입
          resources:
            requests:              # 최소 보장 리소스
              memory: "128Mi"
              cpu: "250m"
            limits:                # 최대 허용 리소스
              memory: "256Mi"
              cpu: "500m"
  strategy:
    type: RollingUpdate            # 배포 전략: 롤링 업데이트
    rollingUpdate:
      maxSurge: 1                  # 동시에 1개까지 추가 생성 가능
      maxUnavailable: 0            # 항상 replicas 수 유지 (무중단)
```

### 오브젝트 간 관계

Deployment, ReplicaSet, Pod는 계층 구조를 이룬다:

```
Deployment (my-app)
  └── ReplicaSet (my-app-7d9f8b6c4d)
        ├── Pod (my-app-7d9f8b6c4d-abc12)
        ├── Pod (my-app-7d9f8b6c4d-def34)
        └── Pod (my-app-7d9f8b6c4d-ghi56)
```

- **Deployment**가 ReplicaSet을 생성하고 관리한다
- **ReplicaSet**이 Pod의 복제본 수를 유지한다
- **Pod**가 실제 컨테이너를 실행한다

이미지 버전을 변경하면 Deployment가 새 ReplicaSet을 만들고,
새 Pod를 하나씩 생성하면서 이전 Pod를 제거한다(롤링 업데이트).

### Namespace

Namespace는 하나의 클러스터를 논리적으로 분리하는 방법이다.
팀별, 환경별로 리소스를 격리할 수 있다.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
---
apiVersion: v1
kind: Namespace
metadata:
  name: staging
---
apiVersion: v1
kind: Namespace
metadata:
  name: development
```

```bash
# 특정 네임스페이스에 리소스 배포
kubectl apply -f deployment.yaml -n production

# 네임스페이스별 Pod 조회
kubectl get pods -n production
kubectl get pods -n staging

# 모든 네임스페이스의 Pod 조회
kubectl get pods --all-namespaces
```

Kubernetes는 기본적으로 다음 네임스페이스를 제공한다:

| 네임스페이스 | 용도 |
|-------------|------|
| `default` | 네임스페이스를 지정하지 않으면 사용되는 기본 공간 |
| `kube-system` | Kubernetes 시스템 컴포넌트가 실행되는 공간 |
| `kube-public` | 모든 사용자가 읽을 수 있는 공간 |
| `kube-node-lease` | 노드 하트비트 관련 리소스가 위치하는 공간 |

### ConfigMap

ConfigMap은 설정값을 코드와 분리해서 관리하는 오브젝트다.
환경변수, 설정 파일 등을 외부화할 수 있다.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config          # ConfigMap 이름 (Pod에서 참조할 때 사용)
data:
  DATABASE_HOST: "db.example.com"   # 단순 키-값 (환경변수로 주입 가능)
  DATABASE_PORT: "5432"
  LOG_LEVEL: "info"
  config.yaml: |            # 파일 형태의 설정 (볼륨 마운트로 사용)
    server:
      port: 8080
      timeout: 30s
    cache:
      ttl: 300
```

Pod에서 ConfigMap을 사용하는 방법:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: my-app:1.0.0
      # 환경변수로 주입
      envFrom:
        - configMapRef:
            name: app-config
      # 파일로 마운트
      volumeMounts:
        - name: config-volume
          mountPath: /etc/config
  volumes:
    - name: config-volume
      configMap:
        name: app-config
        items:
          - key: config.yaml
            path: config.yaml
```

### Secret

Secret은 비밀번호, API 키 같은 민감한 정보를 관리하는 오브젝트다.
ConfigMap과 유사하지만 데이터가 base64로 인코딩되어 저장된다.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secret
type: Opaque              # 범용 시크릿 타입 (사용자 정의 데이터)
data:
  # base64 인코딩된 값 (암호화가 아님, 단순 인코딩)
  # echo -n 'my-password' | base64 → bXktcGFzc3dvcmQ=
  DATABASE_PASSWORD: bXktcGFzc3dvcmQ=   # 디코딩하면 'my-password'
  API_KEY: c2VjcmV0LWFwaS1rZXk=         # 디코딩하면 'secret-api-key'
```

Pod에서 Secret을 사용하는 방법:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: my-app:1.0.0
      env:
        - name: DATABASE_PASSWORD   # 컨테이너 내에서 사용할 환경변수 이름
          valueFrom:
            secretKeyRef:
              name: app-secret       # 참조할 Secret 이름
              key: DATABASE_PASSWORD  # Secret의 data에서 가져올 키
```

> **주의**: base64는 인코딩이지 암호화가 아니다.
> 프로덕션 환경에서는 AWS Secrets Manager나 HashiCorp Vault 같은
> 외부 시크릿 관리 도구와 연동하는 것을 권장한다.

---

## 컨테이너 이미지와 레지스트리

### 쿠버네티스에 내장 레지스트리가 있을까?

결론부터 말하면, **없다.**

쿠버네티스는 이미지를 **저장**하는 역할을 하지 않는다. 외부 레지스트리에서 이미지를 **pull해서 실행**하는 역할만 한다.

실무에서는 외부 레지스트리를 연결해서 사용한다:

| 레지스트리 | 무료 플랜 | 유료 | 특징 |
|-----------|----------|------|------|
| **Docker Hub** | 공개 이미지 무제한, 비공개 1개 | $5/월~ | 가장 대중적. 무료 플랜은 pull rate limit 있음 (100회/6시간) |
| **GitHub Container Registry** (ghcr.io) | 공개 무제한, 비공개 500MB | GitHub 플랜에 포함 | GitHub Actions와 연동이 편리. GitHub 계정이 있으면 바로 사용 |
| **AWS ECR** | 프리티어 500MB/12개월 | 사용량 기반 | AWS 환경이면 사실상 표준. EKS와 IAM 연동이 자연스러움 |
| **GCP Artifact Registry** | 프리티어 500MB | 사용량 기반 | GKE 환경에서 주로 사용 |
| **Harbor** | 오픈소스 (무료) | - | 자체 서버에 설치. 온프레미스 환경에서 주로 사용 |
| **Nexus** | 오픈소스 (무료) | Pro 버전 유료 | Docker 외에 Maven, npm 등 다양한 패키지 저장소로도 활용 |

> 개인 프로젝트나 학습 목적이라면 **GitHub Container Registry**가 가장 무난하다.
> GitHub Actions에서 빌드 → ghcr.io에 push → K8s에서 pull하는 파이프라인을 무료로 구성할 수 있다.

보안 정책상 외부 인터넷이 차단된 환경(사내 on-premise 클러스터 등)에서는 **Harbor** 같은 오픈소스 레지스트리를 쿠버네티스 위에 직접 배포해서 사용하기도 한다.

### 노드 로컬 캐시

각 워커 노드에는 한 번 pull한 이미지가 로컬 캐시(`/var/lib/containerd` 등)로 남는다. 하지만 이건 레지스트리가 아니라 단순 캐시이며, 노드 간 공유도 되지 않는다.

| 구분 | 설명 |
|------|------|
| 쿠버네티스 기본 | 레지스트리 없음, 외부에서 pull |
| 노드 로컬 | 캐시만 존재 (레지스트리 아님) |
| 내부 레지스트리가 필요하다면 | Harbor 등 별도 설치 필요 |

---

## 네트워킹

### Service가 필요한 이유

Pod는 생성될 때마다 새로운 IP를 할당받는다.
Pod가 재시작되거나 교체되면 IP가 바뀌기 때문에,
다른 Pod나 외부에서 특정 Pod에 안정적으로 접근할 방법이 필요하다.

**Service**는 Pod 집합에 대한 고정 접근점(Stable Endpoint)을 제공한다.
Label Selector로 대상 Pod를 지정하고, 트래픽을 자동으로 분산한다.

### Service 타입 비교

| 타입 | 접근 범위 | 사용 사례 | 외부 노출 |
|------|----------|----------|----------|
| **ClusterIP** | 클러스터 내부만 | 마이크로서비스 간 통신 | 불가 |
| **NodePort** | 노드 IP + 포트 | 개발/테스트 환경 | 가능 (30000~32767 포트) |
| **LoadBalancer** | 클라우드 로드밸런서 | 프로덕션 외부 서비스 | 가능 (클라우드 LB 생성) |

### ClusterIP

클러스터 내부에서만 접근 가능한 기본 Service 타입이다.
마이크로서비스 간 통신에 주로 사용한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-service
spec:
  type: ClusterIP  # 기본값이므로 생략 가능
  selector:
    app: backend
  ports:
    - port: 80        # Service가 노출하는 포트
      targetPort: 8080 # Pod의 실제 포트
```

클러스터 내부에서 `backend-service.default.svc.cluster.local` 또는
같은 네임스페이스라면 `backend-service`로 접근할 수 있다.

### NodePort

각 워커 노드의 특정 포트를 열어서 외부 트래픽을 받는다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-service
spec:
  type: NodePort
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080  # 30000~32767 범위에서 지정 (생략하면 자동 할당)
```

`<노드IP>:30080`으로 접근할 수 있다.
간편하지만 프로덕션에서는 LoadBalancer나 Ingress를 사용하는 것이 일반적이다.

### LoadBalancer

클라우드 환경에서 외부 로드밸런서를 자동으로 생성한다.
AWS에서는 CLB(Classic) 또는 NLB(Network)가 생성된다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  type: LoadBalancer
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
```

로드밸런서의 외부 IP(또는 DNS)가 자동으로 할당되어 외부에서 접근할 수 있다.

### Ingress

Ingress는 클러스터 외부에서 내부 서비스로 들어오는 HTTP/HTTPS 트래픽을 라우팅하는 관문이다.

#### 인그레스가 없으면?

Service만으로 외부 노출 시 문제가 있다:

- `LoadBalancer` 타입 → 서비스마다 외부 IP(로드밸런서)가 하나씩 생긴다 (비용 폭탄)
- `NodePort` → 포트 번호로 접근해야 해서 불편하다

```
서비스 A → 1.2.3.4:30001
서비스 B → 1.2.3.5:30002
서비스 C → 1.2.3.6:30003
```

#### 인그레스가 있으면?

하나의 진입점에서 경로/도메인 기반으로 내부 서비스로 분기한다:

```
api.myapp.com/users  →  user-service
api.myapp.com/orders →  order-service
admin.myapp.com      →  admin-service
```

주요 기능:
- **호스트 기반 라우팅**: `api.example.com` → API 서비스, `web.example.com` → 웹 서비스
- **경로 기반 라우팅**: `/api` → API 서비스, `/` → 웹 서비스
- **TLS 종료**: HTTPS 인증서를 Ingress 레벨에서 처리

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing    # 외부 인터넷에서 접근 가능
    alb.ingress.kubernetes.io/target-type: ip            # Pod IP로 직접 라우팅
spec:
  ingressClassName: alb       # 사용할 Ingress Controller 지정 (AWS ALB)
  rules:
    - host: api.example.com   # 이 도메인으로 들어오는 요청을
      http:
        paths:
          - path: /
            pathType: Prefix  # 경로 매칭 방식 (Prefix: /로 시작하는 모든 요청)
            backend:
              service:
                name: api-service   # 이 Service로 전달
                port:
                  number: 80
    - host: web.example.com   # 다른 도메인은 다른 Service로
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-service
                port:
                  number: 80
  tls:                        # HTTPS 설정
    - hosts:
        - api.example.com
        - web.example.com
      secretName: tls-secret  # TLS 인증서가 저장된 Secret 이름
```

> Ingress를 사용하려면 Ingress Controller가 클러스터에 설치되어 있어야 한다.
> AWS에서는 AWS Load Balancer Controller, 온프레미스에서는 Nginx Ingress Controller를 많이 사용한다.

#### 구성 요소

Ingress는 2가지 구성 요소로 나뉜다:

| 구성 요소 | 역할 |
|-----------|------|
| **Ingress 리소스** | 라우팅 규칙을 정의하는 YAML (위 예시) |
| **Ingress Controller** | 규칙을 실제로 읽고 트래픽을 처리하는 구현체 (별도 설치 필요) |

대표적인 Ingress Controller:

- **Nginx Ingress Controller** - 가장 범용적
- **AWS Load Balancer Controller** - AWS ALB와 연동
- **Traefik** - 자동 설정이 편리
- **Istio** - 서비스 메시 기능 포함

> Ingress 리소스만 만든다고 동작하지 않는다. Controller가 반드시 설치되어 있어야 한다.

#### Spring Boot 개발자를 위한 비유

| 쿠버네티스 | Spring Boot |
|-----------|-------------|
| Ingress Controller | API Gateway / Nginx 리버스 프록시 |
| Ingress 규칙 | `@RequestMapping` 경로 라우팅 |
| Service | 각 마이크로서비스 |

MSA에서 **API Gateway**가 하는 역할과 거의 동일하다고 보면 된다.

---

## 스토리지

컨테이너는 기본적으로 휘발성이다. Pod가 삭제되면 내부 데이터도 사라진다.
데이터를 영구적으로 보존하려면 Persistent Volume을 사용해야 한다.

### PersistentVolume (PV)

PV는 클러스터 레벨의 스토리지 리소스다.
관리자가 미리 프로비저닝하거나, StorageClass를 통해 동적으로 생성한다.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 10Gi                         # 스토리지 용량
  accessModes:
    - ReadWriteOnce                       # 하나의 노드에서만 읽기/쓰기 (RWO)
  persistentVolumeReclaimPolicy: Retain   # PVC 삭제 후에도 데이터 유지 (Delete면 같이 삭제)
  storageClassName: gp3                   # StorageClass 이름 (PVC와 매칭 기준)
  csi:
    driver: ebs.csi.aws.com              # CSI 드라이버 (AWS EBS용)
    volumeHandle: vol-0123456789abcdef0   # 실제 EBS 볼륨 ID
```

### PersistentVolumeClaim (PVC)

PVC는 Pod가 스토리지를 요청하는 방법이다.
원하는 용량과 접근 모드를 지정하면 조건에 맞는 PV가 바인딩된다.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data              # PVC 이름 (Pod에서 참조할 때 사용)
spec:
  accessModes:
    - ReadWriteOnce           # PV와 동일한 접근 모드 요청
  resources:
    requests:
      storage: 10Gi           # 필요한 스토리지 용량
  storageClassName: gp3       # 이 StorageClass의 PV를 바인딩 (또는 동적 생성)
```

Pod에서 PVC를 사용하는 방법:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: my-app:1.0.0
      volumeMounts:
        - name: data              # 아래 volumes에서 정의한 이름과 매칭
          mountPath: /app/data    # 컨테이너 내부에서 마운트될 경로
  volumes:
    - name: data                  # volumeMounts.name과 일치해야 함
      persistentVolumeClaim:
        claimName: app-data       # 위에서 만든 PVC 이름
```

### StorageClass

StorageClass는 PVC가 생성될 때 PV를 동적으로 프로비저닝하는 방법을 정의한다.
관리자가 일일이 PV를 만들 필요 없이 PVC만 생성하면 자동으로 스토리지가 할당된다.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3                                # StorageClass 이름 (PVC에서 참조)
provisioner: ebs.csi.aws.com               # 볼륨을 생성할 프로비저너 (AWS EBS CSI)
parameters:
  type: gp3                                # EBS 볼륨 타입 (gp2, gp3, io1 등)
  fsType: ext4                             # 파일시스템 타입
volumeBindingMode: WaitForFirstConsumer    # Pod가 스케줄될 때 볼륨 생성 (AZ 맞춤)
reclaimPolicy: Delete                      # PVC 삭제 시 PV도 함께 삭제
```

> AWS EKS에서는 EBS CSI Driver를 설치하면 gp2/gp3 StorageClass를 사용할 수 있다.

---

## 배포 전략

### 롤링 업데이트

Kubernetes의 기본 배포 전략이다.
새 버전의 Pod를 하나씩 생성하면서 이전 버전의 Pod를 하나씩 제거한다.

동작 방식:

1. 새 Pod를 생성한다 (maxSurge만큼)
2. 새 Pod가 Ready 상태가 되면 이전 Pod를 제거한다 (maxUnavailable만큼)
3. 모든 Pod가 교체될 때까지 반복한다

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # 원하는 수보다 최대 1개 더 생성 가능
      maxUnavailable: 0   # 최소 replicas 수를 항상 유지 (무중단)
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:2.0.0  # 버전 변경 시 롤링 업데이트 시작
          ports:
            - containerPort: 8080
```

| 설정 | 의미 |
|------|------|
| `maxSurge: 1` | replicas가 3이면 최대 4개까지 동시 실행 가능 |
| `maxUnavailable: 0` | 항상 3개 이상의 Pod가 Ready 상태를 유지 |
| `maxSurge: 0, maxUnavailable: 1` | 먼저 1개를 죽이고 새로 생성 (리소스 절약, 순간 용량 감소) |

롤백이 필요하면:

```bash
# 롤아웃 상태 확인
kubectl rollout status deployment/my-app

# 이전 버전으로 롤백
kubectl rollout undo deployment/my-app

# 특정 리비전으로 롤백
kubectl rollout undo deployment/my-app --to-revision=2

# 롤아웃 히스토리 확인
kubectl rollout history deployment/my-app
```

### Helm

Helm은 Kubernetes의 패키지 매니저다.
apt(Ubuntu)나 brew(macOS)처럼 복잡한 애플리케이션을 한 번에 설치하고 관리할 수 있다.

왜 필요한가?

하나의 애플리케이션을 배포하려면 여러 YAML 파일이 필요하다:
Deployment, Service, ConfigMap, Secret, Ingress, PVC 등.
이걸 환경별(dev/staging/prod)로 각각 관리하면 YAML 파일이 수십 개로 늘어난다.

Helm은 이 문제를 해결한다:

- **Chart** = 패키지. 관련된 YAML 파일들을 하나로 묶은 것이다
- **values.yaml** = 설정값. 환경별로 다른 값만 따로 관리한다
- **Release** = Chart를 클러스터에 설치한 인스턴스

```
my-app-chart/
├── Chart.yaml        # 차트 메타데이터 (이름, 버전)
├── values.yaml       # 기본 설정값
├── templates/        # YAML 템플릿
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── configmap.yaml
└── values-prod.yaml  # 프로덕션 환경 설정값 (오버라이드)
```

Helm의 핵심 장점:

- **패키징**: 여러 YAML을 하나의 Chart로 묶어서 관리한다
- **버전 관리**: Chart 버전을 관리하고 이전 버전으로 롤백할 수 있다
- **환경별 설정**: values.yaml을 환경별로 분리해서 같은 Chart를 다른 설정으로 배포한다
- **재사용**: 공개 Chart 저장소에서 검증된 Chart를 가져다 쓸 수 있다 (Nginx, PostgreSQL 등)

```bash
# 차트 저장소 추가
helm repo add bitnami https://charts.bitnami.com/bitnami

# 차트 검색
helm search repo nginx

# 차트 설치
helm install my-nginx bitnami/nginx -f values-prod.yaml

# 릴리스 목록 조회
helm list

# 업그레이드
helm upgrade my-nginx bitnami/nginx -f values-prod.yaml

# 롤백
helm rollback my-nginx 1
```

---

## kubectl 기본 명령어

kubectl은 Kubernetes 클러스터와 상호작용하는 CLI 도구다.
실무에서 자주 쓰는 명령어를 정리한다.

### 리소스 조회

```bash
# Pod 목록 조회
kubectl get pods

# 모든 리소스 조회
kubectl get all

# 특정 네임스페이스의 Pod 조회
kubectl get pods -n kube-system

# 상세 정보 포함 조회
kubectl get pods -o wide

# YAML 형식으로 출력
kubectl get pod my-app -o yaml

# 실시간 변경 감시
kubectl get pods --watch
```

### 상세 정보 확인

```bash
# Pod 상세 정보 (이벤트, 상태, 조건 등)
kubectl describe pod my-app

# Service 상세 정보
kubectl describe service my-service

# Node 상세 정보
kubectl describe node <node-name>
```

`describe`는 문제 디버깅에 특히 유용하다. Events 섹션에서 오류 원인을 확인할 수 있다.

### 리소스 생성/변경

```bash
# YAML 파일로 리소스 생성 또는 변경
kubectl apply -f deployment.yaml

# 디렉토리 내 모든 YAML 적용
kubectl apply -f ./k8s/

# 변경 전 미리보기 (dry-run)
kubectl apply -f deployment.yaml --dry-run=client
```

### 리소스 삭제

```bash
# 특정 리소스 삭제
kubectl delete pod my-app

# YAML 파일에 정의된 리소스 삭제
kubectl delete -f deployment.yaml

# 네임스페이스의 모든 Pod 삭제
kubectl delete pods --all -n development
```

### 로그 확인

```bash
# Pod 로그 확인
kubectl logs my-app

# 실시간 로그 스트리밍
kubectl logs -f my-app

# 이전 컨테이너의 로그 (재시작된 경우)
kubectl logs my-app --previous

# 멀티 컨테이너 Pod에서 특정 컨테이너 로그
kubectl logs my-app -c sidecar
```

### 컨테이너 접속

```bash
# 컨테이너에 쉘 접속
kubectl exec -it my-app -- /bin/bash

# 특정 명령어 실행
kubectl exec my-app -- cat /etc/config/app.yaml

# 멀티 컨테이너 Pod에서 특정 컨테이너에 접속
kubectl exec -it my-app -c sidecar -- /bin/sh
```

### 포트 포워딩

```bash
# 로컬 포트 8080을 Pod의 포트 80으로 포워딩
kubectl port-forward pod/my-app 8080:80

# Service를 통한 포트 포워딩
kubectl port-forward service/my-service 8080:80
```

로컬에서 클러스터 내부 서비스에 접근할 때 유용하다. 디버깅이나 개발 시 자주 사용한다.

### 유용한 옵션 정리

| 옵션 | 설명 | 예시 |
|------|------|------|
| `-n <namespace>` | 네임스페이스 지정 | `kubectl get pods -n production` |
| `-o wide` | 추가 정보 표시 (IP, 노드 등) | `kubectl get pods -o wide` |
| `-o yaml` | YAML 형식 출력 | `kubectl get pod my-app -o yaml` |
| `-o json` | JSON 형식 출력 | `kubectl get pod my-app -o json` |
| `--watch` | 실시간 변경 감시 | `kubectl get pods --watch` |
| `-l <label>` | 레이블로 필터링 | `kubectl get pods -l app=my-app` |
| `--all-namespaces` | 모든 네임스페이스 | `kubectl get pods --all-namespaces` |

---

## YAML 매니페스트 구조

Kubernetes 리소스는 YAML 파일로 정의한다.
모든 YAML 매니페스트는 4가지 필수 필드를 가진다.

### 4가지 필수 필드

```yaml
apiVersion: apps/v1        # 1. API 버전
kind: Deployment           # 2. 리소스 종류
metadata:                  # 3. 메타데이터
  name: my-app
  namespace: production
  labels:
    app: my-app
    version: v1
spec:                      # 4. 원하는 상태 (스펙)
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:1.0.0
```

| 필드 | 역할 |
|------|------|
| **apiVersion** | 사용할 API 그룹과 버전. `v1`(Core), `apps/v1`(Deployment, ReplicaSet), `networking.k8s.io/v1`(Ingress) 등 |
| **kind** | 리소스의 종류. Pod, Deployment, Service, ConfigMap 등 |
| **metadata** | 리소스의 이름, 네임스페이스, 레이블, 어노테이션 등 식별 정보 |
| **spec** | 리소스의 원하는 상태(desired state). 리소스 종류마다 다른 필드를 가진다 |

### Label과 Selector

Label은 리소스에 부착하는 키-값 쌍이다.
Selector는 Label을 기준으로 리소스를 선택하는 메커니즘이다.

이 둘을 통해 Kubernetes의 오브젝트들이 서로 연결된다.

```yaml
# Deployment: Pod에 label을 부여
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  selector:
    matchLabels:
      app: my-app         # 이 label을 가진 Pod를 관리한다
  template:
    metadata:
      labels:
        app: my-app       # Pod에 부여되는 label
        tier: backend
    spec:
      containers:
        - name: app
          image: my-app:1.0.0
          ports:
            - containerPort: 8080
---
# Service: selector로 대상 Pod를 지정
apiVersion: v1
kind: Service
metadata:
  name: my-app-service
spec:
  selector:
    app: my-app            # app=my-app label을 가진 Pod에 트래픽을 전달
  ports:
    - port: 80
      targetPort: 8080
```

동작 원리:

1. Deployment가 `app: my-app` label을 가진 Pod를 생성한다
2. Service의 `selector`가 `app: my-app`을 지정한다
3. Service는 이 label을 가진 모든 Pod를 자동으로 찾아서 트래픽을 분산한다
4. Pod가 추가/삭제되어도 label만 일치하면 Service가 자동으로 인식한다

> Label은 자유롭게 여러 개 부착할 수 있다.
> `app`, `version`, `tier`, `environment` 같은 label을 조합해서
> 세밀한 리소스 관리가 가능하다.

---

## 마무리

이 글에서 다룬 내용을 정리하면:

1. **아키텍처**: 컨트롤 플레인(API Server, etcd, Scheduler, Controller Manager)과 워커 노드(kubelet, kube-proxy, Container Runtime)의 역할
2. **핵심 오브젝트**: Pod → ReplicaSet → Deployment 계층 구조, Namespace, ConfigMap, Secret
3. **네트워킹**: Service(ClusterIP, NodePort, LoadBalancer)와 Ingress를 통한 트래픽 관리
4. **스토리지**: PV, PVC, StorageClass로 데이터 영속성 확보
5. **배포 전략**: 롤링 업데이트와 Helm을 활용한 패키지 관리
6. **kubectl**: 실무에서 자주 쓰는 명령어와 옵션
7. **YAML 매니페스트**: 4가지 필수 필드와 Label/Selector 메커니즘

이 기본 개념을 이해했다면 실무 시리즈를 따라갈 준비가 된 것이다.

**Part 1**에서는 AWS EKS 클러스터를 프로덕션 수준으로 구축하는 방법을 다룬다.
eksctl로 빠르게 시작하고, Terraform으로 IaC 전환하며,
ALB, DNS, HTTPS 같은 네트워킹 설정까지 실무에서 바로 적용할 수 있는 내용을 정리한다.

**Part 2**에서는 ArgoCD를 활용한 GitOps 기반 배포 파이프라인을 구축한다.
Git 저장소를 단일 소스로 사용해서 자동으로 클러스터에 배포하는 방법을 다룰 예정이다.
