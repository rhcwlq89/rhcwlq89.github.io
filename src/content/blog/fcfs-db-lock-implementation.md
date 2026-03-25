---
title: "DB 락으로 선착순 시스템 구현하기: FOR UPDATE부터 동시성 테스트까지"
description: "SELECT FOR UPDATE를 사용한 선착순 재고 차감 구현을 다룬다. Spring Boot + JPA 코드로 비관적 락을 구현하고, 100명 동시 요청 테스트로 정합성을 검증한 뒤, 한계를 직접 확인한다."
pubDate: 2026-03-20T16:00:00+09:00
tags: ["System Design", "First-Come-First-Served", "Database", "Lock", "Spring Boot"]
heroImage: "../../assets/FcfsDbLockImplementation.png"
---

## 서론

[이전 글](/blog/fcfs-system-comparison-guide)에서 선착순 시스템의 6가지 구현 방식을 비교했다. 이번 글에서는 그중 **가장 단순한 방식 — DB 비관적 락(SELECT FOR UPDATE)** 으로 직접 구현해본다.

코드로 구현하고, 100명이 동시에 구매하는 테스트로 정합성을 확인하고, 어디서 한계가 오는지까지 직접 본다.

---

## 1. 왜 DB 락부터 시작하나?

DB 락은 선착순 시스템의 **가장 기본적인 구현**이다.

- 추가 인프라 없이 DB만으로 동작한다
- 동시성 문제의 본질을 코드로 직접 확인할 수 있다
- Redis나 큐 방식의 필요성을 체감하기 위한 **기준점**이 된다

> 어떤 기술이 왜 필요한지를 알려면, 그 기술 없이 먼저 해봐야 한다.

---

## 2. 문제 상황: 락 없이 재고를 차감하면?

재고 1개짜리 상품에 2명이 동시에 구매하는 상황을 보자.

| 단계 | TX1 (주문 A) | TX2 (주문 B) | 실제 재고 |
|:---:|-----------|-----------|:----:|
| 1 | `SELECT stock` → **1** (앱 메모리에 저장) | | 1 |
| 2 | | `SELECT stock` → **1** (앱 메모리에 저장) | 1 |
| 3 | 앱에서 1 > 0 확인 → `UPDATE stock = stock - 1` | | 0 |
| 4 | `COMMIT` | | 0 |
| 5 | | 앱에서 1 > 0 확인 (아까 읽은 값) → `UPDATE stock = stock - 1` | -1 💀 |
| 6 | | `COMMIT` | -1 |

**재고가 음수가 됐다.** TX2는 앱 메모리에 저장된 옛날 값(1)으로 조건을 통과했지만, `UPDATE`의 `stock - 1`은 DB의 **현재 값(0)**에서 차감한다. 결과적으로 0 - 1 = -1. 이것이 **Lost Update** 문제다.

---

## 3. 해결: SELECT FOR UPDATE

`FOR UPDATE`를 붙이면 해당 행에 **배타 락(exclusive lock)** 이 걸린다. 다른 트랜잭션은 이 행을 읽지도 수정하지도 못하고 **대기**한다.

| 단계 | TX1 (주문 A) | TX2 (주문 B) | 재고 |
|:---:|-----------|-----------|:----:|
| 1 | `SELECT stock FOR UPDATE` → **1** (행 락 획득 🔒) | | 1 |
| 2 | | `SELECT stock FOR UPDATE` → 락 대기 ⏳ | 1 |
| 3 | stock > 0 → `UPDATE stock = 0` | | 0 |
| 4 | `COMMIT` (락 해제 🔓) | | 0 |
| 5 | | → **0** (최신 값!) → 품절 처리 | 0 |
| 6 | | `ROLLBACK` | 0 |

TX2는 TX1이 끝날 때까지 기다렸다가, **최신 재고(0)를 읽고 품절로 처리**한다. 초과 판매 없음.

---

## 4. Spring Boot + JPA로 구현

