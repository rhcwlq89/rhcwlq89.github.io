---
title: "Implementing FCFS with Redis: From DECR to Lua Scripts"
description: "Implements a first-come-first-served stock deduction system using Redis DECR atomic operations and Lua scripts. Builds it with Spring Boot + Redisson, directly compares TPS against DB locks under identical conditions (100 stock, 100 concurrent users), and covers Redis-DB consistency and failure recovery strategies."
pubDate: "2026-03-24T16:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Redis", "Spring Boot", "Lua Script"]
heroImage: "../../../assets/FcfsRedisImplementation.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/fcfs-db-lock-implementation), we implemented an FCFS system with DB pessimistic locks. Data consistency was perfect with 100 concurrent requests, but we hit **serialization bottlenecks, connection pool exhaustion, and deadlock risks**.

This post goes beyond DB limits to cover **handling tens of thousands of requests per second with Redis**. We start with DECR atomic operations, bundle validation + deduction + duplicate checking into a single atomic Lua script, and directly compare performance against DB locks under identical conditions.

---

## 1. Why Redis?

The fundamental problem with DB locks is **disk I/O + row lock waiting**. Redis eliminates both.

| Property | DB (FOR UPDATE) | Redis |
|----------|----------------|-------|
| Data storage | Disk | Memory |
| Operation speed | ms range | μs range |
| Concurrency model | Row lock → serial waiting | Single-threaded → natural serial processing |
| TPS | Hundreds to thousands | **Tens to hundreds of thousands** |

Redis is **single-threaded** — it processes commands one at a time, in order. No locks needed — two commands literally can't execute simultaneously. This is why operations like `DECR` are inherently **atomic**.

---

## 2. Approach 1: DECR Atomic Operation

### 2.1 Basic Principle

Redis `DECR` **atomically decrements a value by 1**. Even with 100 simultaneous `DECR` calls, the value decreases exactly 100 times.

```
SET  stock:product:1  100    ← initialize stock
DECR stock:product:1         ← atomically returns 99
DECR stock:product:1         ← atomically returns 98
```

### 2.2 Flow

```
1. DECR stock:product:{id}
2. Return value >= 0 → purchase success → save order to DB
3. Return value < 0  → sold out → INCR to restore
```

### 2.3 Spring Boot + Redisson Implementation

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
            // Sold out → restore
            stock.incrementAndGet();
            return false;
        }
        return true;
    }
}
```

> **Why Redisson over Lettuce?** Spring Boot's default Redis client is Lettuce. For simple `GET`/`SET`/`INCR` operations, Lettuce is perfectly fine. But this series requires **distributed locks (`RLock`), atomic counters (`RAtomicLong`), and Lua script execution** — high-level features that Redisson wraps into Java objects, keeping code concise.
>
> | Aspect | Lettuce | Redisson |
> |--------|---------|----------|
> | Level | Low-level (direct Redis commands) | High-level (Java object abstractions) |
> | Distributed locks | Build yourself with `SET NX EX` + Lua | `RLock` with automatic watchdog renewal |
> | Atomic counters | `RedisTemplate.opsForValue().increment()` | `RAtomicLong.decrementAndGet()` |
> | Lua scripts | `RedisTemplate.execute(RedisScript)` | `RScript` or built into each object |
> | Best for | Simple caching, pub/sub | Distributed locks, concurrency control, FCFS systems |

### 2.4 DECR Approach Limitations

The DECR approach is simple and fast, but has one limitation.



```
Stock: 0
User A: DECR → -1 (sold out) → INCR → 0
User B: DECR → -1 (sold out) → INCR → 0
User C: DECR in between → -1 ... (repeats)
```

**DECR keeps executing even when stock is already 0.** The value briefly goes negative before INCR restores it, causing unnecessary operations. Under high traffic, the negative value can go deep.

The core problem: **"check" and "deduct" are separate operations**. We need to combine them into a single atomic operation.

> **This approach isn't useless.** When stock is plentiful and traffic isn't extreme, DECR alone works just fine. Even if the value briefly goes negative, INCR restores it immediately, and actual orders are only created when `remaining >= 0`. However, under **high traffic near sold-out**, the repeated DECR/INCR cycle is inefficient. To fundamentally solve this, the next section introduces Lua scripts.

---

## 3. Approach 2: Lua Scripts

### 3.1 Why Lua?

Redis executes Lua scripts **atomically**. No other command can interrupt during script execution. This lets us bundle **"check stock → check duplicates → deduct" into a single atomic operation**.

### 3.2 The Lua Script

```lua
-- KEYS[1]: stock:product:{id}
-- KEYS[2]: purchased:product:{id}
-- ARGV[1]: userId

