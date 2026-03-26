---
title: "7 Practical java.util.concurrent Patterns: From Thread Pools to Concurrency Control"
description: "ExecutorService, CompletableFuture, CountDownLatch, ConcurrentHashMap, BlockingQueue, Semaphore, ReentrantLock — 7 commonly used java.util.concurrent classes with real-world patterns and working code."
pubDate: "2026-03-26T14:00:00+09:00"
tags: ["Java", "Concurrency", "Thread", "Spring Boot", "Backend"]
heroImage: "../../../assets/JavaConcurrentPracticalPatterns.png"
lang: en
---

## Introduction

When writing multithreaded code, relying solely on `synchronized` quickly hits a wall. Performance bottlenecks, deadlocks, callback hell — Java provides the `java.util.concurrent` package to solve these problems.

The issue is there are too many classes in this package. It's hard to know what to use when. This post covers **7 classes that are actually used frequently in production**, explaining **when and why** each one is useful with working code.

---

## 1. ExecutorService — Thread Pool Management

### Why Do You Need It?

Creating a `new Thread()` per request wastes resources on thread creation/destruction overhead, and thousands spawned simultaneously can cause OOM. A **thread pool** pre-creates threads and reuses them.

### Pattern: Parallel External API Calls

A product detail page that fetches product info, reviews, and recommendations **simultaneously**.

```java
ExecutorService executor = Executors.newFixedThreadPool(3);

Future<Product> productFuture = executor.submit(() -> productApi.getProduct(id));
Future<List<Review>> reviewFuture = executor.submit(() -> reviewApi.getReviews(id));
Future<List<Product>> recommendFuture = executor.submit(() -> recommendApi.get(id));

Product product = productFuture.get(3, TimeUnit.SECONDS);
List<Review> reviews = reviewFuture.get(3, TimeUnit.SECONDS);
List<Product> recommends = recommendFuture.get(3, TimeUnit.SECONDS);
```

### Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Pool size too large | Context switching overhead, actually slower | CPU-bound: core count, I/O-bound: core count × 2–4 |
| Forgetting `executor.shutdown()` | Threads stay alive, app won't terminate | Always shutdown in `try-finally` |
| Overusing `Executors.newCachedThreadPool()` | Traffic spike → unlimited thread creation → OOM | Use `newFixedThreadPool` or configure `ThreadPoolExecutor` directly |

### In Spring Boot?

