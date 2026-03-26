---
title: "Implementing FCFS with DB Locks: From FOR UPDATE to Concurrency Testing"
description: "Implements a first-come-first-served stock deduction system using SELECT FOR UPDATE. Builds it with Spring Boot + JPA, validates data consistency with 100 concurrent requests, and identifies where DB locks hit their limits."
pubDate: "2026-03-20T16:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Database", "Lock", "Spring Boot"]
heroImage: "../../../assets/FcfsDbLockImplementation.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/fcfs-system-comparison-guide), we compared 6 implementation strategies for FCFS systems. This post implements the **simplest one — DB pessimistic locks (SELECT FOR UPDATE)**.

We'll build it in code, test with 100 concurrent buyers, and see exactly where the limits are.

---

## 1. Why Start with DB Locks?

DB locks are the **most fundamental FCFS implementation**.

- Works with just a database — no extra infrastructure
- Lets you see concurrency problems firsthand in code
- Establishes a **baseline** for understanding why Redis or queues become necessary

> To understand why a technology is needed, try building without it first.

---

## 2. The Problem: Stock Deduction Without Locks

Two users trying to buy the last item simultaneously:

| Step | TX1 (Order A) | TX2 (Order B) | Actual Stock |
|:---:|-----------|-----------|:----:|
| 1 | `SELECT stock` → **1** (saved in app memory) | | 1 |
| 2 | | `SELECT stock` → **1** (saved in app memory) | 1 |
| 3 | App checks 1 > 0 → `UPDATE stock = stock - 1` | | 0 |
| 4 | `COMMIT` | | 0 |
| 5 | | App checks 1 > 0 (stale read) → `UPDATE stock = stock - 1` | -1 💀 |
| 6 | | `COMMIT` | -1 |

**Stock went negative.** TX2 passed the check using its stale value (1), but `UPDATE`'s `stock - 1` deducts from the DB's **current value (0)**. Result: 0 - 1 = -1. This is the **Lost Update** problem.

---

## 3. The Fix: SELECT FOR UPDATE

Adding `FOR UPDATE` places an **exclusive lock** on the row. Other transactions can't read or modify it — they **wait**.

| Step | TX1 (Order A) | TX2 (Order B) | Stock |
|:---:|-----------|-----------|:----:|
| 1 | `SELECT stock FOR UPDATE` → **1** (row locked 🔒) | | 1 |
| 2 | | `SELECT stock FOR UPDATE` → waiting ⏳ | 1 |
| 3 | stock > 0 → `UPDATE stock = 0` | | 0 |
| 4 | `COMMIT` (lock released 🔓) | | 0 |
| 5 | | → **0** (latest value!) → sold out | 0 |
| 6 | | `ROLLBACK` | 0 |

TX2 waits until TX1 finishes, then **reads the latest stock (0) and handles it as sold out**. No overselling.

---

## 4. Implementation with Spring Boot + JPA

### 4.1 Entity

```java
@Entity
@Table(name = "products")
public class Product {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private int stockQuantity;

    @Enumerated(EnumType.STRING)
    private ProductStatus status; // ON_SALE, SOLD_OUT

    public void decreaseStock(int quantity) {
        if (this.stockQuantity < quantity) {
            throw new RuntimeException("Insufficient stock");
        }
        this.stockQuantity -= quantity;
        if (this.stockQuantity == 0) {
            this.status = ProductStatus.SOLD_OUT;
        }
    }
}
```

Stock deduction logic lives inside the entity. Throws an exception if `stockQuantity < quantity` to prevent negative stock.

### 4.2 Repository: FOR UPDATE Query

```java
public interface ProductRepository extends JpaRepository<Product, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Product p WHERE p.id = :id")
    Optional<Product> findByIdForUpdate(@Param("id") Long id);
}
```

`@Lock(LockModeType.PESSIMISTIC_WRITE)` — the actual SQL JPA generates:

```sql
SELECT * FROM products WHERE id = ? FOR UPDATE
```

With QueryDSL:

```java
Product product = queryFactory
    .selectFrom(QProduct.product)
    .where(QProduct.product.id.eq(id))
    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
    .fetchOne();
```

Either way, the result is the same — **an exclusive lock on the row**.

### 4.3 Service: Lock + Deduct

```java
@Service
public class PessimisticLockStockService {
    private final ProductRepository productRepository;

    @Transactional
    public void decreaseStock(Long productId, int quantity) {
        // 1. Lock the row + read
        Product product = productRepository.findByIdForUpdate(productId)
            .orElseThrow(() -> new RuntimeException("Product not found"));

        // 2. Deduct stock (throws if insufficient)
        product.decreaseStock(quantity);

        // 3. On transaction commit: UPDATE executes + lock releases
    }
}
```