### 4.1 엔티티

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

    @Version
    private Long version;

    public void decreaseStock(int quantity) {
        if (this.stockQuantity < quantity) {
            throw new RuntimeException("재고 부족");
        }
        this.stockQuantity -= quantity;
        if (this.stockQuantity == 0) {
            this.status = ProductStatus.SOLD_OUT;
        }
    }
}
```

재고 차감 로직은 엔티티 내부에 둔다. `stockQuantity < quantity`이면 예외를 던져서 음수를 방지한다.

### 4.2 리포지토리: FOR UPDATE 쿼리

```java
public interface ProductRepository extends JpaRepository<Product, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Product p WHERE p.id = :id")
    Optional<Product> findByIdForUpdate(@Param("id") Long id);
}
```

`@Lock(LockModeType.PESSIMISTIC_WRITE)` — JPA가 실제로 실행하는 SQL은 이렇다:

```sql
SELECT * FROM products WHERE id = ? FOR UPDATE
```

QueryDSL을 쓴다면:

```java
Product product = queryFactory
    .selectFrom(QProduct.product)
    .where(QProduct.product.id.eq(id))
    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
    .fetchOne();
```

어떤 방식이든 결과는 동일하다 — **해당 행에 배타 락을 건다.**

### 4.3 서비스: 락 + 재고 차감

```java
@Service
public class PessimisticLockStockService {
    private final ProductRepository productRepository;

    @Transactional
    public void decreaseStock(Long productId, int quantity) {
        // 1. FOR UPDATE로 행 잠금 + 조회
        Product product = productRepository.findByIdForUpdate(productId)
            .orElseThrow(() -> new RuntimeException("상품 없음"));

        // 2. 재고 차감 (부족하면 예외)
        product.decreaseStock(quantity);

        // 3. 트랜잭션 커밋 시 UPDATE 실행 + 락 해제
    }
}
```

**핵심은 3줄이다:**
1. `findByIdForUpdate` — 행을 잠그고 조회
2. `decreaseStock` — 재고 차감 (엔티티 메서드)
3. `@Transactional` 종료 시 — JPA dirty checking으로 UPDATE 실행, 커밋과 함께 락 해제

---

## 5. 동시성 테스트

"정말 동시에 100명이 요청해도 재고가 정확하게 맞을까?" — 직접 확인한다.

### 5.1 테스트 구조

```java
@SpringBootTest
class PessimisticLockStockConcurrencyTest {

    @Autowired
    PessimisticLockStockService stockService;

    @Autowired
    ProductRepository productRepository;

