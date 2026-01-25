---
title: "스프링부트 실무 가이드 4편: Resilience 패턴"
description: "Circuit Breaker, Rate Limiter, Bulkhead로 장애에 강한 시스템 구축하기"
pubDate: 2026-01-25T13:00:00
tags: ["Spring Boot", "Resilience4j", "Circuit Breaker", "Backend", "실무가이드"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [3편: 이벤트 드리븐](/blog/springboot-practical-guide-3) | **4편: Resilience 패턴** | [5편: DB 최적화](/blog/springboot-practical-guide-5) |

---

## TL;DR (핵심 요약)

```
Circuit Breaker = 장애 전파 방지 (CLOSED → OPEN → HALF-OPEN)
Rate Limiter = 초당 요청 수 제한 (DDoS/남용 방지)
Bulkhead = 리소스 격리 (한 서비스 장애가 다른 서비스에 영향 X)
Retry = 일시적 장애 대응 (멱등한 작업만!)
```

| 패턴 | 목적 | 사용 시점 |
|------|------|----------|
| **Circuit Breaker** | 장애 서비스 호출 차단 | 외부 API, 의존 서비스 호출 |
| **Rate Limiter** | 과도한 요청 차단 | API 엔드포인트 보호 |
| **Bulkhead** | 리소스 격리 | 중요 서비스 보호 |
| **Retry** | 일시적 장애 복구 | 네트워크 오류, 타임아웃 |

---

## 1. 왜 Resilience 패턴이 필요한가?

### 1.1 분산 시스템의 현실

```
마이크로서비스 환경:

[Client] ──▶ [API Gateway] ──▶ [OrderService]
                                     │
                   ┌─────────────────┼─────────────────┐
                   ▼                 ▼                 ▼
            [PaymentService]  [InventoryService]  [EmailService]
                   │                 │                 │
                   ▼                 ▼                 ▼
              [외부 PG사]        [DB]             [SMTP 서버]

→ 어느 하나라도 느려지거나 죽으면?
```

**장애는 반드시 발생한다:**

| 장애 유형 | 예시 | 발생 빈도 |
|----------|------|----------|
| 네트워크 지연 | 타임아웃, 패킷 손실 | 매우 흔함 |
| 서비스 다운 | OOM, 배포 실패 | 흔함 |
| 의존성 장애 | DB 연결 풀 고갈, 외부 API 다운 | 흔함 |
| 리소스 고갈 | CPU 100%, 디스크 풀 | 가끔 |

### 1.2 장애 전파 (Cascading Failure)

```
1. EmailService가 느려짐 (응답 5초)

2. OrderService가 EmailService 호출 시 대기
   ┌─────────────────────────────────────────┐
   │ OrderService 스레드 풀 (20개)            │
   │                                         │
   │ [대기] [대기] [대기] [대기] [대기]        │
   │ [대기] [대기] [대기] [대기] [대기]        │
   │ [대기] [대기] [대기] [대기] [대기]        │
   │ [대기] [대기] [대기] [대기] [대기]        │
   │                                         │
   │ → 모든 스레드가 EmailService 응답 대기   │
   └─────────────────────────────────────────┘

3. 새 주문 요청 처리 불가 → OrderService도 다운

4. OrderService에 의존하는 다른 서비스도 영향

→ 하나의 느린 서비스가 전체 시스템을 마비시킴
```

### 1.3 Resilience 패턴의 목표

| 목표 | 설명 |
|------|------|
| **장애 격리** | 한 서비스 장애가 다른 서비스로 전파되지 않음 |
| **빠른 실패** | 느린 응답보다 빠른 에러가 나음 |
| **우아한 저하** | 일부 기능이 안 되더라도 핵심 기능은 동작 |
| **자동 복구** | 장애 서비스가 복구되면 자동으로 정상화 |

---

## 2. Circuit Breaker 패턴

### 2.1 전기 차단기에서 이름을 따옴

```
실제 전기 차단기:
과전류 발생 → 차단기 내림 → 화재 방지

소프트웨어 Circuit Breaker:
장애 감지 → 호출 차단 → 시스템 보호
```

### 2.2 3가지 상태

```
                  실패율 < 임계값
              ┌───────────────────┐
              │                   │
              ▼                   │
         ┌─────────┐              │
         │ CLOSED  │──────────────┘
         │ (정상)   │
         └────┬────┘
              │ 실패율 >= 임계값
              ▼
         ┌─────────┐
         │  OPEN   │ ← 모든 요청 즉시 실패
         │ (차단)   │
         └────┬────┘
              │ 대기 시간 경과
              ▼
         ┌─────────┐
         │HALF-OPEN│ ← 일부 요청만 허용
         │ (테스트) │
         └────┬────┘
              │
      ┌───────┴───────┐
      │               │
   성공률 높음     실패 계속
      │               │
      ▼               ▼
   CLOSED           OPEN
```

### 2.3 프로젝트 설정

```yaml
# application.yml
resilience4j:
  circuitbreaker:
    instances:
      orderService:
        sliding-window-size: 10           # 최근 10개 요청 기준
        failure-rate-threshold: 50        # 50% 이상 실패 시 OPEN
        wait-duration-in-open-state: 10s  # 10초 후 HALF-OPEN
        permitted-number-of-calls-in-half-open-state: 3  # 테스트 요청 3개
        slow-call-duration-threshold: 2s  # 2초 이상이면 느린 호출
        slow-call-rate-threshold: 50      # 느린 호출 50% 이상이면 OPEN
        ignore-exceptions:
          - com.example.marketplace.common.BusinessException  # 비즈니스 예외는 무시
```

**설정 해석:**

| 설정 | 의미 |
|------|------|
| `sliding-window-size: 10` | 최근 10개 요청의 성공/실패를 추적 |
| `failure-rate-threshold: 50` | 10개 중 5개 이상 실패하면 차단 |
| `wait-duration-in-open-state: 10s` | 차단 후 10초 뒤에 테스트 |
| `slow-call-duration-threshold: 2s` | 2초 넘으면 "느린 호출"로 간주 |
| `ignore-exceptions` | BusinessException은 장애로 안 침 |

### 2.4 코드 적용

```kotlin
// OrderService.kt
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // 정상 로직
    return OrderResponse.from(savedOrder)
}

// 차단 시 호출되는 fallback
private fun createOrderFallback(
    buyerId: Long,
    req: CreateOrderRequest,
    ex: Throwable
): OrderResponse {
    log.error("Circuit breaker fallback: ${ex.message}")
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}
```

### 2.5 동작 시나리오

```
시나리오: DB 연결 장애 발생

Time 0s:  요청 1 - 성공
Time 1s:  요청 2 - 성공
Time 2s:  요청 3 - 실패 (DB timeout)
Time 3s:  요청 4 - 실패
Time 4s:  요청 5 - 실패
Time 5s:  요청 6 - 실패
Time 6s:  요청 7 - 실패
          → 실패율 71% (5/7) > 50% → OPEN 상태로 전환

Time 7s:  요청 8 - 즉시 실패 (DB 호출 안 함)
Time 8s:  요청 9 - 즉시 실패
          ...
Time 16s: HALF-OPEN으로 전환
          요청 10 - 성공
          요청 11 - 성공
          요청 12 - 성공
          → 3개 모두 성공 → CLOSED로 복구
```

---

## 3. Rate Limiter (처리율 제한)

### 3.1 왜 필요한가?

```
문제 상황:
┌─────────────────────────────────────────┐
│ 악의적 사용자 or 버그 있는 클라이언트     │
│                                         │
│ 초당 10,000건 요청 발생                  │
│          │                              │
│          ▼                              │
│ ┌─────────────────┐                     │
│ │   서버 과부하    │ → 정상 사용자도 피해 │
│ │   응답 지연      │                     │
│ │   메모리 부족    │                     │
│ └─────────────────┘                     │
└─────────────────────────────────────────┘
```

### 3.2 Resilience4j RateLimiter 옵션

Resilience4j는 **토큰 버킷** 알고리즘 기반의 RateLimiter를 제공합니다.

#### 핵심 설정 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `limitForPeriod` | 한 주기에 허용되는 요청 수 | 50 |
| `limitRefreshPeriod` | 권한(토큰)이 리프레시되는 주기 | 500ns |
| `timeoutDuration` | 권한 획득 대기 시간 (0이면 즉시 거부) | 5s |

#### 설정 상세 설명

```yaml
resilience4j:
  ratelimiter:
    instances:
      orderCreation:
        limit-for-period: 10        # 주기당 10개 요청 허용
        limit-refresh-period: 1s    # 1초마다 토큰 리필
        timeout-duration: 0s        # 대기 없이 즉시 거부
```

**동작 방식 (토큰 버킷):**

```
┌─────────────────────────────────────────────────────────────┐
│  토큰 버킷 (limit-for-period: 10)                            │
│                                                             │
│  [●] [●] [●] [●] [●] [●] [●] [●] [●] [●]  ← 10개 토큰       │
│                                                             │
│  요청 1: 토큰 소비 → [●] [●] [●] [●] [●] [●] [●] [●] [●]    │
│  요청 2: 토큰 소비 → [●] [●] [●] [●] [●] [●] [●] [●]        │
│  ...                                                        │
│  요청 10: 토큰 소비 → [ ] (빈 버킷)                          │
│  요청 11: 토큰 없음 → 거부 or 대기                           │
│                                                             │
│  1초 후 (limit-refresh-period):                             │
│  토큰 리필 → [●] [●] [●] [●] [●] [●] [●] [●] [●] [●]        │
└─────────────────────────────────────────────────────────────┘
```

#### timeoutDuration 동작

```
timeout-duration: 0s (즉시 거부)
─────────────────────────────────
요청 11 도착 → 토큰 없음 → 즉시 RequestNotPermitted 예외

timeout-duration: 5s (최대 5초 대기)
─────────────────────────────────
요청 11 도착 → 토큰 없음 → 최대 5초 대기
  └── 5초 내 토큰 리필되면 → 요청 처리
  └── 5초 지나도 토큰 없으면 → RequestNotPermitted 예외
```

#### 사용자별 Rate Limiting (고급)

```kotlin
// IP 또는 사용자 ID별로 다른 RateLimiter 적용
fun getRateLimiterForUser(userId: String): RateLimiter {
    return rateLimiterRegistry.rateLimiter(
        "user-$userId",
        RateLimiterConfig.custom()
            .limitForPeriod(10)
            .limitRefreshPeriod(Duration.ofSeconds(1))
            .timeoutDuration(Duration.ZERO)
            .build()
    )
}
```

#### 이벤트 리스너

```kotlin
// RateLimiter 이벤트 모니터링
val rateLimiter = rateLimiterRegistry.rateLimiter("orderCreation")

rateLimiter.eventPublisher
    .onSuccess { event ->
        log.debug("Rate limit 통과: ${event.rateLimiterName}")
    }
    .onFailure { event ->
        log.warn("Rate limit 초과: ${event.rateLimiterName}")
    }
```

#### 메트릭

```
# Prometheus 메트릭
resilience4j_ratelimiter_available_permissions{name="orderCreation"} 8
resilience4j_ratelimiter_waiting_threads{name="orderCreation"} 0
resilience4j_ratelimiter_calls_total{name="orderCreation", kind="successful"} 100
resilience4j_ratelimiter_calls_total{name="orderCreation", kind="failed"} 5
```

### 3.3 프로젝트 설정

```yaml
# application.yml
resilience4j:
  ratelimiter:
    instances:
      default:
        limit-for-period: 100       # 1초에 100개 허용
        limit-refresh-period: 1s    # 1초마다 리셋
        timeout-duration: 0s        # 대기 없이 즉시 거부
      orderCreation:
        limit-for-period: 10        # 주문 생성은 초당 10개만
        limit-refresh-period: 1s
        timeout-duration: 0s
```

### 3.4 Spring Filter에서 Resilience4j 활용

```kotlin
// RateLimitingFilter.kt
@Component
class RateLimitingFilter(
    private val rateLimiterRegistry: RateLimiterRegistry
) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        // 요청 경로에 따라 다른 Rate Limiter 적용
        val rateLimiterName = determineRateLimiter(request)
        val rateLimiter = rateLimiterRegistry.rateLimiter(rateLimiterName)

        if (rateLimiter.acquirePermission()) {
            filterChain.doFilter(request, response)  // 허용
        } else {
            handleRateLimitExceeded(response)        // 429 응답
        }
    }

    private fun determineRateLimiter(request: HttpServletRequest): String {
        return when {
            // 주문 생성 API는 더 엄격하게
            request.requestURI.startsWith("/api/v1/orders")
                && request.method == "POST" -> "orderCreation"
            else -> "default"
        }
    }
}
```

### 3.5 응답 예시

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
    "success": false,
    "code": "RATE_LIMITED",
    "message": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
}
```

### 3.6 Rate Limiting 알고리즘 상세

#### 1) 고정 윈도우 (Fixed Window)

```
시간을 고정된 구간으로 나눠서 카운팅

