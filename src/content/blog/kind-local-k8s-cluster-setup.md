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

## 서론

Kubernetes를 공부하거나 실습하려면 클러스터가 필요하다.
선택지는 크게 세 가지다:

| 도구 | 특징 | 단점 |
|------|------|------|
| **EKS/GKE** | 프로덕션 수준 | 비용 발생 (EKS만 시간당 $0.10) |
| **minikube** | 설치 간단 | 단일 노드, 멀티 노드 실습 불가 |
| **kind** | 멀티 노드, 가볍고 빠름 | 프로덕션 용도 아님 |

kind(Kubernetes IN Docker)는 Docker 컨테이너 안에 K8s 노드를 만드는 방식이다.
Docker 컨테이너 하나가 K8s 노드 하나가 되는 구조라서,
컨트롤 플레인 1개 + 워커 노드 2개짜리 클러스터를 로컬에서 몇 분 만에 만들 수 있다.

실제로 쓰다 보면 이런 점이 좋다:

- **빠르다**: 클러스터 생성에 1~2분이면 충분하다
- **가볍다**: VM을 띄우지 않고 Docker 컨테이너만 사용한다
- **멀티 노드**: 워커 노드를 원하는 만큼 추가할 수 있다
- **재현성**: 설정 파일 하나로 동일한 클러스터를 반복 생성할 수 있다

이 글에서는 kind로 로컬 클러스터를 구축하고,
Spring Boot 앱을 빌드해서 배포하는 전체 과정을 실습한다.

> 이 글은 **로컬 K8s 실습** 시리즈의 첫 번째 글이다.
> - **이 글**: kind로 로컬 K8s 클러스터 구축하기
> - **Part 2**: ArgoCD로 GitOps 배포 파이프라인 만들기
> - **Part 3**: Loki + Grafana로 로그 모니터링 구성하기

---

## 사전 준비

### Docker 런타임

kind는 Docker 위에서 동작하므로 Docker 런타임이 필요하다.
Docker Desktop, Colima, Orbstack 중 아무거나 쓰면 된다.
이 실습에서는 **Orbstack** 을 사용한다.