-- 1. Duplicate purchase check
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    return -2  -- already purchased
end

-- 2. Stock check
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil or stock <= 0 then
    return -1  -- sold out
end

-- 3. Deduct stock + record buyer (atomic)
redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return stock - 1  -- return remaining stock
```

**Three things handled in one script:**
1. `SISMEMBER` — duplicate purchase prevention (check if userId exists in Set)
2. `GET` — return immediately if stock ≤ 0 (no unnecessary DECR)
3. `DECR` + `SADD` — deduct stock and record buyer simultaneously

### 3.3 Spring Boot Implementation

You can write Lua scripts as inline Java strings, but readability suffers badly. **Separating into `.lua` files** is the production standard.

**Step 1: Separate Lua file** — `src/main/resources/scripts/purchase.lua`

```lua
-- KEYS[1]: stock:product:{id}
-- KEYS[2]: purchased:product:{id}
-- ARGV[1]: userId

if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    return -2
end

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil or stock <= 0 then
    return -1
end

redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return stock - 1
```

**Step 2: Load the file in Spring**

```java
@Configuration
public class RedisScriptConfig {

    @Bean
    public RedisScript<Long> purchaseScript() {
        return RedisScript.of(new ClassPathResource("scripts/purchase.lua"), Long.class);
    }
}
```

**Step 3: Use in Service**

```java
@Service
@RequiredArgsConstructor
public class RedisLuaStockService {
    private final StringRedisTemplate redisTemplate;
    private final RedisScript<Long> purchaseScript;

    public void initStock(Long productId, int quantity) {
        redisTemplate.opsForValue().set(stockKey(productId), String.valueOf(quantity));
    }