limit: 초당 10개

00:00:00 ~ 00:00:01 (윈도우 1)
├── 요청 1~10: ✅ 허용
└── 요청 11: ❌ 거부

00:00:01 ~ 00:00:02 (윈도우 2)
├── 카운터 리셋
└── 요청 1~10: ✅ 허용

문제: 경계 시점 버스트
────────────────────────────────────
00:00:00.9에 10개 요청 ✅
00:00:01.1에 10개 요청 ✅
→ 0.2초 동안 20개 요청 통과 (의도한 2배!)
```

**장점**: 구현 간단, 메모리 효율적
**단점**: 윈도우 경계에서 버스트 허용

---

#### 2) 슬라이딩 윈도우 (Sliding Window)

```
현재 시점 기준으로 최근 N초를 계산

limit: 1초당 10개

현재 시각: 00:00:01.5
슬라이딩 윈도우: 00:00:00.5 ~ 00:00:01.5

┌─────────────────────────────────────────────────┐
│ 시간축                                           │
│ 0.0   0.5   1.0   1.5   2.0                     │
│  │     │     │     │     │                      │
│  ├─────┴─────┤     │                            │
│  │  이전 윈도우 │     │                            │
│        ├─────┴─────┤                            │
│        │ 슬라이딩 윈도우│ ← 현재 기준               │
└─────────────────────────────────────────────────┘

