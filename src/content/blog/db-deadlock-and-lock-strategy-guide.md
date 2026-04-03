---
title: "격리 수준별 데드락과 락 전략: 비관적 락부터 FOR UPDATE의 한계까지"
description: "Read Committed, Repeatable Read, Serializable 각 격리 수준에서 데드락이 발생하는 실제 케이스를 다룬다. 비관적 락과 낙관적 락의 차이, FOR UPDATE의 동작 원리와 한계까지 정리한다."
pubDate: 2026-03-17T23:50:00+09:00
tags: ["Database", "Deadlock", "Lock", "Transaction", "Spring Boot"]
heroImage: "../../assets/DbDeadlockAndLockStrategyGuide.png"
---

## 서론

[이전 글](/blog/db-isolation-level-guide)에서 격리 수준과 동시성 이상 현상을 다뤘다. 이번 글에서는 한 단계 더 들어가서 — **"그래서 실제로 데드락은 언제 발생하고, 어떻게 막아야 하나?"** 를 다룬다.

"격리 수준을 높이면 안전해지는 거 아니야?" — 반은 맞고 반은 틀리다. 격리 수준을 높이면 이상 현상은 줄어들지만, **락을 더 많이 잡기 때문에 데드락 위험은 오히려 증가**한다.

---

## 1. 데드락이란?

두 트랜잭션이 서로 상대방이 가진 락을 기다리면서 **영원히 진행하지 못하는 상태**다.

| 단계 | TX1 | TX2 | 상태 |
|:---:|------|------|:----:|
| 1 | `UPDATE ... WHERE id = 1` (id=1 락 획득) | | |
| 2 | | `UPDATE ... WHERE id = 2` (id=2 락 획득) | |
| 3 | `UPDATE ... WHERE id = 2` → id=2 락 대기 ⏳ | | |
| 4 | | `UPDATE ... WHERE id = 1` → id=1 락 대기 ⏳ | 💀 Deadlock! |

> **비유**: 좁은 골목에서 두 차가 마주보고 달리는 상황이다. 둘 다 "너 먼저 비켜"라고 하면서 아무도 움직이지 않는다. DB는 이걸 감지하면 **한쪽을 강제 롤백**시켜서 해결한다.

---

## 2. 락의 종류: 공유 락 vs 배타 락

데드락을 이해하려면 먼저 DB가 사용하는 **두 가지 기본 락**을 알아야 한다.

### 2.1 공유 락 (Shared Lock, S Lock)

**"나 읽고 있으니까, 다른 사람도 읽어도 돼. 근데 수정은 안 돼."**

```sql
-- MySQL: 명시적 공유 락
SELECT * FROM accounts WHERE id = 1 FOR SHARE;

-- PostgreSQL: 동일
SELECT * FROM accounts WHERE id = 1 FOR SHARE;

-- SQL Server: 테이블 힌트로 공유 락
SELECT * FROM accounts WITH (HOLDLOCK) WHERE id = 1;
```

```java
// Spring Boot
@Lock(LockModeType.PESSIMISTIC_READ)
@Query("SELECT a FROM Account a WHERE a.id = :id")
Account findByIdForShare(@Param("id") Long id);
```

여러 트랜잭션이 **동시에 공유 락을 획득**할 수 있다. 하지만 공유 락이 걸린 행에 **배타 락을 걸 수는 없다.**

### 2.2 배타 락 (Exclusive Lock, X Lock)

**"나 수정 중이니까, 아무도 읽지도 쓰지도 마."**

```sql
-- MySQL/PostgreSQL: 명시적 배타 락
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;

-- SQL Server: 테이블 힌트로 배타 락
SELECT * FROM accounts WITH (UPDLOCK, HOLDLOCK) WHERE id = 1;

-- UPDATE/DELETE는 자동으로 배타 락 (모든 DB 공통)
UPDATE accounts SET balance = 0 WHERE id = 1;
```

```java
// Spring Boot
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT a FROM Account a WHERE a.id = :id")
Account findByIdForUpdate(@Param("id") Long id);
```

배타 락은 **단 하나의 트랜잭션만** 획득할 수 있다. 다른 트랜잭션은 읽기든 쓰기든 대기해야 한다.