In Spring Boot, you don't create `ExecutorService` directly. Instead, register a `ThreadPoolTaskExecutor` as a bean and delegate async execution with `@Async`.

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "apiExecutor")
    public TaskExecutor apiExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(3);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("api-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}

@Service
public class ProductService {

    @Async("apiExecutor")
    public CompletableFuture<Product> getProduct(Long id) {
        return CompletableFuture.completedFuture(productApi.getProduct(id));
    }
}
```

**Why is the Spring approach better?**
- Spring manages thread pool lifecycle (shutdown) — no manual `try-finally` needed
- Pool size configurable externally via `application.yml`
- Rejection policy (`RejectedExecutionHandler`) set declaratively

**When you still need the raw API:** In test code requiring fine-grained thread control, or batch utilities running outside the Spring context.

---

## 2. CompletableFuture — Async Composition

### Why Do You Need It?

`Future.get()` is **blocking**. The calling thread sits idle while waiting. `CompletableFuture` enables **non-blocking async processing** through callback chaining.

### Pattern: Async Pipeline

Order creation → payment → notification sent sequentially, but **without blocking the calling thread**.

```java
CompletableFuture
    .supplyAsync(() -> orderService.create(request))
    .thenApplyAsync(order -> paymentService.pay(order))
    .thenAcceptAsync(payment -> notificationService.send(payment))
    .exceptionally(ex -> {
        log.error("Order processing failed", ex);
        return null;
    });
```

### Chaining Method Roles

The methods above are distinguished by **whether they take input and produce output**.

| Method | Input | Output | Role | In the example above |
|--------|-------|--------|------|---------------------|
| `supplyAsync` | None | Yes (`T`) | Starting point of the chain. Produces a value | Create order → returns `Order` |
| `thenApplyAsync` | Yes (`T`) | Yes (`U`) | Receives previous result and **transforms** it | `Order` → payment → returns `Payment` |
| `thenAcceptAsync` | Yes (`T`) | None (`void`) | Receives previous result and **consumes** it (no return) | `Payment` → send notification |
| `thenRunAsync` | None | None (`void`) | **Runs** regardless of previous result | (e.g., logging, incrementing counters) |

> **What the `Async` suffix means:** `thenApply` *may* run on the **same thread** as the previous stage, while `thenApplyAsync` is guaranteed to run on a **separate thread** (ForkJoinPool or a specified Executor). For tasks involving I/O, the `Async` variant is the safer choice.

### Running Multiple Tasks and Combining Results

```java
CompletableFuture<Product> productCf = CompletableFuture
    .supplyAsync(() -> productApi.getProduct(id));
CompletableFuture<List<Review>> reviewCf = CompletableFuture
    .supplyAsync(() -> reviewApi.getReviews(id));

// Combine when both complete
CompletableFuture<ProductDetail> detailCf = productCf
    .thenCombine(reviewCf, (product, reviews) -> new ProductDetail(product, reviews));
```

### Future vs CompletableFuture

| Aspect | Future | CompletableFuture |
|--------|--------|-------------------|
| Getting results | `get()` blocks | `thenApply()` non-blocking |
| Chaining | Not possible | `thenApply → thenCompose → thenCombine` |
| Error handling | Wrap in try-catch | `exceptionally()`, `handle()` |
| Combining tasks | Manual implementation | `allOf()`, `anyOf()`, `thenCombine()` |

### In Spring Boot?

When the `@Async` methods from Section 1 return `CompletableFuture`, all chaining works identically to pure Java.

```java
@Service
public class ProductFacade {

    private final ProductService productService;
    private final ReviewService reviewService;

    public CompletableFuture<ProductDetail> getDetail(Long id) {
        CompletableFuture<Product> productCf = productService.getProduct(id);   // @Async
        CompletableFuture<List<Review>> reviewCf = reviewService.getReviews(id); // @Async

        return productCf.thenCombine(reviewCf, ProductDetail::new);
    }
}
```

**Key insight:** `@Async` only determines *which thread pool* executes the method — Spring handles that part. The returned `CompletableFuture`'s chaining API (`thenApply`, `thenCombine`, `exceptionally`) is pure Java. **The composition patterns from Section 2 apply identically in Spring Boot.**

---

## 3. CountDownLatch — Simultaneous Start / Completion Wait

### Why Do You Need It?

When you need "N threads to **start simultaneously**" or "wait until N tasks **all complete**."

### Pattern: Concurrency Testing

Testing 100 simultaneous purchase requests in a FCFS system.

```java
int threadCount = 100;
ExecutorService executor = Executors.newFixedThreadPool(threadCount);
CountDownLatch ready = new CountDownLatch(threadCount);  // wait until all ready
CountDownLatch start = new CountDownLatch(1);             // simultaneous start signal
CountDownLatch done = new CountDownLatch(threadCount);    // wait until all finish

for (int i = 0; i < threadCount; i++) {
    executor.submit(() -> {
        ready.countDown();   // "I'm ready"
        start.await();       // wait for start signal
        try {
            purchaseService.buy(productId, userId);
        } finally {
            done.countDown(); // "I'm done"
        }
    });
}

ready.await();     // wait for all 100 threads to be ready
start.countDown(); // GO!
done.await();      // wait for all 100 threads to finish

assertThat(product.getStock()).isEqualTo(0);
```

### Key Points

- `countDown()` decrements the count by 1. When it hits 0, all threads blocked on `await()` wake up.
- **It's a one-shot tool.** Once the count reaches 0, it can't be reused. Use `CyclicBarrier` if you need reusability.

### In Spring Boot?

There is no Spring wrapper for CountDownLatch. In `@SpringBootTest`, **using it directly is the standard approach**.

```java
@SpringBootTest
class PurchaseConcurrencyTest {

    @Autowired
    private PurchaseService purchaseService;

    @Test
    void concurrent_100_purchases() throws InterruptedException {
        int threadCount = 100;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CountDownLatch ready = new CountDownLatch(threadCount);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threadCount);

        for (int i = 0; i < threadCount; i++) {
            final long userId = i;
            executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    purchaseService.buy(productId, userId);
                } finally {
                    done.countDown();
                }
                return null;
            });
        }

        ready.await();
        start.countDown();
        done.await();

        assertThat(product.getStock()).isEqualTo(0);
        executor.shutdown();
    }
}
```

**The point:** The `CountDownLatch` + `ExecutorService` combo is used as-is in Spring Boot tests. This pattern is effectively the only way to simulate "N concurrent requests hitting at the same time."

---

## 4. ConcurrentHashMap — Thread-Safe Cache

### Why Do You Need It?

`HashMap` under concurrent put/get can cause infinite loops, data loss, and other unpredictable bugs. `Collections.synchronizedMap()` is safe but **locks on every operation**, making it slow.

`ConcurrentHashMap` partitions internally — **reads are lock-free, writes lock only the affected segment.**

### Pattern: Local Cache

Caching external API results in memory, where multiple threads might request the same key simultaneously — and you want **only one API call**.

```java
private final ConcurrentHashMap<String, Product> cache = new ConcurrentHashMap<>();

