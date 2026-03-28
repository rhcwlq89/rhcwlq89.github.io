---
title: "선착순 부하 테스트 개발기: 삽질과 실무 격리 전략"
description: "4가지 선착순 전략을 k6로 테스트하면서 만난 문제들 — Rate Limiter 충돌, 대기열 초과 성공 버그. 그리고 실무에서 선착순 API와 일반 API를 격리하는 4가지 방법(DataSource 분리, Redis 오프로드, 서비스 분리, Bulkhead)을 정리한다."
pubDate: 2026-03-25T14:00:00+09:00
tags:
  - System Design
  - First-Come-First-Served
  - Load Testing
  - k6
  - Spring Boot
  - Behind the Scenes
heroImage: "../../assets/FcfsLoadTestComparison.png"
---

## 서론

[8편](/blog/fcfs-load-test-comparison)에서 4가지 선착순 방식을 k6로 부하 테스트하고 성능을 비교했다. 이 글은 그 테스트 환경을 구축하고 실행하는 과정에서 **무엇을 만들었고, 어떤 문제를 만났고, 실무에서는 어떻게 다르게 해야 하는지** 기록한다.

---

## 1. 격리 설계 — 기존 코드를 건드리지 않기

`marketplace`는 이미 운영 중인 프로젝트다. 주문 흐름, 인증, Rate Limiter가 이미 붙어 있다. 여기에 실험적인 FCFS 코드를 섞으면 기존 동작에 영향을 줄 수 있다.

그래서 `com.example.marketplace.fcfs` 패키지를 별도로 만들어 4가지 전략을 완전히 격리했다.

```
marketplace-api/src/main/kotlin/com/example/marketplace/fcfs/
├── controller/   (5개: DbLockController, RedisController, QueueController, TokenController, ResetController)
├── service/      (4개: 각 전략별 서비스)
├── dto/          (4개: 요청/응답 DTO)
├── entity/       (FcfsOrder — 경량 주문 엔티티)
├── repository/   (FcfsOrderRepository)
└── config/       (Lua 스크립트 빈 설정)
```

설계 원칙은 세 가지였다.

**1. 기존 엔티티 최대한 재사용.** `Product` 엔티티의 `stock` 필드를 그대로 쓴다. DB 락 테스트는 실제 `SELECT FOR UPDATE`로 재고를 차감한다.

**2. `FcfsOrder`는 경량 엔티티.** 기존 `Order`는 결제, 배송, 쿠폰 등 복잡한 필드가 많다. FCFS 테스트용으로는 `userId`, `productId`, `status`, `createdAt`만 있는 단순 엔티티로 충분했다.

**3. Security `permitAll` 추가.** FCFS 엔드포인트는 인증 없이 k6에서 직접 호출해야 한다. `SecurityConfig`에 `/api/orders/db-lock/**`, `/api/orders/redis/**`, `/api/queue/**`, `/api/tokens/**`, `/api/fcfs/**` 경로를 `permitAll`로 추가했다.

그리고 **리셋 엔드포인트**를 별도로 만들었다:

```
POST /api/fcfs/reset
```

각 테스트 전에 재고를 100으로 되돌리고, Redis 키를 삭제하고, `FcfsOrder` 테이블을 비워야 한다. 이걸 수동으로 하면 실수가 생긴다. 리셋 API 하나로 모두 처리한다.

---

## 2. 이슈 1 — Resilience4j Rate Limiter

구현을 마치고 처음 k6 테스트를 돌렸을 때, **토큰 방식에서 성공 건수가 0**이었다.

```
✗ status is 200 or 409
↳  0% — ✓ 0 / ✗ 100
```

에러 메시지를 보니 전부 `429 RATE_LIMITED`였다. 처음엔 k6 설정 문제인 줄 알았다. 그런데 `curl`로 직접 호출해봐도 429가 반환됐다.

**원인은 `RateLimitingFilter`였다.**

`marketplace`에는 Resilience4j 기반의 Rate Limiter가 이미 붙어 있었다. 주문 생성 API를 초당 100건으로 제한하는 필터다. 그런데 이 필터가 **모든 경로**에 적용되고 있었다.

토큰 방식의 흐름을 보면:
1. Phase 1: 토큰 발급 (`POST /api/tokens/issue`) × 100건
2. Phase 2: 토큰으로 구매 (`POST /api/orders/token`) × 100건

k6가 Phase 1과 Phase 2를 빠르게 실행하면서, Phase 2의 100건 요청이 Rate Limiter 한도(초당 100건)를 초과했다. 결과적으로 구매 요청 전부가 429로 차단됐다.

DB 락 테스트에서 100명 중 99건만 성공했던 것도 같은 이유였다. 요청 1건이 Rate Limiter에 걸렸던 것.

**해결은 `shouldNotFilter`에 FCFS 경로를 추가하는 것이었다.**

