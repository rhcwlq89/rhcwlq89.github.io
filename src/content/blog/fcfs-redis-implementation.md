---
title: "Redis로 선착순 시스템 구현하기: DECR부터 Lua 스크립트까지"
description: "Redis DECR 원자 연산과 Lua 스크립트로 선착순 재고 차감을 구현한다. Spring Boot + Redisson으로 구현하고, DB 락 방식과 동일 조건(재고 100개, 동시 100명)으로 TPS를 직접 비교한다. Redis-DB 정합성 문제와 장애 대비 전략까지 다룬다."
pubDate: 2026-03-24T16:00:00+09:00
tags:
  - System Design
  - First-Come-First-Served
  - Redis
  - Spring Boot
  - Lua Script
heroImage: "../../assets/FcfsRedisImplementation.png"
---

## 서론

[이전 글](/blog/fcfs-db-lock-implementation)에서 DB 비관적 락으로 선착순 시스템을 구현했다. 100명 동시 요청에서 데이터 정합성은 완벽했지만, **직렬화 병목, 커넥션 풀 고갈, 데드락 위험** 이라는 한계가 있었다.

이번 글에서는 DB의 한계를 넘어서 **Redis로 초당 수만 건을 처리하는 방법**을 다룬다. DECR 원자 연산부터 시작해서 Lua 스크립트로 검증+차감+중복체크를 원자적으로 묶고, DB 락 방식과 동일 조건에서 성능을 직접 비교한다.

---

## 1. 왜 Redis인가?

DB 락의 근본적인 문제는 **디스크 I/O + 행 락 대기**다. Redis는 이 둘을 모두 제거한다.

| 특성 | DB (FOR UPDATE) | Redis |
|------|----------------|-------|
| 데이터 저장 | 디스크 | 메모리 |
| 연산 속도 | ms 단위 | μs 단위 |
| 동시성 처리 | 행 락 → 직렬 대기 | 싱글 스레드 → 자연스러운 직렬 처리 |
| TPS | 수백~수천 | **수만~수십만** |

Redis는 **싱글 스레드**로 명령을 하나씩 순서대로 처리한다. 락이 필요 없다 — 애초에 동시에 두 명령이 실행되지 않으니까. 이 특성 덕분에 `DECR` 같은 명령이 **원자적(atomic)** 으로 동작한다.

---

## 2. 방식 1: DECR 원자 연산

### 2.1 기본 원리

Redis의 `DECR` 명령은 **원자적으로 값을 1 감소**시킨다. 동시에 100명이 `DECR`을 보내도 정확히 100번 감소한다.

```
SET  stock:product:1  100    ← 재고 초기화
DECR stock:product:1         ← 원자적으로 99 반환
DECR stock:product:1         ← 원자적으로 98 반환
```

### 2.2 구현 흐름

```
1. DECR stock:product:{id}
2. 반환값 >= 0 → 구매 성공 → DB에 주문 저장
3. 반환값 < 0  → 품절 → INCR로 복구
```

### 2.3 Spring Boot + Redisson 구현

```java
@Service
@RequiredArgsConstructor
public class RedisDecrStockService {
    private final RedissonClient redissonClient;

    private String stockKey(Long productId) {
        return "stock:product:" + productId;
    }

    public void initStock(Long productId, int quantity) {
        RAtomicLong stock = redissonClient.getAtomicLong(stockKey(productId));
        stock.set(quantity);
    }

    public boolean decreaseStock(Long productId) {
        RAtomicLong stock = redissonClient.getAtomicLong(stockKey(productId));
        long remaining = stock.decrementAndGet();

        if (remaining < 0) {
            // 품절 → 복구
            stock.incrementAndGet();
            return false;
        }
        return true;
    }
}
```

### 2.4 문제: Race Condition

DECR 방식에는 미묘한 문제가 있다.

```
재고: 0
사용자 A: DECR → -1 (품절 확인) → INCR → 0
사용자 B: DECR → -1 (품절 확인) → INCR → 0
사용자 C: 이 사이에 DECR → -1 ... (반복)
```

**재고가 이미 0인 상태에서도 DECR이 계속 실행**된다. 값이 잠깐 음수가 되었다가 INCR로 복구되는 과정에서 불필요한 연산이 발생하고, 고트래픽 상황에서는 음수 값이 깊어질 수 있다.