Orbstack은 macOS 전용 Docker 런타임으로, Docker Desktop보다 가볍고 빠르다.
아직 안 써봤다면 [orbstack.dev](https://orbstack.dev)에서 설치할 수 있다.

Docker가 정상 동작하는지 확인한다:

```bash
docker version
```

`Client`와 `Server` 정보가 모두 출력되면 정상이다.

### kind, kubectl, helm 설치

macOS에서는 brew로 한 번에 설치할 수 있다:

```bash
brew install kind kubectl helm
```

설치 후 버전을 확인한다:

```bash
kind version
# kind v0.27.0 go1.24.1 darwin/arm64

kubectl version --client
# Client Version: v1.32.3

helm version
# version.BuildInfo{Version:"v3.17.1", ...}
```

> **참고**: kind, kubectl, helm 버전은 실습 시점에 따라 다를 수 있다.
> 큰 차이가 없다면 그대로 진행해도 문제없다.

---

## kind 클러스터 생성

### 클러스터 설정 파일 작성

kind는 YAML 설정 파일로 클러스터 구성을 정의한다.
프로젝트 루트에 `kind-config.yaml` 파일을 만든다:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
        protocol: TCP
      - containerPort: 443
        hostPort: 443
        protocol: TCP
  - role: worker
  - role: worker
```

각 설정의 의미는 다음과 같다:

| 설정 | 설명 |
|------|------|
| `nodes` | 클러스터 노드 구성. control-plane 1개 + worker 2개 |
| `extraPortMappings` | 호스트 포트와 컨테이너 포트를 매핑. Ingress를 위해 80/443 포트를 열어둔다 |

`extraPortMappings`가 왜 필요한지 잠깐 설명하면,
kind 클러스터는 Docker 컨테이너 안에서 돌아간다.
외부(로컬 머신)에서 클러스터 내부의 서비스에 접근하려면 포트를 열어줘야 한다.
나중에 Nginx Ingress Controller를 설치하면 80/443 포트로 트래픽이 들어오게 되는데,
이 매핑이 없으면 `localhost:80`으로 접근할 수 없다.

### 클러스터 생성

```bash
kind create cluster --name marketplace --config kind-config.yaml
```

실행하면 이런 출력이 나온다:

```
Creating cluster "marketplace" ...
 ✓ Ensuring node image (kindest/node:v1.32.2) 🖼
 ✓ Preparing nodes 📦 📦 📦
 ✓ Writing configuration 📜
 ✓ Starting control-plane 🕹️
 ✓ Installing CNI 🔌
 ✓ Installing StorageClass 💾
 ✓ Joining worker nodes 🚜
Set kubectl context to "kind-marketplace"
You can now use your cluster with:

kubectl cluster-info --context kind-marketplace

Have a nice day! 👋
```

마지막 줄을 보면 kubectl context가 `kind-marketplace`로 자동 전환된 걸 알 수 있다.
별도로 context를 전환할 필요가 없다.

### 클러스터 확인

노드 상태를 확인한다:

```bash
kubectl get nodes
```

```
NAME                        STATUS   ROLES           AGE   VERSION
marketplace-control-plane   Ready    control-plane   75s   v1.32.2
marketplace-worker          Ready    <none>          54s   v1.32.2
marketplace-worker2         Ready    <none>          54s   v1.32.2
```

3개 노드가 모두 `Ready` 상태면 성공이다.

Docker 컨테이너로도 확인할 수 있다:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```

```
NAMES                        IMAGE                  STATUS
marketplace-control-plane    kindest/node:v1.32.2   Up 2 minutes
marketplace-worker           kindest/node:v1.32.2   Up 2 minutes
marketplace-worker2          kindest/node:v1.32.2   Up 2 minutes
```

Docker 컨테이너 3개가 K8s 노드 3개인 거다.
이게 kind의 핵심 아이디어다 -- Docker 컨테이너 = K8s 노드.

---

## Nginx Ingress Controller 설치

클러스터에 외부 트래픽을 라우팅하려면 Ingress Controller가 필요하다.
kind는 공식적으로 Nginx Ingress Controller를 지원하며, kind 전용 매니페스트를 제공한다.

### 설치

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
```

이 매니페스트는 일반 Nginx Ingress와 뭐가 다를까?
kind 환경에 맞춰 `hostPort`를 사용하도록 설정되어 있다.
앞서 `extraPortMappings`로 열어둔 80/443 포트와 연결되는 부분이다.

### 설치 확인

Ingress Controller Pod가 정상적으로 뜰 때까지 기다린다:

```bash
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s
```

```
pod/ingress-nginx-controller-xxxxx condition met
```

Pod 상태를 직접 확인하고 싶다면:

```bash
kubectl get pods -n ingress-nginx
```

```
NAME                                        READY   STATUS      RESTARTS   AGE
ingress-nginx-admission-create-xxxxx        0/1     Completed   0          60s
ingress-nginx-admission-patch-xxxxx         0/1     Completed   0          60s
ingress-nginx-controller-xxxxx              1/1     Running     0          60s
```

`ingress-nginx-controller` Pod가 `Running` 상태면 정상이다.
`admission-create`와 `admission-patch`는 초기 설정용 Job이라 `Completed` 상태가 맞다.

---

## marketplace 이미지 빌드

이제 배포할 애플리케이션 이미지를 준비한다.
여기서는 기존에 작업하던 Spring Boot 멀티 모듈 프로젝트(marketplace)를 사용한다.

### Dockerfile 작성

multi-stage 빌드를 사용한다.
빌드용 이미지와 실행용 이미지를 분리해서 최종 이미지 크기를 줄이는 방식이다.

```dockerfile
# Stage 1: 빌드
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app
COPY . .
RUN gradle :module-api:bootJar -x test --no-daemon

# Stage 2: 실행
FROM eclipse-temurin:17-jre
WORKDIR /app

# 보안: root가 아닌 일반 유저로 실행
RUN groupadd -r appuser && useradd -r -g appuser appuser

COPY --from=builder /app/module-api/build/libs/*.jar app.jar

RUN chown appuser:appuser app.jar
USER appuser

ENTRYPOINT ["java", "-jar", "app.jar"]
```

각 Stage의 역할을 정리하면:

| Stage | 베이스 이미지 | 역할 |
|-------|-------------|------|
| builder | `gradle:8.5-jdk17` | Gradle로 bootJar 빌드. JDK + Gradle이 포함된 무거운 이미지 |
| runtime | `eclipse-temurin:17-jre` | JAR 파일만 복사해서 실행. JRE만 포함된 가벼운 이미지 |

왜 multi-stage를 쓸까?
단일 Stage로 빌드하면 최종 이미지에 JDK, Gradle, 소스 코드가 전부 포함된다.
multi-stage를 쓰면 실행에 필요한 JRE + JAR만 남기 때문에 이미지 크기가 크게 줄어든다.

`USER appuser`도 중요한 부분이다.
컨테이너를 root로 실행하면 보안 취약점이 생길 수 있다.
프로덕션에서는 반드시 non-root 유저로 실행해야 한다.

### 이미지 빌드

프로젝트 루트에서 빌드한다:

```bash
docker build -t marketplace:v1 .
```

빌드가 완료되면 이미지를 확인한다:

```bash
docker images marketplace
```

```
REPOSITORY    TAG       IMAGE ID       CREATED          SIZE
marketplace   v1        abc123def456   10 seconds ago   280MB
```

---

## kind로 이미지 로드

일반적으로 K8s 클러스터에서 이미지를 사용하려면 Docker Hub 같은 레지스트리에 Push해야 한다.
하지만 kind는 **로컬 이미지를 클러스터 노드에 직접 복사** 하는 기능을 제공한다.

```bash
kind load docker-image marketplace:v1 --name marketplace
```

```
Image: "marketplace:v1" with ID "sha256:abc123..." not yet present on node "marketplace-worker2", loading...
Image: "marketplace:v1" with ID "sha256:abc123..." not yet present on node "marketplace-worker", loading...
Image: "marketplace:v1" with ID "sha256:abc123..." not yet present on node "marketplace-control-plane", loading...
```

이 명령이 하는 일은 단순하다:
로컬 Docker에 있는 이미지를 kind 클러스터의 각 노드(Docker 컨테이너) 안으로 복사하는 거다.
레지스트리를 거치지 않기 때문에 빠르고 간편하다.

### imagePullPolicy 설정

`kind load`로 로드한 이미지를 사용하려면 한 가지 주의할 점이 있다.
Kubernetes는 기본적으로 이미지를 레지스트리에서 Pull하려고 한다.
로컬에 이미 있는 이미지를 사용하려면 `imagePullPolicy: Never`를 설정해야 한다.

Helm values.yaml이나 Deployment manifest에서:

```yaml
# values.yaml
image:
  repository: marketplace
  tag: v1
  pullPolicy: Never  # 레지스트리에서 Pull하지 않고 로컬 이미지 사용
```

또는 Deployment에서 직접:

```yaml
containers:
  - name: marketplace
    image: marketplace:v1
    imagePullPolicy: Never
```

`imagePullPolicy`를 `Never`로 설정하지 않으면 Pod가 `ErrImagePull` 상태에 빠진다.
kind에서 로컬 이미지를 쓸 때 가장 흔한 실수 중 하나다.

> **팁**: `imagePullPolicy`에는 `Always`, `IfNotPresent`, `Never` 세 가지 옵션이 있다.
> - `Always`: 항상 레지스트리에서 Pull (태그가 `latest`일 때 기본값)
> - `IfNotPresent`: 로컬에 없을 때만 Pull (태그가 지정된 경우 기본값)
> - `Never`: 레지스트리를 사용하지 않음. 로컬 이미지만 사용

kind 환경에서는 `IfNotPresent`도 동작하지만,
명시적으로 `Never`를 쓰는 게 의도가 분명해서 더 좋다.

---

## 트러블슈팅: Redis/Kafka auto-config 문제

이미지를 배포했더니 Pod가 `CrashLoopBackOff` 상태에 빠졌다.
실제로 겪은 문제와 해결 과정을 정리한다.

### v1: CrashLoopBackOff 발생

배포 후 Pod 상태를 확인하면:

```bash
kubectl get pods
```

```
NAME                           READY   STATUS             RESTARTS   AGE
marketplace-xxxxx-yyyyy        0/1    CrashLoopBackOff    3          2m
```

로그를 확인한다:

```bash
kubectl logs marketplace-xxxxx-yyyyy
```

```
***************************
APPLICATION FAILED TO START
***************************

Description:

Failed to configure a DataSource: 'url' is required...

Action:

Consider the following:
	If you want an embedded database (H2, HSQL or Derby), please put it on the classpath.
	If you have database settings to be applied to a particular profile, ...
```

이건 데이터베이스 관련 에러인데, 더 자세히 보면 Redis 연결 실패 로그도 있었다:

```
org.springframework.data.redis.RedisConnectionFailureException:
Unable to connect to Redis
```

### 원인 분석

Spring Boot의 **auto-configuration** 때문이다.
`spring-boot-starter-data-redis` 의존성이 classpath에 있으면,
Spring Boot는 자동으로 Redis 연결을 시도한다.

프로필이 `local`이든 `prod`든 상관없다.
의존성이 classpath에 존재하기만 하면 auto-configuration이 동작한다.

로컬 K8s 환경에서는 Redis 서버가 없으니 당연히 연결에 실패하고, 앱이 죽는다.

### v2: Redis auto-config exclude

`application.yml`에서 Redis auto-configuration을 제외한다:

```yaml
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration
      - org.springframework.boot.autoconfigure.data.redis.RedisReactiveAutoConfiguration
```

다시 빌드하고 배포한다:

```bash
docker build -t marketplace:v2 .
kind load docker-image marketplace:v2 --name marketplace
```

Deployment의 이미지 태그를 `v2`로 변경하고 재배포하면...
이번에는 **Kafka** 연결 실패로 또 죽는다:

```
org.apache.kafka.common.KafkaException:
Failed to construct kafka consumer
```

같은 원리다. `spring-kafka` 의존성이 있으면 Kafka auto-configuration도 동작한다.

### v3: Kafka auto-config도 exclude

Kafka 관련 auto-configuration도 추가로 제외한다:

```yaml
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration
      - org.springframework.boot.autoconfigure.data.redis.RedisReactiveAutoConfiguration
      - org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration
```

또는 `@SpringBootApplication`에서 직접 제외할 수도 있다:

```java
@SpringBootApplication(exclude = {
    RedisAutoConfiguration.class,
    RedisReactiveAutoConfiguration.class,
    KafkaAutoConfiguration.class
})
public class MarketplaceApplication {
    public static void main(String[] args) {
        SpringApplication.run(MarketplaceApplication.class, args);
    }
}
```

다시 빌드하고 배포한다:

```bash
docker build -t marketplace:v3 .
kind load docker-image marketplace:v3 --name marketplace
```

이번에는 정상적으로 기동된다:

```bash
kubectl get pods
```

```
NAME                           READY   STATUS    RESTARTS   AGE
marketplace-xxxxx-yyyyy        1/1     Running   0          30s
```

### 핵심 교훈

이 문제의 핵심은 **Spring Boot auto-configuration은 프로필과 무관하게 classpath 기반으로 동작한다** 는 점이다.

```
classpath에 spring-boot-starter-data-redis 존재
  → RedisAutoConfiguration 활성화
    → Redis 서버 연결 시도
      → 로컬 K8s에 Redis 없음
        → 앱 기동 실패
```

프로파일별로 Redis를 사용하지 않더라도, 의존성이 classpath에 있으면 자동 설정이 동작한다.
해결 방법은 두 가지다:

1. **exclude로 제외**: `@SpringBootApplication(exclude = ...)` 또는 `spring.autoconfigure.exclude`
2. **프로파일별 의존성 분리**: 필요한 모듈에서만 의존성을 포함하도록 Gradle 구성 변경

실무에서는 보통 프로파일별 설정 파일(`application-local.yml`)에서 exclude하고,
프로덕션 프로파일에서는 정상적으로 auto-config가 동작하도록 구성한다.

---

## 정리

이 글에서 다룬 내용을 정리한다:

| 단계 | 내용 |
|------|------|
| 사전 준비 | Docker(Orbstack), kind, kubectl, helm 설치 |
| 클러스터 생성 | kind config로 control-plane 1 + worker 2 구성 |
| Ingress 설치 | kind 전용 Nginx Ingress Controller 설치 |
| 이미지 빌드 | multi-stage Dockerfile로 Spring Boot 앱 빌드 |
| 이미지 로드 | `kind load`로 레지스트리 없이 클러스터에 이미지 전달 |
| 트러블슈팅 | Redis/Kafka auto-config exclude로 기동 문제 해결 |

kind로 로컬에서 프로덕션과 유사한 멀티 노드 K8s 환경을 구축했다.
EKS처럼 비용이 들지 않고, 필요할 때 만들고 지울 수 있어서 실습용으로 최적이다.

참고로 클러스터를 삭제하고 싶을 때는:

```bash
kind delete cluster --name marketplace
```

이 한 줄이면 클러스터가 깔끔하게 사라진다.
Docker 컨테이너 기반이라 찌꺼기가 남지 않는다.

다음 편에서는 이 클러스터에 **ArgoCD** 를 설치해서
GitOps 기반 자동 배포 파이프라인을 구성한다.
Git에 Push하면 자동으로 K8s에 배포되는 환경을 만들어 보자.