```kotlin
override fun shouldNotFilter(request: HttpServletRequest): Boolean {
    val path = request.requestURI
    return path.startsWith("/actuator") ||
            path.startsWith("/api/products") ||
            path.startsWith("/api/auth") ||
            path.startsWith("/api/orders/db-lock") ||
            path.startsWith("/api/orders/redis") ||
            path.startsWith("/api/orders/token") ||
            path.startsWith("/api/queue") ||
            path.startsWith("/api/tokens") ||
            path.startsWith("/api/fcfs")
}
```

이걸 추가하고 나서야 테스트가 제대로 돌아갔다.

**교훈**: 부하 테스트에서 예상 밖의 실패가 나오면, **애플리케이션 레벨 보호 장치**부터 확인하라. Rate Limiter, Circuit Breaker, Bulkhead — 이것들이 테스트 결과를 조용히 왜곡한다. 서버 로그에 429나 503이 찍히고 있는데 k6 에러 메시지만 보고 삽질하는 시간을 아낄 수 있다.

---

## 3. 이슈 2 — 대기열 1,000명에서 성공 185건

재고는 100개인데, k6 리포트에 성공 185건이 찍혔다.

```
success_count: 185
fail_count:    815
```

처음엔 버그를 의심했다. Redis Sorted Set이나 Kafka Consumer에서 중복 처리가 일어나는 건지. 실제로 DB에 저장된 `FcfsOrder` 건수를 직접 확인해봤다:

```sql
SELECT COUNT(*) FROM fcfs_orders WHERE status = 'COMPLETED';
-- 결과: 100
```

DB에는 정확히 100건이었다. 그럼 k6는 왜 185건을 성공으로 세고 있었을까?

**원인은 k6 스크립트가 "성공"을 잘못 정의하고 있었기 때문이다.**

대기열 방식의 흐름:
1. 대기열 진입 (`POST /api/queue/enter`)
2. 상태 폴링 (`GET /api/queue/status`) — `ALLOWED` 또는 `NOT_IN_QUEUE`가 올 때까지
3. 구매 시도 (`POST /api/orders`)

Kafka Consumer의 `consumeQueueOrder`에서 재고 차감 Lua 스크립트(`decreaseStockAtomically`)가 `0`을 반환하면 — 즉 재고가 없으면 — 해당 사용자를 `COMPLETED` 상태로 업데이트하고 있었다. "처리됐다"는 의미로 썼던 상태인데, k6 폴링 스크립트는 `COMPLETED`를 "성공"으로 읽고 있었다.

즉, **재고 차감에 실패한 사용자도 "처리 완료"로 표시되어 성공으로 집계된 것**이다.

수정은 두 가지였다:
1. Kafka Consumer에서 재고 차감 실패 시 상태를 `FAILED`로 업데이트
2. k6 폴링 스크립트에서 `COMPLETED`만 성공으로, `FAILED`와 `NOT_IN_QUEUE`는 실패로 집계

이 수정 후 대기열 테스트도 정확히 100건 성공으로 나왔다.

**핵심 포인트**: 대기열 방식에서 "입장 허용"과 "구매 성공"은 다르다. 비동기 흐름이 있으면 **"성공"의 정의를 명확하게 코드와 스크립트 양쪽에서 일치시켜야 한다.** 그렇지 않으면 측정 자체가 틀린다.

---

## 4. 실무 고려사항 — 선착순 API와 일반 API 격리

테스트 환경에서는 FCFS API만 단독으로 돌렸다. 하지만 실무에서는 **상품 목록, 마이페이지, 결제** 같은 일반 API가 동시에 동작해야 한다. 선착순 트래픽이 몰릴 때 일반 API까지 느려지면 서비스 전체가 마비된다.

### 4.1 문제: DB 커넥션 풀 공유

DB 락 방식의 핵심 문제는 `SELECT FOR UPDATE`가 **커넥션을 물고 대기**한다는 점이다. HikariCP 풀이 10개인데 선착순 요청 10개가 락을 잡으면, 상품 목록 조회 같은 읽기 요청도 커넥션을 얻지 못해 대기한다.

```
[선착순 요청 10개] → 커넥션 풀(10개) 전부 점유
[상품 목록 조회]   → 커넥션 대기 → 타임아웃 → 503 에러
```

### 4.2 해결 1: DataSource 분리

가장 확실한 방법은 **FCFS 전용 DataSource를 별도로 만드는 것**이다.

```kotlin
@Configuration
class DataSourceConfig {

    @Primary
    @Bean
    @ConfigurationProperties("spring.datasource.main")
    fun mainDataSource(): DataSource = HikariDataSource()

    @Bean
    @ConfigurationProperties("spring.datasource.fcfs")
    fun fcfsDataSource(): DataSource = HikariDataSource()
}
```

```yaml
spring:
  datasource:
    main:
      maximum-pool-size: 20   # 일반 API용
    fcfs:
      maximum-pool-size: 10   # 선착순 전용
```

이렇게 하면 선착순 요청이 `fcfsDataSource`의 10개를 전부 잡아도, 일반 API는 `mainDataSource`의 20개를 독립적으로 사용한다.

