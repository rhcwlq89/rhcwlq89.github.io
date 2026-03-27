---
title: "선착순 부하 테스트 개발기: 블로그에 쓴 숫자, 진짜 돌려봤냐?"
description: "블로그에 쓴 부하 테스트 수치가 추정이었다는 걸 인정하고, 4가지 선착순 전략을 실제로 구현해 k6로 돌려본 과정을 정리한다. 격리 패키지 설계, Resilience4j Rate Limiter 충돌, 대기열 초과 성공 버그까지 — 테스트를 실제로 돌리면 생기는 일들."
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

## 서론 — 왜 이 글을 쓰게 됐는가

[8편](/blog/fcfs-load-test-comparison)에서 4가지 선착순 방식의 성능 비교 수치를 제시했다. TPS, P99 응답 시간, DB 커넥션 사용량까지 깔끔하게 표로 정리했다.

그런데 그 수치가 **실제로 돌려본 결과가 아니었다.**

솔직히 말하면:

- `marketplace` 프로젝트에는 `/api/orders/db-lock` 같은 엔드포인트가 없었다
- k6 스크립트 파일도 존재하지 않았다
- 성공이 정확히 100건, 실패가 정확히 400건 — 숫자가 너무 깔끔했다

글을 쓰면서 직접 구현하고 돌려보지 않고 "이론적으로 이렇게 나올 것이다"를 정리한 거였다. 방향은 맞지만, **크기가 틀릴 수 있다.**

이번에 실제로 4가지 전략을 전부 구현하고, k6 스크립트를 짜고, 실제로 돌렸다. 그리고 8편의 수치를 실측 데이터로 교체했다.

이 글은 그 과정에서 **무엇을 만들었고, 어떤 문제를 만났는지** 기록한다.

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

## 4. 이슈 3 — 예상과 다른 실측 결과

두 이슈를 해결하고 1,000명 테스트를 다시 돌렸다. 8편에서 추정한 수치와 실측을 비교하면:

| 항목 | 8편 예측 | 실측 | 차이 |
|------|---------|------|------|
| DB 락 P95 (1,000명) | 12,500ms | 1,165ms | **10배 빨랐다** |
| DB 락 TPS (1,000명) | 79 | 783 | **10배 높았다** |
| Redis TPS (1,000명) | 1,724 | 2,008 | ~16% 높았다 |
| 토큰 TPS (1,000명) | 1,370 | 2,736 | **2배 높았다** |
| Redis vs 토큰 순위 | Redis > 토큰 | **토큰 > Redis** | 역전 |

DB 락이 예측보다 10배 빠른 건 처음엔 당황스러웠다. 그런데 이유를 생각하면 납득이 된다.

**DB 락이 예상보다 빠른 이유**: 8편의 추정은 실제 운영 환경 — RDS와 앱 서버 간 ~1ms 왕복 지연, 수백 개의 동시 연결 — 을 전제했다. 로컬 테스트에서는 MySQL이 같은 머신에서 돌아간다. 네트워크 왕복이 없다. HikariCP 풀 20개도 로컬에서는 빠르게 반환된다. 절대 수치는 크게 다르지만, **운영 환경에서는 격차가 더 벌어질 것**이다.

**토큰이 Redis보다 빠른 이유**: 토큰 방식의 Redis 연산은 `DECR`과 `SISMEMBER` 두 개다. Redis Lua 스크립트는 여러 명령을 묶어 실행하는 만큼 오버헤드가 있다. 그리고 JWT 서명·검증은 CPU 연산이라 I/O 대기가 없다. 로컬에서는 CPU가 I/O보다 빠르게 처리된다.

**숫자가 깔끔하지 않은 이유**: 실제 테스트에서는 JVM 워밍업 상태, OS 스케줄링, GC 타이밍에 따라 수치가 들쭉날쭉하다. 성공이 정확히 100건이 아니라 97건이 나오는 실행도 있었다 (이건 k6 `maxDuration` 제한 때문이었다). 깔끔한 숫자는 **이론에서만 나온다.**

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

이번 작업에서 얻은 것 세 가지:

1. **블로그에 숫자를 쓸 때는 실제로 돌려봐야 한다.** 추정치는 방향은 맞을 수 있지만 크기가 크게 다를 수 있다. DB 락 P95를 12.5초로 예측했는데 실측은 1.2초였다.

2. **테스트 환경에 이미 있는 보호 장치를 잊으면 삽질한다.** Rate Limiter 하나 때문에 토큰 방식 성공률이 0%였다. 새 기능을 추가할 때는 기존 필터·인터셉터 목록을 다시 확인하라.

3. **비동기 흐름이 있으면 "성공"의 정의를 명확히 해야 한다.** 대기열의 `COMPLETED`가 "구매 성공"인지 "처리 완료"인지를 k6 스크립트와 서버 코드가 동일하게 이해해야 측정이 유효하다.

8편의 수치는 실측 데이터로 교체됐다. 예측과 실측이 크게 다른 항목도 있고, 순위가 역전된 것도 있다. 그게 실제 테스트의 가치다.

- 이전 글: [8편 — 선착순 시스템 전체 방식 성능 비교](/blog/fcfs-load-test-comparison)
- 다음 글: [java.util.concurrent 실무 패턴 7선](/blog/java-concurrent-practical-patterns)

---

블로그에 쓴 숫자가 진짜인지 궁금했다면, 이제 진짜다.