계산 방식:
- 이전 윈도우 요청 수: 8개
- 현재 윈도우 요청 수: 4개 (1.0~1.5에 발생)
- 이전 윈도우 가중치: 50% (0.5초/1초)
- 예상 요청 수: 8 * 0.5 + 4 = 8개
- 10개 미만이므로 → ✅ 허용
```

**장점**: 경계 버스트 문제 해결
**단점**: 계산 복잡, 약간의 메모리 추가

---

#### 3) 토큰 버킷 (Token Bucket) - Resilience4j 사용

```
버킷에 일정 속도로 토큰이 채워지고, 요청 시 토큰 소비

설정: limit-for-period: 10, limit-refresh-period: 1s

┌─────────────────────────────────────────────────┐
│  토큰 버킷                                       │
│  ┌─────────────────────────────────┐            │
│  │ [●][●][●][●][●][●][●][●][●][●] │ ← 10개     │
│  └─────────────────────────────────┘            │
│         ↑                                       │
│    1초마다 10개 리필                              │
│    (비어있는 만큼만)                              │
└─────────────────────────────────────────────────┘

시나리오:
T=0.0s: 버킷 [●●●●●●●●●●] (10개)
T=0.1s: 요청 5개 → [●●●●●] (5개 남음)
T=0.2s: 요청 3개 → [●●] (2개 남음)
T=0.3s: 요청 5개 → 2개만 처리, 3개 거부 or 대기
T=1.0s: 리필 → [●●●●●●●●●●] (10개)