public Product getProduct(String id) {
    return cache.computeIfAbsent(id, key -> {
        // This block executes only once per key
        return productApi.fetch(key);
    });
}
```

### Common Mistake

```java
// ❌ check-then-act → two threads both see null and both put
if (!map.containsKey(key)) {
    map.put(key, value);
}

// ✅ Use atomic operations
map.putIfAbsent(key, value);
map.computeIfAbsent(key, k -> createValue(k));
```

> Another thread can slip in between `containsKey()` and `put()`. Use ConcurrentHashMap's atomic methods (`putIfAbsent`, `computeIfAbsent`, `merge`) for true thread safety.

### In Spring Boot?

For local caching, Spring Cache + Caffeine is the standard approach.

```java
// build.gradle
// implementation 'org.springframework.boot:spring-boot-starter-cache'
// implementation 'com.github.ben-manes.caffeine:caffeine'

@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager("products");
        manager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(1_000)
            .expireAfterWrite(Duration.ofMinutes(10)));
        return manager;
    }
}

@Service
public class ProductService {

    @Cacheable(value = "products", key = "#id")
    public Product getProduct(String id) {
        return productApi.fetch(id); // called only on cache miss
    }
}
```

**Why is Spring Cache better?**
- TTL, max size, and eviction policies configured declaratively
- `@CacheEvict` separates invalidation logic
- Caffeine is built on `ConcurrentHashMap` internally, so concurrency is guaranteed

**When you still need `ConcurrentHashMap`:** In-request memoization, `private` methods where cache annotations don't work, or cache keys with complex dynamic structures.

---

## 5. BlockingQueue — Producer-Consumer Pattern

### Why Do You Need It?

"One side puts data in, another side takes it out." When the queue is empty, consumers automatically wait. When full, producers automatically wait. **No manual `wait()`/`notify()` needed.**

### Pattern: Async Log Collector

Writing logs synchronously during request handling slows response time. Push logs to a queue and process them in a separate thread.

```java
private final BlockingQueue<LogEvent> logQueue = new LinkedBlockingQueue<>(10_000);

// Producer: request-handling thread
public void log(LogEvent event) {
    if (!logQueue.offer(event)) {
        // Queue full → drop (log loss vs service outage tradeoff)
        System.err.println("Log queue overflow, dropping event");
    }
}

