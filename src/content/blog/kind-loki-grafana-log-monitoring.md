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

## 서론

[Part 2](/blog/kind-argocd-gitops-pipeline)에서 ArgoCD로 GitOps 파이프라인을 구성했다.
Git push만 하면 자동으로 배포되는 환경이 갖춰진 거다.

그런데 한 가지 빠진 게 있다.
**배포된 앱이 정상적으로 동작하고 있는지 어떻게 확인하지?**

`kubectl logs`로 하나씩 보는 건 한계가 있다.
Pod가 여러 개면 각각 확인해야 하고, Pod가 재시작되면 이전 로그는 사라진다.
"어제 새벽에 에러가 났던 거 같은데" 하는 상황에서 `kubectl logs`로는 답이 없다.

체계적인 로그 모니터링 환경이 필요하다.
로그를 한 곳에 모아서 검색하고, 시간대별로 조회하고, 특정 키워드로 필터링할 수 있어야 한다.

이번 편에서는 **Loki + Promtail + Grafana** 스택을 설치해서
kind 클러스터의 로그 모니터링 환경을 구축한다.

> 이 글은 **로컬 K8s 실습** 시리즈의 세 번째 글이다.
> - **Part 1**: [kind로 로컬 K8s 클러스터 구축하기](/blog/kind-local-k8s-cluster-setup)
> - **Part 2**: [ArgoCD로 GitOps 배포 파이프라인 만들기](/blog/kind-argocd-gitops-pipeline)
> - **이 글**: Loki + Grafana로 로그 모니터링 구성하기

---

## Loki + Promtail + Grafana 스택이란

K8s 환경에서 로그를 수집하고 조회하는 대표적인 방법은 두 가지다:

| 스택 | 구성 | 특징 |
|------|------|------|
| **ELK** | Elasticsearch + Logstash + Kibana | 강력하지만 무겁다. Elasticsearch가 메모리를 많이 먹는다 |
| **PLG** | Promtail + Loki + Grafana | 경량이고 K8s 네이티브. Prometheus와 같은 라벨 기반 설계 |

로컬 실습에서는 당연히 PLG 스택이 적합하다.
리소스를 적게 쓰면서도 필요한 기능은 다 갖추고 있다.

각 컴포넌트의 역할을 정리하면:

### Loki — 로그 저장소

Loki는 Grafana Labs에서 만든 로그 수집·저장 시스템이다.
"Like Prometheus, but for logs"라는 슬로건이 핵심을 잘 설명한다.

Prometheus가 메트릭을 라벨로 인덱싱하듯이,
Loki도 로그를 라벨(namespace, pod, container 등)로 인덱싱한다.
**로그 내용 자체는 인덱싱하지 않는다.**
이게 Elasticsearch와의 가장 큰 차이점이다.

Elasticsearch는 로그 내용을 전문 검색(full-text search)할 수 있도록 인덱싱하는데,
그래서 인덱스 크기가 로그 데이터보다 커지기도 한다.
Loki는 라벨만 인덱싱하고 로그 본문은 그대로 저장하니까 인덱스가 작고 리소스를 적게 먹는다.

단점은 있다.
로그 본문에 대한 grep 성능은 Elasticsearch보다 느리다.
하지만 대부분의 경우 "특정 Pod의 최근 로그를 본다"거나 "특정 시간대의 에러 로그를 찾는다" 정도면 충분하고,
이런 용도로는 Loki가 충분히 빠르다.

### Promtail — 로그 수집기

Promtail은 각 노드에서 Pod 로그를 읽어서 Loki로 전송하는 수집기다.
K8s에서는 **DaemonSet** 으로 배포된다.

DaemonSet이란 **모든 노드에 하나씩** Pod를 배포하는 방식이다.
워커 노드가 2개면 Promtail Pod도 2개가 뜬다.
각 Promtail은 자기 노드에 있는 Pod 로그 파일(`/var/log/pods/`)을 읽어서 Loki로 보낸다.

Promtail이 수집할 때 자동으로 붙이는 라벨들:

