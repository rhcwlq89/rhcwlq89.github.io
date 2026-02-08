---
title: "Spring Boot Pre-Interview Guide Part 4: Performance & Optimization"
description: "Performance optimization and query tuning — N+1 problem, pagination, and caching strategies"
pubDate: 2026-02-08T13:30:00+09:00
lang: en
tags: ["Spring Boot", "Performance", "JPA", "Cache", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 3: Documentation & AOP](/en/blog/spring-boot-pre-interview-guide-3) | **Part 4: Performance** | [Part 5: Security](/en/blog/spring-boot-pre-interview-guide-5) |

> **Full Roadmap**: See the [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)

---

## Introduction

If you've completed the basics from Parts 1-3, it's time for the advanced material. Part 4 covers performance optimization.

**Topics covered in Part 4:**
- Solving the N+1 problem
- Pagination strategies
- Applying caching
- Query optimization

### Table of Contents

- [Solving the N+1 Problem](#solving-the-n1-problem)
- [Pagination](#pagination)
- [Caching Strategies](#caching-strategies)
- [Query Optimization](#query-optimization)
- [Summary](#summary)

---

## Solving the N+1 Problem

### 1. What is the N+1 Problem?

When querying entities with associations, 1 query fetches N records, and then N additional queries are executed for each record's associated data.

```java
// Order : OrderItem = 1 : N relationship
List<Order> orders = orderRepository.findAll(); // 1 query

for (Order order : orders) {
    // An additional query fires for each Order's OrderItems (N times)
    List<OrderItem> items = order.getOrderItems();
    items.forEach(item -> System.out.println(item.getProductName()));
}
```

If you fetch 10 orders, 1 + 10 = 11 queries are executed.

### 2. Solutions

#### Fetch Join

```java
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o JOIN FETCH o.orderItems")
    List<Order> findAllWithOrderItems();
}
```

<details>
<summary>Kotlin version</summary>

```kotlin
interface OrderRepository : JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o JOIN FETCH o.orderItems")
    fun findAllWithOrderItems(): List<Order>
}
```

</details>

> **Caution**: Fetch Join cannot be used together with paging. When you Fetch Join a collection, the data gets multiplied (Cartesian product), and paging is applied in memory.

#### @EntityGraph

`@EntityGraph` achieves the same effect as Fetch Join without writing JPQL.

```java
public interface OrderRepository extends JpaRepository<Order, Long> {

    // 1-level association: Order -> OrderItems
    @EntityGraph(attributePaths = {"orderItems"})
    @Query("SELECT o FROM Order o")
    List<Order> findAllWithOrderItemsGraph();

    // 2-level association: Order -> OrderItems -> Product
    @EntityGraph(attributePaths = {"orderItems", "orderItems.product"})
    List<Order> findByStatus(OrderStatus status);

    // 3-level association: Order -> OrderItems -> Product -> Category
    @EntityGraph(attributePaths = {
        "orderItems",
        "orderItems.product",
        "orderItems.product.category"
    })
    Optional<Order> findWithFullDetailsById(Long id);
}
```

**@EntityGraph vs Fetch Join Comparison**

| Aspect | @EntityGraph | Fetch Join |
|------|-------------|------------|
| Syntax | Annotation | JPQL required |
| Flexibility | Fixed graph | Different queries per condition |
| Readability | Good | JPQL can get lengthy |
| Dynamic application | Difficult | Possible |

> **Tip**: Use `@EntityGraph` for simple associations, and Fetch Join when complex conditions are needed.

#### @BatchSize

You can configure it globally in `application.yml` or apply it directly on the entity.

```yaml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
```

```java
@Entity
public class Order {

    @BatchSize(size = 100)
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    private List<OrderItem> orderItems = new ArrayList<>();
}
```

`@BatchSize` uses an IN query to fetch lazily loaded data in one go:

```sql
-- Before: N queries
SELECT * FROM order_item WHERE order_id = 1;
SELECT * FROM order_item WHERE order_id = 2;
...

-- After @BatchSize: 1 query
SELECT * FROM order_item WHERE order_id IN (1, 2, 3, ..., 100);
```

<details>
<summary>Fetch Join vs @EntityGraph vs @BatchSize Selection Criteria</summary>

| Method | Pros | Cons | When to Use |
|------|------|------|----------|
| **Fetch Join** | Resolves in a single query | No paging, beware of Cartesian product | When result set is small and paging is not needed |
| **@EntityGraph** | Declarative, applicable per method | Same limitations as Fetch Join | When eager loading is needed only for specific queries |
| **@BatchSize** | Supports paging, global configuration | Additional queries (1 + 1) | When paging is needed or there are multiple collections |

**Recommended for assignments**: Set `@BatchSize` globally, and use Fetch Join only when necessary

</details>

### 3. Lazy Loading vs Eager Loading

```java
@Entity
public class Order {

    // Eager loading (EAGER) - NOT recommended
    @ManyToOne(fetch = FetchType.EAGER)
    private Member member;

    // Lazy loading (LAZY) - Recommended
    @ManyToOne(fetch = FetchType.LAZY)
    private Member member;
}
```

<details>
<summary>Practical Tip: Set all associations to LAZY</summary>

**Principle**: Set all associations to `FetchType.LAZY`, and fetch them together using Fetch Join or @EntityGraph when needed.

**Reasons**:
1. EAGER causes unexpected queries
2. Even with EAGER, the N+1 problem occurs when using JPQL
3. Fetching only the required data is better for performance

**Note**: The default for `@ManyToOne` and `@OneToOne` is EAGER, so you must explicitly set them to LAZY.

</details>

---

## Pagination

### 1. Spring Data's Pageable

**Page Response Type Comparison**

| Approach | Pros | Cons |
|------|------|------|
| Return `Page<T>` directly | Simple, Spring standard | Too many unnecessary fields (`sort`, `pageable`, etc.) |
| `CommonResponse<Page<T>>` | Consistent response format | Nested information inside Page |
| Custom PageResponse | Only necessary fields | Requires additional DTO |

**Recommended**: For assignments, returning `Page<T>` directly or wrapping it with `CommonResponse<Page<T>>` is simple and sufficient.

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    public Page<ProductResponse> getProducts(Pageable pageable) {
        return productRepository.findAll(pageable)
            .map(ProductResponse::from);
    }
}
```

```java
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    // Approach 1: Return Page directly
    @GetMapping
    public Page<ProductResponse> getProducts(
            @PageableDefault(size = 20, sort = "createdAt", direction = Sort.Direction.DESC)
            Pageable pageable) {
        return productService.getProducts(pageable);
    }

    // Approach 2: Wrap with CommonResponse
    @GetMapping("/v2")
    public CommonResponse<Page<ProductResponse>> getProductsV2(Pageable pageable) {
        return CommonResponse.success(productService.getProducts(pageable));
    }
}
```

<details>
<summary>Custom PageResponse Example (Optional)</summary>

```java
public record PageResponse<T>(
    List<T> content,
    int page,
    int size,
    long totalElements,
    int totalPages,
    boolean hasNext
) {
    public static <T> PageResponse<T> from(Page<T> page) {
        return new PageResponse<>(
            page.getContent(),
            page.getNumber(),
            page.getSize(),
            page.getTotalElements(),
            page.getTotalPages(),
            page.hasNext()
        );
    }
}
```

</details>

<details>
<summary>Kotlin version</summary>

```kotlin
@Service
class ProductService(
    private val productRepository: ProductRepository
) {
    fun getProducts(pageable: Pageable): Page<ProductResponse> {
        return productRepository.findAll(pageable)
            .map { ProductResponse.from(it) }
    }
}

@RestController
@RequestMapping("/api/v1/products")
class ProductController(
    private val productService: ProductService
) {
    @GetMapping
    fun getProducts(
        @PageableDefault(size = 20, sort = ["createdAt"], direction = Sort.Direction.DESC)
        pageable: Pageable
    ): Page<ProductResponse> {
        return productService.getProducts(pageable)
    }
}
```

</details>

### 2. Page vs Slice

| Type | Characteristics | Query |
|------|------|------|
| **Page** | Includes total count | SELECT + COUNT |
| **Slice** | Only knows if next page exists | SELECT (size + 1) |

```java
// Page - When total count is needed (typical pagination)
Page<Product> findByCategory(Category category, Pageable pageable);

// Slice - When total count is unnecessary (e.g., infinite scroll)
Slice<Product> findByCategory(Category category, Pageable pageable);

// List - When only data is needed without pagination info
List<Product> findByCategory(Category category, Pageable pageable);
```

<details>
<summary>Practical Tip: COUNT Query Optimization</summary>

When using Page, a COUNT query runs alongside the main query. For complex queries, the COUNT query can also become slow.

```java
// Separate COUNT query optimization
@Query(value = "SELECT p FROM Product p JOIN FETCH p.category WHERE p.status = :status",
       countQuery = "SELECT COUNT(p) FROM Product p WHERE p.status = :status")
Page<Product> findByStatus(@Param("status") ProductStatus status, Pageable pageable);
```

**Alternatives**:
- Use `Slice` if total count is not needed
- Use a cached statistics table if only an approximate count is needed

**Cached Statistics Table Example**

Running COUNT queries on large datasets every time causes performance issues. In this case, maintain a separate statistics table with caching.

```java
// 1. Define Statistics Entity
@Entity
public class ProductStats {
    @Id
    private Long categoryId;
    private Long productCount;
    private LocalDateTime updatedAt;
}

// 2. Update statistics on product creation/deletion (using events)
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void updateStats(ProductCreatedEvent event) {
    statsRepository.incrementCount(event.getCategoryId());
}

// 3. Use with cache
@Cacheable("productCounts")
public Long getProductCount(Long categoryId) {
    return statsRepository.findById(categoryId)
        .map(ProductStats::getProductCount)
        .orElse(0L);
}
```

> **For assignments**: This level of optimization is not necessary. The default COUNT query from `Page` is sufficient.

</details>

### 3. Offset vs Cursor-Based Pagination

#### Offset-Based (Default)

```java
// When requesting page=100, size=20
// OFFSET 2000 LIMIT 20 -> Must skip 2000 rows
```

**Problem**: As data grows, the OFFSET increases and performance degrades.

#### Cursor-Based

```java
public interface ProductRepository extends JpaRepository<Product, Long> {

    // ID-based cursor pagination
    @Query("SELECT p FROM Product p WHERE p.id < :cursor ORDER BY p.id DESC")
    List<Product> findByIdLessThan(@Param("cursor") Long cursor, Pageable pageable);
}
```

```java
@Service
public class ProductService {

    public CursorResponse<ProductResponse> getProductsWithCursor(Long cursor, int size) {
        Pageable pageable = PageRequest.of(0, size + 1); // +1 to check for next page

        List<Product> products = cursor == null
            ? productRepository.findAll(PageRequest.of(0, size + 1, Sort.by(Sort.Direction.DESC, "id"))).getContent()
            : productRepository.findByIdLessThan(cursor, pageable);

        boolean hasNext = products.size() > size;
        if (hasNext) {
            products = products.subList(0, size);
        }

        Long nextCursor = hasNext ? products.get(products.size() - 1).getId() : null;

        return new CursorResponse<>(
            products.stream().map(ProductResponse::from).toList(),
            nextCursor,
            hasNext
        );
    }
}
```

<details>
<summary>CursorResponse Class</summary>

```java
@Getter
@AllArgsConstructor
public class CursorResponse<T> {
    private List<T> content;
    private Long nextCursor;
    private boolean hasNext;
}
```

</details>

<details>
<summary>Offset vs Cursor Selection Criteria</summary>

| Approach | Pros | Cons | When to Use |
|------|------|------|----------|
| **Offset** | Simple implementation, can jump to specific pages | Slow for large datasets, possible data duplication/omission | Admin pages, small datasets |
| **Cursor** | Fast for large datasets, consistent results | Cannot jump to specific pages | Infinite scroll, SNS feeds, large datasets |

**Recommended for assignments**: Use Offset (Page) by default; mentioning Cursor-based pagination and its trade-offs in the README can earn bonus points

</details>

---

## Caching Strategies

### 1. Spring Cache Abstraction

```java
@Configuration
@EnableCaching
public class CacheConfig {
    // Uses ConcurrentHashMap-based cache with default settings
}
```

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    /**
     * Product detail query - with caching
     * key: productId, cache name: product
     */
    @Cacheable(value = "product", key = "#productId")
    public ProductDetailResponse getProductDetail(Long productId) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
        return ProductDetailResponse.from(product);
    }

    /**
     * Update product - refresh cache
     */
    @CachePut(value = "product", key = "#productId")
    public ProductDetailResponse updateProduct(Long productId, ProductUpdateCommand command) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
        product.update(command.getName(), command.getPrice());
        return ProductDetailResponse.from(product);
    }

    /**
     * Delete product - evict cache
     */
    @CacheEvict(value = "product", key = "#productId")
    public void deleteProduct(Long productId) {
        productRepository.deleteById(productId);
    }

    /**
     * Clear all product cache
     */
    @CacheEvict(value = "product", allEntries = true)
    public void clearProductCache() {
        // Only clears cache
    }
}
```

### 2. Caffeine Cache

```groovy
// build.gradle
implementation 'com.github.ben-manes.caffeine:caffeine'
implementation 'org.springframework.boot:spring-boot-starter-cache'
```

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        cacheManager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(1000)           // Maximum 1000 entries
            .expireAfterWrite(10, TimeUnit.MINUTES)  // Expire after 10 minutes
            .recordStats());             // Record statistics
        return cacheManager;
    }
}
```

#### Per-Cache Configuration

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager() {
        SimpleCacheManager cacheManager = new SimpleCacheManager();

        List<CaffeineCache> caches = List.of(
            buildCache("product", 500, 30, TimeUnit.MINUTES),
            buildCache("category", 100, 1, TimeUnit.HOURS),
            buildCache("config", 50, 24, TimeUnit.HOURS)
        );

        cacheManager.setCaches(caches);
        return cacheManager;
    }

    private CaffeineCache buildCache(String name, int maxSize, long duration, TimeUnit unit) {
        return new CaffeineCache(name, Caffeine.newBuilder()
            .maximumSize(maxSize)
            .expireAfterWrite(duration, unit)
            .recordStats()
            .build());
    }
}
```