핵심 문제: **"확인"과 "차감"이 분리**되어 있다는 것이다. 이걸 하나의 원자적 연산으로 묶어야 한다.

---

## 3. 방식 2: Lua 스크립트

### 3.1 왜 Lua인가?

Redis는 Lua 스크립트를 **원자적으로** 실행한다. 스크립트 실행 중에는 다른 명령이 끼어들 수 없다. 이를 이용하면 **"재고 확인 → 중복 체크 → 차감"을 하나의 원자적 연산**으로 묶을 수 있다.

### 3.2 Lua 스크립트

```lua
-- KEYS[1]: stock:product:{id}
-- KEYS[2]: purchased:product:{id}
-- ARGV[1]: userId

-- 1. 중복 구매 체크
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    return -2  -- 이미 구매한 사용자
end

-- 2. 재고 확인
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil or stock <= 0 then
    return -1  -- 품절
end

-- 3. 재고 차감 + 구매자 기록 (원자적)
redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return stock - 1  -- 남은 재고 반환
```

**하나의 스크립트 안에서 3가지를 처리한다:**
1. `SISMEMBER` — 중복 구매 방지 (Set에 userId가 있는지 확인)
2. `GET` — 재고가 0 이하면 즉시 반환 (불필요한 DECR 방지)
3. `DECR` + `SADD` — 재고 차감과 구매자 기록을 동시에

### 3.3 Spring Boot 구현

```java
@Service
@RequiredArgsConstructor
public class RedisLuaStockService {
    private final RedissonClient redissonClient;

    private static final String PURCHASE_SCRIPT =
        "if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then " +
        "    return -2 " +
        "end " +
        "local stock = tonumber(redis.call('GET', KEYS[1])) " +
        "if stock == nil or stock <= 0 then " +
        "    return -1 " +
        "end " +
        "redis.call('DECR', KEYS[1]) " +
        "redis.call('SADD', KEYS[2], ARGV[1]) " +
        "return stock - 1";

    public void initStock(Long productId, int quantity) {
        RAtomicLong stock = redissonClient.getAtomicLong(stockKey(productId));
        stock.set(quantity);
    }

    public PurchaseResult tryPurchase(Long productId, Long userId) {
        RScript script = redissonClient.getScript();

        Long result = script.eval(
            RScript.Mode.READ_WRITE,
            PURCHASE_SCRIPT,
            RScript.ReturnType.INTEGER,
            List.of(stockKey(productId), purchasedKey(productId)),
            userId.toString()
        );

        return switch (result.intValue()) {
            case -2 -> PurchaseResult.ALREADY_PURCHASED;
            case -1 -> PurchaseResult.SOLD_OUT;
            default -> PurchaseResult.SUCCESS;
        };
    }

    private String stockKey(Long productId) {
        return "stock:product:" + productId;
    }

    private String purchasedKey(Long productId) {
        return "purchased:product:" + productId;
    }
}
```

```java
public enum PurchaseResult {
    SUCCESS,
    SOLD_OUT,
    ALREADY_PURCHASED
}
```

### 3.4 DECR vs Lua 비교

| 항목 | DECR 단순 방식 | Lua 스크립트 |
|------|-------------|------------|
| 원자성 | DECR 자체만 원자적 | 전체 로직이 원자적 |
| 중복 구매 방지 | 별도 구현 필요 | 스크립트 내 처리 |
| 품절 시 동작 | 음수 → INCR 복구 필요 | 0 이하면 즉시 반환 |
| Race Condition | 음수 진입 가능 | 없음 |
| 코드 복잡도 | 낮음 | 중간 |

**실무에서는 Lua 스크립트 방식이 표준이다.** 중복 체크까지 원자적으로 처리할 수 있기 때문이다.

---

## 4. DB 주문 저장과 정합성 문제

Redis에서 재고를 차감한 후, DB에 주문을 저장해야 한다. 여기서 **정합성 문제**가 발생한다.

### 4.1 문제 시나리오

```
1. Redis: DECR → 재고 99 (성공 ✅)
2. DB: INSERT 주문 → 실패 ❌ (네트워크 오류, DB 다운 등)
3. 결과: Redis 재고는 줄었는데 주문은 없다 → 재고 유실 💀
```