버스트 허용:
────────────────────────────────────
한동안 요청이 없으면 토큰이 쌓여있음
→ 순간적으로 많은 요청 처리 가능 (버스트)
→ 평균적으로는 limit 유지
```

**장점**: 버스트 허용, 부드러운 제한
**단점**: 순간 트래픽 급증 가능

---

#### 4) Leaky 버킷 (Leaky Bucket)

```
버킷에 요청이 쌓이고, 일정 속도로 "흘러나감"

처리 속도: 초당 10개 (100ms마다 1개)

┌─────────────────────────────────────────────────┐
│  요청 도착                                       │
│      ↓ ↓ ↓ ↓ ↓                                  │
│  ┌─────────────────────────────────┐            │
│  │  [ ][ ][ ][●][●][●][●][●]      │ ← 큐       │
│  └─────────────────────────────────┘            │
│                              ↓                  │
│                         일정 속도로              │
│                         처리 (흘러나감)          │
│                              ↓                  │
│                          [처리됨]               │
└─────────────────────────────────────────────────┘

특징:
- 아무리 요청이 몰려도 처리 속도는 일정
- 버킷(큐)이 가득 차면 새 요청 거부
- 트래픽을 "균일하게" 만듦
```

**장점**: 균일한 처리 속도, 백엔드 보호
**단점**: 버스트 불허, 지연 발생

---

#### 알고리즘 비교 요약

| 알고리즘 | 버스트 | 정확도 | 구현 복잡도 | 사용처 |
|----------|--------|--------|------------|--------|
| 고정 윈도우 | 경계에서 2배 | 낮음 | 매우 간단 | 간단한 API 제한 |
| 슬라이딩 윈도우 | 없음 | 높음 | 중간 | 정교한 제한 필요 시 |
| **토큰 버킷** | 허용 | 중간 | 중간 | **Resilience4j, 대부분의 경우** |
| Leaky 버킷 | 없음 | 높음 | 중간 | 균일한 처리 필요 시 |

#### Resilience4j가 토큰 버킷을 사용하는 이유

```
1. 버스트 허용
   - 실제 트래픽은 불균일함
   - 순간적인 요청 증가를 자연스럽게 처리