### 3. Redis Cache

```groovy
// build.gradle
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
implementation 'org.springframework.boot:spring-boot-starter-cache'
```

```yaml
# application.yml
spring:
  redis:
    host: localhost
    port: 6379
  cache:
    type: redis
    redis:
      time-to-live: 600000  # 10 minutes (milliseconds)
      cache-null-values: false
```

```java
@Configuration
@EnableCaching
public class RedisCacheConfig {

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .serializeKeysWith(RedisSerializationContext.SerializationPair
                .fromSerializer(new StringRedisSerializer()))
            .serializeValuesWith(RedisSerializationContext.SerializationPair
                .fromSerializer(new GenericJackson2JsonRedisSerializer()));

        Map<String, RedisCacheConfiguration> cacheConfigurations = Map.of(
            "product", defaultConfig.entryTtl(Duration.ofMinutes(30)),
            "category", defaultConfig.entryTtl(Duration.ofHours(1))
        );

        return RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(defaultConfig)
            .withInitialCacheConfigurations(cacheConfigurations)
            .build();
    }
}
```

<details>
<summary>Local Cache vs Distributed Cache</summary>

| Aspect | Local Cache (Caffeine) | Distributed Cache (Redis) |
|------|---------------------|------------------|
| **Speed** | Very fast (direct memory access) | Relatively slower (network communication) |
| **Consistency** | Possible inconsistency across servers | Guarantees consistency |
| **Capacity** | Limited by server memory | Scalable with dedicated servers |
| **Complexity** | Simple | Requires Redis infrastructure |

