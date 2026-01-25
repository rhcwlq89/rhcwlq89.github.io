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

---

## 2. Circuit Breaker 패턴

### 2.1 3가지 상태

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

### 2.2 설정 예시

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
          - com.example.marketplace.common.BusinessException
```

### 2.3 코드 적용

```kotlin
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

### 2.4 동작 시나리오

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

### 3.2 설정 예시

```yaml
resilience4j:
  ratelimiter:
    instances:
      orderCreation:
        limit-for-period: 10        # 주기당 10개 요청 허용
        limit-refresh-period: 1s    # 1초마다 토큰 리필
        timeout-duration: 0s        # 대기 없이 즉시 거부
```

### 3.3 Filter에서 적용

```kotlin
@Component
class RateLimitingFilter(
    private val rateLimiterRegistry: RateLimiterRegistry
) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
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
            request.requestURI.startsWith("/api/v1/orders")
                && request.method == "POST" -> "orderCreation"
            else -> "default"
        }
    }
}
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

### 4.2 설정 및 적용

```yaml
resilience4j:
  bulkhead:
    instances:
      orderService:
        max-concurrent-calls: 20     # 동시 처리 최대 20개
        max-wait-duration: 0s        # 대기 없이 즉시 거부
```

```kotlin
@Bulkhead(name = "orderService")  // 동시에 20개까지만
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // ...
}
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

### 5.2 설정 및 적용

```yaml
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

```kotlin
@Retry(name = "orderService")
@Bulkhead(name = "orderService")
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // IOException 발생 시 자동으로 재시도
}
```

### 5.3 주의: 멱등성

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

---

## 6. 패턴 조합

### 6.1 적용 순서

```kotlin
@Retry(name = "orderService")                                    // 3. 재시도
@Bulkhead(name = "orderService")                                 // 2. 동시성 제한
@CircuitBreaker(name = "orderService", fallbackMethod = "...")   // 1. 차단기
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // 실행
}

실행 순서 (바깥쪽부터):
[CircuitBreaker] → [Bulkhead] → [Retry] → [실제 로직]
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

### 7.2 Fallback 선택 기준

| 기능 유형 | Fallback 전략 | 예시 |
|----------|--------------|------|
| **핵심 기능** | 에러 전파 | 결제 실패 → 에러 반환 |
| **부가 기능** | 기본값/캐시 | 추천 실패 → 인기 상품 |
| **조회 기능** | 캐시 데이터 | 상품 조회 실패 → 캐시 반환 |

---

## 8. FAQ (자주 묻는 질문)

### Q1. Circuit Breaker의 실패율 임계값은 어떻게 설정하나요?

**A**: 서비스 특성에 따라 다릅니다.

| 서비스 유형 | 권장 임계값 | 이유 |
|------------|-----------|------|
| 결제 서비스 | 30~40% | 민감한 서비스, 빠른 차단 |
| 이메일 서비스 | 60~70% | 비핵심, 여유 있게 |
| 외부 API | 50% | 일반적인 기준 |

### Q2. Retry와 Circuit Breaker를 함께 사용할 때 주의점은?

**A**: Retry 횟수만큼 Circuit Breaker 실패 카운트가 증가합니다.

```
요청 → Retry(3회) → 모두 실패 → Circuit Breaker 실패 카운트 +1
                                (Retry 내부 실패는 1회로 처리)

※ Resilience4j는 기본적으로 최종 결과만 카운트
```

### Q3. Rate Limiter vs Bulkhead 차이점은?

| 구분 | Rate Limiter | Bulkhead |
|------|--------------|----------|
| **제한 대상** | 시간당 요청 수 | 동시 실행 수 |
| **목적** | 과도한 트래픽 방지 | 리소스 격리 |
| **예시** | 초당 100개 | 동시 20개 |
| **적용 위치** | API Gateway, 필터 | 서비스 메서드 |

### Q4. Fallback에서 또 실패하면 어떻게 하나요?

**A**: 다단계 Fallback을 구성하거나, 최종적으로 에러를 반환합니다.

```kotlin
fun getRecommendations(userId: Long): List<Product> {
    return try {
        recommendClient.getRecommendations(userId)
    } catch (e: Exception) {
        try {
            // 1차 Fallback: 캐시
            cachedRecommendations.get(userId)
        } catch (e2: Exception) {
            // 2차 Fallback: 기본 인기 상품
            defaultPopularProducts
        }
    }
}
```

---

## 9. 요약

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ✅ Circuit Breaker = 장애 전파 방지                        │
│     - CLOSED → OPEN → HALF-OPEN 상태 전이                  │
│     - 장애 서비스 호출 차단으로 리소스 보호                  │
│                                                             │
│  ✅ Rate Limiter = 과도한 요청 차단                         │
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