    public PurchaseResult tryPurchase(Long productId, Long userId) {
        Long result = redisTemplate.execute(
            purchaseScript,
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

**Benefits of file separation:**
- Lua syntax highlighting and linting in IDE
- Manage as `.lua` files → escape Java string concatenation hell
- Script-only changes show clearly in diffs
- `RedisScript.of()` internally SHA1-hashes the script and uses `EVALSHA` — avoids sending the full script text every time, improving network efficiency

```java
public enum PurchaseResult {
    SUCCESS,
    SOLD_OUT,
    ALREADY_PURCHASED
}
```

### 3.4 DECR vs Lua Comparison

| Aspect | Simple DECR | Lua Script |
|--------|------------|------------|
| Atomicity | Only DECR itself | Entire logic is atomic |
| Duplicate prevention | Separate implementation needed | Handled in script |
| When sold out | Goes negative → INCR to restore | Returns immediately at ≤ 0 |
| Race condition | Can go negative | None |
| Code complexity | Low | Medium |

**Lua scripts are the standard in production.** They handle duplicate checking atomically.

---

## 4. DB Order Persistence and Consistency

After Redis deducts stock, we need to save the order in DB. This is where **consistency problems** arise.

### 4.1 Problem Scenario

```
1. Redis: DECR → stock 99 (success ✅)
2. DB: INSERT order → fails ❌ (network error, DB down, etc.)
3. Result: Redis stock decreased but no order exists → stock leaked 💀
```

### 4.2 Solution: Compensating Transactions

```java
@Service
@RequiredArgsConstructor
public class FcfsOrderService {
    private final RedisLuaStockService redisStockService;
    private final OrderRepository orderRepository;
    private final RedissonClient redissonClient;

    @Transactional
    public OrderResult purchase(Long productId, Long userId) {
        // 1. Deduct stock in Redis
        PurchaseResult result = redisStockService.tryPurchase(productId, userId);
        if (result != PurchaseResult.SUCCESS) {
            return OrderResult.from(result);
        }

        try {
            // 2. Save order to DB
            Order order = Order.create(productId, userId);
            orderRepository.save(order);
            return OrderResult.success(order.getId());
        } catch (Exception e) {
            // 3. DB failure → restore Redis stock (compensating transaction)
            compensateRedis(productId, userId);
            throw e;
        }
    }

    private void compensateRedis(Long productId, Long userId) {
        RAtomicLong stock = redissonClient.getAtomicLong("stock:product:" + productId);
        stock.incrementAndGet();
        // Also remove from purchased Set
        RSet<String> purchased = redissonClient.getSet("purchased:product:" + productId);
        purchased.remove(userId.toString());
    }
}
```

### 4.3 What If Compensation Fails?

Even the Redis restoration (INCR) can fail in extreme cases. Safety nets for this:

1. **Log failures** — record which product/user had a failed compensation
2. **Scheduled consistency checks** — periodically compare Redis stock against DB order count
3. **Redis stock = initial stock - DB order count** — correct Redis from DB when mismatch found

```java
@Scheduled(fixedRate = 60000) // every minute
public void verifyStockConsistency(Long productId) {
    long redisStock = redisStockService.getStock(productId);
    long dbOrderCount = orderRepository.countByProductId(productId);
    long initialStock = productRepository.findById(productId)
        .orElseThrow().getInitialStock();

    long expectedRedisStock = initialStock - dbOrderCount;

    if (redisStock != expectedRedisStock) {
        log.warn("Stock mismatch! Redis: {}, expected: {}", redisStock, expectedRedisStock);
        redisStockService.initStock(productId, (int) expectedRedisStock);
    }
}
```

> Key principle: **DB is the source of truth, Redis is the cache.** When they disagree, always correct from DB.

---

## 5. Concurrency Test: DB Locks vs Redis

Same conditions as Part 4 (100 stock, 100 concurrent users).

### 5.1 Test Code

```java
@SpringBootTest
class RedisStockConcurrencyTest {

    @Autowired
    RedisLuaStockService redisStockService;

    @Test
    @DisplayName("100 concurrent purchases: stock becomes exactly 0")
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

        System.out.println("Success: " + successCount.get());
        System.out.println("Failed: " + failCount.get());
        System.out.println("Remaining stock: " + remainingStock);
        System.out.println("Elapsed: " + elapsed + "ms");

        assertEquals(100, successCount.get());
        assertEquals(0, remainingStock);
    }
}
```

### 5.2 Results Comparison

```
=== Redis Lua Script Concurrency Test ===
Concurrent requests: 100
Success: 100
Failed: 0
Remaining stock: 0
Elapsed: 127ms
=========================================
```

| Metric | DB Lock (FOR UPDATE) | Redis (Lua) | Difference |
|--------|---------------------|-------------|------------|
| Elapsed time | 851ms | 127ms | **6.7x faster** |
| Processing model | Row lock → serial waiting | Single thread → sequential |
| Duplicate prevention | Separate implementation | Built into Lua |
| DB connections used | 100 simultaneously | **0 during stock deduction** |

> **"Redis is faster just because it's in-memory — isn't that obvious?"**
>
> True. But the key isn't simply "memory = fast." It's that **the DB connection bottleneck is eliminated**.
>
> With DB locks, all 100 requests **hold DB connections simultaneously and wait on locks**. If the connection pool has 20 connections, 80 requests wait just to get a connection.
>
> With Redis, stock deduction finishes in memory, so DB connections are only used **"for successful requests, when saving the order."** If 150 people request 100 items, only the successful 100 need DB connections — the rejected 50 never touch the DB at all.
>
> ```
> [DB Lock]  150 requests → 150 DB connections needed (including lock waits)
> [Redis]    150 requests → 50 rejected instantly by Redis
>                         → DB connections needed for only 100 (no lock waits)
> ```
>
> In other words, the test result above (127ms) **measures stock deduction only**. In production, DB writes for order persistence add to the total response time. But these DB writes are **simple INSERTs without locks** — incomparably lighter than `FOR UPDATE`'s serial waiting.

### 5.3 Over-Demand Test

150 buyers competing for 100 items:

```
=== Redis Lua Script Over-Demand Test ===
Concurrent requests: 150
Success: 100
Failed (sold out): 50
Remaining stock: 0
Elapsed: 143ms
=========================================
```

Compared to DB lock's 816ms — **5.7x faster**. And the 50 rejected buyers used zero DB connections — keeping unnecessary requests from ever reaching the DB is the core advantage of the Redis approach.

### 5.4 Why So Fast?

```
[DB Lock]
Request → acquire DB connection → SELECT FOR UPDATE (disk I/O + lock wait)
→ UPDATE (disk I/O) → COMMIT → release connection

[Redis]
Request → execute Redis Lua (memory operation, ~0.1ms) → done
→ (separately) save order to DB
```

DB locks incur **disk I/O + lock waiting per request**. Redis finishes in **microseconds in memory**. We completely removed the DB from the hot path of stock deduction.

---

## 6. Redis Failure Preparedness

Redis is memory-based — **data disappears on server restart**. For an FCFS system, this is critical.

### 6.1 AOF (Append Only File)

```
# redis.conf
appendonly yes
appendfsync everysec   # write to disk every second
```

| Option | Safety | Performance |
|--------|--------|-------------|
| `always` | Highest (zero data loss) | Slow |
| `everysec` | High (up to 1 second loss) | **Recommended** |
| `no` | Low | Fast |

### 6.2 Redis Sentinel / Cluster

Configure **Sentinel** for automatic failover against single Redis failures.

```
Redis Primary → failure!
→ Sentinel detects (seconds)
→ Promotes Replica to new Primary
→ Application auto-connects to new Primary
```

Redisson natively supports Sentinel configuration:

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

### 6.3 Failure Recovery Strategy

Recovery sequence when Redis goes completely down:

1. **Immediately**: Circuit breaker blocks Redis calls, fall back to DB lock approach
2. **After recovery**: Reset Redis stock based on DB order count
3. **Verification**: Consistency scheduler checks for mismatches

The `CircuitBreaker` used here comes from the **Resilience4j** library. It can be configured declaratively in Spring Boot.

```yaml
# build.gradle
# implementation 'io.github.resilience4j:resilience4j-spring-boot3'

# application.yml
resilience4j:
  circuitbreaker:
    instances:
      redisStock:
        slidingWindowSize: 10           # judge based on last 10 calls
        failureRateThreshold: 50        # open circuit if failure rate >= 50%
        waitDurationInOpenState: 30s    # try half-open after 30s
        permittedNumberOfCallsInHalfOpenState: 3  # allow 3 trial calls in half-open
```

```java
@Service
@RequiredArgsConstructor
public class StockServiceFacade {
    private final RedisLuaStockService redisService;
    private final PessimisticLockStockService dbService;

    @CircuitBreaker(name = "redisStock", fallbackMethod = "fallbackPurchase")
    public OrderResult purchase(Long productId, Long userId) {
        return redisService.tryPurchase(productId, userId);
    }

    private OrderResult fallbackPurchase(Long productId, Long userId, Exception ex) {
        log.warn("Redis circuit open — falling back to DB locks. Cause: {}", ex.getMessage());
        return dbService.decreaseStock(productId, 1);
    }
}
```

**The circuit breaker's 3 states:**

```
CLOSED (normal)
  ↓ failure rate exceeds threshold
OPEN (blocked) → skips Redis, executes fallback immediately
  ↓ waitDuration elapses
HALF_OPEN (trial) → sends a few requests to Redis to check recovery
  ↓ success → CLOSED / failure → OPEN
```

> Resilience4j provides more than just circuit breakers — it also offers `@Bulkhead` (concurrency limiting) as covered in [j.u.c Practical Patterns](/blog/en/java-concurrent-practical-patterns/) Section 6. One library gives you circuit breakers, bulkheads, retries, and rate limiters that compose together.

---

## 7. Production Considerations

### 7.1 Redis Stock Initialization Timing

Stock must be loaded into Redis before the event starts:

```java
@EventListener(ApplicationReadyEvent.class)
public void warmUpStock() {
    List<Product> products = productRepository.findByStatus(ProductStatus.ON_SALE);
    for (Product product : products) {
        redisStockService.initStock(product.getId(), product.getStockQuantity());
    }
}
```

### 7.2 Sequence Initialization When Introducing Redis Mid-Operation

For a brand-new system, Redis `INCR` starting from 1 is fine. But when **introducing Redis to an already running system**, previously issued numbers can collide.

For example, if reservation numbers have been issued up to 1523 via DB sequences, and you introduce Redis `INCR`, it starts from 1 → **number collision.**

**Solution: Initialize Redis with the current max value from DB**

```java
@Component
public class ReservationSeqInitializer implements ApplicationRunner {

    private final StringRedisTemplate redisTemplate;
    private final ReservationRepository reservationRepository;

    private static final String SEQ_KEY = "reservation:seq";

    @Override
    public void run(ApplicationArguments args) {
        // Only initialize if key doesn't exist (don't touch if already set)
        Boolean wasSet = redisTemplate.opsForValue()
            .setIfAbsent(SEQ_KEY, String.valueOf(getMaxSeqFromDB()));

        if (Boolean.TRUE.equals(wasSet)) {
            log.info("Redis sequence initialized: {}", redisTemplate.opsForValue().get(SEQ_KEY));
        }
    }

    private long getMaxSeqFromDB() {
        return reservationRepository.findMaxReservationNo()
            .orElse(999L); // No data in DB → 999 → INCR starts from 1000
    }
}
```

| Scenario | Problem | Solution |
|----------|---------|----------|
| Redis restarts | Sequence resets to 1 → number collision | `ApplicationRunner` checks DB max value on startup and recovers |
| Multiple Pods start simultaneously | Two Pods initialize at once → race condition | Use `setIfAbsent` (SETNX) — only the first Pod succeeds |
| Direct INSERT into DB | Redis and DB sequences diverge | Unify Redis as the sole numbering source, or separate DB sequence ranges |

> **Key principle:** When introducing Redis mid-operation, always initialize with the current max value from DB. Using `INCR`'s default starting value (0) will cause number collisions.

### 7.3 TTL Configuration

Data lingering in Redis after the event wastes memory:

```java
public void initStock(Long productId, int quantity) {
    RAtomicLong stock = redissonClient.getAtomicLong(stockKey(productId));
    stock.set(quantity);
    stock.expire(Duration.ofHours(24)); // auto-delete after 24 hours
}
```

### 7.4 Essential Monitoring

| Metric | Why |
|--------|-----|
| Redis memory usage | Prevent OOM |
| Lua script execution time | Detect slow queries |
| Redis-DB stock mismatch count | Consistency monitoring |
| Circuit breaker state | Track fallback activation |

### 7.5 Monitoring Redis with Grafana

To view the above metrics in real time, use the **Grafana + Prometheus + redis_exporter** stack.

```
Redis → redis_exporter → Prometheus → Grafana
```

**redis_exporter** is an open-source tool that converts Redis `INFO` command output into Prometheus metrics.

| Metric | Prometheus Key | Purpose |
|--------|---------------|---------|
| Memory usage | `redis_memory_used_bytes` | Set OOM threshold alerts |
| Commands per second | `redis_instantaneous_ops_per_sec` | Detect traffic spikes |
| Connected clients | `redis_connected_clients` | Detect connection leaks |
| Cache hit rate | `redis_keyspace_hits_total / misses_total` | Check cache efficiency |
| Slow query count | `redis_slowlog_length` | Detect Lua script performance issues |

> **Quick start:** Import the official Grafana dashboard **Redis Dashboard for Prometheus (ID: 763)** to instantly visualize all the above metrics.

Spring Boot app's **Resilience4j metrics** can also be exported to Prometheus via Actuator + Micrometer. Circuit breaker state (CLOSED/OPEN), bulkhead concurrent calls, etc. can be viewed on the **same Grafana dashboard** alongside Redis metrics — letting you trace the causality chain "Redis response delay → circuit opens → DB fallback activates" on a single screen.

```yaml
# application.yml — expose Resilience4j metrics
management:
  endpoints:
    web:
      exposure:
        include: health, prometheus
  metrics:
    tags:
      application: fcfs-service
```

---

## Summary

| Key Point | Details |
|-----------|---------|
| **DECR's limits** | Simple but can go negative on sold-out, no duplicate check |
| **Lua scripts** | Validate + deduct + duplicate check atomically — production standard |
| **Redis-DB consistency** | Compensating transactions + consistency scheduler |
| **Performance** | **6.7x faster** than DB locks (851ms → 127ms) |
| **Failure preparedness** | AOF + Sentinel + circuit breaker + DB fallback |
| **Core principle** | DB is source of truth, Redis is the fast cache |

Redis is a **"fast but potentially unstable" layer**. If DB locks were "slow but reliable," Redis is "fast but requires failure preparedness." Combining both achieves **speed and reliability simultaneously**.

The next post covers **queue-based implementation**. It absorbs traffic spikes and shows users their position in line.