| 라벨 | 설명 |
|------|------|
| `__meta_kubernetes_pod_name` | Pod 이름 |
| `__meta_kubernetes_namespace` | 네임스페이스 |
| `__meta_kubernetes_pod_label_app` | Pod의 `app` 라벨 값 |
| `__meta_kubernetes_container_name` | 컨테이너 이름 |

이 라벨들 덕분에 Grafana에서 "namespace=default, app=marketplace"처럼 필터링해서 로그를 조회할 수 있다.

### Grafana — 시각화 도구

Grafana는 다양한 데이터소스를 시각화하는 대시보드 도구다.
Loki를 데이터소스로 추가하면 로그를 검색하고 조회할 수 있다.
Prometheus를 추가하면 메트릭 그래프도 볼 수 있다.

이번 실습에서는 kube-prometheus-stack에 포함된 Grafana를 사용한다.
Prometheus(메트릭)와 Loki(로그) 두 데이터소스를 하나의 Grafana에서 모두 조회하는 구조다.

### 전체 아키텍처

로그가 수집되는 흐름을 그려보면 이렇다:

```
Pod (로그 출력)
  ↓
/var/log/pods/ (노드의 로그 파일)
  ↓
Promtail (DaemonSet, 각 노드마다 1개)
  ↓ HTTP push
Loki (로그 저장소)
  ↓ LogQL 쿼리
Grafana (시각화/검색)
```

Pod가 stdout/stderr로 출력한 로그는 노드의 `/var/log/pods/` 디렉토리에 파일로 저장된다.
Promtail이 이 파일을 tail하면서 새 로그가 추가되면 Loki로 전송한다.
Grafana에서 LogQL 쿼리를 날리면 Loki가 저장된 로그를 검색해서 반환한다.

---

## monitoring namespace 생성

모니터링 관련 리소스는 전부 `monitoring` 네임스페이스에 배포한다.
앱과 모니터링 리소스를 분리하면 관리가 편하다.

```bash
kubectl create namespace monitoring
```

```
namespace/monitoring created
```

네임스페이스를 나누는 건 단순히 정리 목적만은 아니다.
RBAC(역할 기반 접근 제어)을 적용할 때 네임스페이스 단위로 권한을 분리할 수 있다.
프로덕션에서는 개발자에게 `default` 네임스페이스 읽기 권한만 주고,
`monitoring` 네임스페이스는 운영팀만 접근하게 하는 식으로 운영할 수 있다.

---

## kube-prometheus-stack 설치

모니터링 환경의 첫 번째 구성 요소는 **kube-prometheus-stack** 이다.
이 Helm 차트 하나로 Prometheus, Grafana, AlertManager, 그리고 다양한 K8s 메트릭 수집기가 한꺼번에 설치된다.

"Loki 글인데 왜 Prometheus부터 설치하지?" 싶을 수 있다.
이유는 간단하다.
kube-prometheus-stack에 포함된 Grafana를 쓸 거고,
나중에 메트릭 모니터링까지 확장하려면 Prometheus도 필요하니까
처음부터 같이 설치하는 게 효율적이다.

### Helm 차트 추가

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

### prometheus-values.yaml 작성

설치 전에 커스텀 values 파일을 먼저 만든다:

```yaml
grafana:
  adminPassword: admin
  service:
    type: NodePort
  additionalDataSources:
    - name: Loki
      type: loki
      url: http://loki.monitoring:3100
      access: proxy
      isDefault: false
prometheus:
  prometheusSpec:
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false
```

각 설정의 의미를 자세히 살펴보자:

**grafana 섹션**

| 설정 | 설명 |
|------|------|
| `adminPassword: admin` | Grafana 관리자 비밀번호. 로컬 실습이니 단순하게 설정 |
| `service.type: NodePort` | 외부에서 접근할 수 있도록 NodePort로 노출 |
| `additionalDataSources` | Grafana에 추가할 데이터소스 목록 |

