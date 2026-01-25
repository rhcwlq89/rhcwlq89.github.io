---
title: "스프링부트 실무 가이드 2편: 캐싱 전략"
description: "Cache-Aside 패턴부터 캐시 문제 해결까지 실무 캐싱 가이드"
pubDate: 2026-01-25T11:00:00
tags: ["Spring Boot", "Cache", "Redis", "Backend", "실무가이드"]
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

### 2.2 도입하지 말아야 할 상황

```
❌ "나중에 트래픽 많아지면 필요하니까" → 섣부른 최적화
❌ "다른 회사도 Redis 쓰니까" → 근거 없는 도입
❌ 쓰기가 읽기보다 많은 데이터 → 캐시 효과 미미
❌ 실시간 정확성이 필수인 데이터 → 재고, 결제 상태
❌ 사용자별로 다른 데이터 → 캐시 히트율 낮음
```

### 2.3 단계별 도입 전략

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

## 3. Cache-Aside 패턴

**가장 널리 사용되는 패턴.** 애플리케이션이 캐시와 DB를 직접 관리합니다.

### 3.1 동작 방식

```
[읽기 - Cache Hit]
Client → App → Cache (HIT) → 데이터 반환

[읽기 - Cache Miss]
Client → App → Cache (MISS) → DB 조회 → Cache 저장 → 데이터 반환

[쓰기]
Client → App → DB 저장 → Cache 무효화 (또는 갱신)
```

### 3.2 Entity 캐싱은 안티패턴!

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

### 3.3 올바른 구현 (DTO 사용)

```kotlin
// ✅ 올바른 예시: DTO 캐싱

// 1. 캐시용 DTO 정의
data class ProductCacheDto(
    val id: Long,
    val name: String,
    val price: BigDecimal,
    val status: ProductStatus,
    val categoryName: String
) {
    companion object {
        fun from(product: Product): ProductCacheDto {
            return ProductCacheDto(
                id = product.id!!,
                name = product.name,
                price = product.price,
                status = product.status,
                categoryName = product.category.name
            )
        }
    }
}

// 2. Service에서 DTO 반환
@Cacheable(value = ["products"], key = "#id")
fun getProductWithCache(id: Long): ProductCacheDto {
    val product = productRepository.findById(id)
        .orElseThrow { BusinessException(ErrorCode.PRODUCT_NOT_FOUND) }
    return ProductCacheDto.from(product)
}

// 3. 캐시 무효화
@CacheEvict(value = ["products"], key = "#id")
fun updateProduct(id: Long, request: UpdateProductRequest): ProductResponse {
    val product = productRepository.findById(id).orElseThrow()
    product.update(request.name, request.price, request.description)
    return ProductResponse.from(productRepository.save(product))
}
```

---

## 4. 캐시 데이터 불일치 문제

Cache-Aside는 데이터 불일치가 발생할 수 있습니다.

### 4.1 불일치 케이스

**케이스: 쓰기 후 읽기 경쟁**

```
[요청 A: 상품 가격 수정]          [요청 B: 상품 조회]
         │                              │
         ├─ DB 업데이트 (1000 → 2000)   │
         │                              ├─ 캐시 조회 (HIT: 1000) ← 오래된 데이터!
         ├─ 캐시 삭제                   │
         │                              └─ 응답: 1000원
         └─ 완료
```

### 4.2 해결 방법

| 방법 | 설명 | 적합한 상황 |
|------|------|------------|
| **짧은 TTL** | 불일치 시간 최소화 (30초~1분) | 대부분의 경우 (권장) |
| **Write-Through** | 삭제 대신 갱신 (`@CachePut`) | 일관성 중요 |
| **지연 삭제** | 삭제 후 500ms 뒤 한 번 더 삭제 | 경쟁 조건 대비 |
| **분산 락** | 캐시 갱신 시 락 획득 | 강한 일관성 필요 |

**지연 삭제 (Delayed Double Delete):**

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

> **실무 권장:** 대부분 **짧은 TTL**만으로 충분합니다.
> "TTL 동안 잠깐 옛날 데이터가 보여도 비즈니스에 문제없다"면 복잡한 해결책은 불필요합니다.