// Consumer: dedicated thread
public void startConsumer() {
    new Thread(() -> {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                LogEvent event = logQueue.take(); // blocks until queue has data
                logWriter.write(event);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }).start();
}
```

### Choosing an Implementation

| Implementation | Characteristics | Best For |
|---------------|----------------|----------|
| `LinkedBlockingQueue` | Node-based, optional size limit | General producer-consumer |
| `ArrayBlockingQueue` | Array-based, fixed size | Predictable memory management |
| `PriorityBlockingQueue` | Priority-sorted | Processing urgent tasks first |
| `SynchronousQueue` | No buffer, direct handoff | Used internally by `Executors.newCachedThreadPool()` |

### In Spring Boot?

The producer-consumer pattern can be replaced with Spring's event system.

```java
// Event definition
public record OrderCreatedEvent(Long orderId, String userId) {}

// Producer: publish event
@Service
public class OrderService {

    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public Order create(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));
        eventPublisher.publishEvent(new OrderCreatedEvent(order.getId(), request.getUserId()));
        return order;
    }
}

// Consumer: async event listener
@Component
public class OrderEventListener {

    @Async("apiExecutor")
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        notificationService.send(event.orderId());
        analyticsService.track(event);
    }
}
```

**Why is the Spring event system better?**
- Producers and consumers don't know each other → low coupling
- Adding `@Async` runs the handler on a separate thread → async processing
- `@TransactionalEventListener` can execute only after transaction commit

**When you still need `BlockingQueue`:** Batch processing (accumulate and flush), backpressure control, or library code that must work without a Spring context.

---

## 6. Semaphore — Limiting Concurrent Access

### Why Do You Need It?

When you need "at most N threads accessing this resource simultaneously." `synchronized` allows only 1, but Semaphore **allows N**.

### Pattern: External API Concurrency Limit

An external payment API that only allows 10 concurrent requests.

```java
private final Semaphore apiLimit = new Semaphore(10);

public PaymentResult pay(PaymentRequest request) throws InterruptedException {
    apiLimit.acquire(); // blocks if 10 already in use
    try {
        return paymentApi.call(request);
    } finally {
        apiLimit.release(); // return the slot
    }
}
```

### With Timeout

```java
if (apiLimit.tryAcquire(3, TimeUnit.SECONDS)) {
    try {
        return paymentApi.call(request);
    } finally {
        apiLimit.release();
    }
} else {
    throw new RuntimeException("Payment API call timed out waiting for a slot");
}
```

### Semaphore vs Rate Limiter

| Aspect | Semaphore | Rate Limiter (Guava/Resilience4j) |
|--------|-----------|----------------------------------|
| Controls | **Concurrent execution count** (how many running right now) | **Throughput per time unit** (how many per second) |
| Example | "Only 10 calls at once" | "Only 100 calls per second" |
| Slot return | On task completion via `release()` | Auto-refills over time |

### In Spring Boot?

Resilience4j's `@Bulkhead` provides declarative concurrency limiting.

```java
// build.gradle
// implementation 'io.github.resilience4j:resilience4j-spring-boot3'

// application.yml
// resilience4j:
//   bulkhead:
//     instances:
//       paymentApi:
//         maxConcurrentCalls: 10
//         maxWaitDuration: 3s

@Service
public class PaymentService {

    @Bulkhead(name = "paymentApi", fallbackMethod = "payFallback")
    public PaymentResult pay(PaymentRequest request) {
        return paymentApi.call(request);
    }

    private PaymentResult payFallback(PaymentRequest request, BulkheadFullException ex) {
        throw new ServiceUnavailableException("Payment service is temporarily overloaded");
    }
}
```

**Why is Resilience4j better?**
- Configuration externalized to `application.yml` → change without redeployment
- Fallback methods for graceful degradation
- Actuator integration for automatic metrics (concurrent calls, waiting count)
- Composable with Circuit Breaker, Retry, and other patterns

**When you still need `Semaphore`:** Simple utilities where Resilience4j is overkill, or library code that must run without framework dependencies.

---

## 7. ReentrantLock — synchronized on Steroids

### Why Do You Need It?

`synchronized` is simple but lacks **timeouts**, **fairness guarantees**, and **conditional waiting**. `ReentrantLock` fills these gaps.

### Pattern: Lock with Timeout

Preventing deadlocks by setting a time limit on lock acquisition.

```java
private final ReentrantLock lock = new ReentrantLock();