### 2.3 호환성 매트릭스

| | 공유 락 (S) 요청 | 배타 락 (X) 요청 |
|---|:---:|:---:|
| **공유 락 (S) 보유** | ✅ 호환 | ❌ 대기 |
| **배타 락 (X) 보유** | ❌ 대기 | ❌ 대기 |

- **S + S = OK**: 여러 트랜잭션이 동시에 읽기 가능
- **S + X = 대기**: 누군가 읽고 있으면 수정 불가 (읽기 끝날 때까지 대기)
- **X + X = 대기**: 누군가 수정 중이면 다른 수정도 대기

이 호환성이 데드락의 근본 원인이다. 예를 들어 두 트랜잭션이 같은 행에 공유 락을 잡고, 둘 다 배타 락으로 업그레이드하려 하면 — **서로의 공유 락을 기다리며 데드락**이 발생한다 (Serializable 격리 수준에서 정확히 이 패턴이 나온다).

### 2.4 SQL 구문 정리

| 락 종류 | MySQL / PostgreSQL | SQL Server |
|--------|-------------------|------------|
| 공유 락 (S) | `SELECT ... FOR SHARE` | `SELECT ... WITH (HOLDLOCK)` |
| 배타 락 (X) | `SELECT ... FOR UPDATE` | `SELECT ... WITH (UPDLOCK, HOLDLOCK)` |
| 배타 락 (자동) | `UPDATE ...` / `DELETE ...` | `UPDATE ...` / `DELETE ...` |

> - `FOR SHARE`는 MySQL 8.0+에서 도입됐다. 이전 버전에서는 `LOCK IN SHARE MODE`를 사용한다. PostgreSQL은 처음부터 `FOR SHARE`를 지원한다.
> - SQL Server는 `FOR UPDATE` / `FOR SHARE` 구문이 없고, 대신 **테이블 힌트** `WITH (...)` 로 락을 제어한다. `HOLDLOCK`은 트랜잭션 끝까지 락을 유지하고, `UPDLOCK`은 배타 락(업데이트 락)을 건다.

---

## 3. 격리 수준별 데드락 케이스

### 3.1 Read Committed에서의 데드락

Read Committed는 가장 느슨한 편인데도 데드락이 발생한다. 왜? **읽기 시 락을 안 걸 뿐, 쓰기(UPDATE/DELETE)는 여전히 행 락을 잡기 때문이다.**

#### 케이스 1: 교차 업데이트

가장 흔한 패턴이다. 송금 시스템에서 A→B, B→A 이체가 동시에 일어나는 상황:

| 단계 | TX1 (A→B 이체) | TX2 (B→A 이체) | 상태 |
|:---:|-----------|-----------|:----:|
| 1 | `UPDATE balance WHERE id='A'` (A 락 획득) | | |
| 2 | | `UPDATE balance WHERE id='B'` (B 락 획득) | |
| 3 | `UPDATE balance WHERE id='B'` → B 락 대기 ⏳ | | |
| 4 | | `UPDATE balance WHERE id='A'` → A 락 대기 ⏳ | 💀 Deadlock! |

#### 케이스 2: FK 제약 조건으로 인한 암묵적 락

명시적으로 UPDATE하지 않아도 데드락이 발생할 수 있다. FK가 걸린 테이블에 INSERT하면 **부모 테이블에 공유 락**이 걸리기 때문이다:

```sql
-- orders 테이블에 user_id FK가 있다고 가정

-- TX1: 사용자 1의 주문 삽입 → users(id=1)에 공유 락
INSERT INTO orders (user_id, product_id) VALUES (1, 100);

-- TX2: 사용자 1의 정보 수정 → users(id=1)에 배타 락 필요
UPDATE users SET updated_at = now() WHERE id = 1;
-- → TX1의 공유 락과 충돌!
```

> FK가 많은 테이블에서 INSERT와 UPDATE가 동시에 빈번한 경우, 생각지 못한 데드락이 발생할 수 있다.

### 3.2 Repeatable Read에서의 데드락