**Recommended for assignments**:
- For single-server assignments, Caffeine is sufficient
- Including Redis in Docker Compose can earn bonus points

</details>

<details>
<summary>Cache Invalidation Strategies</summary>

**Cache-Aside (Lazy Loading)**:
1. Check the cache first
2. If not found, query the DB and store in cache
3. On update/delete, invalidate the cache

**Write-Through**:
1. When saving data, update both cache and DB simultaneously

**Considerations**:
- List query caches are difficult to invalidate (changing a single item requires invalidating the entire list)
- Set appropriate cache TTL to allow natural expiration
- Prevent key collisions when designing cache keys (use prefixes)

</details>

---

## Query Optimization

### 1. Using Projections

Fetch only the required fields instead of the entire entity.

#### Interface Projection

```java
// Interface defining only the required fields
public interface ProductSummary {
    Long getId();
    String getName();
    Integer getPrice();
}

public interface ProductRepository extends JpaRepository<Product, Long> {

    List<ProductSummary> findByCategory(Category category);
}
```

#### Class Projection (DTO)

```java
public record ProductSummaryDto(
    Long id,
    String name,
    Integer price
) {}

public interface ProductRepository extends JpaRepository<Product, Long> {

    @Query("SELECT new com.example.dto.ProductSummaryDto(p.id, p.name, p.price) " +
           "FROM Product p WHERE p.category = :category")
    List<ProductSummaryDto> findSummaryByCategory(@Param("category") Category category);
}
```