**The core is 3 lines:**
1. `findByIdForUpdate` — lock and read the row
2. `decreaseStock` — deduct stock (entity method)
3. When `@Transactional` ends — JPA dirty checking fires the UPDATE, commit releases the lock

---

## 5. Concurrency Testing

"Does it really work when 100 people request simultaneously?" — Let's verify.

### 5.1 Test Structure

```java
@SpringBootTest
class PessimisticLockStockConcurrencyTest {

    @Autowired
    PessimisticLockStockService stockService;

    @Autowired
    ProductRepository productRepository;

    @Test
    @DisplayName("100 concurrent purchases: stock becomes exactly 0")
    void concurrentPurchase_100users() throws InterruptedException {
        // Create product with 100 stock
        Product product = productRepository.save(
            new Product("Limited Edition Sneakers", 100, ProductStatus.ON_SALE)
        );

        int threadCount = 100;
        ExecutorService executor = Executors.newFixedThreadPool(32);
        CountDownLatch latch = new CountDownLatch(threadCount);
        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger failCount = new AtomicInteger(0);

        long startTime = System.currentTimeMillis();

        for (int i = 0; i < threadCount; i++) {
            executor.submit(() -> {
                try {
                    stockService.decreaseStock(product.getId(), 1);
                    successCount.incrementAndGet();
                } catch (Exception e) {
                    failCount.incrementAndGet();
                } finally {
                    latch.countDown();
                }
            });
        }

        latch.await();
        executor.shutdown();
        long elapsed = System.currentTimeMillis() - startTime;

        Product updated = productRepository.findById(product.getId()).get();

        System.out.println("Success: " + successCount.get());
        System.out.println("Failed: " + failCount.get());
        System.out.println("Final stock: " + updated.getStockQuantity());
        System.out.println("Elapsed: " + elapsed + "ms");

        assertEquals(100, successCount.get());
        assertEquals(0, updated.getStockQuantity());
    }
}
```

**`CountDownLatch`** makes the test wait until all threads finish. A pool of 32 threads processes 100 tasks to simulate concurrent requests.

### 5.2 Results

```
=== Pessimistic Lock (FOR UPDATE) Concurrency Test ===
Concurrent requests: 100
Success: 100
Failed: 0
Final stock: 0
Elapsed: 851ms
=====================================================
```

**100 concurrent requests and stock is exactly 0.** No overselling, no negative stock.

### 5.3 Over-Demand Test

What about 150 buyers competing for 100 items?

```
=== Pessimistic Lock (FOR UPDATE) Over-Demand Test ===
Concurrent requests: 150
Success: 100
Failed (sold out): 50
Final stock: 0
Elapsed: 816ms
=====================================================
```

Exactly 100 succeed, 50 get sold-out errors. **Perfect data consistency.**

---

## 6. The Limits: Why This Alone Isn't Enough

Test results look perfect. But in production, three bottlenecks emerge.

### 6.1 Serialization Bottleneck

FOR UPDATE processes **one transaction at a time** on that row.

```
1,000 concurrent users → FOR UPDATE → 1 processes, 999 wait

50ms per transaction × 1,000 = up to 50s wait
200ms per transaction × 10,000 = up to 2,000s (33 min) wait 💀
```

In our test, 100 users finished in 851ms. But **production transactions include payment API calls, order creation, and event publishing**. The longer the transaction, the worse the wait.

### 6.2 Connection Pool Exhaustion

Transactions waiting for locks **hold DB connections**. HikariCP default pool size is 10:

```
100 concurrent users → FOR UPDATE → all 10 connections waiting for locks
→ Request #11 → no connection available → HikariCP timeout → Error!
```

Even normal queries (product listings, user pages) can't get connections — **the entire service slows down**.

### 6.3 Deadlocks

If a single order deducts stock for multiple products:

| Step | TX1 | TX2 | Status |
|:---:|------|------|:----:|
| 1 | Lock product A | | |
| 2 | | Lock product B | |
| 3 | Waiting for product B ⏳ | | |
| 4 | | Waiting for product A ⏳ | 💀 Deadlock! |

> Deadlock prevention (consistent lock ordering, timeouts) was covered in [Part 2](/blog/en/db-deadlock-and-lock-strategy-guide).

### 6.4 Realistic Thresholds