Repeatable Read는 Read Committed보다 **더 많은 락을 더 오래 잡는다.** MySQL InnoDB에서는 **Gap Lock**이라는 추가 락이 발생해서 데드락 위험이 높아진다.

#### Gap Lock이란?

Gap Lock은 인덱스 레코드 **사이의 간격(gap)** 을 잠그는 락이다. Phantom Read를 방지하기 위해 InnoDB가 Repeatable Read에서 사용한다.

#### Gap의 범위는 어떻게 결정되나?

Gap은 **테이블에 실제 존재하는 인덱스 값**을 기준으로 나뉜다. products 테이블에 id = 1, 5, 10이 존재한다면:

```
(-∞) ... [id=1] ... (2,3,4 비어있음) ... [id=5] ... (6,7,8,9 비어있음) ... [id=10] ... (+∞)
         실제 행        gap (1,5)            실제 행        gap (5,10)            실제 행
```

테이블 데이터가 달라지면 gap도 달라진다. id = 1, 3, 10이 있었다면 gap은 (1,3), (3,10), ...이 된다. **인덱스가 없으면** 테이블 풀스캔이 되어 **전체 범위에 gap lock이 걸린다** — 최악의 상황이다.

#### 예시: BETWEEN 조건의 락 범위

```sql
-- products 테이블: id = 1, 5, 10이 존재

-- TX1: id가 3~7 사이인 행을 조회 (FOR UPDATE)
SELECT * FROM products WHERE id BETWEEN 3 AND 7 FOR UPDATE;
```

InnoDB는 내부적으로 **Next-Key Lock**(레코드 락 + 그 앞의 gap lock)을 사용한다. 실제로 걸리는 락을 정리하면:

| 대상 | 락 종류 | 잠김? | 설명 |
|------|--------|:---:|------|
| id=1 | - | ❌ | 범위 밖, 영향 없음 |
| (1, 5) gap | Gap Lock | 🔒 | INSERT(id=2,3,4) 차단 |
| id=5 | Record Lock | 🔒 | 범위 안의 실제 레코드 |
| (5, 10) gap | Gap Lock | 🔒 | INSERT(id=6,7,8,9) 차단 |
| id=10 | Next-Key Lock 경계 | 🔒 | 스캔 끝점으로 잠길 수 있음 |

```mermaid
graph LR
    subgraph "인덱스 (id)"
        A["id=1"] --- B["gap (2,3,4)"] --- C["id=5"] --- D["gap (6,7,8,9)"] --- E["id=10"]
    end
    style B fill:#ff6b6b,stroke:#333,color:#fff
    style D fill:#ff6b6b,stroke:#333,color:#fff
```

핵심: **존재하지 않는 행(id=3, 4, 6, 7)까지 잠기고, 스캔 경계인 id=10까지 잠길 수 있다.** 예상보다 넓은 범위가 잠기기 때문에 데드락 위험이 높아진다.

#### 케이스: Gap Lock으로 인한 데드락

> products 테이블: id = 1, 5, 10이 존재

| 단계 | TX1 | TX2 | 상태 |
|:---:|------|------|:----:|
| 1 | `SELECT ... WHERE id = 3 FOR UPDATE` → id 1~5 gap 락 획득 | | |
| 2 | | `SELECT ... WHERE id = 7 FOR UPDATE` → id 5~10 gap 락 획득 | |
| 3 | `INSERT (id=8)` → id 5~10 gap 대기 ⏳ | | |
| 4 | | `INSERT (id=2)` → id 1~5 gap 대기 ⏳ | 💀 Deadlock! |

두 트랜잭션이 각각 다른 gap을 잠그고, 상대방의 gap에 INSERT하려다 데드락이 발생한다. **Read Committed에서는 Gap Lock이 없으므로 이 데드락은 발생하지 않는다.**

### 3.3 Serializable에서의 데드락

Serializable은 가장 엄격하고 **가장 데드락이 빈번한** 격리 수준이다.

#### MySQL: 모든 SELECT가 FOR SHARE로 변환

```sql
-- Serializable에서는 이 쿼리가
SELECT balance FROM accounts WHERE id = 1;

-- 내부적으로 이렇게 변환된다
SELECT balance FROM accounts WHERE id = 1 FOR SHARE;
```