`additionalDataSources`가 핵심이다.
Loki를 아직 설치하지도 않았는데 데이터소스를 미리 등록하는 이유가 있다.
Grafana가 기동할 때 이 설정을 읽고 데이터소스를 자동으로 추가한다.
Loki가 나중에 설치되면 `http://loki.monitoring:3100` 주소로 바로 연결되는 구조다.

K8s Service 이름이 DNS로 자동 등록되기 때문에 이게 가능하다.
`loki.monitoring`은 "monitoring 네임스페이스에 있는 loki라는 이름의 Service"를 의미한다.

**prometheus 섹션**

| 설정 | 설명 |
|------|------|
| `serviceMonitorSelectorNilUsesHelmValues: false` | 모든 namespace의 ServiceMonitor를 수집 |
| `podMonitorSelectorNilUsesHelmValues: false` | 모든 namespace의 PodMonitor를 수집 |

이 두 설정이 `false`가 아니면 Prometheus가 같은 Helm 릴리스의 ServiceMonitor만 수집한다.
`false`로 설정해야 다른 namespace에 있는 marketplace 같은 앱의 메트릭도 수집할 수 있다.

### 설치 실행

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f prometheus-values.yaml
```

설치에 1~2분 정도 걸린다.
완료되면 Pod 상태를 확인한다:

```bash
kubectl get pods -n monitoring
```

```
NAME                                                     READY   STATUS    RESTARTS   AGE
alertmanager-prometheus-kube-prometheus-alertmanager-0    2/2     Running   0          60s
prometheus-grafana-xxxxxxxxxx-xxxxx                      3/3     Running   0          60s
prometheus-kube-prometheus-operator-xxxxxxxxxx-xxxxx      1/1     Running   0          60s
prometheus-kube-state-metrics-xxxxxxxxxx-xxxxx            1/1     Running   0          60s
prometheus-prometheus-kube-prometheus-prometheus-0        2/2     Running   0          60s
prometheus-prometheus-node-exporter-xxxxx                 1/1     Running   0          60s
```

Pod가 꽤 많이 뜬다.
각각의 역할을 간단히 정리하면:

| 컴포넌트 | 역할 |
|----------|------|
| **grafana** | 시각화 대시보드. 로그와 메트릭을 여기서 조회한다 |
| **prometheus** | 메트릭 수집·저장. 시계열 데이터베이스 |
| **alertmanager** | 알림 관리. 특정 조건이 되면 Slack/이메일로 알림 |
| **kube-prometheus-operator** | Prometheus 관련 CRD(ServiceMonitor 등)를 관리하는 오퍼레이터 |
| **kube-state-metrics** | K8s 오브젝트(Deployment, Pod 등)의 상태를 메트릭으로 변환 |
| **node-exporter** | 노드의 CPU, 메모리, 디스크 등 하드웨어 메트릭 수집 |

> **팁**: `node-exporter`도 DaemonSet이다.
> 노드가 2개면 node-exporter Pod도 2개가 뜬다.
> 각 노드의 하드웨어 리소스 사용량을 수집하는 역할이다.

---

## Loki Stack 설치

이제 로그 수집의 핵심인 Loki와 Promtail을 설치한다.
Grafana의 loki-stack 차트를 사용하면 Loki + Promtail을 한 번에 설치할 수 있다.

### Helm 차트 추가

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
```

### loki-values.yaml 작성

```yaml
promtail:
  enabled: true
grafana:
  enabled: false      # kube-prometheus-stack의 Grafana를 사용할 거라 비활성화
  sidecar:
    datasources:
      enabled: false   # datasource 자동 등록도 비활성화
loki:
  persistence:
    enabled: false     # 로컬 실습이라 영구 저장 불필요
  isDefault: false
```

각 설정의 의미:

| 설정 | 값 | 이유 |
|------|----|------|
| `promtail.enabled` | `true` | Promtail을 같이 설치한다. 로그 수집을 위해 필수 |
| `grafana.enabled` | `false` | kube-prometheus-stack에서 이미 Grafana를 설치했다. 여기서 또 설치하면 Grafana가 2개가 된다 |
| `grafana.sidecar.datasources.enabled` | `false` | Loki가 자체적으로 Grafana datasource를 등록하려는 시도를 차단 |
| `loki.persistence.enabled` | `false` | 로컬 실습이라 Pod가 재시작되면 로그 데이터가 사라져도 괜찮다 |
| `loki.isDefault` | `false` | Grafana의 기본 데이터소스로 설정하지 않는다 |

`grafana.enabled: false`가 **가장 중요한 설정** 이다.
이 값을 `true`로 두면 loki-stack이 자체 Grafana를 설치하면서
kube-prometheus-stack의 Grafana와 충돌이 난다.
같은 namespace에 Grafana가 2개 뜨면서 혼란이 생긴다.

### 설치 실행

```bash
helm install loki grafana/loki-stack \
  -n monitoring \
  -f loki-values.yaml
```

설치 후 확인:

```bash
kubectl get pods -n monitoring -l app=loki
```

```
NAME     READY   STATUS    RESTARTS   AGE
loki-0   1/1     Running   0          30s
```

```bash
kubectl get pods -n monitoring -l app=promtail
```

```
NAME                READY   STATUS    RESTARTS   AGE
loki-promtail-xxxxx   1/1     Running   0          30s
loki-promtail-yyyyy   1/1     Running   0          30s
```

Loki는 StatefulSet으로 1개, Promtail은 DaemonSet으로 노드 수만큼 배포된다.
kind 클러스터의 워커 노드가 2개이므로 Promtail도 2개가 뜬 걸 확인할 수 있다.

> **주의**: Promtail이 `CrashLoopBackOff` 상태라면 `/var/log/pods` 마운트에 문제가 있는 경우가 많다.
> `kubectl logs <promtail-pod> -n monitoring`으로 에러 메시지를 확인하자.

---

## 트러블슈팅: Loki 데이터소스 충돌 문제

처음 설치할 때 흔히 겪는 문제가 있다.
**Grafana에서 Loki 데이터소스가 안 보이거나, 2개가 등록되는 현상** 이다.

### 문제 상황

loki-stack을 기본 설정으로 설치하면 이런 일이 벌어진다:

1. loki-stack이 자체 Grafana sidecar를 통해 Loki datasource를 등록하려고 시도한다
2. kube-prometheus-stack의 Grafana에는 `additionalDataSources`로 이미 Loki를 등록했다
3. 두 설정이 충돌하면서 datasource가 중복되거나, 아예 등록이 안 되는 경우가 생긴다

### 원인

loki-stack 차트는 기본적으로 `grafana.sidecar.datasources.enabled: true`로 되어있다.
이 설정이 켜져 있으면 loki-stack이 ConfigMap을 생성해서
Grafana의 sidecar 컨테이너가 이 ConfigMap을 감지하고 datasource를 자동 등록한다.

문제는 이 ConfigMap이 **kube-prometheus-stack의 Grafana** 를 대상으로 동작한다는 거다.
kube-prometheus-stack의 Grafana도 sidecar가 있기 때문이다.
결과적으로 `additionalDataSources`와 sidecar 자동 등록이 동시에 일어나면서 충돌한다.

### 해결

해결 방법은 **역할을 명확히 분리** 하는 거다:

- **Loki datasource 등록**: kube-prometheus-stack의 `additionalDataSources`가 담당
- **loki-stack**: Loki와 Promtail만 설치. datasource 등록은 관여하지 않음

`loki-values.yaml`에서 다음 두 줄이 이 역할 분리를 구현한다:

```yaml
grafana:
  enabled: false
  sidecar:
    datasources:
      enabled: false
```

`grafana.enabled: false`만으로는 부족하다.
Grafana를 설치하지 않더라도 sidecar datasource ConfigMap은 생성될 수 있다.
`sidecar.datasources.enabled: false`까지 명시적으로 꺼야 깔끔하다.