| Scenario | DB locks sufficient? |
|----------|:-------------------:|
| Internal company event (50 concurrent) | ✅ Fine |
| Small e-commerce (hundreds concurrent) | ⚠️ Need connection pool tuning |
| Limited-edition drop (thousands concurrent) | ❌ Need Redis |
| Concert ticketing (tens of thousands) | ❌ Need queue + Redis |

---

## 7. Alternative: Atomic UPDATE

FOR UPDATE holds a row lock from `SELECT → business logic → UPDATE → COMMIT`. Other transactions wait the entire time.

For simple stock deduction, this entire process can be **collapsed into a single UPDATE statement.**

```sql
UPDATE products
SET stock_quantity = stock_quantity - 1,
    sales_count = sales_count + 1
WHERE id = 1
AND stock_quantity >= 1
AND status = 'ON_SALE'
```

### Why Is This Safe?

The DB internally acquires a row lock when executing an UPDATE statement. This lock is **acquired at UPDATE time and released at COMMIT**. The difference from FOR UPDATE is **when the lock starts**.

| Approach | Lock starts | Lock ends |
|----------|-----------|----------|
| FOR UPDATE | At `SELECT` | At `COMMIT` |
| Atomic UPDATE | At `UPDATE` | At `COMMIT` |

FOR UPDATE holds the lock from SELECT all the way to COMMIT, while Atomic UPDATE holds it only from UPDATE to COMMIT. **The lock starts later, so it's held for less time.**

### Can Other Queries Share the Transaction?

You don't need to run the UPDATE in isolation. Other queries in the same transaction are fine.

```java
@Transactional
public void purchase(Long productId, Long userId) {
    // 1. Deduct stock (products row lock starts here)
    int updated = productRepository.decreaseStockAtomically(productId, 1);
    if (updated == 0) throw new RuntimeException("Sold out");

    // 2. Create order (INSERT into orders table → unrelated to products row lock)
    orderRepository.save(new Order(productId, userId));

    // 3. COMMIT (products row lock released here)
}
```

`INSERT INTO orders` has nothing to do with the products row lock. However, since **the lock is held from UPDATE until COMMIT**, long-running operations after the UPDATE (like external API calls) will extend the lock duration.

> **Tip**: Place the Atomic UPDATE **as late as possible** in the transaction. Do all reads and validations first, then run the UPDATE right before COMMIT to minimize lock hold time.

### FOR UPDATE vs Atomic UPDATE

| Aspect | FOR UPDATE | Atomic UPDATE |
|--------|-----------|---------------|
| Lock starts | At SELECT (early) | At UPDATE (late) |
| Lock ends | At COMMIT | At COMMIT |
| Concurrency | Entire span is serialized | Less waiting due to shorter lock duration |
| Stock reading | Reads latest value, enables business logic | No need to read current stock |
| Complex validation | Can validate beyond stock count | Only conditions in WHERE clause |
| Performance | Wait time grows with traffic | Faster (shorter lock window) |

### Is Atomic UPDATE Production-Ready?

Absolutely. But **suitability depends on the situation.**

**Good fit:**
- Operations where **"check condition + change a number" is all there is** — stock deduction, like count increment, coupon quota decrement
- No business logic needed before the deduction (no tier checks, no external API calls)
- High traffic where FOR UPDATE's lock duration becomes a bottleneck

**Not a good fit:**
- When you need to read the current stock value and branch on it (e.g., send alert if stock drops below 5)
- When validation spans multiple tables (e.g., check user tier → apply discount → deduct stock)
- When you need to distinguish failure reasons — Atomic UPDATE only returns `updated == 0`, so you can't tell "out of stock" from "product is OFF_SALE"

**Practical decision guide:**

| Complexity | Approach |
|------------|----------|
| Just decrementing a number | **Atomic UPDATE** |
| Business logic before/after deduction | **FOR UPDATE** |
| Thousands+ concurrent users | **Redis DECR** or **Redis + Lua** |

> If Atomic UPDATE can handle it, use Atomic UPDATE. If it can't, use FOR UPDATE — that's the natural production guideline.

---

## Summary

| Key Point | Details |
|-----------|---------|
| **FOR UPDATE's role** | Lock the row, block other transactions |
| **Implementation core** | `@Lock(PESSIMISTIC_WRITE)` + `@Transactional` |
| **Concurrency test results** | Perfect data consistency with 100 concurrent requests |
| **Limits** | Serialization bottleneck, connection pool exhaustion, deadlock risk |
| **Realistic threshold** | Suitable for up to a few dozen concurrent users |
| **Alternative** | Atomic UPDATE for improved simple deduction performance |

DB locks are the **starting point for understanding concurrency**. The next post goes beyond DB limits to cover **handling tens of thousands of requests per second with Redis**.
