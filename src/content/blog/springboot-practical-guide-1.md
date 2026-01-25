---
title: "스프링부트 실무 가이드 1편: 동시성 제어와 재고 관리"
description: "원자적 UPDATE와 멱등성 키로 동시성 문제를 해결하는 실무 가이드"
pubDate: 2026-01-25T10:00:00
tags: ["Spring Boot", "Concurrency", "Backend", "실무가이드", "동시성"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| - | **1편: 동시성 제어** | [2편: 캐싱 전략](/blog/springboot-practical-guide-2) |

---

## TL;DR (핵심 요약)

```
재고 과잉 판매 방지 = 원자적 UPDATE (DB 조건부 갱신)
중복 주문 방지 = 멱등성 키 또는 DB 유니크 제약 (분산 락은 오버엔지니어링)
```

| 문제 | 해결책 | 설명 |
|-----|--------|------|
| **재고 과잉 판매** | **Atomic Update** | `UPDATE WHERE stock >= qty` 조건부 감소 |
| **쿠폰 중복 사용** | **Atomic Update** | `UPDATE WHERE used = false` 조건부 갱신 |
| **중복 주문 (따닥)** | **멱등성 키** | 클라이언트 UUID + Redis 캐시 (권장) |

> **분산 락이 필요한 경우**: 캐시 스탬피드, 배치 중복 실행, 외부 API 제약, 장시간 리소스 선점

---

## 목차

1. [문제 정의: 왜 동시성 제어가 필요한가?](#1-문제-정의-왜-동시성-제어가-필요한가)
2. [해결책 1: 원자적 재고 업데이트](#2-해결책-1-원자적-재고-업데이트)
3. [해결책 2: 멱등성 키](#3-해결책-2-멱등성-키)
4. [분산 락이 필요한 경우](#4-분산-락이-필요한-경우)
5. [분산 락 심화](#5-분산-락-심화)
6. [FAQ](#faq-자주-묻는-질문)

---

## 1. 문제 정의: 왜 동시성 제어가 필요한가?

### 1.1 문제 1: 재고 과잉 판매 (Overselling)

재고가 1개 남은 상품에 2명이 동시에 주문하는 상황:

```
시간    사용자 A              사용자 B              재고(DB)
─────────────────────────────────────────────────────────────
T1      재고 조회 → 1개        -                    1
T2      -                    재고 조회 → 1개        1
T3      1 >= 1 → 주문 가능!   -                    1
T4      -                    1 >= 1 → 주문 가능!   1
T5      재고 감소 (1→0)       -                    0
T6      -                    재고 감소 (0→-1)      -1 ❌
```

**결과**: 재고 1개인데 2개 판매 → **과잉 판매(Overselling)** 발생!

**원인**: Check-Then-Act 패턴의 취약점

```kotlin
// ❌ 위험한 코드
fun createOrder(productId: Long, quantity: Int) {
    val product = productRepository.findById(productId)
    if (product.stockQuantity >= quantity) {       // Check
        product.stockQuantity -= quantity          // Act (이 사이에 끼어듦!)
        productRepository.save(product)
    }
}
```

### 1.2 문제 2: 중복 주문 / 쿠폰 중복 사용

같은 사용자가 주문 버튼을 연타하거나, 쿠폰을 중복 사용하려는 상황:

```
시간    사용자 A (요청 1)         사용자 A (요청 2)         문제
─────────────────────────────────────────────────────────────────
T1      쿠폰 조회 → 있음           -
T2      -                        쿠폰 조회 → 있음
T3      쿠폰 사용 처리             -
T4      -                        쿠폰 사용 처리             ⚠️ 중복 사용?
T5      주문 생성 #1              -
T6      -                        주문 생성 #2              ⚠️ 중복 주문?
```

### 1.3 문제별 해결책 요약

| 문제 | 원인 | 권장 해결책 | 비고 |
|------|------|------------|------|
| **재고 과잉 판매** | Check-Then-Act | **원자적 UPDATE** | 필수 |
| **쿠폰 중복 사용** | Check-Then-Act | **원자적 UPDATE** | 필수 |
| **중복 주문 (따닥)** | 버튼 연타 | **멱등성 키** | 권장 |
| **캐시 스탬피드** | 캐시 만료 | **분산 락** | 선택 |
| **배치 중복 실행** | 다중 인스턴스 | **분산 락** | 선택 |

---

## 2. 해결책 1: 원자적 재고 업데이트

### 2.1 원자적(Atomic) 연산이란?

중간에 끊기지 않고 **한 번에 완료**되는 연산. 다른 트랜잭션이 끼어들 수 없음.

```
┌─────────────────────────────────────────────────────────────┐
│  일반 방식 (3단계)                 원자적 방식 (1단계)         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. SELECT stock     ← 끼어들 수 있음                        │
│  2. 애플리케이션 계산  ← 끼어들 수 있음      vs    1. UPDATE   │
│  3. UPDATE stock     ← 끼어들 수 있음            WHERE 조건  │
│                                                             │
│  ❌ Race Condition 발생              ✅ DB가 원자성 보장      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 비교: 기존 방식 vs 원자적 방식

```kotlin
// ❌ 기존 방식 (3번의 쿼리, 중간에 끼어들 수 있음)
val product = repository.findById(id)        // SELECT
if (product.stockQuantity >= quantity) {
    product.stockQuantity -= quantity
    repository.save(product)                  // UPDATE
}

// ✅ 원자적 방식 (1번의 쿼리로 조건 확인 + 업데이트)
val updated = repository.decreaseStockAtomically(id, quantity)
if (updated == 0) throw BusinessException(ErrorCode.INSUFFICIENT_STOCK)
```

### 2.3 원자적 재고 감소 쿼리

```kotlin
@Modifying
@Query("""
    UPDATE Product p
    SET p.stockQuantity = p.stockQuantity - :quantity,
        p.salesCount = p.salesCount + :quantity
    WHERE p.id = :productId
    AND p.stockQuantity >= :quantity   -- ⭐ 핵심: 조건부 업데이트
    AND p.status = 'ON_SALE'
""")
fun decreaseStockAtomically(productId: Long, quantity: Int): Int
```

### 2.4 동시 요청 시 동작

```
시간    사용자 A                           사용자 B
────────────────────────────────────────────────────────────
        재고: 1개

T1      UPDATE WHERE stock >= 1           UPDATE WHERE stock >= 1
        ↓                                 ↓
        DB Row Lock 획득                   DB Row Lock 대기...

T2      stock = 0으로 변경                 (대기중)
        COMMIT

T3      updateCount = 1 ✅                 DB Row Lock 획득
                                          stock(0) >= 1? → FALSE

T4                                        updateCount = 0 ❌
                                          → INSUFFICIENT_STOCK
```

**결과**: 정확히 1개만 판매됨!

#### 왜 동작하는가? (DB Row Lock)

```
┌─────────────────────────────────────────────────────────────┐
│  InnoDB (MySQL) / PostgreSQL의 Row-Level Lock               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  UPDATE 문 실행 시:                                          │
│  1. 해당 Row에 Exclusive Lock (X-Lock) 획득                  │
│  2. 다른 트랜잭션은 같은 Row 수정 불가 (대기)                   │
│  3. COMMIT 후 Lock 해제 → 다음 트랜잭션 진행                  │
│                                                             │
│  ※ WHERE 조건은 Lock 획득 후 재평가됨                        │
│  → 이미 재고가 0이면 조건 불충족 → updateCount = 0           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

> **핵심**: DB 자체의 Row Lock 메커니즘이 동시성을 처리합니다. 별도의 분산 락 없이도 재고 보호가 가능한 이유입니다.

---

## 3. 해결책 2: 멱등성 키

### 3.1 멱등성 키 (Idempotency Key)란?

같은 요청을 여러 번 보내도 한 번만 처리되도록 보장하는 고유 키입니다.

```kotlin
@PostMapping("/orders")
fun createOrder(
    @RequestHeader("Idempotency-Key") idempotencyKey: String,
    @RequestBody request: OrderCreateRequest
): OrderResponse {
    // 1. 이미 처리된 요청인지 확인
    val cached = redisTemplate.opsForValue().get("idempotency:$idempotencyKey")
    if (cached != null) return cached  // 이전 결과 반환

    // 2. 새로운 주문 처리
    val result = orderService.createOrder(request)

    // 3. 결과 캐시 (24시간)
    redisTemplate.opsForValue().set("idempotency:$idempotencyKey", result, 24, TimeUnit.HOURS)
    return result
}
```

**클라이언트 측:**
```javascript
const response = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: {
        'Idempotency-Key': crypto.randomUUID(),  // 요청마다 고유 키
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(orderData)
});
```

### 3.2 개선된 구현 (처리 중 상태 관리)

```kotlin
fun createOrder(idempotencyKey: String, request: OrderCreateRequest): OrderResponse {
    val cacheKey = "idempotency:$idempotencyKey"

    // 1. 이미 완료된 요청 확인
    val cached = redisTemplate.opsForValue().get(cacheKey)
    if (cached is OrderResponse) return cached

    // 2. 처리 중인지 확인 (SETNX로 원자적 체크)
    val acquired = redisTemplate.opsForValue()
        .setIfAbsent("$cacheKey:processing", "1", Duration.ofSeconds(30))
    if (acquired != true) {
        throw BusinessException(ErrorCode.REQUEST_IN_PROGRESS)
    }

    try {
        // 3. 주문 처리
        val result = orderService.createOrder(request)

        // 4. 결과 캐시
        redisTemplate.opsForValue().set(cacheKey, result, Duration.ofHours(24))
        return result
    } finally {
        redisTemplate.delete("$cacheKey:processing")
    }
}
```

### 3.3 멱등성 키 vs 분산 락

| 구분 | 멱등성 키 | 분산 락 |
|------|----------|--------|
| **목적** | 중복 요청 방지 | 동시 실행 직렬화 |
| **방식** | 결과 캐싱 | 락 획득/해제 |
| **복잡도** | 낮음 | 중간 |
| **적합한 상황** | 중복 주문 방지 | 캐시 스탬피드, 배치 |

---

## 4. 분산 락이 필요한 경우

### 4.1 언제 분산 락이 필요한가?

대부분의 주문 시나리오에서 분산 락은 **오버엔지니어링**입니다.

| 문제 | 분산 락 필요? | 더 나은 대안 |
|------|:------------:|-------------|
| 재고 과잉 판매 | ❌ | 원자적 UPDATE |
| 쿠폰 중복 사용 | ❌ | 원자적 UPDATE |
| 중복 주문 (따닥) | ❌ | 멱등성 키 |
| **캐시 스탬피드** | ✅ | - |
| **배치 중복 실행** | ✅ | - |
| **외부 API 직렬화** | ✅ | - |

### 4.2 캐시 스탬피드 방지

```kotlin
fun getProduct(productId: Long): Product {
    val cached = redisTemplate.opsForValue().get("product:$productId")
    if (cached != null) return cached

    // 캐시 미스 시 1000개 요청이 동시에 DB 조회 → DB 죽음
    val lock = redissonClient.getLock("cache:product:$productId")

    return if (lock.tryLock(1, 5, TimeUnit.SECONDS)) {
        try {
            // Double-check
            val recheck = redisTemplate.opsForValue().get("product:$productId")
            if (recheck != null) return recheck

            // 1개만 DB 조회
            val product = productRepository.findById(productId)
            redisTemplate.opsForValue().set("product:$productId", product, 1, TimeUnit.HOURS)
            product
        } finally {
            lock.unlock()
        }
    } else {
        Thread.sleep(100)
        redisTemplate.opsForValue().get("product:$productId")!!
    }
}
```

### 4.3 배치 중복 실행 방지

```kotlin
@Scheduled(cron = "0 0 0 * * *")
fun dailySettlement() {
    val lock = redissonClient.getLock("batch:daily-settlement")

    if (lock.tryLock(0, 30, TimeUnit.MINUTES)) {
        try {
            settlementService.process()  // 30분 소요
        } finally {
            lock.unlock()
        }
    }
    // 락 못 잡으면 다른 인스턴스가 실행 중 → 무시
}
```

---

## 5. 분산 락 심화

### 5.1 Redis에서의 분산 락 동작 원리

#### Redisson의 Lua 스크립트 (락 획득)

```lua
-- 락이 없으면 새로 생성
if redis.call('exists', KEYS[1]) == 0 then
    redis.call('hset', KEYS[1], ARGV[2], 1)      -- 소유자 ID 저장
    redis.call('pexpire', KEYS[1], ARGV[1])      -- TTL 설정
    return nil  -- 락 획득 성공
end

-- 같은 스레드가 이미 보유 중이면 (재진입)
if redis.call('hexists', KEYS[1], ARGV[2]) == 1 then
    redis.call('hincrby', KEYS[1], ARGV[2], 1)   -- 카운트 증가
    redis.call('pexpire', KEYS[1], ARGV[1])
    return nil  -- 락 획득 성공
end

return redis.call('pttl', KEYS[1])  -- 남은 TTL 반환 (락 획득 실패)
```

### 5.2 락 전략 선택 가이드

| 구분 | 낙관적 락 | 비관적 락 | 분산 락 |
|------|----------|----------|---------|
| **방식** | 버전 체크 후 충돌 시 실패 | SELECT FOR UPDATE | Redis/ZooKeeper |
| **충돌 처리** | 애플리케이션 재시도 | DB 대기열 관리 | 외부 시스템 관리 |
| **구현** | `@Version` | `@Lock(PESSIMISTIC)` | Redisson 등 |

#### 의사결정 플로우

```
                        시작
                          │
                          ▼
                  ┌───────────────┐
                  │ 충돌이 자주    │
                  │ 발생하는가?    │
                  └───────────────┘
                     │         │
                  아니오        예
                     │         │
                     ▼         ▼
              ┌──────────┐  ┌───────────────┐
              │ 낙관적 락 │  │ 락 보유 시간이  │
              │   사용    │  │ 긴가? (>100ms) │
              └──────────┘  └───────────────┘
                               │         │
                            아니오        예
                               │         │
                               ▼         ▼
                        ┌──────────┐  ┌──────────┐
                        │ 비관적 락 │  │ 분산 락  │
                        │   사용   │  │   사용   │
                        └──────────┘  └──────────┘
```

### 5.3 실무 권장

| 서비스 | 권장 방식 | 이유 |
|--------|----------|------|
| 게시글 수정 | 낙관적 락 | 동시 수정 거의 없음 |
| 좋아요 카운트 | 없음/원자적 UPDATE | 정확도보다 성능 |
| **재고 차감** | **원자적 UPDATE** | DB 레벨에서 해결 |
| **중복 주문 방지** | **멱등성 키** | 가볍고 효과적 |
| **캐시 갱신** | **분산 락** | 스탬피드 방지 |
| **배치 작업** | **분산 락** | 다중 인스턴스 |

---

## FAQ (자주 묻는 질문)

### Q1. 분산 락 없이 재고 보호가 정말 되나요?

**A**: 네, 원자적 UPDATE만으로 충분합니다.

```sql
UPDATE products SET stock = stock - 1 WHERE id = 1 AND stock >= 1
```

DB의 Row Lock이 동시성을 처리합니다.

### Q2. 원자적 UPDATE가 실패하면 어떻게 되나요?

**A**: `affected rows = 0`이 반환되고, 애플리케이션에서 예외를 던집니다.

```kotlin
val updated = productRepository.decreaseStockAtomically(productId, quantity)
if (updated == 0) throw BusinessException(ErrorCode.INSUFFICIENT_STOCK)
```

### Q3. 여러 상품을 동시에 주문할 때 데드락이 발생하나요?

**A**: 상품 ID 순으로 정렬하여 UPDATE하면 데드락을 방지할 수 있습니다.

```kotlin
val items = orderItems.sortedBy { it.productId }
items.forEach { productRepository.decreaseStockAtomically(it.productId, it.quantity) }
```

### Q4. 멱등성 키는 누가 생성하나요?

**A**: 일반적으로 **클라이언트**가 생성합니다. 버튼 클릭 시 키를 생성하고, 재시도 시 동일한 키를 사용합니다.

### Q5. 언제 분산 락을 써야 하나요?

**A**: 아래 경우에만 사용하세요:

| 사용 O | 사용 X |
|--------|--------|
| 캐시 스탬피드 방지 | 재고 차감 |
| 배치 작업 중복 방지 | 쿠폰 사용 |
| 외부 API 직렬화 | 중복 주문 방지 |

**판단 기준**: "원자적 UPDATE나 멱등성 키로 해결 가능한가?" → 가능하면 분산 락 불필요

---

## 요약

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ✅ 원자적 UPDATE만으로 대부분의 데이터 무결성 문제 해결       │
│                                                             │
│  ✅ 중복 요청 방지는 멱등성 키가 더 가볍고 효과적             │
│                                                             │
│  ⚠️ 분산 락은 특수한 경우에만 필요:                          │
│     - 캐시 스탬피드 방지                                     │
│     - 배치 작업 중복 실행 방지                               │
│     - 외부 API 직렬화 제약                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

> **다음 편**: [스프링부트 실무 가이드 2편: 캐싱 전략](/blog/springboot-practical-guide-2)