### 4.2 해결 전략: 보상 트랜잭션

```java
@Service
@RequiredArgsConstructor
public class FcfsOrderService {
    private final RedisLuaStockService redisStockService;
    private final OrderRepository orderRepository;
    private final RedissonClient redissonClient;

    @Transactional
    public OrderResult purchase(Long productId, Long userId) {
        // 1. Redis에서 재고 차감
        PurchaseResult result = redisStockService.tryPurchase(productId, userId);
        if (result != PurchaseResult.SUCCESS) {
            return OrderResult.from(result);
        }

        try {
            // 2. DB에 주문 저장
            Order order = Order.create(productId, userId);
            orderRepository.save(order);
            return OrderResult.success(order.getId());
        } catch (Exception e) {
            // 3. DB 실패 → Redis 재고 복구 (보상 트랜잭션)
            compensateRedis(productId, userId);
            throw e;
        }
    }

    private void compensateRedis(Long productId, Long userId) {
        RAtomicLong stock = redissonClient.getAtomicLong("stock:product:" + productId);
        stock.incrementAndGet();
        // 구매자 Set에서도 제거
        RSet<String> purchased = redissonClient.getSet("purchased:product:" + productId);
        purchased.remove(userId.toString());
    }
}
```

### 4.3 보상이 실패하면?

**Redis 복구(INCR)까지 실패**하는 극단적인 상황도 있다. 이때를 위한 안전장치:

1. **실패 로그 기록** — 어떤 상품의 어떤 사용자가 보상 실패했는지 기록
2. **스케줄러로 정합성 검증** — 주기적으로 Redis 재고와 DB 주문 수를 비교
3. **Redis 재고 = 초기 재고 - DB 주문 수** — 불일치 발견 시 Redis를 DB 기준으로 보정

```java
@Scheduled(fixedRate = 60000) // 1분마다
public void verifyStockConsistency(Long productId) {
    long redisStock = redisStockService.getStock(productId);
    long dbOrderCount = orderRepository.countByProductId(productId);
    long initialStock = productRepository.findById(productId)
        .orElseThrow().getInitialStock();

    long expectedRedisStock = initialStock - dbOrderCount;

    if (redisStock != expectedRedisStock) {
        log.warn("재고 불일치! Redis: {}, 예상: {}", redisStock, expectedRedisStock);
        redisStockService.initStock(productId, (int) expectedRedisStock);
    }
}
```

> 핵심 원칙: **DB가 진실의 원천(Source of Truth)이고, Redis는 캐시**다. 불일치가 생기면 항상 DB 기준으로 보정한다.

---

## 5. 동시성 테스트: DB 락 vs Redis

4편과 동일한 조건(재고 100개, 동시 100명)으로 비교한다.

### 5.1 테스트 코드

```java
@SpringBootTest
class RedisStockConcurrencyTest {

    @Autowired
    RedisLuaStockService redisStockService;

    @Test
    @DisplayName("100명이 동시에 1개씩 구매하면 재고가 정확히 0이 된다")
    void concurrentPurchase_100users() throws InterruptedException {
        Long productId = 1L;
        redisStockService.initStock(productId, 100);

        int threadCount = 100;
        ExecutorService executor = Executors.newFixedThreadPool(32);
        CountDownLatch latch = new CountDownLatch(threadCount);
        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger failCount = new AtomicInteger(0);

        long startTime = System.currentTimeMillis();

        for (int i = 0; i < threadCount; i++) {
            long userId = i + 1;
            executor.submit(() -> {
                try {
                    PurchaseResult result =
                        redisStockService.tryPurchase(productId, userId);
                    if (result == PurchaseResult.SUCCESS) {
                        successCount.incrementAndGet();
                    } else {
                        failCount.incrementAndGet();
                    }
                } finally {
                    latch.countDown();
                }
            });
        }

        latch.await();
        executor.shutdown();
        long elapsed = System.currentTimeMillis() - startTime;

        long remainingStock = redisStockService.getStock(productId);

        System.out.println("성공: " + successCount.get());
        System.out.println("실패: " + failCount.get());
        System.out.println("남은 재고: " + remainingStock);
        System.out.println("소요 시간: " + elapsed + "ms");

        assertEquals(100, successCount.get());
        assertEquals(0, remainingStock);
    }
}
```

