---
title: "Spring Boot Practical Guide Part 2: Caching Strategy and Redis"
description: "A complete caching guide from Cache-Aside pattern to cache problem resolution, ready to apply in production"
pubDate: 2026-02-08T12:00:00+09:00
lang: en
tags: ["Spring Boot", "Redis", "Cache", "Backend", "Practical Guide"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 1: Concurrency Control](/en/blog/springboot-practical-guide-1) | **Part 2: Caching Strategy** | [Part 3: Event-Driven](/en/blog/springboot-practical-guide-3) |

---

## Introduction

Caching is a powerful tool for improving performance, but when used incorrectly, it only adds complexity. In this part, we cover **when to introduce caching** and **how to implement it correctly**.

**What Part 2 covers:**
- Criteria for deciding when to introduce caching
- Choosing caching strategies based on data characteristics
- Cache-Aside pattern and correct implementation (DTO caching)
- Resolving cache data inconsistency issues
- Cache problems (Stampede, Penetration, Avalanche)

### Table of Contents

- [What is a Cache?](#1-what-is-a-cache)
- [When to Introduce Caching](#2-when-to-introduce-caching)
- [Strategy Selection by Data Characteristics](#3-strategy-selection-by-data-characteristics)
- [Cache-Aside Pattern](#4-cache-aside-pattern-lazy-loading)
- [Cache Data Inconsistency Problem](#5-cache-data-inconsistency-problem)
- [Other Caching Patterns](#6-other-caching-patterns)
- [Cache Invalidation Strategies](#7-cache-invalidation-strategies)
- [Cache Problems and Solutions](#8-cache-problems-and-solutions)
- [Local Cache vs Distributed Cache](#9-local-cache-vs-distributed-cache)
- [Real Project Application Examples](#10-real-project-application-examples)
- [FAQ](#11-faq-frequently-asked-questions)
- [Summary](#summary)

---

## 1. What is a Cache?

A cache is a technique that stores frequently accessed data in a fast storage layer to reduce response time and decrease DB load.

### 1.1 Response Time Comparison

```
┌─────────────────────────────────────────────────────────────┐
│  Response Time by Storage Type                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DB Query:      ~10ms   (Network + Disk I/O)               │
│  Redis Query:   ~1ms    (Network + Memory)                  │
│  Local Cache:   ~0.01ms (Memory only)                       │
│                                                             │
│  * Local cache is 100x faster than Redis                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Cache Effect Calculation

```
Assuming QPS 1000, DB query 10ms:

Without cache:     1000 x 10ms = 10 seconds/sec of DB load
Cache 90% hit:     100 x 10ms = 1 second/sec of DB load (10x reduction!)
```

### 1.3 Cache Suitability Assessment

| Suitable Data | Unsuitable Data |
|--------------|----------------|
| Frequently read data | Frequently changing data |
| Rarely changing data | Data requiring real-time accuracy |
| Data with high computation cost | User-specific sensitive data |
| Shareable data | One-time data |

```
Marketplace example:

Suitable: Product listings, categories, popular products, configuration values
Not suitable: Stock quantities, payment status, real-time prices
```

---

## 2. When to Introduce Caching

> **Key point**: Caching is not "nice to have" -- it should be introduced **when a problem occurs**.

### 2.1 Introduction Signals (Consider caching in these situations)

```
1. DB CPU usage consistently above 70%
2. Same queries being executed repeatedly (slow query log analysis)
3. API response time failing SLA (e.g., p95 > 500ms)
4. DB connection pool exhaustion
5. Expected traffic surge (events, promotions)
```

### 2.2 SLA/SLO/SLI Terminology

| Term | Meaning | Example |
|------|---------|---------|
| **SLI** (Indicator) | Actual measured value | p95 response time = 320ms |
| **SLO** (Objective) | Internal target | p95 < 500ms |
| **SLA** (Agreement) | External commitment (compensation on violation) | p95 < 1000ms |

```
SLA example:

[Response Time]
- p50: Under 100ms   (50% of requests respond within 100ms)
- p95: Under 500ms   (95% of requests respond within 500ms)
- p99: Under 1000ms  (99% of requests respond within 1 second)

[Availability]
- 99.9%  -> Approximately 43 minutes of downtime per month allowed
- 99.99% -> Approximately 4 minutes of downtime per month allowed
```

### 2.3 Introduction Decision Flow

```
                        Start
                          │
                          ▼
                  ┌───────────────┐
                  │ Is response   │
                  │ time slow?    │
                  └───────────────┘
                     │         │
                   YES        NO
                     │         │
                     ▼         ▼
              ┌──────────┐   Cache not needed
              │ Is DB    │   (Avoid premature optimization)
              │ the cause?│
              └──────────┘
                 │    │
               YES   NO
                 │    │
                 ▼    ▼
          ┌──────────┐  Fix other bottlenecks
          │ Can query │  (Network, external APIs)
          │ be optimized?│
          └──────────┘
             │    │
           YES   NO
             │    │
             ▼    ▼
       Index/query  ┌──────────┐
       tuning first │ Read:Write│
                   │ > 10:1?  │
                   └──────────┘
                      │    │
                    YES   NO
                      │    │
                      ▼    ▼
                 Introduce  Consider DB
                 caching    scale-up
```

### 2.4 Pre-Introduction Checklist

```
□ Have you measured the current bottleneck? (APM, slow query logs)
□ Have you explored solutions without caching? (Indexes, query optimization)
□ Have you identified the read/write ratio of the data to cache?
□ Have you defined the acceptable range of data inconsistency?
□ Do you have a fallback strategy for cache failures?
□ Do you have a plan for monitoring cache hit rate?
```

### 2.5 When NOT to Introduce Caching

```
"We'll need it when traffic grows later" -> Premature optimization
"Other companies use Redis too" -> Baseless adoption
Write-heavy data -> Minimal cache benefit
Data requiring real-time accuracy -> Stock, payment status
User-specific data -> Low cache hit rate
```

### 2.6 Phased Introduction Strategy

```
[Phase 1] Start with local cache (Caffeine)
          - Immediate application without additional infrastructure
          - For single server or when data inconsistency is acceptable

[Phase 2] Switch to distributed cache (Redis)
          - Multi-server environment
          - When data consistency is needed

[Phase 3] Multi-level cache setup (Caffeine + Redis)
          - Hot data in local, everything in Redis
          - When optimal performance is required
```

---

## 3. Strategy Selection by Data Characteristics

> **Key point**: Don't handle all data with a single strategy. Use different strategies based on characteristics!

### 3.1 Recommended Strategy by Characteristics

| Data Characteristics | Example | Recommended Strategy | TTL |
|---------------------|---------|---------------------|-----|
| **Rarely changes** | Categories, terms, settings | Read-Through + Refresh-Ahead | 1 hour ~ 1 day |
| **Occasionally changes** | Product info, profiles | Cache-Aside + Explicit invalidation | 5 ~ 30 min |
| **Frequently changes** | Stock, prices | No caching or very short TTL | 10 ~ 30 sec |
| **Write-heavy** | View counts, likes | Write-Behind | N/A (batch) |
| **High computation cost** | Statistics, rankings, aggregations | Cache-Aside + Long TTL | 5 min ~ 1 hour |

### 3.2 Decision Criteria

```
1. Read:Write ratio
   - 100:1 or higher -> Aggressive caching
   - Around 10:1 -> Selective caching
   - 1:1 or lower -> Minimal cache benefit

2. Inconsistency tolerance
   - Not tolerable (stock, payments) -> No caching
   - Seconds tolerable -> Short TTL (10~30 sec)
   - Minutes tolerable -> Normal TTL + invalidation

3. Access pattern
   - Hot Data (popular products) -> Local cache + Redis (multi-level)
   - Cold Data (old products) -> Redis only or no caching

4. Computation cost
   - Simple query -> Small cache benefit
   - Aggregation/sorting/join -> Large cache benefit
```

---

## 4. Cache-Aside Pattern (Lazy Loading)

**The most widely used pattern.** The application directly manages the cache and DB.

### 4.1 How It Works

```
[Read - Cache Hit]
Client -> App -> Cache (HIT) -> Return data

[Read - Cache Miss]
Client -> App -> Cache (MISS) -> DB query -> Save to Cache -> Return data

[Write]
Client -> App -> Save to DB -> Invalidate Cache (or update)
```

### 4.2 Entity Caching is an Anti-pattern!

```kotlin
// Bad example: Caching Entity directly
@Cacheable(value = ["products"], key = "#id")
fun getProduct(id: Long): Product {  // Returns Entity
    return productRepository.findById(id).orElseThrow()
}
```

**Why Entity caching is problematic:**

| Problem | Description |
|---------|-------------|
| Lazy Loading errors | Entity retrieved from cache is outside persistence context -> `LazyInitializationException` |
| Serialization issues | Hibernate Proxy object serialization can fail |
| Unnecessary data exposure | Internal fields and associated Entities get cached/exposed |
| Increased cache size | Storing entire Entity -> Memory waste |
| Dirty checking malfunction | Modifying cached Entity may cause unintended DB updates |

### 4.3 Correct Implementation (Using DTOs)

```kotlin
// Correct example: DTO caching

// 1. Define cache DTO
data class ProductCacheDto(
    val id: Long,
    val name: String,
    val price: BigDecimal,
    val status: ProductStatus,
    val stockQuantity: Int,
    val categoryId: Long,
    val categoryName: String
) {
    companion object {
        fun from(product: Product): ProductCacheDto {
            return ProductCacheDto(
                id = product.id!!,
                name = product.name,
                price = product.price,
                status = product.status,
                stockQuantity = product.stockQuantity,
                categoryId = product.category.id!!,
                categoryName = product.category.name
            )
        }
    }
}

// 2. Manual implementation
fun getProduct(id: Long): ProductCacheDto {
    val cacheKey = "product:$id"

    // 1. Check cache
    redisTemplate.opsForValue().get(cacheKey)?.let { return it }

    // 2. Cache Miss -> Query DB and convert to DTO
    val product = productRepository.findById(id)
        .orElseThrow { BusinessException(ErrorCode.PRODUCT_NOT_FOUND) }

    val dto = ProductCacheDto.from(product)

    // 3. Store DTO in cache (TTL 10 minutes)
    redisTemplate.opsForValue().set(cacheKey, dto, Duration.ofMinutes(10))

    return dto
}

// 3. Using Spring @Cacheable (recommended)
@Cacheable(value = ["products"], key = "#id")
fun getProductWithCache(id: Long): ProductCacheDto {
    val product = productRepository.findById(id)
        .orElseThrow { BusinessException(ErrorCode.PRODUCT_NOT_FOUND) }
    return ProductCacheDto.from(product)
}

// 4. Cache invalidation
@CacheEvict(value = ["products"], key = "#id")
fun updateProduct(id: Long, request: UpdateProductRequest): ProductResponse {
    val product = productRepository.findById(id)
        .orElseThrow { BusinessException(ErrorCode.PRODUCT_NOT_FOUND) }
    product.update(request.name, request.price, request.description)
    return ProductResponse.from(productRepository.save(product))
}
```

### 4.4 DTO vs Entity Caching Comparison

| Aspect | Entity Caching | DTO Caching |
|--------|---------------|-------------|
| Lazy Loading | Errors occur | No issues |
| Serialization | Proxy problems | Safe |
| Cache size | Large (all fields) | Small (only what's needed) |
| API response conversion | Additional work needed | Ready to use |
| Associations | N+1 risk | Pre-flattened |

---

## 5. Cache Data Inconsistency Problem

Cache-Aside can cause data inconsistency.

### 5.1 Case 1: Write-then-Read Race Condition (Most Common)

```
[Request A: Modify product price]     [Request B: Query product]
         │                              │
         ├─ DB update (1000 -> 2000)    │
         │                              ├─ Cache lookup (HIT: 1000) <- Stale data!
         ├─ Delete cache                │
         │                              └─ Response: 1000
         └─ Complete
```

Cause: Another request reads the cache between the DB update and cache deletion

### 5.2 Case 2: Cache Refresh Race Condition

Two **read requests** arrive almost simultaneously, and a **write request** sneaks in between.

```
[Request A]                           [Request B]
   │                                  │
   ├─ Cache lookup (MISS)             ├─ Cache lookup (MISS)
   ├─ DB query (price: 1000)          ├─ DB query (price: 1000)
   │                                  │
   │  <- At this point, another request changes price to 2000 + deletes cache ->
   │                                  │
   │                                  ├─ Save to cache (1000) <- Old value saved to deleted cache!
   ├─ Save to cache (1000)            │

Result: DB has 2000 but cache has 1000 (inconsistent until TTL expires)
```

**Detailed timeline:**

```
Product ID: 123, Current price: 1000

[09:00:00.000] User A: Request product 123 query
[09:00:00.001] User B: Request product 123 query
[09:00:00.002] A: Cache MISS
[09:00:00.003] B: Cache MISS
[09:00:00.010] A: DB query starts
[09:00:00.011] B: DB query starts
[09:00:00.050] A: DB query complete (price: 1000)
[09:00:00.051] B: DB query complete (price: 1000)

[09:00:00.060] Admin: Change price to 2000 + delete cache

[09:00:00.070] B: Save 1000 to cache  <- Old value saved to deleted cache!
[09:00:00.071] A: Save 1000 to cache  <- Overwrite

[09:00:00.100 ~ 09:10:00.070]
    -> All users see 1000 during TTL (actual value is 2000)
```

### 5.3 Solutions

| Method | Description | Suitable Situation |
|--------|-------------|-------------------|
| **Short TTL** | Minimize inconsistency window (30 sec ~ 1 min) | Most cases (recommended) |
| **Write-Through** | Update instead of delete (`@CachePut`) | When consistency matters |
| **Delayed Delete** | Delete again 500ms after initial delete | Race condition prevention (Cases 2, 3) |
| **Distributed Lock** | Acquire lock when updating cache | When strong consistency is needed |
| **Version Key** | Include version like `product:1:v5` | Complex but reliable |

**Delayed Double Delete implementation:**

```kotlin
@Transactional
fun updateProduct(id: Long, request: UpdateRequest): ProductResponse {
    // 1. Delete cache first
    redisTemplate.delete("product:$id")

    // 2. Update DB
    val product = productRepository.save(...)

    // 3. Delete again after 500ms (race condition defense)
    CompletableFuture.delayedExecutor(500, TimeUnit.MILLISECONDS).execute {
        redisTemplate.delete("product:$id")
    }

    return ProductResponse.from(product)
}
```

**Why is this effective?**

```
In Case 2 scenario:

[09:00:00.060] Admin: Price change + cache delete (1st)
[09:00:00.070] B: Save 1000 to cache <- Stale value saved
[09:00:00.560] Admin: Cache delete (2nd, delayed delete) <- Stale value removed!
[09:00:00.600] Next request: Cache MISS -> DB query (2000) -> Correct!
```

> **Production recommendation:** A **short TTL** is sufficient in most cases.
> If "seeing stale data briefly during TTL is not a business problem," complex solutions are unnecessary.

---

## 6. Other Caching Patterns

### 6.1 Read-Through

The cache handles DB queries on behalf of the application. The application only looks at the cache.

```kotlin
@Bean
fun categoryCache(): LoadingCache<String, List<CategoryResponse>> {
    return Caffeine.newBuilder()
        .maximumSize(100)
        .expireAfterWrite(Duration.ofHours(1))
        .build { _ ->
            // Automatically called on Cache Miss
            categoryRepository.findAll()
                .sortedBy { it.displayOrder }
                .map { CategoryResponse.from(it) }
        }
}
```

### 6.2 Write-Through

On write, data is saved to both the cache and DB simultaneously.

```kotlin
// Using Spring @CachePut - updates cache along with DB save
@CachePut(value = ["products"], key = "#result.id")
fun createProduct(request: CreateProductRequest): ProductResponse {
    val product = Product.create(request)
    val saved = productRepository.save(product)
    return ProductResponse.from(saved)
}
```

**@CachePut and transaction issues:**

`@CachePut` saves to the cache **before the transaction commits**:

```
@Transactional + @CachePut execution order:

1. Transaction starts
2. Method executes (DB save)
3. Cache saves with method return value  <- Cache save happens here!
4. Transaction commits

Problem: Cache is saved at step 3, but what if step 4 rolls back?
     -> Data exists in cache but not in DB -- inconsistency!
```

**Why is @CacheEvict used more often?**

| Approach | Behavior | On DB Rollback |
|----------|----------|---------------|
| `@CacheEvict` | Delete cache -> Cache from DB on next query | Safe |
| `@CachePut` | Update cache immediately | Inconsistency possible |

### 6.3 Write-Behind (Write-Back)

Writes go only to the cache, and DB persistence is handled asynchronously.

```kotlin
@Service
class ProductViewService(
    private val redisTemplate: RedisTemplate<String, String>,
    private val productRepository: ProductRepository
) {
    // Record in Redis only on view (fast)
    fun incrementViewCount(productId: Long) {
        redisTemplate.opsForValue().increment("viewCount:$productId")
    }

    // Sync to DB every minute
    @Scheduled(fixedRate = 60_000)
    fun syncViewCountsToDB() {
        val keys = redisTemplate.keys("viewCount:*") ?: return

        keys.chunked(100).forEach { batch ->
            val updates = batch.mapNotNull { key ->
                val productId = key.substringAfter("viewCount:").toLongOrNull()
                val count = redisTemplate.opsForValue().getAndDelete(key)?.toLongOrNull() ?: 0
                productId?.let { it to count }
            }
            productRepository.bulkUpdateViewCounts(updates)
        }
    }
}
```

> **Suitable for**: Data where temporary loss is acceptable, such as view counts and likes

### 6.4 Refresh-Ahead

Refreshes the cache before TTL expires.

```kotlin
@Bean
fun popularProductsCache(): LoadingCache<String, List<ProductResponse>> {
    return Caffeine.newBuilder()
        .maximumSize(10)
        .expireAfterWrite(Duration.ofMinutes(10))
        .refreshAfterWrite(Duration.ofMinutes(8))  // Background refresh after 8 minutes
        .build { _ ->
            productRepository.findByStatusOrderBySalesCountDesc(
                ProductStatus.ON_SALE,
                PageRequest.of(0, 10)
            ).map { ProductResponse.from(it) }
        }
}
```

---

## 7. Cache Invalidation Strategies

### 7.1 TTL-Based

```kotlin
// Automatically expires after 10 minutes
redisTemplate.opsForValue().set("key", value, Duration.ofMinutes(10))
```

### 7.2 Explicit Invalidation

```kotlin
// Delete single key
@CacheEvict(value = ["products"], key = "#id")
fun updateProduct(id: Long, request: UpdateRequest)

// Delete all entries
@CacheEvict(value = ["products"], allEntries = true)
fun bulkUpdateProducts()

// Invalidate multiple caches simultaneously
@Caching(evict = [
    CacheEvict(value = ["products"], key = "#id"),
    CacheEvict(value = ["popularProducts"], allEntries = true)
])
fun deleteProduct(id: Long)
```

**allEntries=true vs key specification:**

| Approach | Behavior | Suitable Situation |
|----------|----------|-------------------|
| `key = "#id"` | Delete 1 specific key | Individual product cache |
| `allEntries = true` | Delete all keys in the cache | List/aggregation cache |

---

## 8. Cache Problems and Solutions

### 8.1 Cache Stampede (Thundering Herd)

**Problem**: Multiple requests simultaneously query the DB when cache expires

```
At TTL expiration
     │
     ├── Request 1 -> Cache Miss -> DB query
     ├── Request 2 -> Cache Miss -> DB query  <- DB overload!
     ├── Request 3 -> Cache Miss -> DB query
     └── ...
```

**Solution: Distributed Lock**

```kotlin
fun getProductWithLock(id: Long): ProductCacheDto {
    val cacheKey = "product:$id"
    val lockKey = "lock:product:$id"

    // Check cache
    redisTemplate.opsForValue().get(cacheKey)?.let { return it }

    // Acquire distributed lock (SETNX)
    val acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, "locked", Duration.ofSeconds(5))

    if (acquired == true) {
        try {
            // Double-check
            redisTemplate.opsForValue().get(cacheKey)?.let { return it }

            // Only 1 request queries DB
            val product = productRepository.findById(id).orElseThrow()
            val dto = ProductCacheDto.from(product)
            redisTemplate.opsForValue().set(cacheKey, dto, Duration.ofMinutes(10))
            return dto
        } finally {
            redisTemplate.delete(lockKey)
        }
    } else {
        // Lock acquisition failed -> Wait briefly and retry
        Thread.sleep(50)
        return getProductWithLock(id)
    }
}
```

### 8.2 Cache Penetration

**Problem**: Repeated queries for non-existent data -> DB query every time

**Solution: Null Caching**

```kotlin
fun getProductSafe(id: Long): ProductCacheDto? {
    val cacheKey = "product:$id"

    // Check EMPTY marker
    if (redisTemplate.hasKey("$cacheKey:empty") == true) {
        return null
    }

    redisTemplate.opsForValue().get(cacheKey)?.let { return it }

    val product = productRepository.findById(id).orElse(null)

    if (product == null) {
        // Cache non-existent data with short TTL
        redisTemplate.opsForValue().set("$cacheKey:empty", "1", Duration.ofMinutes(1))
        return null
    }

    val dto = ProductCacheDto.from(product)
    redisTemplate.opsForValue().set(cacheKey, dto, Duration.ofMinutes(10))
    return dto
}
```

### 8.3 Cache Avalanche

**Problem**: Many caches expire simultaneously -> DB overload

**Solution: TTL Jitter**

```kotlin
fun cacheWithJitter(key: String, value: Any, baseTtlMinutes: Long) {
    // Add +/-20% random to base TTL
    val jitter = (baseTtlMinutes * 0.2 * Random.nextDouble()).toLong()
    val ttl = baseTtlMinutes + jitter

    redisTemplate.opsForValue().set(key, value, Duration.ofMinutes(ttl))
}

// Example: Base 10 min -> Distributed between 8~12 min
```

### 8.4 Hot Key Problem

**Problem**: Requests concentrated on a specific key -> Single Redis node overload

**Solution: Local Cache Combination (Multi-level)**

```kotlin
// L1: Local cache (Caffeine) - 30 sec (fast)
// L2: Redis - 10 min (shared across servers)

private val localCache = Caffeine.newBuilder()
    .maximumSize(100)
    .expireAfterWrite(Duration.ofSeconds(30))
    .build<String, List<ProductResponse>>()

fun getPopularProducts(): List<ProductResponse> {
    val cacheKey = "popularProducts:top10"

    // L1 lookup (local)
    localCache.getIfPresent(cacheKey)?.let { return it }

    // L2 lookup (Redis)
    val products = redisTemplate.opsForValue().get(cacheKey)
        ?: fetchAndCacheToRedis()

    // Save to L1
    localCache.put(cacheKey, products)
    return products
}
```

---

## 9. Local Cache vs Distributed Cache

### 9.1 Comparison

| Aspect | Local Cache (Caffeine) | Distributed Cache (Redis) |
|--------|----------------------|--------------------------|
| **Speed** | ~0.01ms | ~1ms |
| **Capacity** | Limited by JVM heap | Tens of GB or more |
| **Consistency** | Inconsistent across servers | Consistency guaranteed |
| **Failure impact** | Independent per server | Affects all servers |

### 9.2 Selection Guide

```
Q1. Do multiple servers need the same data?
    YES -> Distributed cache (Redis)
    NO  -> Go to Q2

Q2. Does the data change frequently?
    YES -> Distributed cache
    NO  -> Local cache (Caffeine)
```

---

## 10. Real Project Application Examples

### 10.1 Category List (Cache-Aside)

Categories rarely change, so caching is highly effective.

```kotlin
@Service
class CategoryService(
    private val categoryJpaRepository: CategoryJpaRepository
) {
    // Retrieve from cache, query DB and cache if not found
    @Cacheable(value = ["categories"], key = "'all'")
    fun getAllCategories(): List<CategoryResponse> {
        return categoryJpaRepository.findAll()
            .sortedBy { it.displayOrder }
            .map { CategoryResponse.from(it) }  // Entity -> DTO conversion
    }

    // Invalidate entire cache when creating a category
    @Transactional
    @CacheEvict(value = ["categories"], allEntries = true)
    fun createCategory(req: CreateCategoryRequest): CategoryResponse {
        // ... creation logic
    }
}
```

### 10.2 Popular Product List (Cache-Aside)

Popular products have high computation cost (sorting) and a slight delay is acceptable.

```kotlin
@Service
class ProductService(
    private val productJpaRepository: ProductJpaRepository
) {
    // Cache popular products TOP 10
    @Cacheable(value = ["popularProducts"], key = "'top10'")
    fun getPopularProducts(): List<ProductResponse> {
        return productJpaRepository.findByStatusOrderBySalesCountDesc(
            ProductStatus.ON_SALE,
            PageRequest.of(0, 10)
        ).map { ProductResponse.from(it) }
    }

    // Invalidate popular products cache when updating a product
    @Transactional
    @CacheEvict(value = ["popularProducts"], allEntries = true)
    fun updateProduct(sellerId: Long, productId: Long, req: UpdateProductRequest): ProductResponse {
        // ... update logic
    }
}
```

### 10.3 Cache Configuration (CacheConfig)

```kotlin
@Configuration
@EnableCaching
@Profile("local")  // Caffeine for local, Redis for Docker/Prod
class CacheConfig {

    @Bean
    fun cacheManager(): CacheManager {
        return CaffeineCacheManager("popularProducts", "categories").apply {
            setCaffeine(
                Caffeine.newBuilder()
                    .expireAfterWrite(10, TimeUnit.MINUTES)  // TTL 10 minutes
                    .maximumSize(1000)
                    .recordStats()  // Hit rate monitoring
            )
        }
    }
}
```

---

## 11. FAQ (Frequently Asked Questions)

### Q1. What should I do before introducing caching?

Measure your current bottleneck. Identify the cause using APM or slow query logs, then first evaluate whether it can be resolved with index/query optimization.

### Q2. Why shouldn't I cache Entities?

There are 5 problems:
1. `LazyInitializationException` occurs
2. Hibernate Proxy serialization issues
3. Unnecessary data exposure
4. Increased cache size
5. Dirty checking malfunction

Always convert to DTO before caching.

### Q3. How should I set TTL?

It depends on data characteristics:
- Rarely changes (categories): 1 hour ~ 1 day
- Occasionally changes (product info): 5 ~ 30 minutes
- Frequently changes (stock): No caching or 10 ~ 30 seconds

Define the acceptable inconsistency range and set accordingly.

### Q4. What happens if cache invalidation fails?

The DB has the new value while the cache has the old value. Solutions:
- Set short TTL (last line of defense)
- Delayed delete (once more after 500ms)
- Logging/alerting on invalidation failure

### Q5. How should I handle cache failures?

Prepare a fallback strategy:

```kotlin
fun getPopularProducts(): List<ProductResponse> {
    return try {
        redisTemplate.opsForValue().get("popularProducts:top10")
            ?: fetchFromDB()
    } catch (e: RedisConnectionException) {
        log.warn("Redis connection failed, falling back to DB")
        fetchFromDB()  // Query DB directly
    }
}
```

### Q6. Should I cache real-time data like stock quantities?

No. Do not cache data that requires real-time accuracy. Handle it directly in the DB with atomic UPDATE operations.

---

## Summary

### Strategy by Data Characteristics

| Data Characteristics | Recommended Strategy | TTL | Example |
|---------------------|---------------------|-----|---------|
| **Rarely changes** | Read-Through + Refresh-Ahead | 1 hour ~ 1 day | Categories, settings |
| **Occasionally changes** | Cache-Aside + Explicit invalidation | 5 ~ 30 min | Product info |
| **Frequently changes** | No caching | - | Stock, payment status |
| **Write-heavy** | Write-Behind | Batch | View counts, likes |
| **High computation cost** | Cache-Aside + Long TTL | 5 min ~ 1 hour | Rankings, statistics |

### Caching Pattern Comparison

| Pattern | Key Point | Suitable Situation |
|---------|-----------|-------------------|
| **Cache-Aside** | App manages cache/DB directly | General purpose, read-heavy (recommended) |
| **Read-Through** | Cache handles DB queries | Consistent cache logic |
| **Write-Through** | Save to cache + DB simultaneously | When consistency matters |
| **Write-Behind** | Save to cache only, DB async | When write performance matters |
| **Refresh-Ahead** | Refresh before TTL expires | Hot Key |

### Solutions by Problem

| Problem | Solution |
|---------|----------|
| **Cache Stampede** | Distributed lock, probabilistic early refresh |
| **Cache Penetration** | Null caching |
| **Cache Avalanche** | TTL Jitter |
| **Hot Key** | Local cache combination, key replication |
| **Data inconsistency** | Short TTL, delayed delete |

### Quick Checklist

- [ ] Have you measured the bottleneck before introducing caching?
- [ ] Have you first evaluated whether index/query optimization can solve it?
- [ ] Are you caching DTOs instead of Entities?
- [ ] Have you set TTL appropriate for data characteristics?
- [ ] Is the cache invalidation strategy clear?
- [ ] Do you have a fallback strategy for cache failures?
- [ ] Can you monitor cache hit rate?

---

The next part covers **Event-Driven Architecture and Kafka**.

[Next: Part 3 - Event-Driven Architecture](/en/blog/springboot-practical-guide-3)
