---
title: "스프링 사전과제 가이드 4편: Performance & Optimization"
description: "성능 최적화와 쿼리 튜닝 - N+1 문제, 페이지네이션, 캐싱 전략"
pubDate: 2026-01-25
tags: ["Spring Boot", "JPA", "Performance", "Cache", "Backend", "사전과제"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [3편: Documentation & AOP](/blog/spring-boot-pre-interview-guide-3) | **4편: Performance** | [5편: Security](/blog/spring-boot-pre-interview-guide-5) |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고

---

## 서론

1~3편의 기본 과정을 마쳤다면, 이제 심화 과정이다. 4편에서는 성능 최적화를 다룬다.

**4편에서 다루는 내용:**
- N+1 문제 해결
- 페이지네이션 전략
- 캐싱 적용
- 쿼리 최적화

### 목차

- [N+1 문제 해결](#n1-문제-해결)
- [페이지네이션](#페이지네이션)
- [캐싱 전략](#캐싱-전략)
- [쿼리 최적화](#쿼리-최적화)
- [정리](#정리)

---

## N+1 문제 해결

### 1. N+1 문제란?

연관관계가 있는 Entity를 조회할 때, 1번의 쿼리로 N개의 데이터를 가져온 후, 각 데이터마다 추가 쿼리가 N번 발생하는 현상이다.

```java
// Order : OrderItem = 1 : N 관계
List<Order> orders = orderRepository.findAll(); // 1번 쿼리

for (Order order : orders) {
    // 각 Order마다 OrderItem 조회 쿼리 발생 (N번)
    List<OrderItem> items = order.getOrderItems();
    items.forEach(item -> System.out.println(item.getProductName()));
}
```

10개의 주문을 조회하면 1 + 10 = 11번의 쿼리가 실행된다.

### 2. 해결 방법

#### Fetch Join

```java
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o JOIN FETCH o.orderItems")
    List<Order> findAllWithOrderItems();
}
```

<details>
<summary>Kotlin 버전</summary>

```kotlin
interface OrderRepository : JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o JOIN FETCH o.orderItems")
    fun findAllWithOrderItems(): List<Order>
}
```

</details>

> **주의**: Fetch Join은 페이징과 함께 사용할 수 없다. 컬렉션을 Fetch Join하면 데이터가 뻥튀기되어 메모리에서 페이징 처리된다.

#### @EntityGraph

`@EntityGraph`는 JPQL 없이 Fetch Join과 동일한 효과를 낼 수 있다.

```java
public interface OrderRepository extends JpaRepository<Order, Long> {

    // 1단계 연관관계: Order → OrderItems
    @EntityGraph(attributePaths = {"orderItems"})
    @Query("SELECT o FROM Order o")
    List<Order> findAllWithOrderItemsGraph();

    // 2단계 연관관계: Order → OrderItems → Product
    @EntityGraph(attributePaths = {"orderItems", "orderItems.product"})
    List<Order> findByStatus(OrderStatus status);

    // 3단계 연관관계: Order → OrderItems → Product → Category
    @EntityGraph(attributePaths = {
        "orderItems",
        "orderItems.product",
        "orderItems.product.category"
    })
    Optional<Order> findWithFullDetailsById(Long id);
}
```

**@EntityGraph vs Fetch Join 비교**

| 항목 | @EntityGraph | Fetch Join |
|------|-------------|------------|
| 문법 | 어노테이션 | JPQL 작성 |
| 유연성 | 고정된 그래프 | 조건에 따라 다른 쿼리 |
| 가독성 | 좋음 | JPQL이 길어질 수 있음 |
| 동적 적용 | 어려움 | 가능 |

> **팁**: 단순한 연관관계는 `@EntityGraph`, 복잡한 조건이 필요하면 Fetch Join을 사용한다.

#### @BatchSize

`application.yml`에서 전역 설정하거나, Entity에 직접 적용할 수 있다.

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

`@BatchSize`는 지연 로딩 시 IN 쿼리로 한 번에 가져온다:

```sql
-- 기존: N번의 쿼리
SELECT * FROM order_item WHERE order_id = 1;
SELECT * FROM order_item WHERE order_id = 2;
...

-- @BatchSize 적용 후: 1번의 쿼리
SELECT * FROM order_item WHERE order_id IN (1, 2, 3, ..., 100);
```

<details>
<summary>💬 Fetch Join vs @EntityGraph vs @BatchSize 선택 기준</summary>

| 방법 | 장점 | 단점 | 사용 시점 |
|------|------|------|----------|
| **Fetch Join** | 한 번의 쿼리로 해결 | 페이징 불가, 카테시안 곱 주의 | 조회 건수가 적고 페이징이 필요 없을 때 |
| **@EntityGraph** | 선언적, 메서드별 적용 가능 | Fetch Join과 동일한 한계 | 특정 쿼리에만 즉시 로딩이 필요할 때 |
| **@BatchSize** | 페이징 가능, 전역 설정 가능 | 추가 쿼리 발생 (1 + 1) | 페이징이 필요하거나 컬렉션이 여러 개일 때 |

**과제에서 권장**: `@BatchSize`를 전역 설정하고, 필요한 경우에만 Fetch Join 사용

</details>

### 3. 지연 로딩 vs 즉시 로딩

```java
@Entity
public class Order {

    // 즉시 로딩 (EAGER) - 권장하지 않음
    @ManyToOne(fetch = FetchType.EAGER)
    private Member member;

    // 지연 로딩 (LAZY) - 권장
    @ManyToOne(fetch = FetchType.LAZY)
    private Member member;
}
```

<details>
<summary>💡 실무 팁: 모든 연관관계는 LAZY로</summary>

**기본 원칙**: 모든 연관관계는 `FetchType.LAZY`로 설정하고, 필요한 시점에 Fetch Join이나 @EntityGraph로 함께 조회한다.

**이유**:
1. EAGER는 예상치 못한 쿼리를 발생시킨다
2. JPQL 사용 시 EAGER도 N+1 문제가 발생한다
3. 필요한 데이터만 조회하는 것이 성능상 유리하다

**주의**: `@ManyToOne`, `@OneToOne`의 기본값은 EAGER이므로 명시적으로 LAZY 설정이 필요하다.

</details>

---

## 페이지네이션

### 1. Spring Data의 Pageable

**Page 응답 방식 비교**

| 방식 | 장점 | 단점 |
|------|------|------|
| `Page<T>` 직접 반환 | 간단, Spring 표준 | 불필요한 필드 많음 (`sort`, `pageable` 등) |
| `CommonResponse<Page<T>>` | 일관된 응답 형식 | Page 내부에 중첩 정보 |
| 커스텀 PageResponse | 필요한 필드만 | 추가 DTO 작성 필요 |

**권장**: 과제에서는 `Page<T>` 직접 반환 또는 `CommonResponse<Page<T>>`로 감싸는 것이 간단하고 충분하다.

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

    // 방식 1: Page 직접 반환
    @GetMapping
    public Page<ProductResponse> getProducts(
            @PageableDefault(size = 20, sort = "createdAt", direction = Sort.Direction.DESC)
            Pageable pageable) {
        return productService.getProducts(pageable);
    }

    // 방식 2: CommonResponse로 감싸기
    @GetMapping("/v2")
    public CommonResponse<Page<ProductResponse>> getProductsV2(Pageable pageable) {
        return CommonResponse.success(productService.getProducts(pageable));
    }
}
```

<details>
<summary>💡 커스텀 PageResponse 예시 (선택)</summary>

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
<summary>Kotlin 버전</summary>

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

| 타입 | 특징 | 쿼리 |
|------|------|------|
| **Page** | 전체 개수 포함 | SELECT + COUNT |
| **Slice** | 다음 페이지 존재 여부만 | SELECT (size + 1) |

```java
// Page - 전체 개수가 필요한 경우 (일반적인 페이지네이션)
Page<Product> findByCategory(Category category, Pageable pageable);

// Slice - 무한 스크롤 등 전체 개수가 불필요한 경우
Slice<Product> findByCategory(Category category, Pageable pageable);

// List - 페이징 정보 없이 데이터만 필요한 경우
List<Product> findByCategory(Category category, Pageable pageable);
```

<details>
<summary>💡 실무 팁: COUNT 쿼리 최적화</summary>

Page를 사용하면 COUNT 쿼리가 함께 실행되는데, 복잡한 조회 쿼리의 경우 COUNT 쿼리도 느려질 수 있다.

```java
// COUNT 쿼리 분리 최적화
@Query(value = "SELECT p FROM Product p JOIN FETCH p.category WHERE p.status = :status",
       countQuery = "SELECT COUNT(p) FROM Product p WHERE p.status = :status")
Page<Product> findByStatus(@Param("status") ProductStatus status, Pageable pageable);
```

**대안**:
- 전체 개수가 필요 없으면 `Slice` 사용
- 대략적인 개수만 필요하면 캐싱된 통계 테이블 활용

**캐싱된 통계 테이블 활용 예시**

대용량 데이터에서 매번 COUNT 쿼리를 실행하면 성능 문제가 발생한다. 이 경우 별도 통계 테이블을 두고 캐싱한다.

```java
// 1. 통계 Entity 정의
@Entity
public class ProductStats {
    @Id
    private Long categoryId;
    private Long productCount;
    private LocalDateTime updatedAt;
}

// 2. 상품 등록/삭제 시 통계 갱신 (이벤트 활용)
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void updateStats(ProductCreatedEvent event) {
    statsRepository.incrementCount(event.getCategoryId());
}

// 3. 캐시와 함께 사용
@Cacheable("productCounts")
public Long getProductCount(Long categoryId) {
    return statsRepository.findById(categoryId)
        .map(ProductStats::getProductCount)
        .orElse(0L);
}
```

> **과제에서는**: 이 수준의 최적화는 필요하지 않다. `Page`의 기본 COUNT 쿼리로 충분하다.

</details>

### 3. Offset vs Cursor 기반 페이지네이션

#### Offset 기반 (기본)

```java
// page=100, size=20 요청 시
// OFFSET 2000 LIMIT 20 -> 2000개를 스킵해야 함
```

**문제점**: 데이터가 많아지면 OFFSET이 커져서 성능이 저하된다.

#### Cursor 기반

```java
public interface ProductRepository extends JpaRepository<Product, Long> {

    // ID 기반 커서 페이지네이션
    @Query("SELECT p FROM Product p WHERE p.id < :cursor ORDER BY p.id DESC")
    List<Product> findByIdLessThan(@Param("cursor") Long cursor, Pageable pageable);
}
```

```java
@Service
public class ProductService {

    public CursorResponse<ProductResponse> getProductsWithCursor(Long cursor, int size) {
        Pageable pageable = PageRequest.of(0, size + 1); // 다음 페이지 확인용 +1

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
<summary>CursorResponse 클래스</summary>

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
<summary>💬 Offset vs Cursor 선택 기준</summary>

| 방식 | 장점 | 단점 | 사용 시점 |
|------|------|------|----------|
| **Offset** | 구현 간단, 특정 페이지 이동 가능 | 대용량에서 느림, 데이터 중복/누락 가능 | 관리자 페이지, 데이터가 적은 경우 |
| **Cursor** | 대용량에서 빠름, 일관된 결과 | 특정 페이지 이동 불가 | 무한 스크롤, SNS 피드, 대용량 데이터 |

**과제에서 권장**: 기본적으로 Offset(Page) 사용, README에 Cursor 방식의 존재와 트레이드오프를 언급하면 가산점

</details>

---

## 캐싱 전략

### 1. Spring Cache 추상화

```java
@Configuration
@EnableCaching
public class CacheConfig {
    // 기본 설정으로 ConcurrentHashMap 기반 캐시 사용
}
```

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    /**
     * 상품 상세 조회 - 캐시 적용
     * key: productId, 캐시명: product
     */
    @Cacheable(value = "product", key = "#productId")
    public ProductDetailResponse getProductDetail(Long productId) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
        return ProductDetailResponse.from(product);
    }

    /**
     * 상품 수정 - 캐시 갱신
     */
    @CachePut(value = "product", key = "#productId")
    public ProductDetailResponse updateProduct(Long productId, ProductUpdateCommand command) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
        product.update(command.getName(), command.getPrice());
        return ProductDetailResponse.from(product);
    }

    /**
     * 상품 삭제 - 캐시 제거
     */
    @CacheEvict(value = "product", key = "#productId")
    public void deleteProduct(Long productId) {
        productRepository.deleteById(productId);
    }

    /**
     * 전체 상품 캐시 제거
     */
    @CacheEvict(value = "product", allEntries = true)
    public void clearProductCache() {
        // 캐시만 제거
    }
}
```

### 2. Caffeine 캐시 적용

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
            .maximumSize(1000)           // 최대 1000개 항목
            .expireAfterWrite(10, TimeUnit.MINUTES)  // 10분 후 만료
            .recordStats());             // 통계 기록
        return cacheManager;
    }
}
```

#### 캐시별 설정 분리

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

### 3. Redis 캐시 적용

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
      time-to-live: 600000  # 10분 (밀리초)
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
<summary>💬 로컬 캐시 vs 분산 캐시</summary>

| 구분 | 로컬 캐시 (Caffeine) | 분산 캐시 (Redis) |
|------|---------------------|------------------|
| **속도** | 매우 빠름 (메모리 직접 접근) | 상대적으로 느림 (네트워크 통신) |
| **일관성** | 서버 간 불일치 가능 | 일관성 보장 |
| **용량** | 서버 메모리 제한 | 별도 서버로 확장 가능 |
| **복잡도** | 간단 | Redis 인프라 필요 |

**과제에서 권장**:
- 단일 서버 과제라면 Caffeine으로 충분
- Docker Compose에 Redis를 포함시키면 가산점

</details>

<details>
<summary>💡 캐시 무효화 전략</summary>

**Cache-Aside (Lazy Loading)**:
1. 캐시에서 먼저 조회
2. 없으면 DB에서 조회 후 캐시에 저장
3. 수정/삭제 시 캐시 무효화

**Write-Through**:
1. 데이터 저장 시 캐시와 DB 동시 업데이트

**주의사항**:
- 목록 조회 캐시는 무효화가 어려움 (개별 항목 변경 시 전체 무효화 필요)
- 캐시 TTL을 적절히 설정하여 자연 만료 유도
- 캐시 키 설계 시 충돌 방지 (prefix 사용)

</details>

---

## 쿼리 최적화

### 1. Projection 활용

전체 Entity 대신 필요한 필드만 조회한다.

#### Interface Projection

```java
// 필요한 필드만 정의한 인터페이스
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
<summary>💡 Projection 성능 비교</summary>

```java
// 1. Entity 전체 조회 - 모든 컬럼 + 연관 Entity
List<Product> products = productRepository.findAll();

// 2. Interface Projection - 필요한 컬럼만 (Proxy 생성)
List<ProductSummary> summaries = productRepository.findAllProjectedBy();

// 3. DTO Projection - 필요한 컬럼만 (직접 생성)
List<ProductSummaryDto> dtos = productRepository.findAllSummary();
```

**성능**: DTO Projection > Interface Projection > Entity 전체 조회

단, 조회 후 Entity 수정이 필요하면 Entity로 조회해야 한다.

</details>

### 2. QueryDSL 동적 쿼리

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
<summary>💬 QueryDSL vs JPQL vs Native Query</summary>

| 방식 | 장점 | 단점 | 사용 시점 |
|------|------|------|----------|
| **JPQL** | JPA 표준, Entity 매핑 | 문자열 기반, 동적 쿼리 어려움 | 단순한 정적 쿼리 |
| **QueryDSL** | 타입 안전, 동적 쿼리 용이 | 설정 복잡, Q클래스 생성 필요 | 복잡한 동적 쿼리 |
| **Native Query** | SQL 직접 작성, 최적화 가능 | DB 종속, Entity 매핑 제한 | 복잡한 통계, 특정 DB 기능 필요 시 |

**과제에서 권장**: 단순 CRUD는 Spring Data JPA, 복잡한 검색 조건이 있으면 QueryDSL 도입

</details>

### 3. 인덱스 설계

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
<summary>💡 인덱스 설계 팁</summary>

**인덱스가 필요한 경우**:
- WHERE 절에 자주 사용되는 컬럼
- JOIN 조건에 사용되는 컬럼 (FK)
- ORDER BY에 사용되는 컬럼
- 카디널리티가 높은 컬럼 (고유값이 많은)

**인덱스 주의사항**:
- INSERT/UPDATE/DELETE 성능 저하
- 복합 인덱스는 컬럼 순서가 중요 (왼쪽부터 사용)
- 과도한 인덱스는 오히려 성능 저하

**과제에서**: Entity에 `@Index`를 선언하면 DDL 자동 생성 시 인덱스가 포함되어 의도를 보여줄 수 있다.

</details>

---

## 정리

### 체크리스트

| 항목 | 확인 |
|------|------|
| 모든 연관관계가 `FetchType.LAZY`로 설정되어 있는가? | ⬜ |
| `@BatchSize` 전역 설정이 적용되어 있는가? | ⬜ |
| 페이지네이션이 필요한 API에 `Pageable`이 적용되어 있는가? | ⬜ |
| 자주 조회되는 데이터에 캐싱이 적용되어 있는가? | ⬜ |
| 목록 조회 시 필요한 필드만 Projection으로 가져오는가? | ⬜ |
| 복잡한 동적 쿼리에 QueryDSL이 사용되었는가? | ⬜ |

### 핵심 포인트

1. **N+1 문제**: 모든 연관관계는 LAZY, 필요 시 Fetch Join 또는 @BatchSize
2. **페이지네이션**: Page(Offset) 기본, 대용량이면 Cursor 고려
3. **캐싱**: 변경이 적고 조회가 많은 데이터에 적용
4. **쿼리 최적화**: 필요한 데이터만 조회 (Projection, 조건 절 최적화)

<details>
<summary>⚠️ 과제에서 흔한 실수</summary>

1. **EAGER 로딩 그대로 사용**
   - `@ManyToOne`, `@OneToOne` 기본값이 EAGER
   - 반드시 명시적으로 LAZY 설정

2. **무분별한 Fetch Join**
   - 컬렉션 여러 개를 Fetch Join하면 카테시안 곱 발생
   - `MultipleBagFetchException` 발생 가능

3. **COUNT 쿼리 무시**
   - Page 사용 시 COUNT 쿼리도 함께 실행됨
   - 복잡한 조회 시 COUNT 쿼리 분리 또는 Slice 사용

4. **캐시 키 충돌**
   - 서로 다른 메서드에서 같은 캐시명 + 같은 키 사용
   - 메서드별로 고유한 캐시명 또는 키 전략 필요

</details>

---

다음 편에서는 **Spring Security**, **JWT 인증**, **비밀번호 관리**에 대해 다룹니다.

👉 [이전: 3편 - Documentation & AOP](/blog/spring-boot-pre-interview-guide-3)
👉 [다음: 5편 - Security & Authentication](/blog/spring-boot-pre-interview-guide-5)