---

## 5. 캐시 무효화 전략

### 5.1 TTL 기반

```kotlin
// 10분 후 자동 만료
redisTemplate.opsForValue().set("key", value, Duration.ofMinutes(10))
```

### 5.2 명시적 무효화

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

---

## 6. Cache Stampede (Thundering Herd)

### 6.1 문제

캐시 만료 시 다수의 요청이 동시에 DB 조회

```
TTL 만료 시점
     │
     ├── Request 1 → Cache Miss → DB 조회
     ├── Request 2 → Cache Miss → DB 조회  ← DB 폭주!
     ├── Request 3 → Cache Miss → DB 조회
     └── ...
```

### 6.2 해결책: 분산 락

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

---

## 7. 로컬 캐시 vs 분산 캐시

### 7.1 비교

| 구분 | 로컬 캐시 (Caffeine) | 분산 캐시 (Redis) |
|------|---------------------|-------------------|
| **속도** | 0.01ms (최고) | 1ms |
| **용량** | 제한적 (힙 메모리) | 대용량 가능 |
| **일관성** | 서버별 불일치 가능 | 모든 서버 동일 |
| **장애 영향** | 서버별 독립 | Redis 장애 시 전체 영향 |

### 7.2 언제 무엇을 사용?

```
로컬 캐시 (Caffeine):
- 단일 서버 환경
- 데이터 불일치 허용 가능
- 극도로 빠른 응답 필요
- 예: 설정값, 코드 테이블

분산 캐시 (Redis):
- 다중 서버 환경
- 데이터 일관성 필요
- 큰 캐시 용량 필요
- 예: 세션, 상품 정보

다단계 캐시 (Caffeine + Redis):
- Hot Data는 로컬
- 전체는 Redis
- 최적의 성능 필요 시
```

---

## 8. FAQ (자주 묻는 질문)

### Q1. 캐시 TTL은 얼마로 설정해야 하나요?

**A**: 데이터 특성에 따라 다릅니다.

| 데이터 | 권장 TTL |
|--------|----------|
| 설정, 카테고리 | 1시간~1일 |
| 상품 정보 | 5~30분 |
| 인기 상품 | 5~10분 |
| 실시간 데이터 | 캐시 안 함 |

### Q2. @Cacheable vs 직접 구현, 뭐가 좋나요?

**A**: 단순한 경우 `@Cacheable`, 복잡한 로직은 직접 구현

```kotlin
// 단순한 경우 - @Cacheable 권장
@Cacheable(value = ["products"], key = "#id")
fun getProduct(id: Long): ProductDto

// 복잡한 경우 - 직접 구현
// 조건부 캐싱, 분산 락, 커스텀 직렬화 필요 시
```

### Q3. 캐시 장애 시 어떻게 대응하나요?

**A**: Fallback 전략을 준비하세요.

```kotlin
fun getProduct(id: Long): ProductDto {
    return try {
        cache.get("product:$id") ?: loadFromDB(id)
    } catch (e: RedisConnectionException) {
        log.warn("Redis 연결 실패, DB 직접 조회")
        loadFromDB(id)  // Fallback
    }
}
```

### Q4. allEntries=true는 비효율적인가요?

**A**: 캐시 구조에 따라 다릅니다.

```
"popularProducts" 캐시:
키: "top10" → [상품1, ..., 상품10]  ← 단일 엔트리

allEntries=true로 삭제해도 실제로는 1개만 삭제됨 → OK

수천 개의 키가 있는 캐시라면 → key 지정 사용
```

---

## 9. 요약

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ✅ 캐시는 문제가 발생했을 때 도입                            │
│                                                             │
│  ✅ Entity 캐싱 금지! DTO로 변환 후 캐싱                     │
│                                                             │
│  ✅ 대부분은 Cache-Aside + 짧은 TTL로 충분                   │
│                                                             │
│  ✅ 데이터 특성에 따라 전략을 다르게                          │
│                                                             │
│  ⚠️ 캐시 스탬피드는 분산 락으로 방지                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

> **다음 편**: [스프링부트 실무 가이드 3편: 이벤트 드리븐 아키텍처](/blog/springboot-practical-guide-3)