읽기만 해도 **공유 락**을 잡기 때문에, 이후 UPDATE 시 배타 락으로 업그레이드할 때 충돌이 빈번하다:

| 단계 | TX1 | TX2 | 상태 |
|:---:|------|------|:----:|
| 1 | `SELECT balance WHERE id=1` (공유 락 획득) | | |
| 2 | | `SELECT balance WHERE id=1` (공유 락 획득) | |
| 3 | `UPDATE balance WHERE id=1` → 배타 락 필요, TX2 공유 락 대기 ⏳ | | |
| 4 | | `UPDATE balance WHERE id=1` → 배타 락 필요, TX1 공유 락 대기 ⏳ | 💀 Deadlock! |

읽기-쓰기 패턴만으로도 데드락이 발생한다. **Serializable에서는 동시성이 극도로 낮아진다.**

#### PostgreSQL: SSI는 다르다

MySQL의 Serializable은 **모든 SELECT에 공유 락**을 걸어서 직렬성을 보장한다. 읽기만 해도 락이 걸리니 동시성이 극도로 낮아지고, 위 예시처럼 데드락이 빈번하다.

PostgreSQL은 완전히 다른 접근을 한다. **SSI(Serializable Snapshot Isolation)** 라는 방식으로, 락을 걸지 않고 트랜잭션을 일단 실행한 뒤 커밋 시점에 충돌을 감지한다.

**동작 원리:**

1. 각 트랜잭션은 **스냅샷을 읽는다** (락 없음, MVCC와 동일)
2. PostgreSQL이 **"누가 무엇을 읽고 무엇을 썼는지"** 를 추적한다
3. 커밋 시점에 **"이 트랜잭션들이 순서대로 실행됐다면 같은 결과가 나왔을까?"** 를 검사한다
4. 결과가 달라질 수 있으면 → 한쪽을 롤백시킨다

```
[MySQL Serializable]
TX1: SELECT → 공유 락 🔒 → TX2 대기 ⏳ → TX1 완료 → TX2 실행
→ 락으로 직렬화 (느림, 데드락 위험)

[PostgreSQL SSI]
TX1: SELECT → 스냅샷 읽기 (락 없음)
TX2: SELECT → 스냅샷 읽기 (락 없음, 동시에 실행)
TX1: COMMIT → OK
TX2: COMMIT → 충돌 감지 → 롤백!
→ 충돌 감지로 직렬화 (빠름, 데드락 없음, 대신 재시도 필요)
```

**MySQL과의 차이:**

| 항목 | MySQL (락 기반) | PostgreSQL (SSI) |
|------|---------------|-----------------|
| 읽기 시 | 공유 락 → 다른 TX 쓰기 대기 | 락 없음 → 동시 실행 |
| 충돌 해결 | 데드락 → DB가 한쪽 롤백 | 직렬화 실패 → 한쪽 롤백 |
| 동시성 | 낮음 (읽기도 대기) | 높음 (읽기 동시 가능) |
| 에러 | `Deadlock found` | `could not serialize access` |

PostgreSQL SSI에서 발생하는 에러:

```
ERROR: could not serialize access due to concurrent update
```

데드락은 아니지만 한쪽 트랜잭션이 롤백되므로, 재시도 로직이 반드시 필요하다.

#### 참고: SSI의 충돌 감지는 어떻게 동작하나?

SSI는 **rw-dependency(읽기-쓰기 의존성)** 를 추적한다. TX1이 읽은 데이터를 TX2가 수정하면 "TX1 → TX2" 의존성이 생기는데, 이걸 **rw-conflict**라고 한다.

```sql
TX1: SELECT * FROM accounts WHERE id = 1;  -- 잔액 100 읽음
TX2: UPDATE accounts SET balance = 50 WHERE id = 1;  -- 잔액 수정
-- → rw-conflict: TX1이 읽은 걸 TX2가 바꿈 (TX1 → TX2)
```

rw-conflict가 하나뿐이면 괜찮다. **두 트랜잭션이 서로의 읽기를 수정하는 순환 구조**가 되면 롤백한다.