<details>
<summary>Projection Performance Comparison</summary>

```java
// 1. Full Entity query - all columns + associated entities
List<Product> products = productRepository.findAll();

// 2. Interface Projection - only required columns (proxy creation)
List<ProductSummary> summaries = productRepository.findAllProjectedBy();

// 3. DTO Projection - only required columns (direct instantiation)
List<ProductSummaryDto> dtos = productRepository.findAllSummary();
```

**Performance**: DTO Projection > Interface Projection > Full Entity query

However, if you need to modify the entity after querying, you must query it as an entity.

</details>

### 2. QueryDSL for Dynamic Queries

```groovy
// build.gradle
implementation 'com.querydsl:querydsl-jpa:5.0.0:jakarta'
annotationProcessor 'com.querydsl:querydsl-apt:5.0.0:jakarta'
annotationProcessor 'jakarta.annotation:jakarta.annotation-api'
annotationProcessor 'jakarta.persistence:jakarta.persistence-api'
```

```java
@Repository
@RequiredArgsConstructor
public class ProductQueryRepository {

    private final JPAQueryFactory queryFactory;

    public List<Product> searchProducts(ProductSearchCondition condition) {
        return queryFactory
            .selectFrom(product)
            .where(
                categoryEq(condition.getCategoryId()),
                priceGoe(condition.getMinPrice()),
                priceLoe(condition.getMaxPrice()),
                nameContains(condition.getKeyword())
            )
            .orderBy(product.createdAt.desc())
            .offset(condition.getOffset())
            .limit(condition.getLimit())
            .fetch();
    }

    private BooleanExpression categoryEq(Long categoryId) {
        return categoryId != null ? product.category.id.eq(categoryId) : null;
    }

    private BooleanExpression priceGoe(Integer minPrice) {
        return minPrice != null ? product.price.goe(minPrice) : null;
    }

    private BooleanExpression priceLoe(Integer maxPrice) {
        return maxPrice != null ? product.price.loe(maxPrice) : null;
    }

    private BooleanExpression nameContains(String keyword) {
        return StringUtils.hasText(keyword) ? product.name.contains(keyword) : null;
    }
}
```

