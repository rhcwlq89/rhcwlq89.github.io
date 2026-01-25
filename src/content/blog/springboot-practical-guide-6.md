---
title: "스프링부트 실무 가이드 6편: 모니터링과 옵저버빌리티"
description: "Prometheus, Grafana, 커스텀 메트릭으로 시스템 상태를 실시간 파악하기"
pubDate: 2026-01-25T15:00:00
tags: ["Spring Boot", "Prometheus", "Grafana", "Monitoring", "Backend", "실무가이드"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

> **스프링부트 실무 가이드 시리즈**
>
> | 편 | 제목 | 링크 |
> |---|------|------|
> | 1편 | 동시성 제어와 재고 관리 | [바로가기](/blog/springboot-practical-guide-1) |
> | 2편 | 캐싱 전략 | [바로가기](/blog/springboot-practical-guide-2) |
> | 3편 | 이벤트 드리븐 아키텍처 | [바로가기](/blog/springboot-practical-guide-3) |
> | 4편 | Resilience 패턴 | [바로가기](/blog/springboot-practical-guide-4) |
> | 5편 | 데이터베이스 최적화 | [바로가기](/blog/springboot-practical-guide-5) |
> | **6편** | **모니터링** | 현재 글 |

---

시스템이 아무리 잘 설계되어도 운영 중 문제가 발생합니다. 중요한 건 **얼마나 빨리 문제를 파악하고 해결하느냐**입니다. 이번 마지막 편에서는 옵저버빌리티의 핵심 개념과 실무 모니터링 구축 방법을 다룹니다.

---

## 1. 옵저버빌리티(Observability)란?

### 1.1 모니터링 vs 옵저버빌리티

```
모니터링 (Monitoring):
"미리 정의한 것을 감시"
- CPU 사용률 > 80%면 알림
- 에러율 > 5%면 알림
- 알려진 문제만 감지 가능

옵저버빌리티 (Observability):
"시스템 내부 상태를 외부에서 이해"
- 왜 느려졌지? → 원인 추적 가능
- 어디서 병목이지? → 분석 가능
- 예상치 못한 문제도 파악 가능
```

### 1.2 옵저버빌리티의 3가지 축

```
┌─────────────────────────────────────────────────────────┐
│                    Observability                        │
│                                                         │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│   │   Metrics   │  │    Logs     │  │   Traces    │   │
│   │   (메트릭)   │  │   (로그)    │  │  (트레이스)  │   │
│   └─────────────┘  └─────────────┘  └─────────────┘   │
│         │                │                │            │
│    "무엇이"         "무슨 일이"       "어디서"         │
│    "얼마나"         "일어났는가"      "어떤 경로로"    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

| 축 | 설명 | 도구 예시 |
|-----|------|----------|
| **Metrics** | 수치화된 시계열 데이터 | Prometheus, Datadog |
| **Logs** | 이벤트 기록 | ELK Stack, Loki |
| **Traces** | 요청 흐름 추적 | Jaeger, Zipkin |

### 1.3 실제 장애 대응 비교

```
장애 발생 시나리오:
오전 10:05 - 사용자 "결제가 안 돼요" 신고

옵저버빌리티 없이:
├── "로그 파일 어디있지?"
├── "어떤 서버에서 발생했지?"
├── "재현이 안 되는데..."
└── 3시간 후 원인 파악

옵저버빌리티 있으면:
├── 메트릭: 10:03부터 결제 API 지연 급증
├── 로그: PaymentService에서 timeout 에러
├── 트레이스: 외부 PG사 API 응답 5초
└── 15분 만에 원인 파악
```

---

## 2. Prometheus & Micrometer

### 2.1 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Prometheus 아키텍처                   │
│                                                         │
│   ┌─────────────┐     Pull      ┌─────────────┐        │
│   │   Spring    │ ◀──────────── │ Prometheus  │        │
│   │   Boot App  │  /actuator/   │   Server    │        │
│   │             │  prometheus   │             │        │
│   └─────────────┘               └──────┬──────┘        │
│                                        │                │
│                                        │ Query          │
│                                        ▼                │
│                                 ┌─────────────┐        │
│                                 │   Grafana   │        │
│                                 │  Dashboard  │        │
│                                 └─────────────┘        │
└─────────────────────────────────────────────────────────┘

특징:
- Pull 방식: Prometheus가 앱에서 메트릭을 가져감
- 시계열 DB: 시간에 따른 메트릭 변화 저장
- PromQL: 강력한 쿼리 언어
```

### 2.2 Micrometer의 역할

```
Micrometer = 메트릭의 SLF4J (추상화 계층)

┌─────────────────────────────────────────────────────────┐
│                     Application Code                     │
│                                                         │
│              meterRegistry.counter("orders").increment() │
│                              │                          │
│                              ▼                          │
│                    ┌─────────────────┐                  │
│                    │   Micrometer    │                  │
│                    │  (추상화 계층)   │                  │
│                    └────────┬────────┘                  │
│                             │                           │
│          ┌──────────────────┼──────────────────┐       │
│          ▼                  ▼                  ▼       │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐  │
│   │ Prometheus │    │  Datadog   │    │ CloudWatch │  │
│   │  Registry  │    │  Registry  │    │  Registry  │  │
│   └────────────┘    └────────────┘    └────────────┘  │
└─────────────────────────────────────────────────────────┘

장점: 벤더 중립적 코드 작성, 모니터링 시스템 변경 시 코드 수정 불필요
```

### 2.3 프로젝트 설정

```kotlin
// build.gradle.kts
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("io.micrometer:micrometer-registry-prometheus")
}
```

```yaml
# application-prod.yml
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus
  endpoint:
    health:
      show-details: when_authorized
  prometheus:
    metrics:
      export:
        enabled: true
```

---

## 3. 메트릭 유형

### 3.1 4가지 기본 메트릭 타입

```
┌─────────────────────────────────────────────────────────┐
│  1. Counter (카운터)                                     │
│     - 증가만 가능 (감소 불가)                            │
│     - 예: 총 요청 수, 총 에러 수                         │
│     0 → 1 → 2 → 3 → 4 → 5 → ...                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  2. Gauge (게이지)                                      │
│     - 증가/감소 모두 가능, 현재 상태를 나타냄            │
│     - 예: 현재 메모리 사용량, 활성 스레드 수             │
│     50 → 70 → 45 → 80 → 30 → ...                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  3. Timer (타이머)                                      │
│     - 이벤트 지속 시간 + 발생 횟수                       │
│     - 예: API 응답 시간, 쿼리 실행 시간                  │
│     count: 100, sum: 5.2s, max: 0.5s                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  4. Histogram (히스토그램)                               │
│     - 값의 분포를 버킷으로 측정                          │
│     - 예: 응답 시간 분포 (0-100ms: 50%, 100-500ms: 40%) │
│     bucket_0.1: 50, bucket_0.5: 90, bucket_1.0: 98     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 언제 무엇을 사용하는가?

| 측정 대상 | 메트릭 타입 | 예시 |
|----------|------------|------|
| 누적 개수 | Counter | 주문 수, 에러 수 |
| 현재 상태 | Gauge | 메모리 사용량, 활성 연결 수 |
| 소요 시간 | Timer | API 응답 시간 |
| 값 분포 | Histogram | 응답 시간 백분위 |

---

## 4. 커스텀 비즈니스 메트릭

### 4.1 OrderMetrics 구현

```kotlin
@Component
class OrderMetrics(private val meterRegistry: MeterRegistry) {

    // Counter: 주문 생성 수 (증가만)
    private val orderCreatedCounter: Counter = Counter.builder("marketplace.orders.created")
        .description("Total number of orders created")
        .register(meterRegistry)

    // Counter: 주문 취소 수
    private val orderCancelledCounter: Counter = Counter.builder("marketplace.orders.cancelled")
        .description("Total number of orders cancelled")
        .register(meterRegistry)

    // Counter: 주문 실패 수
    private val orderFailedCounter: Counter = Counter.builder("marketplace.orders.failed")
        .description("Total number of failed order attempts")
        .register(meterRegistry)

    // Timer: 주문 생성 소요 시간
    private val orderCreationTimer: Timer = Timer.builder("marketplace.orders.creation.time")
        .description("Time taken to create an order")
        .register(meterRegistry)

    // Gauge: 현재 활성 주문 수
    private val activeOrders: AtomicInteger = AtomicInteger(0)

    init {
        meterRegistry.gauge("marketplace.orders.active", activeOrders)
    }

    fun incrementOrderCreated() {
        orderCreatedCounter.increment()
        activeOrders.incrementAndGet()
    }

    fun incrementOrderCancelled() {
        orderCancelledCounter.increment()
        activeOrders.decrementAndGet()
    }

    fun <T> timeOrderCreation(block: () -> T): T {
        return orderCreationTimer.recordCallable(block)!!
    }
}
```

### 4.2 서비스에서 활용

```kotlin
@Service
class OrderService(private val orderMetrics: OrderMetrics) {

    fun createOrder(request: CreateOrderRequest): OrderResponse {
        return orderMetrics.timeOrderCreation {
            try {
                val order = processOrder(request)
                orderMetrics.incrementOrderCreated()
                order
            } catch (e: Exception) {
                orderMetrics.incrementOrderFailed()
                throw e
            }
        }
    }
}
```

### 4.3 Prometheus에서 보이는 메트릭

```
# 주문 카운터
marketplace_orders_created_total 150
marketplace_orders_cancelled_total 12
marketplace_orders_failed_total 3

# 활성 주문 (Gauge)
marketplace_orders_active 138

# 주문 생성 시간 (Timer)
marketplace_orders_creation_time_seconds_count 150
marketplace_orders_creation_time_seconds_sum 45.2
marketplace_orders_creation_time_seconds_max 1.2
```

---

## 5. 태그(Label)를 활용한 차원 분석

### 5.1 태그의 중요성

```
태그 없이:
marketplace_orders_created_total 150
→ 전체 주문 수만 알 수 있음

태그 있으면:
marketplace_orders_created_total{status="success",payment="card"} 100
marketplace_orders_created_total{status="success",payment="bank"} 40
marketplace_orders_created_total{status="failed",payment="card"} 10
→ 결제 수단별, 상태별 분석 가능
```

### 5.2 태그 추가 방법

```kotlin
private fun orderCounter(status: String, paymentType: String): Counter {
    return Counter.builder("marketplace.orders")
        .tag("status", status)
        .tag("payment_type", paymentType)
        .register(meterRegistry)
}

fun recordOrder(paymentType: String, success: Boolean) {
    val status = if (success) "success" else "failed"
    orderCounter(status, paymentType).increment()
}
```

### 5.3 PromQL로 분석

```promql
# 전체 주문 수
sum(marketplace_orders_created_total)

# 결제 수단별 주문 수
sum by (payment_type) (marketplace_orders_created_total)

# 실패율
sum(marketplace_orders_created_total{status="failed"})
  / sum(marketplace_orders_created_total) * 100

# 최근 5분간 초당 주문 수
rate(marketplace_orders_created_total[5m])
```

---

## 6. 헬스체크 (Health Check)

### 6.1 헬스체크의 역할

```
"이 서비스가 정상인가?"를 판단하는 엔드포인트

GET /actuator/health

{
  "status": "UP",          ← 전체 상태
  "components": {
    "db": { "status": "UP" },          ← DB 연결 OK
    "redis": { "status": "UP" },       ← Redis OK
    "kafka": { "status": "UP" },       ← Kafka OK
    "diskSpace": { "status": "UP" }    ← 디스크 OK
  }
}

활용:
- Kubernetes: Liveness/Readiness Probe
- 로드밸런서: 정상 인스턴스만 트래픽 전달
- 모니터링: 장애 감지 및 알림
```

### 6.2 커스텀 HealthIndicator

```kotlin
@Component
@Profile("docker", "prod")
class RedisHealthIndicator(
    private val redisConnectionFactory: RedisConnectionFactory
) : HealthIndicator {

    override fun health(): Health {
        return try {
            val connection = redisConnectionFactory.connection
            val pong = connection.ping()
            connection.close()

            if (pong != null) {
                Health.up()
                    .withDetail("status", "Redis is available")
                    .withDetail("response", pong)
                    .build()
            } else {
                Health.down()
                    .withDetail("status", "Redis ping returned null")
                    .build()
            }
        } catch (e: Exception) {
            Health.down(e)
                .withDetail("status", "Redis is unavailable")
                .withDetail("error", e.message)
                .build()
        }
    }
}
```

### 6.3 Kubernetes Probe 설정

```yaml
spec:
  containers:
    - name: marketplace-api
      livenessProbe:           # 살아있는지?
        httpGet:
          path: /actuator/health
          port: 8080
        initialDelaySeconds: 60
        periodSeconds: 10
        failureThreshold: 3    # 3번 실패하면 재시작

      readinessProbe:          # 트래픽 받을 준비 됐는지?
        httpGet:
          path: /actuator/health
          port: 8080
        initialDelaySeconds: 30
        periodSeconds: 5
        failureThreshold: 3    # 3번 실패하면 트래픽 제외
```

### 6.4 Liveness vs Readiness

| Probe | 목적 | 실패 시 |
|-------|------|--------|
| **Liveness** | 컨테이너 생존 확인 | 재시작 |
| **Readiness** | 트래픽 수신 준비 확인 | 서비스 제외 |

```
예시 시나리오:
1. Pod 시작
   Liveness: 체크 안 함 (initialDelaySeconds 대기)
   Readiness: FAIL → 트래픽 안 받음

2. 앱 초기화 완료
   Liveness: UP
   Readiness: UP → 트래픽 받기 시작

3. DB 연결 끊김
   Liveness: UP (앱 자체는 살아있음)
   Readiness: DOWN → 트래픽 중단

4. 앱 데드락
   Liveness: FAIL → 컨테이너 재시작
```

---

## 7. 유용한 PromQL 쿼리

### 7.1 RED Method (요청 기반 서비스)

```promql
# Rate: 초당 요청 수
rate(http_server_requests_seconds_count[5m])

# Errors: 에러율 (%)
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
  / sum(rate(http_server_requests_seconds_count[5m])) * 100

# Duration: 평균 응답 시간
rate(http_server_requests_seconds_sum[5m])
  / rate(http_server_requests_seconds_count[5m])

# Duration: 95퍼센타일 응답 시간
histogram_quantile(0.95,
  rate(http_server_requests_seconds_bucket[5m]))
```

### 7.2 USE Method (리소스)

```promql
# Utilization: JVM 메모리 사용률
jvm_memory_used_bytes{area="heap"}
  / jvm_memory_max_bytes{area="heap"} * 100

# Saturation: HikariCP 대기 스레드
hikaricp_connections_pending

# Errors: DB 연결 타임아웃
hikaricp_connections_timeout_total
```

### 7.3 비즈니스 메트릭

```promql
# 분당 주문 수
rate(marketplace_orders_created_total[1m]) * 60

# 주문 성공률
sum(marketplace_orders_created_total{status="success"})
  / sum(marketplace_orders_created_total) * 100
```

---

## 8. 알림 설정 예시

```yaml
# Prometheus alerting rules
groups:
  - name: marketplace-alerts
    rules:
      # 에러율 5% 초과
      - alert: HighErrorRate
        expr: |
          sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
          / sum(rate(http_server_requests_seconds_count[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"

      # 응답 시간 2초 초과
      - alert: SlowResponseTime
        expr: |
          histogram_quantile(0.95,
            rate(http_server_requests_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow response time"

      # 서비스 다운
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.instance }} is down"
```

---

## 9. 핵심 정리

| 개념 | 설명 | 도구 |
|------|------|------|
| **Metrics** | 수치 기반 시계열 데이터 | Prometheus + Micrometer |
| **Logs** | 상세 이벤트 기록 | ELK, Loki |
| **Traces** | 분산 요청 추적 | Jaeger, Zipkin |
| **Counter** | 누적 카운터 (증가만) | 요청 수, 에러 수 |
| **Gauge** | 현재 상태 (증감 가능) | 메모리, 연결 수 |
| **Timer** | 소요 시간 + 횟수 | API 응답 시간 |
| **HealthCheck** | 서비스 상태 확인 | Kubernetes Probe |

---

## 시리즈를 마치며

지금까지 6편에 걸쳐 대용량 트래픽 처리를 위한 스프링부트 실무 기법들을 다뤘습니다.

| 편 | 주제 | 핵심 기술 |
|---|------|----------|
| 1편 | 동시성 제어 | Atomic UPDATE, 멱등성 키 |
| 2편 | 캐싱 전략 | Redis, Caffeine, Cache-Aside |
| 3편 | 이벤트 드리븐 | Kafka, Outbox 패턴 |
| 4편 | Resilience 패턴 | Circuit Breaker, Rate Limiter |
| 5편 | DB 최적화 | 인덱스, 커서 페이지네이션, Read Replica |
| 6편 | 모니터링 | Prometheus, Grafana, 커스텀 메트릭 |

이 시리즈에서 다룬 내용들은 실제 대규모 서비스에서 공통적으로 사용되는 패턴들입니다. 코드를 직접 작성하고 테스트해보면서 각 기술이 어떤 문제를 해결하는지 체감해보시길 권합니다.
