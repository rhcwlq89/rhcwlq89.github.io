---
title: "Spring Boot Practical Guide Part 5: Database Optimization"
description: "Handling large-scale data with index design, cursor-based pagination, and Read Replicas"
pubDate: 2026-02-08T12:30:00+09:00
lang: en
tags: ["Spring Boot", "Database", "MySQL", "JPA", "Backend", "Practical Guide"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 4: Resilience Patterns](/en/blog/springboot-practical-guide-4) | **Part 5: DB Optimization** | [Part 6: Monitoring](/en/blog/springboot-practical-guide-6) |

---

## Introduction

In most web applications, performance bottlenecks occur at the database level. Through index design, query optimization, and architectural improvements, you can dramatically improve DB performance.

**Topics covered in Part 5:**
- Principles and design methods for indexes
- Handling large-scale data with cursor-based pagination
- Read/write separation using Read Replicas
- N+1 problem resolution strategies

### Table of Contents

- [Why is Database Optimization Important?](#1-why-is-database-optimization-important)
- [Indexes](#2-indexes)
- [Pagination Optimization](#3-pagination-optimization)
- [Read Replica](#4-read-replica)
- [N+1 Problem](#5-n1-problem)
- [FAQ](#6-faq-interview-prep)
- [Summary](#summary)

---

## 1. Why is Database Optimization Important?

### 1.1 Most Performance Issues Originate from the DB

```
Typical web request processing time distribution:

+-------------------------------------------------------------+
|  Network     | App Logic |      Database Query              |
|    10ms      |   20ms    |         200ms                    |
|    (4%)      |   (8%)    |         (87%)                    |
+-------------------------------------------------------------+

> Most latency comes from DB queries
> DB optimization has a major impact on overall performance
```

### 1.2 Performance Degradation with Data Growth

```
100 rows:        SELECT * WHERE status = 'ON_SALE'  ->  1ms
10,000 rows:     SELECT * WHERE status = 'ON_SALE'  ->  50ms
1,000,000 rows:  SELECT * WHERE status = 'ON_SALE'  ->  5,000ms

After adding an index:
1,000,000 rows:  SELECT * WHERE status = 'ON_SALE'  ->  5ms
```

---

## 2. Indexes

### 2.1 What is an Index?

An index is like the index at the back of a book.

```
Finding "Kafka" in a book:
+-- Without index: Read every page from start to end (Full Scan)
+-- With index: Go to "K" section -> "Kafka: p.234" -> Jump directly

Finding status = 'ON_SALE' in a DB:
+-- Without index: Scan all rows (Full Table Scan)
+-- With index: B-Tree search -> Found immediately
```

### 2.2 Index Structure (B-Tree)

```
Index: idx_products_status

                    +------------------+
                    |   [ON_SALE]      |
                    |    [SOLD_OUT]    |
                    +--------+---------+
                             |
            +----------------+----------------+
            v                v                v
    +--------------+ +--------------+ +--------------+
    | DELETED      | | ON_SALE      | | SOLD_OUT     |
    | row: 5,12,89 | | row: 1,3,7.. | | row: 2,4,8.. |
    +--------------+ +--------------+ +--------------+

Search: status = 'ON_SALE'
1. Locate ON_SALE position at the root node
2. Navigate to the corresponding leaf node
3. Obtain row pointer
-> O(log n) complexity
```

### 2.3 Index Design for the Project

```sql
-- V2__add_indexes.sql

-- Products table: Optimize product queries
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_seller_id ON products(seller_id);
CREATE INDEX idx_products_sales_count ON products(sales_count DESC);
CREATE INDEX idx_products_created_at ON products(created_at DESC);

-- Composite indexes: Conditions frequently used together
CREATE INDEX idx_products_status_created_at ON products(status, created_at DESC);
CREATE INDEX idx_products_status_sales_count ON products(status, sales_count DESC);

-- Orders table
CREATE INDEX idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_buyer_created_at ON orders(buyer_id, created_at DESC);

-- Order Items table
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_seller_id ON order_items(seller_id);
```

### 2.4 Composite Index

**The column order of an index matters!**

```sql
-- Composite index: (status, created_at)
CREATE INDEX idx_products_status_created_at ON products(status, created_at DESC);

-- Index is used (leading column condition present)
SELECT * FROM products
WHERE status = 'ON_SALE' AND created_at > '2024-01-01';

SELECT * FROM products
WHERE status = 'ON_SALE';

-- Index is NOT used (leading column condition missing)
SELECT * FROM products
WHERE created_at > '2024-01-01';
-- Searching only by created_at without status condition -> Full Scan
```

**Composite Index Design Principles:**

```
1. Place equality (=) condition columns first
2. Place range (>, <, BETWEEN) condition columns later
3. Place columns with higher cardinality (number of unique values) first

Example: WHERE status = 'ON_SALE' AND created_at > '2024-01-01'
    Index: (status, created_at)  -- Good
    Index: (created_at, status)  -- Bad
```

### 2.5 Downsides of Indexes

```
+----------------------------------+----------------------------+
|  Index Advantages                |  Index Disadvantages       |
+----------------------------------+----------------------------+
|  Faster SELECT queries           |  Slower INSERT operations  |
|  Optimized WHERE conditions      |  Slower UPDATE operations  |
|  Optimized ORDER BY              |  Slower DELETE operations  |
|                                  |  Additional storage needed |
+----------------------------------+----------------------------+

Reason:
Indexes must be updated along with data changes
More indexes = more write overhead

Recommendations:
- Only index columns that are frequently queried
- Minimize indexes on write-heavy tables
- Remove unused indexes
```

### 2.6 Execution Plan (EXPLAIN)

```sql
-- Check query execution plan
EXPLAIN SELECT * FROM products WHERE status = 'ON_SALE';

-- Interpreting results
+----+-------------+----------+------+---------------------+
| id | select_type | table    | type | key                 |
+----+-------------+----------+------+---------------------+
|  1 | SIMPLE      | products | ref  | idx_products_status |
+----+-------------+----------+------+---------------------+

type values:
- ALL: Full Table Scan (worst)
- index: Full Index Scan
- range: Index range scan
- ref: Index lookup (good)
- eq_ref: Unique index lookup (optimal)
- const: Constant lookup (optimal)
```

---

## 3. Pagination Optimization

### 3.1 The Problem with Offset Pagination

```sql
-- Offset pagination
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 0;     -- Page 1
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 20;    -- Page 2
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 19980; -- Page 1000
```

**The problem:**

```
Page 1 (OFFSET 0):
+--------------------------------------------+
| Read 20 rows -> Return 20 rows             |
| Processing time: 5ms                       |
+--------------------------------------------+

Page 1000 (OFFSET 19980):
+--------------------------------------------+
| Read 19,980 rows -> Discard -> Return 20   |
| Processing time: 2,000ms                   |
+--------------------------------------------+

-> Performance degrades linearly as OFFSET grows
-> A serious problem with large datasets
```

### 3.2 Cursor-Based Pagination (Keyset Pagination)

```sql
-- First page
SELECT * FROM products
ORDER BY created_at DESC, id DESC
LIMIT 21;  -- limit + 1 (to check if next page exists)

-- Next page (cursor = last item's created_at, id)
SELECT * FROM products
WHERE (created_at, id) < ('2024-01-15 10:30:00', 12345)
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

**Advantages:**

```
Page 1:
+--------------------------------------------+
| Read 21 rows via index -> Return 20 rows   |
| Processing time: 5ms                       |
+--------------------------------------------+

Page 1000:
+--------------------------------------------+
| Read 21 rows via index -> Return 20 rows   |
| Processing time: 5ms (same!)               |
+--------------------------------------------+

-> Consistent performance regardless of page depth
```

### 3.3 Cursor Response Implementation

```kotlin
// CursorPageResponse.kt
data class CursorPageResponse<T>(
    val content: List<T>,       // Actual data
    val nextCursor: String?,    // Next page cursor (Base64 encoded)
    val hasNext: Boolean,       // Whether next page exists
    val size: Int               // Current page size
) {
    companion object {
        fun <T> of(
            content: List<T>,
            limit: Int,
            cursorExtractor: (T) -> Pair<LocalDateTime, Long>
        ): CursorPageResponse<T> {
            // Query limit + 1 items to determine hasNext
            val hasNext = content.size > limit
            val resultContent = if (hasNext) content.dropLast(1) else content

            val nextCursor = if (hasNext && resultContent.isNotEmpty()) {
                val last = resultContent.last()
                val (timestamp, id) = cursorExtractor(last)
                encodeCursor(timestamp, id)
            } else {
                null
            }

            return CursorPageResponse(
                content = resultContent,
                nextCursor = nextCursor,
                hasNext = hasNext,
                size = resultContent.size
            )
        }

        // Cursor encoding: "2024-01-15T10:30:00:12345" -> Base64
        fun encodeCursor(timestamp: LocalDateTime, id: Long): String {
            val cursorString = "${timestamp}:$id"
            return Base64.getEncoder().encodeToString(cursorString.toByteArray())
        }

        // Cursor decoding: Base64 -> (timestamp, id)
        fun decodeCursor(cursor: String): Pair<LocalDateTime, Long>? {
            return try {
                val decoded = String(Base64.getDecoder().decode(cursor))
                val parts = decoded.split(":")
                val timestamp = LocalDateTime.parse(parts[0])
                val id = parts[1].toLong()
                timestamp to id
            } catch (e: Exception) {
                null
            }
        }
    }
}
```

### 3.4 Cursor Query Implementation (QueryDSL)

```kotlin
// ProductJpaRepositoryImpl.kt
override fun searchWithCursor(
    keyword: String?,
    categoryId: Long?,
    status: ProductStatus?,
    cursor: LocalDateTime?,
    cursorId: Long?,
    limit: Int
): List<Product> {
    val query = queryFactory
        .selectFrom(product)
        .where(
            keywordContains(keyword),
            categoryIdEq(categoryId),
            statusEq(status),
            cursorCondition(cursor, cursorId)  // Cursor condition
        )
        .orderBy(product.createdAt.desc(), product.id.desc())
        .limit(limit.toLong() + 1)  // limit + 1

    return query.fetch()
}

// Cursor condition: (created_at, id) < (cursor_time, cursor_id)
private fun cursorCondition(cursor: LocalDateTime?, cursorId: Long?): BooleanExpression? {
    if (cursor == null || cursorId == null) return null

    return product.createdAt.lt(cursor)
        .or(product.createdAt.eq(cursor).and(product.id.lt(cursorId)))
}
```

### 3.5 API Response Example

```json
// GET /api/v1/products/cursor?limit=5

// First page
{
  "content": [
    {"id": 100, "name": "Product100", "createdAt": "2024-01-15T10:30:00"},
    {"id": 99, "name": "Product99", "createdAt": "2024-01-15T10:25:00"},
    {"id": 98, "name": "Product98", "createdAt": "2024-01-15T10:20:00"},
    {"id": 97, "name": "Product97", "createdAt": "2024-01-15T10:15:00"},
    {"id": 96, "name": "Product96", "createdAt": "2024-01-15T10:10:00"}
  ],
  "nextCursor": "MjAyNC0wMS0xNVQxMDoxMDowMDo5Ng==",
  "hasNext": true,
  "size": 5
}

// Next page: GET /api/v1/products/cursor?limit=5&cursor=MjAyNC0wMS0xNVQxMDoxMDowMDo5Ng==
{
  "content": [
    {"id": 95, "name": "Product95", "createdAt": "2024-01-15T10:05:00"},
    ...
  ],
  "nextCursor": "...",
  "hasNext": true,
  "size": 5
}
```

### 3.6 Offset vs Cursor Comparison

| Criteria | Offset | Cursor |
|------|--------|--------|
| **Performance** | Degrades as page depth increases | Always consistent |
| **Data Consistency** | Duplicates/omissions when data is added/deleted | Consistency maintained |
| **Jump to Specific Page** | Possible (page=5) | Not possible |
| **Implementation Complexity** | Simple | Relatively complex |
| **Use Cases** | Admin pages, small datasets | Infinite scroll, large datasets |

---

## 4. Read Replica

### 4.1 Why Read/Write Separation is Needed

```
Typical web service traffic pattern:

Read : Write = 9 : 1 (or even more extreme)

+---------------------------------------------------------+
|                      Single DB                          |
|                                                         |
|   [Read 90%] ----------------+                          |
|                               v                         |
|                        +--------------+                 |
|                        |   Primary    | <- Bottleneck!  |
|                        |   Database   |                 |
|                        +--------------+                 |
|                               ^                         |
|   [Write 10%] ---------------+                          |
|                                                         |
+---------------------------------------------------------+

> Read requests affect write performance
> Single DB handles all load
```

### 4.2 Read Replica Architecture

```
+---------------------------------------------------------+
|                  Read Replica Setup                      |
|                                                         |
|                    +--------------+                     |
|   [Write 10%] --> |   Primary    |                     |
|                    |   (Master)   |                     |
|                    +------+-------+                     |
|                           |                             |
|                    Async Replication                     |
|                           |                             |
|              +------------+------------+                |
|              v            v            v                |
|       +----------+ +----------+ +----------+           |
|       | Replica1 | | Replica2 | | Replica3 |           |
|       +----------+ +----------+ +----------+           |
|              ^            ^            ^                |
|              +------------+------------+                |
|                           |                             |
|   [Read 90%] ------------+                              |
|                                                         |
+---------------------------------------------------------+

Advantages:
- Distributed read load
- Primary focuses on writes
- Easy read scaling by adding Replicas
```

### 4.3 Routing DataSource Implementation

```kotlin
// DataSourceConfig.kt
@Configuration
@Profile("prod")
@ConditionalOnProperty(name = ["spring.datasource.replica.enabled"], havingValue = "true")
class DataSourceConfig {

    // Primary DataSource (for writes)
    @Bean
    @ConfigurationProperties(prefix = "spring.datasource.primary")
    fun primaryDataSource(): DataSource {
        return DataSourceBuilder.create().build()
    }

    // Replica DataSource (for reads)
    @Bean
    @ConfigurationProperties(prefix = "spring.datasource.replica")
    fun replicaDataSource(): DataSource {
        return DataSourceBuilder.create().build()
    }

    // Routing DataSource (automatic routing)
    @Bean
    fun routingDataSource(
        @Qualifier("primaryDataSource") primaryDataSource: DataSource,
        @Qualifier("replicaDataSource") replicaDataSource: DataSource
    ): DataSource {
        val routingDataSource = ReplicationRoutingDataSource()

        val dataSourceMap = mapOf<Any, Any>(
            DataSourceType.PRIMARY to primaryDataSource,
            DataSourceType.REPLICA to replicaDataSource
        )

        routingDataSource.setTargetDataSources(dataSourceMap)
        routingDataSource.setDefaultTargetDataSource(primaryDataSource)

        return routingDataSource
    }

    @Primary
    @Bean
    fun dataSource(@Qualifier("routingDataSource") routingDataSource: DataSource): DataSource {
        return LazyConnectionDataSourceProxy(routingDataSource)
    }
}

// Routing decision logic
class ReplicationRoutingDataSource : AbstractRoutingDataSource() {
    override fun determineCurrentLookupKey(): Any {
        // Route to Replica for readOnly transactions, Primary otherwise
        return if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            DataSourceType.REPLICA
        } else {
            DataSourceType.PRIMARY
        }
    }
}
```

### 4.4 The Role of @Transactional(readOnly = true)

```kotlin
@Service
@Transactional(readOnly = true)  // Default: use Replica
class ProductService {

    // Read-only -> Routed to Replica
    fun getProduct(id: Long): ProductResponse {
        return productRepository.findById(id)
    }

    // Read-only -> Routed to Replica
    fun searchProducts(request: SearchRequest): Page<ProductResponse> {
        return productRepository.search(request)
    }

    @Transactional  // Write -> Routed to Primary
    fun createProduct(request: CreateProductRequest): ProductResponse {
        return productRepository.save(Product(...))
    }

    @Transactional  // Write -> Routed to Primary
    fun updateProduct(id: Long, request: UpdateProductRequest): ProductResponse {
        val product = productRepository.findById(id)
        product.update(request)
        return productRepository.save(product)
    }
}
```

### 4.5 Replication Lag Problem

```
Problem scenario:
+---------------------------------------------------------+
|                                                         |
|  T=0ms:  Order saved to Primary (INSERT)                |
|  T=5ms:  "Order complete" response -> Returned to user  |
|  T=10ms: User clicks "View my orders"                  |
|  T=15ms: Query from Replica -> Not replicated yet!      |
|                                                         |
|  User: "I just placed an order but it's not showing!"   |
|                                                         |
+---------------------------------------------------------+
```

**Solutions:**

```kotlin
// 1. Read from Primary immediately after writing
@Transactional  // Not readOnly -> Primary
fun createOrderAndGet(request: CreateOrderRequest): OrderResponse {
    val order = orderRepository.save(Order(...))
    // Query within the same transaction -> Reads from Primary
    return OrderResponse.from(order)
}

// 2. Session Affinity
// After a write, the same user reads from Primary for a certain period

// 3. Explicit Primary read
@Transactional(readOnly = false)  // Force Primary
fun getRecentOrder(userId: Long): OrderResponse {
    return orderRepository.findTopByUserIdOrderByCreatedAtDesc(userId)
}

// 4. Accept Eventual Consistency
// Show "Changes will be reflected shortly" in the UI
```

---

## 5. N+1 Problem

### 5.1 What is the N+1 Problem?

```kotlin
// Query Orders
val orders = orderRepository.findByBuyerId(buyerId)  // 1 query

// Query OrderItems for each Order
orders.forEach { order ->
    val items = order.orderItems  // N queries (Lazy Loading)
    items.forEach { println(it.productName) }
}

// Total queries: 1 + N (if there are 100 orders, that's 101 queries!)
```

```sql
-- Actual queries executed
SELECT * FROM orders WHERE buyer_id = 1;
SELECT * FROM order_items WHERE order_id = 1;
SELECT * FROM order_items WHERE order_id = 2;
SELECT * FROM order_items WHERE order_id = 3;
... (100 more!)
```

### 5.2 Solution: Fetch Join

```kotlin
// JPQL Fetch Join
@Query("SELECT o FROM Order o JOIN FETCH o.orderItems WHERE o.buyer.id = :buyerId")
fun findByBuyerIdWithItems(buyerId: Long): List<Order>

// QueryDSL Fetch Join
fun findByBuyerIdWithItems(buyerId: Long): List<Order> {
    return queryFactory
        .selectFrom(order)
        .join(order.orderItems, orderItem).fetchJoin()
        .where(order.buyer.id.eq(buyerId))
        .fetch()
}

// Total queries: 1!
```

```sql
-- Solved with a single query
SELECT o.*, oi.* FROM orders o
JOIN order_items oi ON o.id = oi.order_id
WHERE o.buyer_id = 1;
```

### 5.3 @EntityGraph

```kotlin
@EntityGraph(attributePaths = ["orderItems", "orderItems.product"])
fun findByBuyerId(buyerId: Long): List<Order>
```

### 5.4 Batch Size Configuration

```yaml
# application.yml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
```

```
Before (N+1):
SELECT * FROM orders WHERE buyer_id = 1;
SELECT * FROM order_items WHERE order_id = 1;
SELECT * FROM order_items WHERE order_id = 2;
SELECT * FROM order_items WHERE order_id = 3;
... (100 times)

After (Batch):
SELECT * FROM orders WHERE buyer_id = 1;
SELECT * FROM order_items WHERE order_id IN (1,2,3,...,100);
... (2 times!)
```

### 5.5 N+1 Solution Strategy Comparison

| Strategy | Advantages | Disadvantages | When to Use |
|------|------|------|----------|
| **Fetch Join** | Solved with 1 query | Cannot paginate | Single collection |
| **@EntityGraph** | Declarative, simple | Difficult for dynamic queries | Static queries |
| **Batch Size** | Global setting | Not a complete solution | Default setting |

---

## 6. FAQ (Interview Prep)

### Q1. Are more indexes always better?

**No.** Having too many indexes means:
- Indexes must be updated on INSERT, UPDATE, DELETE -> Write performance degradation
- Additional storage space required for indexes
- The optimizer may choose the wrong index

**Recommendations:**
- Only create indexes on frequently queried columns
- Remove unused indexes
- Use composite indexes to cover multiple conditions

### Q2. How do you determine the column order in a composite index?

```
1. Place equality (=) condition columns first
2. Place range condition columns later
3. Place columns with higher cardinality first

Example: WHERE status = 'ON_SALE' AND price > 10000 AND category_id = 5
Recommended order: (status, category_id, price)
```

### Q3. What are the problems with offset pagination?

- Performance degrades linearly as OFFSET grows (reads and discards 19,980 rows)
- Duplicates/omissions can occur when data changes
- Solution: Cursor-based pagination

### Q4. How do you handle Replication Lag with Read Replicas?

```
1. Read from Primary immediately after writing (same transaction)
2. Session affinity (keep using Primary for a certain period)
3. Explicitly specify Primary for critical reads
4. Accept Eventual Consistency
```

### Q5. What is the N+1 problem and how do you solve it?

The N+1 problem occurs when querying associated entities results in N additional queries.

**Solutions:**
- Fetch Join: `JOIN FETCH`
- @EntityGraph
- Batch Size configuration

---

## 7. Project File Structure

```
marketplace/
+-- marketplace-api/
|   +-- src/main/
|       +-- kotlin/.../
|       |   +-- common/
|       |   |   +-- CursorPageResponse.kt     # Cursor response
|       |   +-- config/
|       |   |   +-- DataSourceConfig.kt       # Read Replica routing
|       |   +-- product/
|       |       +-- ProductController.kt      # Cursor API
|       |
|       +-- resources/
|           +-- db/migration/
|               +-- V2__add_indexes.sql       # Index DDL
|
+-- marketplace-infra/
    +-- src/main/kotlin/.../
        +-- ProductJpaRepositoryImpl.kt       # Cursor query implementation
```

---

## 8. Hands-On Practice

```bash
# 1. Check query execution plan
# H2 Console (http://localhost:8080/h2-console)
EXPLAIN SELECT * FROM products WHERE status = 'ON_SALE';

# 2. Test cursor pagination
# First page
curl "http://localhost:8080/api/v1/products/cursor?limit=5"

# Next page (use the nextCursor value)
curl "http://localhost:8080/api/v1/products/cursor?limit=5&cursor=<NEXT_CURSOR>"

# 3. Check index list (MySQL)
SHOW INDEX FROM products;
```

---

## Summary

### Comparison by Technique

| Technique | Purpose | When to Apply |
|------|------|----------|
| **Index** | Improve query performance | Frequently searched columns |
| **Composite Index** | Optimize multi-condition queries | Multiple WHERE conditions |
| **Cursor Pagination** | Handle large-scale lists | Infinite scroll, large datasets |
| **Read Replica** | Distribute read load | High read-to-write ratio |
| **Fetch Join** | Solve N+1 problem | When loading associated entities |

### N+1 Resolution Strategies

| Strategy | Advantages | Disadvantages | When to Use |
|------|------|------|----------|
| **Fetch Join** | Solved with 1 query | Cannot paginate | Single collection |
| **@EntityGraph** | Declarative, simple | Difficult for dynamic queries | Static queries |
| **Batch Size** | Global setting | Not a complete solution | Default setting |

### Quick Checklist

- [ ] Are frequently queried columns indexed?
- [ ] Is the column order in composite indexes correct? (equality -> range)
- [ ] Is cursor-based pagination used for large-scale lists?
- [ ] Is `readOnly = true` set on read-only transactions?
- [ ] Are there any queries causing N+1 problems?
- [ ] Are there any unused indexes?
- [ ] Have you verified query execution plans with EXPLAIN?

---

The next part covers **Monitoring and Observability**.

[Next: Part 6 - Monitoring](/en/blog/springboot-practical-guide-6)