### 4.3 해결 2: Redis 오프로드 (권장)

8편의 테스트 결과가 이미 답을 보여줬다. **재고 차감을 Redis로 옮기면 DB 커넥션 경합 자체가 사라진다.**

```
[선착순 요청] → Redis (DECR) → 성공 시에만 DB INSERT (커넥션 1개, 짧은 시간)
[일반 API]    → DB 커넥션 풀 (여유롭게 사용)
```

Redis 방식이나 토큰 방식은 재고 차감에 DB 커넥션을 쓰지 않으므로, 선착순 트래픽과 일반 트래픽이 **DB 레벨에서 간섭하지 않는다.**

### 4.4 해결 3: 서비스 분리 (대규모)

트래픽 규모가 크다면 선착순 API를 **별도 서비스로 분리**하는 것이 가장 깔끔하다.

```
[Nginx / ALB]
├── /api/orders/fcfs/** → FCFS 서비스 (별도 인스턴스, 별도 DB 풀)
└── /api/**             → 메인 서비스 (기존 인스턴스)
```

- 선착순 서비스의 스케일링을 독립적으로 할 수 있다
- 선착순 서비스가 장애를 일으켜도 메인 서비스에 영향 없다
- 인프라 비용은 늘지만, 대규모 이벤트에서는 이 격리가 필수다

### 4.5 해결 4: Bulkhead 패턴

서비스 분리까지는 과하지만 커넥션 풀 격리는 하고 싶다면, **Resilience4j Bulkhead**로 동시 실행 수를 제한할 수 있다.

```kotlin
@Bulkhead(name = "fcfsApi", fallbackMethod = "fcfsFallback")
fun purchase(request: FcfsRequest): FcfsResponse {
    // ...
}
```

```yaml
resilience4j:
  bulkhead:
    instances:
      fcfsApi:
        max-concurrent-calls: 10    # 동시 최대 10개만 허용
        max-wait-duration: 500ms    # 초과 시 500ms 대기 후 실패
```

이렇게 하면 선착순 API가 동시에 10개 이상의 DB 커넥션을 잡지 못하도록 제한한다.

### 4.6 정리: 상황별 추천

| 상황 | 추천 격리 방법 |
|------|-------------|
| **소규모 (동시 ~100명)** | Bulkhead로 동시 실행 수 제한 |
| **중규모 (동시 ~1,000명)** | Redis 오프로드 + Bulkhead |
| **대규모 (동시 ~10,000명+)** | 서비스 분리 + Redis + 대기열 |

---

## 5. 테스트 환경이 결과에 미치는 영향

이 테스트의 수치를 그대로 신뢰하면 안 된다.

로컬 테스트의 한계:
- MySQL, Redis, Kafka, 앱 서버가 모두 같은 머신에서 실행 → 네트워크 지연 0
- k6도 같은 머신에서 실행 → k6가 요청을 보내는 것 자체가 CPU 경쟁을 유발
- 운영 환경의 방화벽, 로드밸런서, 연결 수 제한 등이 없음

그럼에도 이 테스트가 유효한 이유는 **비교의 기준이 동일**하기 때문이다. 모든 방식을 같은 환경, 같은 시나리오로 돌렸다. 그러니 "토큰이 Redis보다 이 환경에서 빠르다"는 비교는 유효하다. 하지만 "TPS 2,736"이라는 절대 수치는 운영 환경에서 재현되지 않을 수 있다.

**목적은 절대 수치가 아니라 방식 간 상대 비교다.**

---

## 정리

이번 작업에서 얻은 것:

1. **테스트 환경에 이미 있는 보호 장치를 잊으면 삽질한다.** Rate Limiter 하나 때문에 토큰 방식 성공률이 0%였다. 새 기능을 추가할 때는 기존 필터·인터셉터 목록을 다시 확인하라.

2. **비동기 흐름이 있으면 "성공"의 정의를 명확히 해야 한다.** 대기열의 `COMPLETED`가 "구매 성공"인지 "처리 완료"인지를 k6 스크립트와 서버 코드가 동일하게 이해해야 측정이 유효하다.

3. **실무에서는 격리가 핵심이다.** 선착순 트래픽이 몰릴 때 일반 API까지 죽으면 안 된다. Redis 오프로드, DataSource 분리, Bulkhead, 서비스 분리 — 규모에 맞는 격리 전략을 선택하라.

4. **로컬 테스트의 한계를 인정하라.** 모든 수치는 같은 머신에서의 상대 비교다. 네트워크 레이턴시, 커넥션 풀 공유, 다른 API와의 경합이 없는 환경이다. 프로덕션에서는 DB 락 방식의 성능이 훨씬 더 떨어질 것이다.

- 이전 글: [8편 — 선착순 시스템 전체 방식 성능 비교](/blog/fcfs-load-test-comparison)
- 다음 글: [java.util.concurrent 실무 패턴 7선](/blog/java-concurrent-practical-patterns)