```
[안전 — 한 방향]
TX1 읽기 → TX2 쓰기
→ TX1이 먼저 실행된 것으로 간주하면 결과 동일 → OK

[위험 — 순환 (rw-antidependency cycle)]
TX1 읽기 → TX2 쓰기
TX2 읽기 → TX1 쓰기
→ TX1이 먼저? TX2가 먼저? 어떤 순서로도 같은 결과 불가능 → 롤백!
```

구체적 예시:

```sql
-- accounts: Alice 잔액 100, Bob 잔액 100

-- TX1
SELECT sum(balance) FROM accounts;  -- 200 읽음
UPDATE accounts SET balance = 50 WHERE name = 'Alice';

-- TX2 (동시에)
SELECT sum(balance) FROM accounts;  -- 200 읽음
UPDATE accounts SET balance = 50 WHERE name = 'Bob';

-- TX1 COMMIT → OK
-- TX2 COMMIT → 직렬화 실패! 롤백!
```

왜 롤백인가?
- TX1→TX2 순서였다면: TX1이 Alice를 50으로 바꾼 후 TX2가 sum = **150**을 읽었어야 한다
- TX2→TX1 순서였다면: TX2가 Bob을 50으로 바꾼 후 TX1이 sum = **150**을 읽었어야 한다
- 하지만 **둘 다 200을 읽었다** → 어떤 순서로든 재현 불가능 → 직렬화 위반

PostgreSQL은 내부적으로 **SIRead Lock(predicate lock)** 이라는 가벼운 마커를 사용한다. 실제로 행을 잠그지 않고 **"이 트랜잭션이 이 범위를 읽었다"를 기록만** 한다.

| 항목 | 일반 Lock | SIRead Lock |
|------|----------|-------------|
| 다른 TX 차단 | O (대기 발생) | **X (차단 안 함)** |
| 역할 | 동시 접근 방지 | 읽기 범위 기록 |
| 오버헤드 | 대기 시간 | 메모리 (추적 정보 저장) |

SSI는 **낙관적 락과 비슷한 철학**이다. 일단 동시에 실행하고, 문제가 있으면 나중에 롤백한다.

---

## 4. 비관적 락 vs 낙관적 락

데드락과 동시성을 다루는 두 가지 철학이 있다.

### 4.1 비관적 락 (Pessimistic Lock)

**"충돌이 발생할 거라고 가정하고, 미리 잠근다."**

```sql
BEGIN;
SELECT * FROM products WHERE id = 1 FOR UPDATE;  -- 먼저 잠금!
-- 다른 트랜잭션은 이 행을 읽지도 수정하지도 못함
UPDATE products SET stock = stock - 1 WHERE id = 1;
COMMIT;
```

```java
// Spring Boot
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT p FROM Product p WHERE p.id = :id")
Product findByIdForUpdate(@Param("id") Long id);
```

| 장점 | 단점 |
|------|------|
| 충돌 시 데이터 정합성 확실 | 동시성 낮음 (락 대기) |
| 구현이 단순 | 데드락 위험 |
| | 커넥션 점유 시간 증가 |

**적합한 경우**: 충돌이 자주 발생하는 경우 (재고 차감, 좌석 선택)

### 4.2 낙관적 락 (Optimistic Lock)

**"충돌이 드물다고 가정하고, 일단 진행한 뒤 충돌을 감지한다."**

테이블에 `version` 컬럼을 추가하고, UPDATE 시 버전이 변경되었는지 확인한다:

```sql
-- 1. 읽기 (락 없음)
SELECT id, stock, version FROM products WHERE id = 1;
-- → stock=10, version=3

-- 2. 수정 시도 (version 확인)
UPDATE products
SET stock = 9, version = 4
WHERE id = 1 AND version = 3;
-- → 영향받은 행이 0이면? 다른 트랜잭션이 먼저 수정한 것 → 재시도
```

```java
// Spring Boot - @Version 애노테이션
@Entity
public class Product {
    @Id
    private Long id;
    private int stock;

    @Version
    private Long version;  // JPA가 자동으로 관리
}
```