public void transferMoney(Account from, Account to, long amount) {
    try {
        if (lock.tryLock(3, TimeUnit.SECONDS)) {
            try {
                from.withdraw(amount);
                to.deposit(amount);
            } finally {
                lock.unlock();
            }
        } else {
            throw new RuntimeException("Lock acquisition timed out — retry later");
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
```

### synchronized vs ReentrantLock

| Aspect | synchronized | ReentrantLock |
|--------|-------------|---------------|
| Usage | Keyword (auto-release) | `lock()` / `unlock()` (manual release) |
| Timeout | Not possible | `tryLock(timeout)` |
| Fairness | Not guaranteed | `new ReentrantLock(true)` → longest-waiting thread goes first |
| Conditional wait | `wait()` / `notify()` | `Condition` objects for multiple conditions |
| Risk of mistakes | Low (auto-release) | Forgetting `unlock()` → permanent lock. Always use `finally` |

> If you just need a simple critical section, `synchronized` is enough. Only reach for `ReentrantLock` when you need `tryLock`, fairness, or multiple conditions.

### In Spring Boot?

A single-instance `ReentrantLock` is almost never sufficient in production. The moment you have multiple Pods, the lock becomes meaningless. You need a **distributed lock**.

```java
// build.gradle
// implementation 'org.redisson:redisson-spring-boot-starter'

@Service
public class StockService {

    private final RedissonClient redissonClient;

    public void decrease(Long productId, int quantity) {
        RLock lock = redissonClient.getLock("stock:" + productId);

        try {
            if (lock.tryLock(5, 3, TimeUnit.SECONDS)) { // wait 5s, auto-release 3s
                try {
                    Stock stock = stockRepository.findByProductId(productId);
                    stock.decrease(quantity);
                    stockRepository.save(stock);
                } finally {
                    lock.unlock();
                }
            } else {
                throw new RuntimeException("Failed to acquire stock lock");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

**Why distributed locks?**
- Spring Boot apps typically run on 2+ Pods
- JVM-level `ReentrantLock` only controls threads within the same process
- Redis-based Redisson locks are **shared across all Pods**

**When you still need `ReentrantLock`:** Batch servers guaranteed to be single-instance, or protecting JVM-internal resources (file writes, connection pool initialization).

---

## Summary: When to Use What?

| Situation | Class |
|-----------|-------|
| Run tasks in a thread pool | `ExecutorService` |
| Chain and combine async tasks | `CompletableFuture` |
| Simultaneous start / wait for N completions | `CountDownLatch` |
| Thread-safe Map (local cache) | `ConcurrentHashMap` |
| Producer-consumer queue | `BlockingQueue` |
| Limit concurrent access to N | `Semaphore` |
| Lock with timeout / fairness | `ReentrantLock` |

> The core principle: **don't create `Thread` objects directly, and don't write `wait()`/`notify()` yourself.** `java.util.concurrent` provides battle-tested tools. Don't reinvent the wheel.

---

## Spring Boot Wraps j.u.c — It Doesn't Replace It

The 7 classes covered in this post don't disappear in Spring Boot. Spring **wraps them to make them easier to use**.

| Pure Java | Spring Boot Wrapper |
|-----------|-------------------|
| `ExecutorService` | `@Async` + `ThreadPoolTaskExecutor` |
| `CompletableFuture` | Used directly as `@Async` return type |
| `CountDownLatch` | No wrapper — used as-is in tests |
| `ConcurrentHashMap` | `@Cacheable` + Caffeine |
| `BlockingQueue` | `ApplicationEventPublisher` + `@EventListener` |
| `Semaphore` | Resilience4j `@Bulkhead` |
| `ReentrantLock` | Redisson distributed locks |

**You need to understand the primitives to use the wrappers properly.** Debugging why `@Async` isn't working requires understanding `ExecutorService`. Knowing how Caffeine guarantees concurrency requires understanding `ConcurrentHashMap`. Work on top of abstractions, but understand the layer beneath.