2. 구현 효율성
   - AtomicInteger로 토큰 카운트만 관리
   - 요청 히스토리 저장 불필요

3. 설정 직관성
   - "1초에 10개" = limit-for-period: 10, limit-refresh-period: 1s
   - 이해하기 쉬움
```

---

## 4. Bulkhead 패턴 (격벽)

### 4.1 배의 격벽에서 유래

```
배의 구조:
┌─────┬─────┬─────┬─────┐
│     │     │     │     │
│ 격실1│ 격실2│ 격실3│ 격실4│
│     │     │     │     │
└─────┴─────┴─────┴─────┘
    │
    └── 한 격실에 물이 차도 다른 격실은 안전

소프트웨어 Bulkhead:
┌─────────────────────────────────────────┐
│              스레드 풀 분리               │
│                                         │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│ │주문 처리 │  │상품 조회 │  │결제 처리 │  │
│ │ 20 스레드│  │ 30 스레드│  │ 10 스레드│  │
│ └─────────┘  └─────────┘  └─────────┘  │
│      │                                  │
│      └── 주문 처리가 느려져도            │
│          상품 조회는 영향 없음           │
└─────────────────────────────────────────┘
```

### 4.2 프로젝트 설정

```yaml
# application.yml
resilience4j:
  bulkhead:
    instances:
      orderService:
        max-concurrent-calls: 20     # 동시 처리 최대 20개
        max-wait-duration: 0s        # 대기 없이 즉시 거부
```

### 4.3 코드 적용

```kotlin
// OrderService.kt
@Bulkhead(name = "orderService")  // 동시에 20개까지만
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // ...
}
```

### 4.4 동작 시나리오

```
설정: max-concurrent-calls = 20