> **교훈**: Helm 차트 여러 개를 조합해서 쓸 때는 **누가 무엇을 담당하는지** 명확히 정리해야 한다.
> 각 차트가 자동으로 해주는 것들이 겹치면 디버깅하기 어려운 문제가 생긴다.
> 충돌이 의심되면 각 차트의 기본 values를 확인하자:
> ```bash
> helm show values grafana/loki-stack | grep -A 5 sidecar
> ```

---

## Grafana 접속 및 로그 확인

모든 설치가 끝났다.
이제 Grafana에 접속해서 실제 로그를 확인해보자.

### Grafana 포트 포워딩

```bash
kubectl port-forward svc/prometheus-grafana -n monitoring 3000:80
```

Service 이름이 `prometheus-grafana`인 이유는
kube-prometheus-stack의 Helm 릴리스 이름(`prometheus`)이 접두사로 붙기 때문이다.

### 로그인

브라우저에서 [http://localhost:3000](http://localhost:3000)에 접속한다.

- **Username**: `admin`
- **Password**: `admin`

`prometheus-values.yaml`에서 `grafana.adminPassword: admin`으로 설정했기 때문에
초기 비밀번호가 `admin`이다.

### Loki 데이터소스 확인

로그인 후 왼쪽 사이드바에서 **Connections → Data sources** 를 선택한다.
데이터소스 목록에 다음이 보여야 한다:

| 데이터소스 | 타입 | URL |
|-----------|------|-----|
| Prometheus | prometheus | http://localhost:9090 |
| **Loki** | loki | http://loki.monitoring:3100 |

Loki가 목록에 있으면 정상이다.
없다면 앞서 설명한 트러블슈팅 섹션을 확인하자.

### 로그 조회 — Explore

실제 로그를 조회해보자.

1. 왼쪽 사이드바에서 **Explore** 아이콘(나침반 모양)을 클릭한다
2. 상단의 데이터소스 드롭다운에서 **Loki** 를 선택한다
3. **Label filters** 에서 라벨을 선택한다:
   - `namespace` = `default`
   - `app` = `marketplace`
4. **Run query** 버튼을 클릭한다

marketplace Pod의 로그가 시간순으로 표시된다.
Spring Boot의 시작 로그, HTTP 요청 로그 등이 보일 거다.

### LogQL 기본 문법

Label filters 대신 직접 LogQL 쿼리를 작성할 수도 있다.
LogQL은 Loki의 쿼리 언어로, PromQL(Prometheus 쿼리 언어)과 비슷한 문법이다.

자주 쓰는 쿼리들:

```
# 특정 Pod의 로그
{namespace="default", app="marketplace"}

# 에러 로그만 필터링
{namespace="default", app="marketplace"} |= "ERROR"

# 특정 문자열을 제외
{namespace="default", app="marketplace"} != "health"

# 정규식으로 필터링
{namespace="default", app="marketplace"} |~ "Exception|Error"

# 파이프라인: JSON 파싱 후 필드 필터링
{namespace="default", app="marketplace"} | json | level="error"
```

| 연산자 | 의미 |
|--------|------|
| `\|=` | 문자열 포함 (contains) |
| `!=` | 문자열 미포함 (not contains) |
| `\|~` | 정규식 매칭 |
| `!~` | 정규식 미매칭 |

`{}`안의 라벨 셀렉터로 로그 스트림을 선택하고,
`|` 파이프 연산자로 필터링이나 파싱을 체이닝하는 구조다.

### 실시간 로그 (Live tail)

Grafana Explore 화면에서 **Live** 버튼을 클릭하면 실시간 로그 스트리밍 모드로 전환된다.
새 로그가 발생하면 즉시 화면에 표시된다.

```
{namespace="default", app="marketplace"} |= "ERROR"
```

이렇게 에러 로그만 필터링한 상태에서 Live 모드를 켜두면
에러가 발생하는 즉시 화면에서 확인할 수 있다.
터미널을 여러 개 열어서 `kubectl logs -f`를 각 Pod마다 치는 것보다 훨씬 편하다.

> **팁**: Live 모드는 브라우저 탭을 열어둬야 동작한다.
> 백그라운드 알림이 필요하면 AlertManager를 활용하는 게 맞다.
> 하지만 로컬 실습에서는 Live 모드로도 충분하다.

---

## ServiceMonitor 설정 (보너스)

로그 모니터링까지 구성했으니, **메트릭 모니터링** 도 덤으로 해보자.
kube-prometheus-stack을 설치할 때 Prometheus가 같이 설치됐으니,
ServiceMonitor만 추가하면 앱의 메트릭도 수집할 수 있다.

### Spring Boot Actuator

메트릭을 수집하려면 앱이 메트릭을 노출해야 한다.
Spring Boot는 Actuator + Micrometer로 Prometheus 형식의 메트릭을 노출할 수 있다.

`build.gradle`에 다음 의존성이 필요하다:

```groovy
implementation 'org.springframework.boot:spring-boot-starter-actuator'
runtimeOnly 'io.micrometer:micrometer-registry-prometheus'
```

`application.yml`에서 Prometheus 엔드포인트를 활성화한다:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, prometheus
  metrics:
    tags:
      application: marketplace
```

이렇게 설정하면 `/actuator/prometheus` 엔드포인트가 생긴다.
이 엔드포인트에 접속하면 JVM 메모리, HTTP 요청 수, 응답 시간 등의 메트릭이
Prometheus 형식(텍스트)으로 출력된다.

### marketplace-servicemonitor.yaml 작성

Prometheus가 marketplace 앱의 메트릭을 수집하도록 ServiceMonitor를 작성한다:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: marketplace
  namespace: monitoring
  labels:
    release: prometheus
spec:
  namespaceSelector:
    matchNames:
      - default
  selector:
    matchLabels:
      app: marketplace
  endpoints:
    - port: http
      path: /actuator/prometheus
      interval: 15s
```

각 필드의 의미:

| 필드 | 설명 |
|------|------|
| `metadata.labels.release: prometheus` | kube-prometheus-stack이 이 ServiceMonitor를 인식하기 위해 필수. Helm 릴리스 이름과 일치해야 한다 |
| `namespaceSelector.matchNames` | 감시할 대상 Service가 있는 namespace |
| `selector.matchLabels` | 감시할 Service의 라벨. marketplace Service에 `app: marketplace` 라벨이 있어야 한다 |
| `endpoints[].port` | Service에 정의된 포트 이름. marketplace Service의 포트 이름이 `http`여야 한다 |
| `endpoints[].path` | 메트릭을 가져올 경로 |
| `endpoints[].interval` | 스크래핑 간격. 15초마다 메트릭을 수집한다 |

**`release: prometheus` 라벨이 빠지면 Prometheus가 이 ServiceMonitor를 무시한다.**
이거 때문에 헤매는 경우가 많다.
prometheus-values.yaml에서 `serviceMonitorSelectorNilUsesHelmValues: false`를 설정했으니
모든 namespace의 ServiceMonitor를 수집하긴 하지만,
그래도 `release` 라벨이 매칭 조건에 포함되어 있을 수 있으므로 명시하는 게 안전하다.

### 적용

```bash
kubectl apply -f marketplace-servicemonitor.yaml
```

```
servicemonitor.monitoring.coreos.com/marketplace created
```

적용 후 Prometheus가 marketplace 타겟을 인식하는지 확인한다:

```bash
kubectl port-forward svc/prometheus-kube-prometheus-prometheus -n monitoring 9090:9090
```

브라우저에서 [http://localhost:9090/targets](http://localhost:9090/targets)에 접속하면
`monitoring/marketplace/0` 타겟이 `UP` 상태로 보여야 한다.

### Grafana에서 메트릭 확인

Grafana로 돌아가서 Explore에서 데이터소스를 **Prometheus** 로 변경한다.
다음 PromQL 쿼리로 JVM 메모리 사용량을 확인할 수 있다:

```
jvm_memory_used_bytes{application="marketplace"}
```

HTTP 요청 수:

```
http_server_requests_seconds_count{application="marketplace"}
```

이렇게 로그(Loki)와 메트릭(Prometheus)을 하나의 Grafana에서 함께 조회할 수 있다.
문제가 생겼을 때 메트릭 그래프로 이상 지점을 찾고,
같은 시간대의 로그를 Loki에서 확인하는 식으로 디버깅 효율을 높일 수 있다.

---

## 정리

3편에 걸쳐 로컬 K8s 환경에서 **클러스터 구축 → 자동 배포 → 로그 모니터링** 까지 전체 DevOps 파이프라인을 구축했다.

### 시리즈 전체 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                  kind 클러스터                        │
│                                                     │
│  ┌──────────┐   ┌───────────┐   ┌───────────────┐   │
│  │ Marketplace│   │  ArgoCD   │   │  monitoring   │   │
│  │  (default) │   │ (argocd)  │   │  namespace    │   │
│  │           │   │           │   │               │   │
│  │  Pod x2   │   │  Server   │   │  Prometheus   │   │
│  │  Service  │   │  Repo Svr │   │  Grafana      │   │
│  │  Ingress  │   │           │   │  Loki         │   │
│  │           │   │           │   │  Promtail x2  │   │
│  └──────────┘   └───────────┘   └───────────────┘   │
│       ↑               ↑               ↑             │
│       │          Git 감시/동기화    로그·메트릭 수집    │
└───────┼───────────────┼───────────────┼─────────────┘
        │               │               │
   marketplace.local   GitHub       Grafana UI
   (브라우저 접속)    (marketplace-    (localhost:3000)
                     deploy repo)
```

각 편에서 구축한 내용을 정리하면:

| 편 | 구성 요소 | 역할 |
|----|----------|------|
| **Part 1** | kind 클러스터 | 로컬 멀티 노드 K8s 환경 |
| **Part 1** | Nginx Ingress | 외부 트래픽 라우팅 |
| **Part 1** | marketplace 앱 | Spring Boot 앱 수동 배포 |
| **Part 2** | ArgoCD | GitOps 기반 자동 배포 |
| **Part 2** | marketplace-deploy | Helm 차트로 선언적 배포 관리 |
| **Part 3** | kube-prometheus-stack | Prometheus + Grafana + AlertManager |
| **Part 3** | Loki + Promtail | 로그 수집·저장 |
| **Part 3** | ServiceMonitor | 앱 메트릭 수집 |

### 로컬 vs 프로덕션 차이

이번 시리즈에서 구축한 환경은 로컬 실습용이지만,
프로덕션(EKS, GKE 등)에서도 아키텍처의 큰 틀은 동일하다.

| 항목 | 로컬 (kind) | 프로덕션 (EKS) |
|------|------------|---------------|
| 클러스터 | kind (Docker 기반) | EKS (AWS 관리형) |
| 이미지 레지스트리 | `kind load` (로컬 로드) | ECR, Docker Hub |
| CI | 수동 (`docker build`) | GitHub Actions, Jenkins |
| CD | ArgoCD | ArgoCD (동일) |
| 로그 저장 | Loki (메모리, 비영구) | Loki + S3 백엔드 (영구 저장) |
| 메트릭 저장 | Prometheus (로컬) | Prometheus + Thanos 또는 AWS Managed Prometheus |
| 접근 방식 | port-forward | ALB + Route53 |

핵심은 **도구와 패턴이 같다** 는 거다.
ArgoCD, Loki, Prometheus, Grafana — 로컬에서 익힌 이 도구들을
프로덕션에서도 그대로 쓸 수 있다.
달라지는 건 스토리지 백엔드(S3), 네트워크 설정(ALB), CI 자동화 정도다.

로컬 실습에서 전체 구조를 이해해두면
프로덕션 환경을 구축할 때 "이건 로컬에서 해봤던 그거네"라는 감각이 생긴다.
그 감각이 있으면 새로운 도구나 환경에 적응하는 속도가 확 빨라진다.