### 5.2 결과 비교

```
=== Redis Lua 스크립트 동시성 테스트 결과 ===
동시 요청 수: 100
성공: 100
실패: 0
남은 재고: 0
소요 시간: 127ms
==========================================
```

| 측정 항목 | DB 락 (FOR UPDATE) | Redis (Lua) | 차이 |
|----------|-------------------|-------------|------|
| 소요 시간 | 851ms | 127ms | **6.7배 빠름** |
| 처리 방식 | 행 락 → 직렬 대기 | 싱글 스레드 → 순차 처리 |
| 중복 구매 방지 | 별도 구현 필요 | Lua 내장 |
| DB 커넥션 사용 | 100개 동시 점유 | 0개 (Redis만 사용) |

### 5.3 초과 요청 테스트

재고 100개에 150명이 동시 구매:

```
=== Redis Lua 스크립트 초과 요청 테스트 결과 ===
동시 요청 수: 150
성공: 100
실패 (품절): 50
남은 재고: 0
소요 시간: 143ms
==============================================
```

DB 락의 816ms 대비 **5.7배 빠르다.** 그리고 DB 커넥션을 하나도 쓰지 않았다.

### 5.4 왜 이렇게 빠른가?

```
[DB 락]
요청 → DB 커넥션 획득 → SELECT FOR UPDATE (디스크 I/O + 락 대기)
→ UPDATE (디스크 I/O) → COMMIT → 커넥션 반환

[Redis]
요청 → Redis Lua 실행 (메모리 연산, ~0.1ms) → 완료
→ (이후 별도로) DB에 주문 저장
```

DB 락은 **매 요청마다 디스크 I/O + 락 대기**가 발생한다. Redis는 **메모리에서 마이크로초 단위**로 끝난다. 재고 차감이라는 핫 경로(hot path)에서 DB를 완전히 제거한 것이다.

---

## 6. Redis 장애 대비

Redis는 메모리 기반이라 **서버 재시작 시 데이터가 사라진다.** 선착순 시스템에서 이는 치명적이다.

### 6.1 AOF (Append Only File) 설정

```
# redis.conf
appendonly yes
appendfsync everysec   # 1초마다 디스크에 기록
```

| 옵션 | 안전성 | 성능 |
|------|-------|------|
| `always` | 최고 (데이터 유실 0) | 느림 |
| `everysec` | 높음 (최대 1초 유실) | **권장** |
| `no` | 낮음 | 빠름 |

### 6.2 Redis Sentinel / Cluster

단일 Redis 장애에 대비해 **Sentinel**로 자동 페일오버를 구성한다.

```
Redis Primary → 장애 발생!
→ Sentinel이 감지 (수 초)
→ Replica를 새 Primary로 승격
→ 애플리케이션이 새 Primary에 자동 연결
```

Redisson은 Sentinel 설정을 기본 지원한다:

```yaml
spring:
  redis:
    sentinel:
      master: mymaster
      nodes:
        - sentinel1:26379
        - sentinel2:26379
        - sentinel3:26379
```

### 6.3 장애 복구 전략

Redis가 완전히 다운된 경우의 복구 순서:

1. **즉시**: 서킷 브레이커로 Redis 호출 차단, DB 락 방식으로 폴백
2. **복구 후**: DB 주문 수 기준으로 Redis 재고 재설정
3. **검증**: 정합성 스케줄러로 불일치 확인

```java
@Service
public class StockServiceFacade {
    private final RedisLuaStockService redisService;
    private final PessimisticLockStockService dbService;
    private final CircuitBreaker circuitBreaker;

    public OrderResult purchase(Long productId, Long userId) {
        if (circuitBreaker.isOpen()) {
            // Redis 장애 시 DB 락으로 폴백
            return dbService.decreaseStock(productId, 1);
        }
        return redisService.tryPurchase(productId, userId);
    }
}
```

---

## 7. 실무 적용 시 주의사항

### 7.1 Redis 재고 초기화 타이밍

이벤트 시작 전에 Redis에 재고를 미리 셋업해야 한다:

```java
@EventListener(ApplicationReadyEvent.class)
public void warmUpStock() {
    List<Product> products = productRepository.findByStatus(ProductStatus.ON_SALE);
    for (Product product : products) {
        redisStockService.initStock(product.getId(), product.getStockQuantity());
    }
}
```