현재 상태:
┌─────────────────────────────────────────┐
│ OrderService Bulkhead                   │
│                                         │
│ 처리 중: [1] [2] [3] ... [18] [19] [20] │
│                                         │
│ 슬롯: 20/20 사용 중                      │
└─────────────────────────────────────────┘

새 요청 21번 도착:
→ max-wait-duration: 0s 이므로 즉시 거부
→ BulkheadFullException 발생
→ Fallback 호출 또는 503 Service Unavailable
```

---

## 5. Retry 패턴

### 5.1 일시적 장애 대응

```
네트워크 일시 단절:
요청 1: ❌ 실패 (네트워크 순간 끊김)
요청 2: ✅ 성공 (0.5초 후 복구됨)

→ 재시도하면 성공할 수 있는 상황
```

### 5.2 프로젝트 설정

```yaml
# application.yml
resilience4j:
  retry:
    instances:
      orderService:
        max-attempts: 3              # 최대 3번 시도
        wait-duration: 500ms         # 재시도 간격 500ms
        retry-exceptions:
          - java.io.IOException          # 네트워크 에러만 재시도
          - java.util.concurrent.TimeoutException
```

### 5.3 코드 적용

```kotlin
// OrderService.kt
@Retry(name = "orderService")
@Bulkhead(name = "orderService")
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // IOException 발생 시 자동으로 재시도
}
```

### 5.4 주의: 멱등성

```
문제 상황:
┌─────────────────────────────────────────┐
│ 1차 시도: 주문 생성 요청                  │
│           DB에 저장 완료                 │
│           응답 반환 중 네트워크 끊김       │
│                                         │
│ 2차 시도: 같은 요청 재시도                │
│           DB에 또 저장 → 주문 중복!!      │
└─────────────────────────────────────────┘

해결: 멱등키(Idempotency Key) 사용
POST /api/v1/orders
Idempotency-Key: abc-123-def

→ 같은 키로 요청 시 이전 결과 반환 (새로 생성 안 함)
```

### 5.5 Retry vs Circuit Breaker

| 상황 | Retry | Circuit Breaker |
|------|-------|-----------------|
| 일시적 장애 | 재시도로 성공 가능 | - |
| 지속적 장애 | 계속 실패, 리소스 낭비 | 빠르게 실패, 보호 |
| 조합 | Retry 먼저 → 실패 누적 → Circuit Breaker 발동 |

---

## 6. 패턴 조합

### 6.1 적용 순서

```kotlin
// OrderService.kt
@Retry(name = "orderService")                                    // 3. 재시도
@Bulkhead(name = "orderService")                                 // 2. 동시성 제한
@CircuitBreaker(name = "orderService", fallbackMethod = "...")   // 1. 차단기
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // 실행
}

실행 순서 (바깥쪽부터):
[CircuitBreaker] → [Bulkhead] → [Retry] → [실제 로직]

요청 처리 흐름:
1. CircuitBreaker: OPEN이면 즉시 fallback
2. Bulkhead: 슬롯 없으면 거부
3. Retry: 실패 시 재시도
4. 실제 로직 실행
```

### 6.2 전체 흐름

```
요청 도착
    │
    ▼
┌─────────────────┐
│ RateLimiter     │ → 초과 시 429 응답
│ (HTTP 필터)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ CircuitBreaker  │ → OPEN이면 즉시 fallback
│                 │
└────────┬────────┘
         │ CLOSED
         ▼
┌─────────────────┐
│ Bulkhead        │ → 슬롯 없으면 거부
│                 │
└────────┬────────┘
         │ 슬롯 확보
         ▼
┌─────────────────┐
│ Retry           │ → 실패 시 재시도 (최대 3회)
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 비즈니스 로직    │
│                 │
└─────────────────┘
```

---

## 7. Fallback 전략

### 7.1 Fallback 유형

```kotlin
// 1. 기본값 반환
private fun getProductsFallback(ex: Throwable): List<ProductResponse> {
    return emptyList()  // 빈 목록 반환
}

