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

> In Spring Boot, it's more common to use `@Async` + a `TaskExecutor` bean rather than creating ExecutorService directly. But the underlying mechanism is the same.

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