### 7.2 운영 중 Redis 도입 시 시퀀스 초기화

신규 시스템이라면 Redis `INCR`이 1부터 시작해도 문제 없다. 하지만 **이미 운영 중인 시스템에 Redis를 도입**하면, 기존에 발급된 번호와 충돌할 수 있다.

예를 들어 예약번호가 DB 시퀀스로 1523번까지 발급된 상태에서 Redis `INCR`을 도입하면 1부터 다시 시작한다 → **번호 충돌.**

**해결: DB의 현재 최대값으로 Redis 초기화**

```java
@Component
public class ReservationSeqInitializer implements ApplicationRunner {

    private final StringRedisTemplate redisTemplate;
    private final ReservationRepository reservationRepository;

    private static final String SEQ_KEY = "reservation:seq";

    @Override
    public void run(ApplicationArguments args) {
        // Redis에 키가 없을 때만 초기화 (이미 있으면 건드리지 않음)
        Boolean wasSet = redisTemplate.opsForValue()
            .setIfAbsent(SEQ_KEY, String.valueOf(getMaxSeqFromDB()));

        if (Boolean.TRUE.equals(wasSet)) {
            log.info("Redis 시퀀스 초기화 완료: {}", redisTemplate.opsForValue().get(SEQ_KEY));
        }
    }

    private long getMaxSeqFromDB() {
        return reservationRepository.findMaxReservationNo()
            .orElse(999L); // DB에 데이터가 없으면 999 → INCR 시 1000부터 시작
    }
}
```

| 상황 | 문제 | 해결 |
|------|------|------|
| Redis 재시작 | 시퀀스가 날아가서 1부터 시작 → 번호 충돌 | `ApplicationRunner`로 앱 기동 시 DB 최대값 체크 후 복구 |
| 여러 Pod 동시 기동 | 두 Pod가 동시에 초기화 → race condition | `setIfAbsent` (SETNX) 사용 — 먼저 쓴 Pod만 성공 |
| DB에서 직접 INSERT 발생 | Redis와 DB 시퀀스가 어긋남 | Redis를 유일한 채번 소스로 통일하거나, DB 시퀀스와 범위를 분리 |

> **핵심 원칙:** Redis를 중간에 도입할 때는 반드시 DB의 현재 최대값으로 초기화한다. `INCR`의 기본 시작값(0)을 그대로 쓰면 번호 충돌이 발생한다.

### 7.3 TTL 설정

이벤트가 끝난 후에도 Redis에 데이터가 남아있으면 메모리 낭비다:

```java
public void initStock(Long productId, int quantity) {
    RAtomicLong stock = redissonClient.getAtomicLong(stockKey(productId));
    stock.set(quantity);
    stock.expire(Duration.ofHours(24)); // 24시간 후 자동 삭제
}
```

### 7.4 모니터링 필수 항목

| 항목 | 이유 |
|------|------|
| Redis 메모리 사용량 | OOM 방지 |
| Lua 스크립트 실행 시간 | 슬로우 쿼리 감지 |
| Redis-DB 재고 불일치 수 | 정합성 모니터링 |
| 서킷 브레이커 상태 | 폴백 발동 여부 |

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **DECR의 한계** | 단순하지만 품절 시 음수 진입, 중복 체크 불가 |
| **Lua 스크립트** | 검증+차감+중복체크를 원자적으로 처리 — 실무 표준 |
| **Redis-DB 정합성** | 보상 트랜잭션 + 정합성 스케줄러로 보장 |
| **성능** | DB 락 대비 **6.7배 빠름** (851ms → 127ms) |
| **장애 대비** | AOF + Sentinel + 서킷 브레이커 + DB 폴백 |
| **핵심 원칙** | DB가 진실의 원천, Redis는 빠른 캐시 |

Redis는 **"빠르지만 불안정할 수 있는" 계층**이다. DB 락이 "느리지만 확실한" 방식이었다면, Redis는 "빠르지만 장애 대비가 필요한" 방식이다. 둘을 조합하면 **속도와 안정성을 동시에** 확보할 수 있다.

다음 글에서는 **대기열/큐 기반 구현**을 다룬다. 트래픽 폭주를 흡수하고, 사용자에게 대기 순번을 보여주는 방식이다.