// 2. 캐시된 데이터 반환
private fun getProductsFallback(ex: Throwable): List<ProductResponse> {
    return cachedProducts ?: emptyList()
}

// 3. 에러 응답
private fun createOrderFallback(ex: Throwable): OrderResponse {
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}

// 4. 대체 서비스 호출
private fun getRecommendationsFallback(ex: Throwable): List<Product> {
    return fallbackRecommendationService.getPopularProducts()
}
```

### 7.2 프로젝트의 Fallback

```kotlin
// OrderService.kt - 주문 생성 실패 시
private fun createOrderFallback(
    buyerId: Long,
    req: CreateOrderRequest,
    ex: Throwable
): OrderResponse {
    log.error("Circuit breaker fallback triggered for createOrder. " +
              "Buyer: $buyerId, Error: ${ex.message}")
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}

// ProductService.kt - 상품 검색 실패 시
private fun searchProductsFallback(
    req: ProductSearchRequest,
    pageable: Pageable,
    ex: Throwable
): Page<ProductResponse> {
    log.error("Circuit breaker fallback triggered for searchProducts. " +
              "Error: ${ex.message}")
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}
```

### 7.3 Fallback 선택 기준

| 기능 유형 | Fallback 전략 | 예시 |
|----------|--------------|------|
| **핵심 기능** | 에러 전파 | 결제 실패 → 에러 반환 |
| **부가 기능** | 기본값/캐시 | 추천 실패 → 인기 상품 |
| **조회 기능** | 캐시 데이터 | 상품 조회 실패 → 캐시 반환 |

---

## 8. 모니터링

### 8.1 Actuator 엔드포인트

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, circuitbreakers, ratelimiters
  endpoint:
    health:
      show-details: when_authorized
```

### 8.2 Circuit Breaker 상태 확인

```bash
# Circuit Breaker 상태 조회
curl http://localhost:8080/actuator/circuitbreakers

{
  "circuitBreakers": {
    "orderService": {
      "state": "CLOSED",
      "failureRate": "0.0%",
      "slowCallRate": "0.0%",
      "numberOfFailedCalls": 0,
      "numberOfSlowCalls": 0
    }
  }
}
```

### 8.3 메트릭

```
resilience4j.circuitbreaker.state{name="orderService"} 0  # 0=CLOSED, 1=OPEN, 2=HALF_OPEN
resilience4j.circuitbreaker.failure.rate{name="orderService"} 0.0
resilience4j.ratelimiter.available.permissions{name="default"} 100
resilience4j.bulkhead.available.concurrent.calls{name="orderService"} 20
```

---

## 9. 설정 튜닝 가이드

### 9.1 Circuit Breaker 튜닝

```yaml
# 보수적인 설정 (장애에 민감)
sliding-window-size: 5
failure-rate-threshold: 30
wait-duration-in-open-state: 30s

# 관대한 설정 (일시적 장애 허용)
sliding-window-size: 20
failure-rate-threshold: 70
wait-duration-in-open-state: 5s
```

### 9.2 Rate Limiter 튜닝

```yaml
# 엄격한 제한 (DDoS 방어)
limit-for-period: 10
limit-refresh-period: 1s

# 느슨한 제한 (일반 사용)
limit-for-period: 1000
limit-refresh-period: 1s
```

### 9.3 환경별 설정

| 환경 | Rate Limit | Circuit Breaker | Bulkhead |
|------|-----------|-----------------|----------|
| 개발 | 높게 | 느슨하게 | 높게 |
| 스테이징 | 프로덕션과 동일 | 동일 | 동일 |
| 프로덕션 | 적절히 | 적절히 | 적절히 |

---

## 10. FAQ (면접 대비)

### Q1. Circuit Breaker 패턴을 사용하는 이유는?

장애가 발생한 서비스에 계속 요청하면:
- 스레드가 대기하며 리소스 낭비
- 타임아웃 누적으로 응답 지연
- 결국 호출하는 쪽도 장애