<details>
<summary>Kotlin + QueryDSL</summary>

```kotlin
@Repository
class ProductQueryRepository(
    private val queryFactory: JPAQueryFactory
) {
    fun searchProducts(condition: ProductSearchCondition): List<Product> {
        return queryFactory
            .selectFrom(product)
            .where(
                categoryEq(condition.categoryId),
                priceGoe(condition.minPrice),
                priceLoe(condition.maxPrice),
                nameContains(condition.keyword)
            )
            .orderBy(product.createdAt.desc())
            .offset(condition.offset)
            .limit(condition.limit)
            .fetch()
    }

    private fun categoryEq(categoryId: Long?) =
        categoryId?.let { product.category.id.eq(it) }

    private fun priceGoe(minPrice: Int?) =
        minPrice?.let { product.price.goe(it) }

    private fun priceLoe(maxPrice: Int?) =
        maxPrice?.let { product.price.loe(it) }

    private fun nameContains(keyword: String?) =
        keyword?.takeIf { it.isNotBlank() }?.let { product.name.contains(it) }
}
```

</details>

<details>
<summary>QueryDSL vs JPQL vs Native Query</summary>

| Approach | Pros | Cons | When to Use |
|------|------|------|----------|
| **JPQL** | JPA standard, entity mapping | String-based, difficult dynamic queries | Simple static queries |
| **QueryDSL** | Type-safe, easy dynamic queries | Complex setup, Q-class generation required | Complex dynamic queries |
| **Native Query** | Direct SQL, can optimize | DB-dependent, limited entity mapping | Complex statistics, DB-specific features |