    @Test
    @DisplayName("100명이 동시에 1개씩 구매하면 재고가 정확히 0이 된다")
    void concurrentPurchase_100users() throws InterruptedException {
        // 재고 100개인 상품 생성
        Product product = productRepository.save(
            new Product("한정판 스니커즈", 100, ProductStatus.ON_SALE)
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

        System.out.println("성공: " + successCount.get());
        System.out.println("실패: " + failCount.get());
        System.out.println("최종 재고: " + updated.getStockQuantity());
        System.out.println("소요 시간: " + elapsed + "ms");

        assertEquals(100, successCount.get());
        assertEquals(0, updated.getStockQuantity());
    }
}
```

**`CountDownLatch`** 는 모든 스레드가 작업을 마칠 때까지 테스트를 대기시킨다. 32개의 스레드 풀에 100개의 작업을 넣어서 동시 요청을 시뮬레이션한다.

### 5.2 테스트 결과

```
=== 비관적 락 (FOR UPDATE) 동시성 테스트 결과 ===
동시 요청 수: 100
성공: 100
실패: 0
최종 재고: 0
소요 시간: 851ms
==========================================
```

**100명이 동시에 요청해도 재고가 정확히 0이 된다.** 초과 판매 없음, 음수 재고 없음.

### 5.3 초과 요청 테스트

재고 100개에 150명이 동시 구매하면?

```
=== 비관적 락 (FOR UPDATE) 초과 요청 테스트 결과 ===
동시 요청 수: 150
성공: 100
실패 (품절): 50
최종 재고: 0
소요 시간: 816ms
==========================================
```

정확히 100명만 성공하고 50명은 품절 처리. **데이터 정합성 완벽.**

---

## 6. 한계: 왜 이것만으로는 부족한가

테스트 결과만 보면 완벽하다. 하지만 실제 서비스에서는 3가지 병목이 발생한다.

### 6.1 직렬화 병목

FOR UPDATE는 **한 번에 하나의 트랜잭션만** 해당 행을 처리할 수 있다.

```
동시 1,000명 → FOR UPDATE → 1명 처리, 999명 대기

트랜잭션 50ms × 1,000명 = 최대 50초 대기
트랜잭션 200ms × 10,000명 = 최대 2,000초(33분) 대기 💀
```

테스트에서는 100명이 851ms에 끝났지만, **실제 서비스에서는 트랜잭션 안에 결제 API 호출, 주문 생성, 이벤트 발행 등이 포함**된다. 트랜잭션이 길어질수록 대기 시간은 급격히 늘어난다.

### 6.2 DB 커넥션 풀 고갈

락을 기다리는 트랜잭션은 **DB 커넥션을 물고 있다.** HikariCP 기본 풀 크기는 10개인데:

```
동시 100명 → FOR UPDATE → 10개 커넥션 전부 락 대기 중
→ 11번째 요청 → 커넥션 없음 → HikariCP timeout → 에러!
```

일반 조회 요청(상품 목록, 마이페이지)도 커넥션을 얻지 못해서 **전체 서비스가 느려진다.**

### 6.3 데드락

하나의 주문에서 여러 상품의 재고를 차감한다면:

| 단계 | TX1 | TX2 | 상태 |
|:---:|------|------|:----:|
| 1 | 상품 A 락 획득 | | |
| 2 | | 상품 B 락 획득 | |
| 3 | 상품 B 락 대기 ⏳ | | |
| 4 | | 상품 A 락 대기 ⏳ | 💀 Deadlock! |

> 데드락 방지법(락 순서 통일, 타임아웃)은 [2편](/blog/db-deadlock-and-lock-strategy-guide)에서 다뤘다.

### 6.4 현실적인 한계선

| 상황 | DB 락으로 괜찮은가? |
|------|:------------------:|
| 사내 이벤트 (동시 50명) | ✅ 충분 |
| 소규모 쇼핑몰 (동시 수백 명) | ⚠️ 커넥션 풀 조정 필요 |
| 한정판 판매 (동시 수천 명) | ❌ Redis 필요 |
| 콘서트 티켓팅 (동시 수만 명) | ❌ 대기열 + Redis 필요 |

---

## 7. 보완: Atomic UPDATE 방식

FOR UPDATE의 대안으로 **락 없이 원자적 UPDATE**를 쓰는 방법도 있다.

```sql
UPDATE products
SET stock_quantity = stock_quantity - 1,
    sales_count = sales_count + 1
WHERE id = 1
AND stock_quantity >= 1
AND status = 'ON_SALE'
```

`WHERE stock_quantity >= 1` 조건으로 음수를 방지한다. 업데이트된 행이 0개면 품절이다.

```java
@Transactional
public void decreaseStockAtomic(Long productId, int quantity) {
    int updated = productRepository.decreaseStockAtomically(productId, quantity);
    if (updated == 0) {
        throw new RuntimeException("재고 부족 또는 상품 없음");
    }
}
```

### FOR UPDATE vs Atomic UPDATE

| 항목 | FOR UPDATE | Atomic UPDATE |
|------|-----------|---------------|
| 락 방식 | 행 락 (배타 락) | 락 없음 (WHERE 조건으로 원자적 처리) |
| 동시성 | 직렬 처리 (한 번에 하나) | 여러 트랜잭션이 동시에 시도 가능 |
| 재고 읽기 | 최신 값을 조회 후 비즈니스 로직 가능 | 현재 재고를 읽을 필요 없음 |
| 복잡한 검증 | 재고 외에 추가 조건 검증 가능 | WHERE 절에 넣을 수 있는 조건만 |
| 성능 | 대기 시간이 길어짐 | 더 빠름 (락 대기 없음) |

**단순 재고 차감**이라면 Atomic UPDATE가 더 효율적이다. 하지만 **"재고를 읽고 → 복잡한 비즈니스 로직을 수행한 뒤 → 차감"** 해야 하는 경우에는 FOR UPDATE가 필요하다.

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **FOR UPDATE의 역할** | 행을 잠그고 다른 트랜잭션의 접근을 차단 |
| **구현 핵심** | `@Lock(PESSIMISTIC_WRITE)` + `@Transactional` |
| **동시성 테스트 결과** | 100명 동시 요청에도 재고 정합성 완벽 |
| **한계** | 직렬화 병목, 커넥션 풀 고갈, 데드락 위험 |
| **현실적 한계선** | 동시 수십 명 수준까지 적합 |
| **보완** | Atomic UPDATE로 단순 차감 성능 개선 가능 |

DB 락은 **동시성 문제의 본질을 이해하기 위한 출발점**이다. 다음 글에서는 DB의 한계를 넘어서 **Redis로 초당 수만 건을 처리하는 방법**을 다룬다.