```java
// 재시도 로직
@Retryable(value = OptimisticLockingFailureException.class, maxAttempts = 3)
@Transactional
public void deductStock(Long productId) {
    Product product = productRepository.findById(productId).orElseThrow();
    if (product.getStock() <= 0) throw new SoldOutException();
    product.decreaseStock();
    // COMMIT 시 version 불일치하면 OptimisticLockingFailureException 발생 → 재시도
}
```

| 장점 | 단점 |
|------|------|
| 락을 안 잡아서 동시성 높음 | 충돌 시 재시도 비용 |
| 데드락 없음 | 충돌이 잦으면 재시도 폭발 |
| 커넥션 점유 짧음 | 재시도 로직 구현 필요 |

**적합한 경우**: 충돌이 드문 경우 (게시글 수정, 설정 변경)

### 4.3 어떤 걸 써야 하나?

```mermaid
graph TD
    A["동시 수정이 자주 발생하나?"] -->|자주| B["비관적 락 FOR UPDATE"]
    A -->|드물게| C["낙관적 락 @Version"]
    B --> D["트래픽이 높나?"]
    D -->|높음| E["Redis / 대기열 검토 → Phase 2"]
    D -->|보통| F["FOR UPDATE로 충분"]
```

| 상황 | 추천 |
|------|------|
| 재고 차감, 좌석 선택 | 비관적 락 (`FOR UPDATE`) |
| 게시글 수정, 프로필 업데이트 | 낙관적 락 (`@Version`) |
| 초당 수천 건 이상 동시 접근 | Redis (다음 시리즈) |

---

## 5. 데드락 방지 전략

### 5.1 락 순서 통일

데드락의 근본 원인은 **다른 순서로 락을 잡는 것**이다. 항상 같은 순서로 잠그면 교차가 발생하지 않는다.

```java
// 나쁜 예: 순서가 보장되지 않음
public void transfer(Long fromId, Long toId, int amount) {
    Account from = accountRepo.findByIdForUpdate(fromId);  // fromId 락
    Account to = accountRepo.findByIdForUpdate(toId);      // toId 락
}

// 좋은 예: ID 오름차순으로 항상 정렬
public void transfer(Long fromId, Long toId, int amount) {
    Long firstId = Math.min(fromId, toId);
    Long secondId = Math.max(fromId, toId);

    Account first = accountRepo.findByIdForUpdate(firstId);   // 항상 작은 ID 먼저
    Account second = accountRepo.findByIdForUpdate(secondId);  // 항상 큰 ID 나중에

    // 이후 from/to 판별해서 이체 로직 수행
}
```

### 5.2 락 타임아웃 설정

영원히 기다리지 않도록 타임아웃을 건다.

```sql
-- MySQL: 3초 후 락 대기 포기
SET innodb_lock_wait_timeout = 3;

-- PostgreSQL: 3초 후 포기
SET lock_timeout = '3s';
```

```java
// Spring Boot에서 JPA 힌트로 설정
@QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "3000"))
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT p FROM Product p WHERE p.id = :id")
Product findByIdForUpdate(@Param("id") Long id);
```

#### 타임아웃은 어떻게 결정하나?

DB 기본값은 대부분 너무 길다. MySQL은 50초, PostgreSQL은 무제한이다. **"정상 처리 시간의 2~3배"** 가 일반적인 기준이다.

| 상황 | 정상 처리 시간 | 권장 타임아웃 | 이유 |
|------|-------------|------------|------|
| 재고 차감 (단순) | ~50ms | **1~3초** | 짧은 트랜잭션, 오래 기다리면 커넥션 낭비 |
| 주문 생성 (복잡) | ~200ms | **3~5초** | 여러 테이블 접근, 약간의 여유 |
| 결제 처리 (외부 API 포함) | ~2초 | **5~10초** | 외부 API 지연 감안 |
| 배치/정산 | ~10초 | **30~60초** | 대량 처리, 긴 트랜잭션 허용 |

결정할 때 가장 중요한 3가지:

**1. 커넥션 풀 크기와의 관계**

```
HikariCP maxPoolSize: 10
락 타임아웃: 30초

→ 최악의 경우: 10개 커넥션이 전부 30초씩 대기
→ 300초(5분) 동안 다른 요청 처리 불가 💀
```