**Recommended for assignments**: Use Spring Data JPA for simple CRUD, and introduce QueryDSL when complex search conditions are needed

</details>

### 3. Index Design

```java
@Entity
@Table(name = "product", indexes = {
    @Index(name = "idx_product_category", columnList = "category_id"),
    @Index(name = "idx_product_status_created", columnList = "status, created_at"),
    @Index(name = "idx_product_name", columnList = "name")
})
public class Product {
    // ...
}
```

<details>
<summary>Index Design Tips</summary>

**When indexes are needed**:
- Columns frequently used in WHERE clauses
- Columns used in JOIN conditions (FK)
- Columns used in ORDER BY
- Columns with high cardinality (many unique values)

**Index considerations**:
- Degrades INSERT/UPDATE/DELETE performance
- Column order matters in composite indexes (leftmost prefix rule)
- Too many indexes can actually hurt performance

**For assignments**: Declaring `@Index` on entities includes indexes in auto-generated DDL, demonstrating your intent.

</details>

---

## Summary

### Checklist

| Item | Check |
|------|------|
| Are all associations set to `FetchType.LAZY`? | ⬜ |
| Is `@BatchSize` global configuration applied? | ⬜ |
| Is `Pageable` applied to APIs that need pagination? | ⬜ |
| Is caching applied to frequently queried data? | ⬜ |
| Are list queries using Projection to fetch only needed fields? | ⬜ |
| Is QueryDSL used for complex dynamic queries? | ⬜ |

### Key Points

1. **N+1 Problem**: Set all associations to LAZY; use Fetch Join or @BatchSize when needed
2. **Pagination**: Use Page (Offset) by default; consider Cursor for large datasets
3. **Caching**: Apply to data that is rarely modified but frequently read
4. **Query Optimization**: Fetch only the required data (Projection, optimized WHERE clauses)

<details>
<summary>Common Mistakes in Assignments</summary>

1. **Using EAGER loading as-is**
   - Default for `@ManyToOne` and `@OneToOne` is EAGER
   - Always explicitly set LAZY

2. **Indiscriminate Fetch Joins**
   - Fetch Joining multiple collections causes Cartesian products
   - May throw `MultipleBagFetchException`

3. **Ignoring COUNT queries**
   - Using Page executes a COUNT query alongside the main query
   - For complex queries, separate the COUNT query or use Slice

4. **Cache key collisions**
   - Different methods using the same cache name + same key
   - Each method needs a unique cache name or key strategy

</details>

---

The next part covers **Spring Security**, **JWT authentication**, and **password management**.

[Previous: Part 3 - Documentation & AOP](/en/blog/spring-boot-pre-interview-guide-3)
[Next: Part 5 - Security & Authentication](/en/blog/spring-boot-pre-interview-guide-5)
