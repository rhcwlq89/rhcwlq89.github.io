---
title: "스프링부트 실무 가이드 2편: 캐싱 전략과 Redis 활용"
description: "Cache-Aside 패턴부터 캐시 문제 해결까지, 실무에서 바로 적용 가능한 캐싱 완벽 가이드"
pubDate: 2026-01-25T11:00:00
tags: ["Spring Boot", "Cache", "Redis", "Backend", "실무가이드", "캐싱"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [1편: 동시성 제어](/blog/springboot-practical-guide-1) | **2편: 캐싱 전략** | [3편: 이벤트 드리븐](/blog/springboot-practical-guide-3) |

---

## TL;DR (핵심 요약)

```
캐시 도입 = 문제가 발생했을 때 (섣부른 최적화 금지)
기본 전략 = Cache-Aside + DTO + 짧은 TTL
데이터별 전략 = 특성에 따라 다르게 (단일 전략 X)
```

| 데이터 특성 | 권장 전략 | TTL | 예시 |
|------------|----------|-----|------|
| **거의 안 변함** | Read-Through + Refresh-Ahead | 1시간~1일 | 카테고리, 설정 |
| **가끔 변함** | Cache-Aside + 명시적 무효화 | 5~30분 | 상품 정보 |
| **자주 변함** | 캐시 안 함 | - | 재고, 결제 상태 |
| **쓰기 많음** | Write-Behind | 배치 | 조회수, 좋아요 |
| **계산 비용 높음** | Cache-Aside + 긴 TTL | 5분~1시간 | 랭킹, 통계 |

> **핵심 원칙**: Entity 캐싱은 안티패턴! 반드시 DTO로 변환 후 캐싱

---

## 1. 캐시란 무엇인가?

자주 접근하는 데이터를 빠른 저장소에 보관하여 응답 시간을 단축하고 DB 부하를 줄이는 기술입니다.

### 1.1 응답 시간 비교

```
┌─────────────────────────────────────────────────────────────┐
│  저장소별 응답 시간                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DB 조회:     ~10ms   (네트워크 + 디스크 I/O)                │
│  Redis 조회:  ~1ms    (네트워크 + 메모리)                    │
│  로컬 캐시:   ~0.01ms (메모리만)                             │
│                                                             │
│  ※ 로컬 캐시는 Redis보다 100배 빠름                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 캐시 효과 계산

```
QPS 1000, DB 조회 10ms 가정:

캐시 없음:     1000 × 10ms = 10초/초의 DB 부하
캐시 90% 히트: 100 × 10ms = 1초/초의 DB 부하 (10배 감소!)
```

### 1.3 캐시 적합성 판단

| 적합한 데이터 | 부적합한 데이터 |
|--------------|----------------|
| 자주 읽히는 데이터 | 자주 변경되는 데이터 |
| 변경이 드문 데이터 | 실시간 정확성 필수 데이터 |
| 계산 비용이 높은 데이터 | 사용자별 민감 데이터 |
| 공유 가능한 데이터 | 일회성 데이터 |

```
마켓플레이스 예시:

✅ 적합: 상품 목록, 카테고리, 인기 상품, 설정값
❌ 부적합: 재고 수량, 결제 상태, 실시간 가격
```

---

## 2. 캐시 도입 시점

> **핵심**: 캐시는 "있으면 좋다"가 아니라 **문제가 발생했을 때** 도입합니다.

### 2.1 도입 신호 (이런 상황이면 검토)

```
1. DB CPU 사용률 지속 70% 이상
2. 동일 쿼리가 반복 실행됨 (슬로우 쿼리 로그 분석)
3. API 응답 시간 SLA 미달 (예: p95 > 500ms)
4. DB 커넥션 풀 고갈 현상
5. 트래픽 급증 예정 (이벤트, 프로모션)
```

### 2.2 SLA/SLO/SLI 용어 정리

| 용어 | 의미 | 예시 |
|------|------|------|
| **SLI** (Indicator) | 실제 측정값 | p95 응답시간 = 320ms |
| **SLO** (Objective) | 내부 목표 | p95 < 500ms |
| **SLA** (Agreement) | 외부 약속 (위반 시 보상) | p95 < 1000ms |

```
SLA 예시:

[응답 시간]
- p50: 100ms 이하   (50%의 요청이 100ms 안에 응답)
- p95: 500ms 이하   (95%의 요청이 500ms 안에 응답)
- p99: 1000ms 이하  (99%의 요청이 1초 안에 응답)

[가용성]
- 99.9%  → 한 달에 약 43분 다운타임 허용
- 99.99% → 한 달에 약 4분 다운타임 허용
```

### 2.3 도입 판단 플로우

```
                        시작
                          │
                          ▼
                  ┌───────────────┐
                  │ 응답 시간이    │
                  │ 느린가?       │
                  └───────────────┘
                     │         │
                   YES        NO
                     │         │
                     ▼         ▼
              ┌──────────┐   캐시 불필요
              │ 원인이   │   (섣부른 최적화 금지)
              │ DB인가?  │
              └──────────┘
                 │    │
               YES   NO
                 │    │
                 ▼    ▼
          ┌──────────┐  다른 병목 해결
          │ 쿼리 최적화│  (네트워크, 외부 API)
          │ 가능한가?  │
          └──────────┘
             │    │
           YES   NO
             │    │
             ▼    ▼
       인덱스/쿼리  ┌──────────┐
       튜닝 먼저    │ 읽기:쓰기 │
                   │ > 10:1?  │
                   └──────────┘
                      │    │
                    YES   NO
                      │    │
                      ▼    ▼
                 캐시 도입  DB 스케일업 검토
```

### 2.4 도입 전 체크리스트

```
□ 현재 병목 지점을 측정했는가? (APM, 슬로우 쿼리 로그)
□ 캐시 없이 해결 가능한 방법을 검토했는가? (인덱스, 쿼리 최적화)
□ 캐시할 데이터의 읽기/쓰기 비율을 파악했는가?
□ 데이터 불일치 허용 범위를 정의했는가?
□ 캐시 장애 시 fallback 전략이 있는가?
□ 캐시 히트율 모니터링 계획이 있는가?
```

### 2.5 도입하지 말아야 할 상황

```
❌ "나중에 트래픽 많아지면 필요하니까" → 섣부른 최적화
❌ "다른 회사도 Redis 쓰니까" → 근거 없는 도입
❌ 쓰기가 읽기보다 많은 데이터 → 캐시 효과 미미
❌ 실시간 정확성이 필수인 데이터 → 재고, 결제 상태
❌ 사용자별로 다른 데이터 → 캐시 히트율 낮음
```

### 2.6 단계별 도입 전략

```
[1단계] 로컬 캐시로 시작 (Caffeine)
        - 인프라 추가 없이 즉시 적용
        - 단일 서버 또는 데이터 불일치 허용 시

[2단계] 분산 캐시 전환 (Redis)
        - 다중 서버 환경
        - 데이터 일관성 필요 시

[3단계] 다단계 캐시 구성 (Caffeine + Redis)
        - Hot 데이터는 로컬, 전체는 Redis
        - 최적의 성능 필요 시
```

---

## 3. 데이터 특성별 전략 선택

> **핵심**: 단일 전략으로 모든 데이터를 처리하지 마세요. 특성에 따라 다르게!

### 3.1 특성별 권장 전략

| 데이터 특성 | 예시 | 권장 전략 | TTL |
|------------|------|----------|-----|
| **거의 안 변함** | 카테고리, 약관, 설정 | Read-Through + Refresh-Ahead | 1시간~1일 |
| **가끔 변함** | 상품 정보, 프로필 | Cache-Aside + 명시적 무효화 | 5~30분 |
| **자주 변함** | 재고, 가격 | 캐시 안 함 또는 매우 짧은 TTL | 10~30초 |
| **쓰기가 많음** | 조회수, 좋아요 | Write-Behind | N/A (배치) |
| **계산 비용 높음** | 통계, 랭킹, 집계 | Cache-Aside + 긴 TTL | 5분~1시간 |

### 3.2 판단 기준

```
1. 읽기:쓰기 비율
   - 100:1 이상 → 적극 캐싱
   - 10:1 정도 → 선택적 캐싱
   - 1:1 이하 → 캐싱 효과 미미

2. 불일치 허용 범위
   - 허용 불가 (재고, 결제) → 캐시 안 함
   - 수 초 허용 → 짧은 TTL (10~30초)
   - 수 분 허용 → 일반 TTL + 무효화

3. 접근 패턴
   - Hot Data (인기 상품) → 로컬 캐시 + Redis (다단계)
   - Cold Data (오래된 상품) → Redis만 또는 캐시 안 함

4. 계산 비용
   - 단순 조회 → 캐시 효과 작음
   - 집계/정렬/조인 → 캐시 효과 큼
```

---

## 4. Cache-Aside 패턴 (Lazy Loading)

**가장 널리 사용되는 패턴.** 애플리케이션이 캐시와 DB를 직접 관리합니다.

### 4.1 동작 방식

```
[읽기 - Cache Hit]
Client → App → Cache (HIT) → 데이터 반환

[읽기 - Cache Miss]
Client → App → Cache (MISS) → DB 조회 → Cache 저장 → 데이터 반환

[쓰기]
Client → App → DB 저장 → Cache 무효화 (또는 갱신)
```

### 4.2 Entity 캐싱은 안티패턴!

```kotlin
// ❌ 잘못된 예시: Entity 직접 캐싱
@Cacheable(value = ["products"], key = "#id")
fun getProduct(id: Long): Product {  // Entity 반환
    return productRepository.findById(id).orElseThrow()
}
```

**Entity 캐싱이 문제인 이유:**

| 문제 | 설명 |
|------|------|
| Lazy Loading 오류 | 캐시에서 꺼낸 Entity는 영속성 컨텍스트 밖 → `LazyInitializationException` |
| 직렬화 문제 | Hibernate Proxy 객체 직렬화 실패 가능 |
| 불필요한 데이터 노출 | 내부 필드, 연관 Entity까지 캐싱/노출 |
| 캐시 크기 증가 | Entity 전체 저장 → 메모리 낭비 |
| 변경 감지 오작동 | 캐시된 Entity 수정 시 의도치 않은 DB 반영 |

### 4.3 올바른 구현 (DTO 사용)

```kotlin
// ✅ 올바른 예시: DTO 캐싱

// 1. 캐시용 DTO 정의
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

// 2. 직접 구현
fun getProduct(id: Long): ProductCacheDto {
    val cacheKey = "product:$id"

    // 1. 캐시 조회
    redisTemplate.opsForValue().get(cacheKey)?.let { return it }

    // 2. Cache Miss → DB 조회 후 DTO 변환
    val product = productRepository.findById(id)
        .orElseThrow { BusinessException(ErrorCode.PRODUCT_NOT_FOUND) }

    val dto = ProductCacheDto.from(product)

    // 3. 캐시에 DTO 저장 (TTL 10분)
    redisTemplate.opsForValue().set(cacheKey, dto, Duration.ofMinutes(10))

    return dto
}

// 3. Spring @Cacheable 사용 (권장)
@Cacheable(value = ["products"], key = "#id")
fun getProductWithCache(id: Long): ProductCacheDto {
    val product = productRepository.findById(id)
        .orElseThrow { BusinessException(ErrorCode.PRODUCT_NOT_FOUND) }
    return ProductCacheDto.from(product)
}

// 4. 캐시 무효화
@CacheEvict(value = ["products"], key = "#id")
fun updateProduct(id: Long, request: UpdateProductRequest): ProductResponse {
    val product = productRepository.findById(id)
        .orElseThrow { BusinessException(ErrorCode.PRODUCT_NOT_FOUND) }
    product.update(request.name, request.price, request.description)
    return ProductResponse.from(productRepository.save(product))
}
```

### 4.4 DTO vs Entity 캐싱 비교

| 항목 | Entity 캐싱 | DTO 캐싱 |
|------|------------|---------|
| Lazy Loading | 오류 발생 | 문제 없음 |
| 직렬화 | Proxy 문제 | 안전 |
| 캐시 크기 | 큼 (전체 필드) | 작음 (필요한 것만) |
| API 응답 변환 | 추가 작업 필요 | 바로 사용 가능 |
| 연관 관계 | N+1 위험 | 미리 평탄화 |

---

## 5. 캐시 데이터 불일치 문제

Cache-Aside는 데이터 불일치가 발생할 수 있습니다.

### 5.1 케이스 1: 쓰기 후 읽기 경쟁 (가장 흔함)

```
[요청 A: 상품 가격 수정]          [요청 B: 상품 조회]
         │                              │
         ├─ DB 업데이트 (1000 → 2000)   │
         │                              ├─ 캐시 조회 (HIT: 1000) ← 오래된 데이터!
         ├─ 캐시 삭제                   │
         │                              └─ 응답: 1000원
         └─ 완료
```

원인: DB 업데이트와 캐시 삭제 사이에 다른 요청이 캐시를 읽음

### 5.2 케이스 2: 캐시 갱신 경쟁 조건

두 개의 **읽기 요청**이 거의 동시에 들어오고, 그 사이에 **쓰기 요청**이 끼어드는 상황입니다.

```
[요청 A]                           [요청 B]
   │                                  │
   ├─ 캐시 조회 (MISS)                ├─ 캐시 조회 (MISS)
   ├─ DB 조회 (가격: 1000)            ├─ DB 조회 (가격: 1000)
   │                                  │
   │  ← 이 시점에 다른 요청이 가격을 2000으로 수정 + 캐시 삭제 →
   │                                  │
   │                                  ├─ 캐시 저장 (1000) ← 삭제된 캐시에 옛날 값 저장!
   ├─ 캐시 저장 (1000)                │

결과: DB는 2000인데 캐시는 1000 (TTL까지 불일치)
```

**구체적인 타임라인:**

```
상품 ID: 123, 현재 가격: 1000원

[09:00:00.000] 사용자 A: 상품 123 조회 요청
[09:00:00.001] 사용자 B: 상품 123 조회 요청
[09:00:00.002] A: 캐시 MISS
[09:00:00.003] B: 캐시 MISS
[09:00:00.010] A: DB 조회 시작
[09:00:00.011] B: DB 조회 시작
[09:00:00.050] A: DB 조회 완료 (가격: 1000원)
[09:00:00.051] B: DB 조회 완료 (가격: 1000원)

[09:00:00.060] ★ 관리자: 가격 2000원으로 수정 + 캐시 삭제

[09:00:00.070] B: 캐시에 1000원 저장  ← 삭제된 캐시에 옛날 값 저장!
[09:00:00.071] A: 캐시에 1000원 저장  ← 덮어쓰기

[09:00:00.100 ~ 09:10:00.070]
    → TTL 동안 모든 사용자가 1000원으로 보게 됨 (실제는 2000원)
```

### 5.3 해결 방법

| 방법 | 설명 | 적합한 상황 |
|------|------|------------|
| **짧은 TTL** | 불일치 시간 최소화 (30초~1분) | 대부분의 경우 (권장) |
| **Write-Through** | 삭제 대신 갱신 (`@CachePut`) | 일관성 중요 |
| **지연 삭제** | 삭제 후 500ms 뒤 한 번 더 삭제 | 경쟁 조건 대비 (케이스 2, 3) |
| **분산 락** | 캐시 갱신 시 락 획득 | 강한 일관성 필요 |
| **버전 키** | `product:1:v5` 처럼 버전 포함 | 복잡하지만 확실 |

**지연 삭제 (Delayed Double Delete) 구현:**

```kotlin
@Transactional
fun updateProduct(id: Long, request: UpdateRequest): ProductResponse {
    // 1. 캐시 먼저 삭제
    redisTemplate.delete("product:$id")

    // 2. DB 업데이트
    val product = productRepository.save(...)

    // 3. 500ms 후 한 번 더 삭제 (경쟁 조건 방어)
    CompletableFuture.delayedExecutor(500, TimeUnit.MILLISECONDS).execute {
        redisTemplate.delete("product:$id")
    }

    return ProductResponse.from(product)
}
```

**왜 효과적인가?**

```
케이스 2 상황에서:

[09:00:00.060] 관리자: 가격 수정 + 캐시 삭제 (1차)
[09:00:00.070] B: 캐시에 1000원 저장 ← 오래된 값 저장됨
[09:00:00.560] 관리자: 캐시 삭제 (2차, 지연 삭제) ← 오래된 값 제거!
[09:00:00.600] 다음 요청: 캐시 MISS → DB 조회 (2000원) → 정상!
```

> **실무 권장:** 대부분 **짧은 TTL**만으로 충분합니다.
> "TTL 동안 잠깐 옛날 데이터가 보여도 비즈니스에 문제없다"면 복잡한 해결책은 불필요합니다.

---

## 6. 기타 캐싱 패턴

### 6.1 Read-Through

캐시가 DB 조회를 대행합니다. 애플리케이션은 캐시만 바라봅니다.

```kotlin
@Bean
fun categoryCache(): LoadingCache<String, List<CategoryResponse>> {
    return Caffeine.newBuilder()
        .maximumSize(100)
        .expireAfterWrite(Duration.ofHours(1))
        .build { _ ->
            // Cache Miss 시 자동으로 호출됨
            categoryRepository.findAll()
                .sortedBy { it.displayOrder }
                .map { CategoryResponse.from(it) }
        }
}
```

### 6.2 Write-Through

쓰기 시 캐시와 DB에 동시에 저장합니다.

```kotlin
// Spring @CachePut 사용 - DB 저장 후 캐시도 함께 갱신
@CachePut(value = ["products"], key = "#result.id")
fun createProduct(request: CreateProductRequest): ProductResponse {
    val product = Product.create(request)
    val saved = productRepository.save(product)
    return ProductResponse.from(saved)
}
```

**@CachePut과 트랜잭션 문제:**

`@CachePut`은 **트랜잭션 커밋 전에** 캐시에 저장합니다:

```
@Transactional + @CachePut 실행 순서:

1. 트랜잭션 시작
2. 메서드 실행 (DB 저장)
3. 메서드 반환값으로 캐시 저장  ← 여기서 캐시 저장!
4. 트랜잭션 커밋

문제: 3번에서 캐시에 저장되지만, 4번에서 롤백되면?
     → DB에는 없고, 캐시에만 데이터가 존재하는 불일치 발생!
```

**왜 @CacheEvict를 더 많이 쓰는가?**

| 방식 | 동작 | DB 롤백 시 |
|------|------|-----------|
| `@CacheEvict` | 캐시 삭제 → 다음 조회 시 DB에서 캐싱 | ✅ 안전 |
| `@CachePut` | 캐시 즉시 갱신 | ⚠️ 불일치 가능 |

### 6.3 Write-Behind (Write-Back)

쓰기를 캐시에만 하고, DB 저장은 비동기로 처리합니다.

```kotlin
@Service
class ProductViewService(
    private val redisTemplate: RedisTemplate<String, String>,
    private val productRepository: ProductRepository
) {
    // 조회 시 Redis에만 기록 (빠름)
    fun incrementViewCount(productId: Long) {
        redisTemplate.opsForValue().increment("viewCount:$productId")
    }

    // 1분마다 DB 동기화
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

> **적합한 상황**: 조회수, 좋아요 등 일시적 유실 허용 가능한 데이터

### 6.4 Refresh-Ahead

TTL 만료 전에 미리 캐시를 갱신합니다.

```kotlin
@Bean
fun popularProductsCache(): LoadingCache<String, List<ProductResponse>> {
    return Caffeine.newBuilder()
        .maximumSize(10)
        .expireAfterWrite(Duration.ofMinutes(10))
        .refreshAfterWrite(Duration.ofMinutes(8))  // 8분 후 백그라운드 갱신
        .build { _ ->
            productRepository.findByStatusOrderBySalesCountDesc(
                ProductStatus.ON_SALE,
                PageRequest.of(0, 10)
            ).map { ProductResponse.from(it) }
        }
}
```

---

## 7. 캐시 무효화 전략

### 7.1 TTL 기반

```kotlin
// 10분 후 자동 만료
redisTemplate.opsForValue().set("key", value, Duration.ofMinutes(10))
```

### 7.2 명시적 무효화

```kotlin
// 단일 키 삭제
@CacheEvict(value = ["products"], key = "#id")
fun updateProduct(id: Long, request: UpdateRequest)

// 전체 삭제
@CacheEvict(value = ["products"], allEntries = true)
fun bulkUpdateProducts()

// 여러 캐시 동시 무효화
@Caching(evict = [
    CacheEvict(value = ["products"], key = "#id"),
    CacheEvict(value = ["popularProducts"], allEntries = true)
])
fun deleteProduct(id: Long)
```

**allEntries=true vs key 지정:**

| 방식 | 동작 | 적합한 상황 |
|------|------|------------|
| `key = "#id"` | 특정 키 1개 삭제 | 개별 상품 캐시 |
| `allEntries = true` | 해당 캐시의 모든 키 삭제 | 목록/집계 캐시 |

---

## 8. 캐시 문제와 해결책

### 8.1 Cache Stampede (Thundering Herd)

**문제**: 캐시 만료 시 다수의 요청이 동시에 DB 조회

```
TTL 만료 시점
     │
     ├── Request 1 → Cache Miss → DB 조회
     ├── Request 2 → Cache Miss → DB 조회  ← DB 폭주!
     ├── Request 3 → Cache Miss → DB 조회
     └── ...
```

**해결책: 분산 락**

```kotlin
fun getProductWithLock(id: Long): ProductCacheDto {
    val cacheKey = "product:$id"
    val lockKey = "lock:product:$id"

    // 캐시 확인
    redisTemplate.opsForValue().get(cacheKey)?.let { return it }

    // 분산 락 획득 (SETNX)
    val acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, "locked", Duration.ofSeconds(5))

    if (acquired == true) {
        try {
            // Double-check
            redisTemplate.opsForValue().get(cacheKey)?.let { return it }

            // 1개만 DB 조회
            val product = productRepository.findById(id).orElseThrow()
            val dto = ProductCacheDto.from(product)
            redisTemplate.opsForValue().set(cacheKey, dto, Duration.ofMinutes(10))
            return dto
        } finally {
            redisTemplate.delete(lockKey)
        }
    } else {
        // 락 획득 실패 → 잠시 대기 후 재시도
        Thread.sleep(50)
        return getProductWithLock(id)
    }
}
```

### 8.2 Cache Penetration

**문제**: 존재하지 않는 데이터 반복 조회 → 매번 DB 조회

**해결책: Null 캐싱**

```kotlin
fun getProductSafe(id: Long): ProductCacheDto? {
    val cacheKey = "product:$id"

    // EMPTY 마커 체크
    if (redisTemplate.hasKey("$cacheKey:empty") == true) {
        return null
    }

    redisTemplate.opsForValue().get(cacheKey)?.let { return it }

    val product = productRepository.findById(id).orElse(null)

    if (product == null) {
        // 없는 데이터도 짧은 TTL로 캐싱
        redisTemplate.opsForValue().set("$cacheKey:empty", "1", Duration.ofMinutes(1))
        return null
    }

    val dto = ProductCacheDto.from(product)
    redisTemplate.opsForValue().set(cacheKey, dto, Duration.ofMinutes(10))
    return dto
}
```

### 8.3 Cache Avalanche

**문제**: 다수의 캐시가 동시에 만료 → DB 과부하

**해결책: TTL Jitter**

```kotlin
fun cacheWithJitter(key: String, value: Any, baseTtlMinutes: Long) {
    // 기본 TTL에 ±20% 랜덤 추가
    val jitter = (baseTtlMinutes * 0.2 * Random.nextDouble()).toLong()
    val ttl = baseTtlMinutes + jitter

    redisTemplate.opsForValue().set(key, value, Duration.ofMinutes(ttl))
}

// 예: 기본 10분 → 8~12분 사이로 분산
```

### 8.4 Hot Key 문제

**문제**: 특정 키에 요청 집중 → 단일 Redis 노드 과부하

**해결책: 로컬 캐시 조합 (다단계)**

```kotlin
// L1: 로컬 캐시 (Caffeine) - 30초 (빠름)
// L2: Redis - 10분 (서버 간 공유)

private val localCache = Caffeine.newBuilder()
    .maximumSize(100)
    .expireAfterWrite(Duration.ofSeconds(30))
    .build<String, List<ProductResponse>>()

fun getPopularProducts(): List<ProductResponse> {
    val cacheKey = "popularProducts:top10"

    // L1 조회 (로컬)
    localCache.getIfPresent(cacheKey)?.let { return it }

    // L2 조회 (Redis)
    val products = redisTemplate.opsForValue().get(cacheKey)
        ?: fetchAndCacheToRedis()

    // L1에 저장
    localCache.put(cacheKey, products)
    return products
}
```

---

## 9. 로컬 캐시 vs 분산 캐시

### 9.1 비교

| 항목 | 로컬 캐시 (Caffeine) | 분산 캐시 (Redis) |
|------|---------------------|-------------------|
| **속도** | ~0.01ms | ~1ms |
| **용량** | JVM 힙 제한 | 수십 GB 이상 |
| **일관성** | 서버 간 불일치 | 일관성 보장 |
| **장애 영향** | 서버별 독립 | 전체 영향 |

### 9.2 선택 가이드

```
Q1. 여러 서버에서 동일한 데이터가 필요한가?
    YES → 분산 캐시 (Redis)
    NO  → Q2로

Q2. 데이터가 자주 변경되는가?
    YES → 분산 캐시
    NO  → 로컬 캐시 (Caffeine)
```

---

## 10. 실제 프로젝트 적용 사례

### 10.1 카테고리 목록 (Cache-Aside)

카테고리는 거의 변하지 않으므로 캐싱 효과가 큽니다.

```kotlin
@Service
class CategoryService(
    private val categoryJpaRepository: CategoryJpaRepository
) {
    // 캐시에서 조회, 없으면 DB 조회 후 캐싱
    @Cacheable(value = ["categories"], key = "'all'")
    fun getAllCategories(): List<CategoryResponse> {
        return categoryJpaRepository.findAll()
            .sortedBy { it.displayOrder }
            .map { CategoryResponse.from(it) }  // Entity → DTO 변환
    }

    // 카테고리 생성 시 캐시 전체 무효화
    @Transactional
    @CacheEvict(value = ["categories"], allEntries = true)
    fun createCategory(req: CreateCategoryRequest): CategoryResponse {
        // ... 생성 로직
    }
}
```

### 10.2 인기 상품 목록 (Cache-Aside)

인기 상품은 계산 비용이 높고(정렬), 약간의 지연이 허용됩니다.

```kotlin
@Service
class ProductService(
    private val productJpaRepository: ProductJpaRepository
) {
    // 인기 상품 TOP 10 캐싱
    @Cacheable(value = ["popularProducts"], key = "'top10'")
    fun getPopularProducts(): List<ProductResponse> {
        return productJpaRepository.findByStatusOrderBySalesCountDesc(
            ProductStatus.ON_SALE,
            PageRequest.of(0, 10)
        ).map { ProductResponse.from(it) }
    }

    // 상품 수정 시 인기 상품 캐시 무효화
    @Transactional
    @CacheEvict(value = ["popularProducts"], allEntries = true)
    fun updateProduct(sellerId: Long, productId: Long, req: UpdateProductRequest): ProductResponse {
        // ... 수정 로직
    }
}
```

### 10.3 캐시 설정 (CacheConfig)

```kotlin
@Configuration
@EnableCaching
@Profile("local")  // 로컬에서는 Caffeine, Docker/Prod에서는 Redis
class CacheConfig {

    @Bean
    fun cacheManager(): CacheManager {
        return CaffeineCacheManager("popularProducts", "categories").apply {
            setCaffeine(
                Caffeine.newBuilder()
                    .expireAfterWrite(10, TimeUnit.MINUTES)  // TTL 10분
                    .maximumSize(1000)
                    .recordStats()  // 히트율 모니터링
            )
        }
    }
}
```

---

## 11. FAQ (자주 묻는 질문)

### Q1. 캐시 도입 전 무엇을 먼저 해야 하나요?

현재 병목을 측정하세요. APM이나 슬로우 쿼리 로그로 원인을 파악한 후, 인덱스/쿼리 최적화로 해결 가능한지 먼저 검토하세요.

### Q2. Entity를 캐싱하면 왜 안 되나요?

5가지 문제가 있습니다:
1. `LazyInitializationException` 발생
2. Hibernate Proxy 직렬화 문제
3. 불필요한 데이터 노출
4. 캐시 크기 증가
5. 변경 감지 오작동

반드시 DTO로 변환 후 캐싱하세요.

### Q3. TTL은 어떻게 설정해야 하나요?

데이터 특성에 따라 다릅니다:
- 거의 안 변함 (카테고리): 1시간~1일
- 가끔 변함 (상품 정보): 5~30분
- 자주 변함 (재고): 캐시 안 함 또는 10~30초

불일치 허용 범위를 정의하고 그에 맞게 설정하세요.

### Q4. 캐시 무효화가 실패하면 어떻게 되나요?

DB는 새 값, 캐시는 옛날 값이 됩니다. 해결책:
- TTL을 짧게 설정 (최종 방어선)
- 지연 삭제 (500ms 후 한 번 더)
- 무효화 실패 시 로깅/알람

### Q5. 캐시 장애 시 어떻게 대응하나요?

fallback 전략을 준비하세요:

```kotlin
fun getPopularProducts(): List<ProductResponse> {
    return try {
        redisTemplate.opsForValue().get("popularProducts:top10")
            ?: fetchFromDB()
    } catch (e: RedisConnectionException) {
        log.warn("Redis 연결 실패, DB fallback")
        fetchFromDB()  // DB 직접 조회
    }
}
```

### Q6. 재고 같은 실시간 데이터도 캐싱해야 하나요?

아니요. 실시간 정확성이 필요한 데이터는 캐싱하지 마세요. 원자적 UPDATE로 DB에서 직접 처리하세요.

---

## 12. 핵심 정리

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. 섣부른 최적화 금지 - 문제가 생겼을 때 도입               │
│                                                             │
│  2. Entity 캐싱은 안티패턴 - 반드시 DTO로 변환              │
│                                                             │
│  3. 단일 전략 X - 데이터 특성별로 다르게                     │
│                                                             │
│  4. 단순하게 시작 - Cache-Aside + TTL로 시작                │
│                                                             │
│  5. 측정하고 개선 - 히트율 90% 이상 목표                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 캐싱 패턴 비교

| 패턴 | 핵심 | 적합한 상황 |
|------|------|------------|
| **Cache-Aside** | 앱이 캐시/DB 직접 관리 | 범용, 읽기 위주 (권장) |
| **Read-Through** | 캐시가 DB 조회 대행 | 일관된 캐시 로직 |
| **Write-Through** | 캐시+DB 동시 저장 | 일관성 중요 |
| **Write-Behind** | 캐시만 저장, DB는 비동기 | 쓰기 성능 중요 |
| **Refresh-Ahead** | TTL 전 미리 갱신 | Hot Key |

### 문제별 해결책

| 문제 | 해결책 |
|------|--------|
| **Cache Stampede** | 분산 락, 확률적 조기 갱신 |
| **Cache Penetration** | Null 캐싱 |
| **Cache Avalanche** | TTL Jitter |
| **Hot Key** | 로컬 캐시 조합, 키 복제 |
| **데이터 불일치** | 짧은 TTL, 지연 삭제 |

---

> **다음 편**: [스프링부트 실무 가이드 3편: 이벤트 드리븐 아키텍처](/blog/springboot-practical-guide-3)