Circuit Breaker는 실패율이 임계값을 넘으면 요청을 차단하여:
- 빠른 실패 (Fast Fail)
- 장애 격리
- 장애 서비스에 회복 시간 제공

### Q2. Circuit Breaker의 3가지 상태를 설명해주세요.

| 상태 | 설명 |
|------|------|
| **CLOSED** | 정상 상태. 모든 요청 통과 |
| **OPEN** | 차단 상태. 모든 요청 즉시 실패 |
| **HALF-OPEN** | 테스트 상태. 일부 요청만 통과시켜 복구 확인 |

### Q3. Rate Limiting과 Bulkhead의 차이는?

| 구분 | Rate Limiting | Bulkhead |
|------|--------------|----------|
| 제한 대상 | 시간당 요청 수 | 동시 실행 수 |
| 목적 | 과도한 트래픽 방지 | 리소스 격리 |
| 예시 | 초당 100개 | 동시 20개 |
| 적용 위치 | 주로 API Gateway, 필터 | 서비스 메서드 |

### Q4. Retry 패턴 사용 시 주의할 점은?

1. **멱등성 보장**: 재시도해도 결과가 같아야 함
2. **재시도 대상 선별**: 일시적 장애만 재시도 (IOException 등)
3. **지수 백오프**: 재시도 간격을 점점 늘림 (500ms → 1s → 2s)
4. **최대 횟수 제한**: 무한 재시도 방지

### Q5. Circuit Breaker와 Retry를 함께 사용하면?

```
Retry가 먼저 실행되고, 실패가 누적되면 Circuit Breaker가 발동:

요청 → Retry(3회) → 모두 실패 → Circuit Breaker 실패 카운트 +1
요청 → Retry(3회) → 모두 실패 → Circuit Breaker 실패 카운트 +2
...
실패율 50% 초과 → Circuit Breaker OPEN
→ 이후 요청은 Retry 없이 즉시 실패
```

### Q6. Fallback 전략에는 어떤 것들이 있나요?

| 전략 | 설명 | 사용 사례 |
|------|------|----------|
| 기본값 반환 | 빈 목록, 기본 객체 | 목록 조회 |
| 캐시 반환 | 이전에 캐시한 데이터 | 자주 안 바뀌는 데이터 |
| 에러 응답 | 503 Service Unavailable | 핵심 기능 |
| 대체 서비스 | 백업 서비스 호출 | 고가용성 필요 |

---

## 11. 프로젝트 파일 구조

```
marketplace-api/
├── src/main/kotlin/.../
│   ├── config/
│   │   └── RateLimitingFilter.kt     # HTTP Rate Limiting
│   │
│   ├── order/
│   │   └── OrderService.kt           # @CircuitBreaker, @Bulkhead, @Retry
│   │
│   ├── product/
│   │   └── ProductService.kt         # @CircuitBreaker
│   │
│   └── common/
│       └── ErrorCode.kt              # RATE_LIMITED, SERVICE_UNAVAILABLE
│
└── src/main/resources/
    └── application.yml               # Resilience4j 설정
```

---

## 요약

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ✅ Circuit Breaker = 장애 전파 방지                        │
│     - CLOSED → OPEN → HALF-OPEN 상태 전이                  │
│     - 장애 서비스 호출 차단으로 리소스 보호                  │
│                                                             │
│  ✅ Rate Limiter = 과도한 요청 차단                         │
│     - 토큰 버킷 알고리즘                                    │
│     - 초당/분당 요청 수 제한                                │
│     - DDoS, API 남용 방지                                   │
│                                                             │
│  ✅ Bulkhead = 리소스 격리                                  │
│     - 동시 실행 수 제한                                     │
│     - 한 서비스 장애가 다른 서비스에 영향 X                  │
│                                                             │
│  ✅ Retry = 일시적 장애 복구                                │
│     - 네트워크 오류 등 일시적 장애 대응                     │
│     - 멱등한 작업에만 적용!                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

> **다음 편**: [스프링부트 실무 가이드 5편: 데이터베이스 최적화](/blog/springboot-practical-guide-5)