타임아웃이 길수록 커넥션 고갈 위험이 커진다. **커넥션 풀이 작으면 타임아웃도 짧게** 설정해야 한다.

**2. 사용자 경험**

API 응답 시간이 3초를 넘으면 사용자가 떠난다. 락 타임아웃 5초 + 비즈니스 로직 1초 = 최악 6초 응답이다. 선착순 같은 빠른 응답이 필요한 경우 **1~2초**가 적절하다.

**3. 재시도 전략과의 조합**

```
타임아웃 3초 × 재시도 3회 = 최대 9초
타임아웃 1초 × 재시도 3회 = 최대 3초  ← 더 나은 UX
```

타임아웃을 짧게 잡고 재시도 횟수로 보완하는 게 보통 더 낫다. 빠르게 실패하고 빠르게 재시도하는 편이 오래 기다리는 것보다 성공 확률도 높다.

> 한 줄 요약: **선착순 시스템이면 1~3초, 일반 서비스면 3~5초, 배치면 30~60초.**

### 5.3 재시도 로직

데드락은 완전히 막을 수 없다. DB가 데드락을 감지하면 한쪽을 롤백하는데, **롤백된 쪽이 재시도**하면 된다.

```java
@Retryable(
    value = {DeadlockLoserDataAccessException.class, CannotAcquireLockException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 100, multiplier = 2)  // 100ms, 200ms, 400ms
)
@Transactional
public void deductStock(Long productId) {
    Product product = productRepository.findByIdForUpdate(productId);
    if (product.getStock() <= 0) throw new SoldOutException();
    product.decreaseStock();
}
```

> **주의**: `@Retryable`은 `@Transactional`보다 바깥에 있어야 한다. 트랜잭션이 롤백된 후 새 트랜잭션으로 재시도해야 하기 때문이다. 같은 클래스 내 호출이면 프록시 문제로 동작하지 않을 수 있다.

### 5.4 트랜잭션을 짧게

락 보유 시간이 길수록 데드락 확률이 올라간다. 트랜잭션 안에서 **외부 API 호출, 파일 I/O, 무거운 연산**을 하지 않는다.

```java
// 나쁜 예: 트랜잭션 안에서 외부 API 호출
@Transactional
public void processOrder(Long productId) {
    Product p = productRepo.findByIdForUpdate(productId);  // 락 획득
    p.decreaseStock();
    externalPaymentApi.charge(order);  // 💀 외부 API가 3초 걸리면 락도 3초 유지
    emailService.sendConfirmation(order);  // 💀 추가 지연
}

// 좋은 예: 트랜잭션은 DB 작업만
@Transactional
public void deductStock(Long productId) {
    Product p = productRepo.findByIdForUpdate(productId);
    p.decreaseStock();
}

// 외부 호출은 트랜잭션 밖에서
public void processOrder(Long productId) {
    deductStock(productId);  // 트랜잭션 짧게
    externalPaymentApi.charge(order);  // 락 해제된 후
    emailService.sendConfirmation(order);
}
```

---

## 6. REPEATABLE READ만으로 재고 차감이 안전한가?

1편에서 다룬 질문을 여기서 명확히 답한다.

### 답: 안전하지 않다 (MySQL 기준)

Repeatable Read는 **"읽은 값이 바뀌지 않는다"** 는 보장이지, **"동시에 수정하는 걸 막아준다"** 는 보장이 아니다.

| 단계 | TX1 (주문 A) | TX2 (주문 B) | 재고 |
|:---:|-----------|-----------|:----:|
| 1 | `SELECT stock` → **1** (스냅샷) | | 1 |
| 2 | | `SELECT stock` → **1** (스냅샷) | 1 |
| 3 | `UPDATE stock = 0` (1-1) | | 0 |
| 4 | `COMMIT` | | 0 |
| 5 | | `UPDATE stock = -1` (1로 알고 있으므로 1-1) 💀 | -1 |
| 6 | | `COMMIT` | -1 |

재고가 음수! **Lost Update** 발생.

### FOR UPDATE를 추가하면 해결된다

