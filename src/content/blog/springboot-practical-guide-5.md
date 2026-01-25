---
title: "스프링부트 실무 가이드 5편: 데이터베이스 최적화"
description: "인덱스 설계, 커서 기반 페이지네이션, Read Replica로 대용량 데이터 처리하기"
pubDate: 2026-01-25T14:00:00
tags: ["Spring Boot", "Database", "Index", "Pagination", "Backend", "실무가이드"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

> **스프링부트 실무 가이드 시리즈**
>
> | 편 | 제목 | 링크 |
> |---|------|------|
> | 1편 | 동시성 제어와 재고 관리 | [바로가기](/blog/springboot-practical-guide-1) |
> | 2편 | 캐싱 전략 | [바로가기](/blog/springboot-practical-guide-2) |
> | 3편 | 이벤트 드리븐 아키텍처 | [바로가기](/blog/springboot-practical-guide-3) |
> | 4편 | Resilience 패턴 | [바로가기](/blog/springboot-practical-guide-4) |
> | **5편** | **데이터베이스 최적화** | 현재 글 |
> | 6편 | 모니터링 | [바로가기](/blog/springboot-practical-guide-6) |

---

대부분의 웹 애플리케이션에서 성능 병목의 87%는 데이터베이스에서 발생합니다. 이번 글에서는 인덱스, 페이지네이션, Read Replica를 활용한 DB 최적화 전략을 다룹니다.

---

## 1. 인덱스의 원리

### 1.1 인덱스란?

인덱스는 책의 색인과 같습니다.

```
책에서 "Kafka"를 찾을 때:
├── 색인 없이: 1페이지부터 끝까지 모두 읽음 (Full Scan)
└── 색인 있으면: "K" 섹션 → "Kafka: p.234" → 바로 이동

DB에서 status = 'ON_SALE' 찾을 때:
├── 인덱스 없이: 모든 행 스캔 (Full Table Scan)
└── 인덱스 있으면: B-Tree 탐색 → 바로 찾음
```

**데이터 증가에 따른 성능 변화:**

```
데이터 100건:      SELECT * WHERE status = 'ON_SALE'  →  1ms
데이터 10,000건:   SELECT * WHERE status = 'ON_SALE'  →  50ms
데이터 1,000,000건: SELECT * WHERE status = 'ON_SALE'  →  5,000ms ❌

인덱스 추가 후:
데이터 1,000,000건: SELECT * WHERE status = 'ON_SALE'  →  5ms ✅
```

### 1.2 인덱스 구조 (B-Tree)

```
인덱스: idx_products_status

                    ┌─────────────────┐
                    │   [ON_SALE]     │
                    │    [SOLD_OUT]   │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ DELETED      │ │ ON_SALE      │ │ SOLD_OUT     │
    │ row: 5,12,89 │ │ row: 1,3,7.. │ │ row: 2,4,8.. │
    └──────────────┘ └──────────────┘ └──────────────┘

탐색: status = 'ON_SALE'
1. 루트 노드에서 ON_SALE 위치 확인
2. 해당 리프 노드로 이동
3. 행 위치(row pointer) 획득
→ O(log n) 복잡도
```

---

## 2. 인덱스 설계

### 2.1 마켓플레이스 인덱스 예시

```sql
-- V2__add_indexes.sql

-- Products 테이블: 상품 조회 최적화
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_seller_id ON products(seller_id);
CREATE INDEX idx_products_sales_count ON products(sales_count DESC);
CREATE INDEX idx_products_created_at ON products(created_at DESC);

-- 복합 인덱스: 자주 함께 사용되는 조건
CREATE INDEX idx_products_status_created_at ON products(status, created_at DESC);
CREATE INDEX idx_products_status_sales_count ON products(status, sales_count DESC);

-- Orders 테이블
CREATE INDEX idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_buyer_created_at ON orders(buyer_id, created_at DESC);

-- Order Items 테이블
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_seller_id ON order_items(seller_id);
```

### 2.2 복합 인덱스 컬럼 순서

**인덱스 컬럼 순서가 중요합니다!**

```sql
-- 복합 인덱스: (status, created_at)
CREATE INDEX idx_products_status_created_at ON products(status, created_at DESC);

-- ✅ 인덱스 사용됨 (선행 컬럼 조건 있음)
SELECT * FROM products
WHERE status = 'ON_SALE' AND created_at > '2024-01-01';

SELECT * FROM products
WHERE status = 'ON_SALE';

-- ❌ 인덱스 사용 안됨 (선행 컬럼 조건 없음)
SELECT * FROM products
WHERE created_at > '2024-01-01';
-- status 조건 없이 created_at만 검색 → Full Scan
```

**복합 인덱스 설계 원칙:**

```
1. 등호(=) 조건 컬럼을 앞에
2. 범위(>, <, BETWEEN) 조건 컬럼을 뒤에
3. 카디널리티(고유값 수)가 높은 컬럼을 앞에

예: WHERE status = 'ON_SALE' AND created_at > '2024-01-01'
    인덱스: (status, created_at) ✅
    인덱스: (created_at, status) ❌
```

### 2.3 인덱스의 단점

```
┌─────────────────────────────────┬───────────────────────────┐
│  인덱스 장점                    │  인덱스 단점              │
├─────────────────────────────────┼───────────────────────────┤
│  SELECT 속도 향상               │  INSERT 속도 저하         │
│  WHERE 조건 최적화              │  UPDATE 속도 저하         │
│  ORDER BY 최적화                │  DELETE 속도 저하         │
│                                 │  저장 공간 추가 필요       │
└─────────────────────────────────┴───────────────────────────┘

권장:
- 자주 조회하는 컬럼에만 인덱스
- 쓰기가 많은 테이블은 인덱스 최소화
- 사용하지 않는 인덱스는 삭제
```

### 2.4 실행 계획 (EXPLAIN)

```sql
-- 쿼리 실행 계획 확인
EXPLAIN SELECT * FROM products WHERE status = 'ON_SALE';

-- 결과 해석
+----+-------------+----------+------+---------------------+
| id | select_type | table    | type | key                 |
+----+-------------+----------+------+---------------------+
|  1 | SIMPLE      | products | ref  | idx_products_status |
+----+-------------+----------+------+---------------------+

type 값:
- ALL: Full Table Scan ❌ (최악)
- index: Full Index Scan
- range: 인덱스 범위 스캔
- ref: 인덱스 조회 ✅
- eq_ref: 유니크 인덱스 조회 ✅ (최적)
- const: 상수 조회 ✅ (최적)
```

---

## 3. 페이지네이션 최적화

### 3.1 Offset 방식의 문제

```sql
-- Offset 페이지네이션
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 0;     -- Page 1
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 20;    -- Page 2
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 19980; -- Page 1000
```

**문제점:**

```
Page 1 (OFFSET 0):
┌────────────────────────────────────────────┐
│ 20개 읽고 → 20개 반환                       │
│ 처리 시간: 5ms                              │
└────────────────────────────────────────────┘

Page 1000 (OFFSET 19980):
┌────────────────────────────────────────────┐
│ 19,980개 읽고 → 버리고 → 20개 반환          │
│ 처리 시간: 2,000ms ❌                       │
└────────────────────────────────────────────┘

→ OFFSET이 커질수록 성능이 선형적으로 저하
```

### 3.2 커서 기반 페이지네이션

```sql
-- 첫 페이지
SELECT * FROM products
ORDER BY created_at DESC, id DESC
LIMIT 21;  -- limit + 1 (다음 페이지 존재 여부 확인용)

-- 다음 페이지 (커서 = 마지막 항목의 created_at, id)
SELECT * FROM products
WHERE (created_at, id) < ('2024-01-15 10:30:00', 12345)
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

**장점:**

```
Page 1:
┌────────────────────────────────────────────┐
│ 인덱스로 21개 읽고 → 20개 반환              │
│ 처리 시간: 5ms                              │
└────────────────────────────────────────────┘

Page 1000:
┌────────────────────────────────────────────┐
│ 인덱스로 21개 읽고 → 20개 반환              │
│ 처리 시간: 5ms ✅ (동일!)                   │
└────────────────────────────────────────────┘

→ 어떤 페이지든 일정한 성능
```

### 3.3 커서 응답 구현

```kotlin
data class CursorPageResponse<T>(
    val content: List<T>,       // 실제 데이터
    val nextCursor: String?,    // 다음 페이지 커서 (Base64 인코딩)
    val hasNext: Boolean,       // 다음 페이지 존재 여부
    val size: Int               // 현재 페이지 크기
) {
    companion object {
        fun <T> of(
            content: List<T>,
            limit: Int,
            cursorExtractor: (T) -> Pair<LocalDateTime, Long>
        ): CursorPageResponse<T> {
            // limit + 1개를 조회해서 hasNext 판단
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
    }
}
```

### 3.4 커서 쿼리 구현 (QueryDSL)

```kotlin
override fun searchWithCursor(
    keyword: String?,
    categoryId: Long?,
    status: ProductStatus?,
    cursor: LocalDateTime?,
    cursorId: Long?,
    limit: Int
): List<Product> {
    return queryFactory
        .selectFrom(product)
        .where(
            keywordContains(keyword),
            categoryIdEq(categoryId),
            statusEq(status),
            cursorCondition(cursor, cursorId)  // 커서 조건
        )
        .orderBy(product.createdAt.desc(), product.id.desc())
        .limit(limit.toLong() + 1)  // limit + 1
        .fetch()
}

// 커서 조건: (created_at, id) < (cursor_time, cursor_id)
private fun cursorCondition(cursor: LocalDateTime?, cursorId: Long?): BooleanExpression? {
    if (cursor == null || cursorId == null) return null

    return product.createdAt.lt(cursor)
        .or(product.createdAt.eq(cursor).and(product.id.lt(cursorId)))
}
```

### 3.5 Offset vs Cursor 비교

| 항목 | Offset | Cursor |
|------|--------|--------|
| **성능** | 페이지가 깊어질수록 느림 | 항상 일정 |
| **데이터 일관성** | 중간에 데이터 추가/삭제 시 중복/누락 | 일관성 유지 |
| **특정 페이지 이동** | 가능 (page=5) | 불가능 |
| **구현 복잡도** | 간단 | 상대적으로 복잡 |
| **사용 사례** | 관리자 페이지, 소규모 데이터 | 무한 스크롤, 대용량 데이터 |

---

## 4. Read Replica (읽기 복제본)

### 4.1 읽기/쓰기 분리가 필요한 이유

```
일반적인 웹 서비스 트래픽 패턴: 읽기 : 쓰기 = 9 : 1

┌─────────────────────────────────────────────────────────┐
│                      단일 DB                            │
│                                                         │
│   [읽기 90%] ──────────┐                               │
│                        ▼                               │
│                 ┌──────────────┐                       │
│                 │   Primary    │ ← 병목!               │
│                 │   Database   │                       │
│                 └──────────────┘                       │
│                        ▲                               │
│   [쓰기 10%] ──────────┘                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Read Replica 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                      Read Replica 구성                  │
│                                                         │
│                    ┌──────────────┐                    │
│   [쓰기 10%] ────▶ │   Primary    │                    │
│                    │   (Master)   │                    │
│                    └──────┬───────┘                    │
│                           │                             │
│                    비동기 복제                          │
│                           │                             │
│              ┌────────────┼────────────┐               │
│              ▼            ▼            ▼               │
│       ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│       │ Replica1 │ │ Replica2 │ │ Replica3 │         │
│       └──────────┘ └──────────┘ └──────────┘         │
│              ▲            ▲            ▲               │
│              └────────────┼────────────┘               │
│                           │                             │
│   [읽기 90%] ─────────────┘                            │
│                                                         │
└─────────────────────────────────────────────────────────┘

장점:
- 읽기 부하 분산
- Primary는 쓰기에 집중
- Replica 추가로 읽기 확장 용이
```

### 4.3 Routing DataSource 구현

```kotlin
@Configuration
@Profile("prod")
class DataSourceConfig {

    @Bean
    @ConfigurationProperties(prefix = "spring.datasource.primary")
    fun primaryDataSource(): DataSource = DataSourceBuilder.create().build()

    @Bean
    @ConfigurationProperties(prefix = "spring.datasource.replica")
    fun replicaDataSource(): DataSource = DataSourceBuilder.create().build()

    @Bean
    fun routingDataSource(
        @Qualifier("primaryDataSource") primary: DataSource,
        @Qualifier("replicaDataSource") replica: DataSource
    ): DataSource {
        val routingDataSource = ReplicationRoutingDataSource()

        val dataSourceMap = mapOf<Any, Any>(
            DataSourceType.PRIMARY to primary,
            DataSourceType.REPLICA to replica
        )

        routingDataSource.setTargetDataSources(dataSourceMap)
        routingDataSource.setDefaultTargetDataSource(primary)

        return routingDataSource
    }
}

class ReplicationRoutingDataSource : AbstractRoutingDataSource() {
    override fun determineCurrentLookupKey(): Any {
        // readOnly 트랜잭션이면 Replica, 아니면 Primary
        return if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            DataSourceType.REPLICA
        } else {
            DataSourceType.PRIMARY
        }
    }
}
```

### 4.4 서비스에서 활용

```kotlin
@Service
@Transactional(readOnly = true)  // 기본: Replica 사용
class ProductService {

    // 읽기 전용 → Replica로 라우팅
    fun getProduct(id: Long): ProductResponse {
        return productRepository.findById(id)
    }

    // 읽기 전용 → Replica로 라우팅
    fun searchProducts(request: SearchRequest): Page<ProductResponse> {
        return productRepository.search(request)
    }

    @Transactional  // 쓰기 → Primary로 라우팅
    fun createProduct(request: CreateProductRequest): ProductResponse {
        return productRepository.save(Product(...))
    }
}
```

### 4.5 Replication Lag 문제와 해결

```
문제 상황:
T=0ms:  Primary에 주문 저장 (INSERT)
T=5ms:  "주문 완료" 응답 → 사용자에게 반환
T=10ms: 사용자가 "내 주문 조회" 클릭
T=15ms: Replica에서 조회 → 아직 복제 안 됨! ❌

사용자: "방금 주문했는데 안 보여요!"
```

**해결 방법:**

```kotlin
// 1. 쓰기 직후 조회는 Primary 사용
@Transactional  // readOnly 아님 → Primary
fun createOrderAndGet(request: CreateOrderRequest): OrderResponse {
    val order = orderRepository.save(Order(...))
    // 같은 트랜잭션 내에서 조회 → Primary에서 읽음
    return OrderResponse.from(order)
}

// 2. 명시적 Primary 읽기
@Transactional(readOnly = false)  // Primary 강제
fun getRecentOrder(userId: Long): OrderResponse {
    return orderRepository.findTopByUserIdOrderByCreatedAtDesc(userId)
}
```

---

## 5. N+1 문제

### 5.1 N+1 문제란?

```kotlin
// Order 조회
val orders = orderRepository.findByBuyerId(buyerId)  // 쿼리 1번

// 각 Order의 OrderItem 조회
orders.forEach { order ->
    val items = order.orderItems  // 쿼리 N번 (Lazy Loading)
    items.forEach { println(it.productName) }
}

// 총 쿼리: 1 + N번 (orders가 100개면 101번!)
```

### 5.2 해결: Fetch Join

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

// 총 쿼리: 1번!
```

### 5.3 Batch Size 설정

```yaml
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
... (100번)

After (Batch):
SELECT * FROM orders WHERE buyer_id = 1;
SELECT * FROM order_items WHERE order_id IN (1,2,3,...,100);
... (2번!)
```

---

## 6. 핵심 정리

| 기법 | 목적 | 적용 시점 |
|------|------|----------|
| **인덱스** | 조회 성능 향상 | 자주 검색하는 컬럼 |
| **복합 인덱스** | 다중 조건 최적화 | WHERE 조건이 여러 개일 때 |
| **커서 페이지네이션** | 대용량 목록 처리 | 무한 스크롤, 대량 데이터 |
| **Read Replica** | 읽기 부하 분산 | 읽기:쓰기 비율이 높을 때 |
| **Fetch Join** | N+1 문제 해결 | 연관 엔티티 함께 조회 시 |

---

## 다음 편 예고

다음 편에서는 **모니터링과 옵저버빌리티**를 다룹니다. Prometheus, Grafana, 커스텀 메트릭을 통해 시스템 상태를 실시간으로 파악하는 방법을 알아봅니다.

> 다음 편: [스프링부트 실무 가이드 6편: 모니터링](/blog/springboot-practical-guide-6)