| 단계 | TX1 (주문 A) | TX2 (주문 B) | 재고 |
|:---:|-----------|-----------|:----:|
| 1 | `SELECT stock FOR UPDATE` → **1** (행 락 획득) | | 1 |
| 2 | | `SELECT stock FOR UPDATE` → 락 대기 ⏳ | 1 |
| 3 | `UPDATE stock = 0` | | 0 |
| 4 | `COMMIT` (락 해제) | | 0 |
| 5 | | → **0** (최신 값!) → 품절 처리 | 0 |
| 6 | | `ROLLBACK` | 0 |

### 격리 수준은 중요하지 않다

`FOR UPDATE`를 쓰면 **Read Committed에서도 Repeatable Read에서도 동일하게 동작**한다. 락이 핵심이지 격리 수준이 핵심이 아니다.

```java
// 이 두 코드의 재고 차감 동작은 사실상 동일
@Transactional(isolation = Isolation.READ_COMMITTED)
public void deductStock(Long id) {
    Product p = repo.findByIdForUpdate(id);  // FOR UPDATE가 핵심
    if (p.getStock() <= 0) throw new SoldOutException();
    p.decreaseStock();
}

@Transactional(isolation = Isolation.REPEATABLE_READ)
public void deductStock(Long id) {
    Product p = repo.findByIdForUpdate(id);  // 위와 동일하게 동작
    if (p.getStock() <= 0) throw new SoldOutException();
    p.decreaseStock();
}
```

**실무 권장: `Isolation.DEFAULT` + `FOR UPDATE`** — DB 기본값 그대로 두고 명시적 락으로 제어.

---

## 7. FOR UPDATE의 한계

FOR UPDATE는 재고 차감 문제를 해결하지만, **트래픽이 높아지면 3가지 병목**이 생긴다.

### 7.1 동시 요청 직렬화

```
동시 100명 → FOR UPDATE → 1명만 처리, 99명 대기 → 순서대로 1명씩

TPS 예시:
  트랜잭션 처리 시간 50ms × 100명 = 최대 5초 대기
  트랜잭션 처리 시간 200ms × 1000명 = 최대 200초 대기 💀
```

### 7.2 데드락 위험

하나의 주문에서 재고 차감 + 쿠폰 사용 + 포인트 차감을 한다면, 여러 행을 잠그게 되고 데드락 가능성이 높아진다.

### 7.3 DB 커넥션 풀 고갈

락 대기 중인 트랜잭션은 **DB 커넥션을 물고 있다.** 일반적으로 HikariCP 기본 풀 크기는 10개인데, 10개가 전부 락 대기 중이면 새로운 요청은 커넥션조차 얻지 못한다.

```
[요청 101] → 커넥션 풀 비어있음 → HikariCP timeout → 에러!
```

### 그래서 다음 단계가 필요하다

| 한계 | 대안 |
|------|------|
| 직렬화 병목 | Redis 원자 연산 (DECR) — 락 없이 초당 수만 건 처리 |
| 데드락 | Redis Lua 스크립트 — 단일 스레드로 원자적 실행 |
| 커넥션 고갈 | 대기열 시스템 — DB 접근 자체를 줄임 |

**이 내용이 다음 시리즈(Phase 2: 선착순 시스템 설계)의 출발점이 된다.**

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **데드락은 모든 격리 수준에서 발생** | 쓰기 락은 격리 수준과 무관하게 존재 |
| **격리 수준이 높을수록 데드락 위험 증가** | Gap Lock (Repeatable Read), 공유 락 (Serializable) |
| **비관적 락 vs 낙관적 락** | 충돌 빈번 → 비관적 락, 충돌 드묾 → 낙관적 락 |
| **데드락 방지 4원칙** | 락 순서 통일, 타임아웃, 재시도, 트랜잭션 짧게 |
| **재고 차감의 핵심은 FOR UPDATE** | 격리 수준이 아니라 명시적 락이 안전성을 보장 |
| **FOR UPDATE의 한계** | 직렬화 병목, 데드락, 커넥션 고갈 → Redis/대기열 필요 |

다음 글부터는 **Phase 2: 선착순 시스템 설계** 시리즈로 넘어간다. DB 락의 한계를 넘어서 Redis, 메시지 큐, 토큰 발급 등 다양한 방식으로 선착순 시스템을 구현해본다.
