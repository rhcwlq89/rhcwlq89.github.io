---
title: "트랜잭션 격리 수준 완전 정리: Read Uncommitted부터 Serializable까지"
description: "DB 트랜잭션 격리 수준 4가지를 실무 예시로 설명한다. 각 레벨에서 어떤 동시성 문제가 발생하고, MySQL과 PostgreSQL에서 기본값이 왜 다른지까지 다룬다."
pubDate: 2026-03-17T22:30:00+09:00
tags: ["Database", "Transaction", "Isolation Level", "MySQL", "PostgreSQL"]
heroImage: "../../assets/DbIsolationLevelGuide.png"
---

## 서론

"트랜잭션 격리 수준이 뭐예요?" — 면접에서도 자주 나오고, 실무에서도 동시성 버그의 원인이 되는 주제다. 하지만 공식 문서만 보면 용어가 어렵고 와닿지 않는다.

이 글에서는 **은행 계좌 이체**라는 하나의 시나리오로 4가지 격리 수준을 전부 설명한다. "이 레벨에서는 이런 문제가 생기고, 저 레벨에서는 안 생긴다"를 직접 느낄 수 있도록 구성했다.

---

## 1. 트랜잭션이란?

격리 수준을 이해하려면 먼저 트랜잭션이 뭔지 알아야 한다.

트랜잭션은 **"다 되거나, 아무것도 안 되거나"** 를 보장하는 작업 단위다.

```sql
-- 계좌 이체: A → B로 10만원
BEGIN;
UPDATE accounts SET balance = balance - 100000 WHERE id = 'A';  -- A에서 차감
UPDATE accounts SET balance = balance + 100000 WHERE id = 'B';  -- B에 입금
COMMIT;
```

첫 번째 UPDATE만 성공하고 두 번째가 실패하면? A의 돈은 사라졌는데 B에는 안 들어간 상태가 된다. 트랜잭션은 이걸 방지한다 — 둘 다 성공하거나, 둘 다 취소(ROLLBACK)된다.

### ACID 한 줄 요약

| 속성 | 의미 | 비유 |
|------|------|------|
| **Atomicity** (원자성) | 전부 성공 or 전부 실패 | 택배가 반만 도착하는 일은 없다 |
| **Consistency** (일관성) | 트랜잭션 전후로 데이터 규칙이 유지됨 | 잔고가 음수가 되면 안 된다 |
| **Isolation** (격리성) | 동시 트랜잭션이 서로 간섭하지 않음 | ATM 2대로 동시에 출금해도 꼬이지 않음 |
| **Durability** (지속성) | 커밋된 데이터는 영구 저장 | 정전돼도 입금 기록은 남아 있음 |

오늘 다루는 건 이 중에서 **Isolation (격리성)** 이다. "동시에 여러 트랜잭션이 실행될 때, 서로 얼마나 보이게 할 것인가?"가 격리 수준의 핵심이다.

---

## 2. 왜 격리 수준이 필요한가?

완벽한 격리(= 하나씩 순서대로 실행)는 가능하지만, **느리다.**

```
사용자 A 트랜잭션 완료 → 사용자 B 트랜잭션 시작 → 완료 → 사용자 C 시작 → ...
```

동시 접속자 1,000명이면 999명은 기다려야 한다. 현실적이지 않다.

그래서 **"어느 정도의 간섭은 허용하는 대신 성능을 올리자"** 라는 트레이드오프가 생겼고, 그 정도를 정한 게 **격리 수준(Isolation Level)** 이다.

격리가 높을수록 안전하지만 느리고, 낮을수록 빠르지만 이상한 현상이 발생할 수 있다.

```
낮음 ◄──────────────────────────────► 높음
빠름                                    느림
위험                                    안전

Read Uncommitted → Read Committed → Repeatable Read → Serializable
```

---

## 3. 동시성에서 발생하는 이상 현상

격리 수준을 이해하려면, 먼저 **"격리가 부족하면 어떤 문제가 생기는가?"** 를 알아야 한다. 모든 예시는 **A 계좌 잔액 100만원** 상태에서 시작한다.

### 3.1 Dirty Read (더티 리드)

**커밋되지 않은 데이터를 다른 트랜잭션이 읽는 것.**

| 단계 | TX1 (이체) | TX2 (조회) | A 잔액 |
|:---:|-----------|-----------|:------:|
| 1 | `UPDATE balance = 0` (커밋 안 함) | | 100만→0 |
| 2 | | `SELECT balance` → **0원** 💀 | 0 |
| 3 | `ROLLBACK` | | 100만 |
| 4 | | 0원 기준으로 잘못된 판단 | 100만 |

트랜잭션 1이 롤백했는데, 트랜잭션 2는 이미 0원을 읽었다. **존재한 적 없는 데이터**를 본 것이다.

> **비유**: 선생님이 시험 점수를 고치고 있는데(아직 확정 전) 옆에서 누가 그 점수를 읽어간 것과 같다.

### 3.2 Non-Repeatable Read (반복 불가능 읽기)

**같은 트랜잭션에서 같은 데이터를 두 번 읽었는데 값이 다른 것.**

| 단계 | TX1 (조회) | TX2 (수정) | A 잔액 |
|:---:|-----------|-----------|:------:|
| 1 | `SELECT balance` → **100만원** | | 100만 |
| 2 | | `UPDATE balance = 50만` | 100만→50만 |
| 3 | | `COMMIT` | 50만 |
| 4 | `SELECT balance` → **50만원** 💀 값이 바뀌었다! | | 50만 |

같은 SELECT를 두 번 실행했는데 결과가 다르다. 트랜잭션 1 입장에서는 "내가 읽는 사이에 누가 바꿔버렸네?"가 된다.

> **비유**: 책을 읽다가 잠시 화장실 다녀왔더니 누가 페이지 내용을 고쳐놓은 것과 같다.

### 3.3 Phantom Read (팬텀 리드)

**같은 조건으로 조회했는데 결과 집합이 달라지는 것.** INSERT, UPDATE, DELETE 모두 원인이 될 수 있다.

#### INSERT로 인한 Phantom Read

| 단계 | TX1 (조회) | TX2 (삽입) | 결과 |
|:---:|-----------|-----------|:------:|
| 1 | `SELECT count(*) WHERE balance > 50만` → **3건** | | 3건 |
| 2 | | `INSERT ('D', 80만)` | |
| 3 | | `COMMIT` | |
| 4 | `SELECT count(*) WHERE balance > 50만` → **4건** 💀 없던 행이 나타남! | | 4건 |

#### Phantom Read 원인 요약

| 원인 | 현상 | 예시 |
|------|------|------|
| **INSERT** | 없던 행이 유령처럼 나타남 | 새 계좌 D(80만) 추가 → 3건→4건 |
| **UPDATE** | 조건에 안 맞던 행이 조건에 맞게 변함 (또는 반대) | D 잔액 30만→80만 → 3건→4건 |
| **DELETE** | 있던 행이 사라짐 | C(70만) 삭제 → 3건→2건 |

> **비유**: 교실에서 안경 쓴 학생 수를 세고 돌아섰는데 — 새 학생이 들어왔거나(INSERT), 안 쓰던 학생이 안경을 썼거나(UPDATE), 쓰고 있던 학생이 나갔거나(DELETE).

### 3.4 Lost Update (갱신 손실)

**두 트랜잭션이 동시에 같은 데이터를 수정해서 한쪽의 변경이 사라지는 것.**

| 단계 | TX1 (출금 30만) | TX2 (출금 20만) | A 잔액 |
|:---:|-----------|-----------|:------:|
| 1 | `SELECT balance` → **100만원** | | 100만 |
| 2 | | `SELECT balance` → **100만원** | 100만 |
| 3 | `UPDATE balance = 70만` (100-30) | | 70만 |
| 4 | `COMMIT` | | 70만 |
| 5 | | `UPDATE balance = 80만` (100-20) 💀 TX1이 70만으로 바꾼 걸 모름! | 80만 |
| 6 | | `COMMIT` | 80만 |

최종 잔액: **80만원** (정상이라면 50만원 = 100-30-20). 트랜잭션 1의 30만원 차감이 완전히 사라졌다. 선착순 시스템에서 재고 차감할 때 이런 일이 발생하면, **재고가 0인데 주문이 더 들어가는** 사고가 난다.

---

## 4. 격리 수준 4가지

### 4.1 Read Uncommitted (레벨 0)

**가장 느슨한 격리.** 다른 트랜잭션의 커밋되지 않은 변경까지 읽을 수 있다.

```sql
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
```

| 현상 | 발생 여부 |
|------|----------|
| Dirty Read | O |
| Non-Repeatable Read | O |
| Phantom Read | O |

> 실무에서 이 레벨을 쓰는 경우는 **거의 없다.** "대략적인 통계를 빠르게 보고 싶다"는 극단적인 경우에만 쓰인다. MySQL에서도 기본값이 아니다.

### 4.2 Read Committed (레벨 1)

**커밋된 데이터만 읽을 수 있다.** Dirty Read는 방지하지만, 같은 트랜잭션에서 같은 데이터를 두 번 읽으면 값이 달라질 수 있다.

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

| 현상 | 발생 여부 |
|------|----------|
| Dirty Read | X |
| Non-Repeatable Read | O |
| Phantom Read | O |

> **PostgreSQL, Oracle의 기본값**이다. 대부분의 웹 서비스에서 이 정도면 충분하다.

#### 동작 원리: 매번 최신 스냅샷

Read Committed는 SELECT를 실행할 때마다 **그 시점의 최신 커밋된 데이터**를 읽는다.

```
t1: 트랜잭션 시작
t2: SELECT → 시점 t2의 커밋된 데이터
t3: (다른 트랜잭션이 커밋)
t4: SELECT → 시점 t4의 커밋된 데이터 (t3의 변경 반영됨!)
```

그래서 같은 트랜잭션 안에서도 SELECT 결과가 달라질 수 있다 (Non-Repeatable Read).

### 4.3 Repeatable Read (레벨 2)

**트랜잭션이 시작된 시점의 스냅샷을 끝까지 유지한다.** 같은 SELECT를 여러 번 실행해도 항상 같은 결과를 보장한다.

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

| 현상 | 발생 여부 |
|------|----------|
| Dirty Read | X |
| Non-Repeatable Read | X |
| Phantom Read | △ (DB마다 다름) |

> **MySQL(InnoDB)의 기본값**이다. InnoDB는 MVCC + Next-Key Lock으로 Phantom Read까지 대부분 방지한다.

#### 동작 원리: 트랜잭션 시작 시점 스냅샷 고정

```
t1: 트랜잭션 시작 → 이 시점의 스냅샷 고정!
t2: SELECT → t1 시점의 데이터
t3: (다른 트랜잭션이 커밋)
t4: SELECT → 여전히 t1 시점의 데이터 (t3의 변경이 안 보임!)
```

Read Committed와의 결정적 차이: **스냅샷을 고정하는 시점**이다.

```
Read Committed:   SELECT마다 새 스냅샷
Repeatable Read:  트랜잭션 시작 시 스냅샷 고정, 끝까지 유지
```

#### MySQL vs PostgreSQL의 Repeatable Read 차이

이 부분이 중요하다. 같은 "Repeatable Read"인데 DB마다 동작이 다르다:

| | MySQL (InnoDB) | PostgreSQL |
|--|---------------|------------|
| **Phantom Read 방지** | O (Next-Key Lock) | O (SSI 아님, 스냅샷으로 방지) |
| **Lost Update 방지** | X (별도 락 필요) | O (첫 번째 업데이트 우선, 나머지 에러) |
| **구현 방식** | MVCC + Gap Lock | MVCC (스냅샷 기반) |

MySQL에서 Repeatable Read를 쓰더라도 Lost Update를 방지하려면 `SELECT ... FOR UPDATE`로 명시적 락을 걸어야 한다.

### 4.4 Serializable (레벨 3)

**가장 엄격한 격리.** 트랜잭션들이 마치 하나씩 순서대로 실행되는 것처럼 동작한다.

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

| 현상 | 발생 여부 |
|------|----------|
| Dirty Read | X |
| Non-Repeatable Read | X |
| Phantom Read | X |

모든 이상 현상이 차단된다. 하지만 대가가 크다:

```
성능: Read Committed 대비 5~10배 느려질 수 있음
동시성: 트랜잭션 간 충돌 시 한쪽이 롤백됨
```

> **금융 정산, 좌석 배정** 등 정확성이 생명인 시스템에서만 사용한다. 일반 웹 서비스에서는 오버킬이다.

#### MySQL vs PostgreSQL의 Serializable 차이

| | MySQL (InnoDB) | PostgreSQL |
|--|---------------|------------|
| **구현 방식** | 모든 SELECT를 `SELECT ... FOR SHARE`로 변환 (락 기반) | SSI (Serializable Snapshot Isolation, 낙관적) |
| **특징** | 락을 많이 잡아서 데드락 위험 증가 | 충돌 감지 후 롤백, 락을 덜 잡음 |

---

## 5. 격리 수준별 요약 비교

| 격리 수준 | Dirty Read | Non-Repeatable Read | Phantom Read | 성능 |
|-----------|-----------|-------------------|-------------|------|
| **Read Uncommitted** | O | O | O | 가장 빠름 |
| **Read Committed** | X | O | O | 빠름 |
| **Repeatable Read** | X | X | △ | 보통 |
| **Serializable** | X | X | X | 느림 |

### 기본값이 왜 다를까?

| DB | 기본 격리 수준 | 이유 |
|----|--------------|------|
| **MySQL (InnoDB)** | Repeatable Read | 바이너리 로그 기반 복제에서 일관성 보장을 위해 |
| **PostgreSQL** | Read Committed | MVCC가 충분히 강력해서 대부분의 경우 이것으로 충분 |
| **Oracle** | Read Committed | 높은 동시성 환경에서의 성능 우선 |
| **SQL Server** | Read Committed | Oracle과 동일한 이유. 단, RCSI 옵션으로 동작 변경 가능 |

<details>
<summary>Read Committed Snapshot Isolation (RCSI) 상세 비교 (클릭하여 펼치기)</summary>

### Read Committed Snapshot Isolation (RCSI)

표준 SQL에는 없지만, 실무에서 자주 만나는 변형이 있다 — **Read Committed Snapshot Isolation (RCSI)**.

일반 Read Committed는 **락 기반**이다. 다른 트랜잭션이 쓰고 있는 행을 읽으려면 **락이 풀릴 때까지 기다려야** 한다:

**일반 Read Committed (락 기반)**

| 단계 | TX1 (수정) | TX2 (조회) | 비고 |
|:---:|-----------|-----------|:------:|
| 1 | `UPDATE balance = 0` (락 획득) | | |
| 2 | | `SELECT balance` → 락 대기... ⏳ | 블로킹 |
| 3 | `COMMIT` (락 해제) | | |
| 4 | | → **0원** (이제야 읽을 수 있음) | |

RCSI는 이 문제를 해결한다. **읽기 시 락을 걸지 않고, 커밋된 마지막 버전의 스냅샷을 읽는다:**

**RCSI (스냅샷 기반)**

| 단계 | TX1 (수정) | TX2 (조회) | 비고 |
|:---:|-----------|-----------|:------:|
| 1 | `UPDATE balance = 0` (락 획득) | | |
| 2 | | `SELECT balance` → **100만원** (변경 전 커밋된 값) | 대기 없음! |
| 3 | `COMMIT` | | |

핵심 차이:

| | 일반 Read Committed | RCSI |
|--|-------------------|------|
| **읽기 시 락** | 공유 락 사용 (쓰기 락과 충돌) | 락 없음 (스냅샷 읽기) |
| **읽기 vs 쓰기** | 서로 블로킹 | 서로 블로킹 안 함 |
| **동시성** | 낮음 | 높음 |
| **오버헤드** | 락 관리 | tempdb에 버전 저장 |

#### DB별 지원 현황

| DB | RCSI 지원 | 설정 방법 |
|----|----------|----------|
| **SQL Server** | O (DB 옵션) | `ALTER DATABASE mydb SET READ_COMMITTED_SNAPSHOT ON` |
| **PostgreSQL** | 기본 동작 | MVCC로 항상 스냅샷 읽기 (별도 설정 불필요) |
| **Oracle** | 기본 동작 | Undo 세그먼트로 항상 스냅샷 읽기 |
| **MySQL (InnoDB)** | 기본 동작 | MVCC로 Read Committed에서도 스냅샷 읽기 |

> **중요**: PostgreSQL, Oracle, MySQL은 Read Committed에서 이미 RCSI처럼 동작한다 (읽기 시 락을 안 건다). **SQL Server만 기본적으로 락 기반**이라서, RCSI를 명시적으로 켜야 한다. SQL Server를 쓰는 프로젝트라면 RCSI 활성화를 적극 고려해야 한다.

</details>

---

## 6. 실무에서 어떻게 선택하나?

### 대부분의 웹 서비스 → Read Committed

게시판, 쇼핑몰, 일반 API 서버. 대부분의 경우 이것으로 충분하다. PostgreSQL을 쓰면 기본값이므로 별도 설정이 필요 없다.

### 정합성이 중요한 비즈니스 로직 → Repeatable Read + 명시적 락

재고 차감, 포인트 차감, 좌석 선택 등. 격리 수준만 올리는 게 아니라 `SELECT ... FOR UPDATE`로 필요한 행에 명시적으로 락을 거는 게 일반적이다.

```sql
BEGIN;
SELECT stock FROM products WHERE id = 1 FOR UPDATE;  -- 락 획득
-- stock > 0 확인
UPDATE products SET stock = stock - 1 WHERE id = 1;
COMMIT;
```

### 금융 정산, 감사 로그 → Serializable

잘못되면 돈이 사라지거나, 법적 문제가 되는 시스템. 성능 손실을 감수하고 가장 높은 격리를 적용한다.

### 대략적인 통계, 대시보드 → Read Uncommitted (극히 드묾)

"지금 대략 주문이 몇 건이야?" 같은 정확하지 않아도 되는 조회. 하지만 Read Committed로도 충분히 빠르기 때문에 실무에서 거의 안 쓴다.

---

## 7. Spring Boot에서 격리 수준 설정

### 7.1 동작 원리

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void deductStock(Long productId) { ... }
```

이렇게 설정하면 Spring이 트랜잭션을 시작할 때 내부적으로 다음을 실행한다:

```
1. @Transactional 진입
2. DataSource에서 Connection 획득
3. connection.setTransactionIsolation(TRANSACTION_REPEATABLE_READ)
   → DB에 SET TRANSACTION ISOLATION LEVEL REPEATABLE READ 실행
4. BEGIN
5. 비즈니스 로직 실행
6. COMMIT 또는 ROLLBACK
7. Connection 반환
```

**해당 트랜잭션에만 적용**된다. DB 전체의 기본 격리 수준을 바꾸는 게 아니다.

### 7.2 DB별 격리 수준 지원 현황

모든 DB가 4가지를 다 지원하지는 **않는다.** Spring Boot에서 설정해도 DB가 지원하지 않으면 에러가 발생한다.

| 격리 수준 | MySQL | MariaDB | PostgreSQL | Oracle | SQL Server |
|-----------|:---:|:---:|:---:|:---:|:---:|
| **Read Uncommitted** | O | O | △ | X | O |
| **Read Committed** | O | O | O (**기본값**) | O (**기본값**) | O (**기본값**) |
| **Repeatable Read** | O (**기본값**) | O (**기본값**) | △ | X | O |
| **Serializable** | O | O | O | O | O |

**△ = 설정은 가능하지만 실제 동작이 다름, X = 미지원 (설정 시 에러)**

### 7.3 DB별 특이사항

#### PostgreSQL

```
Read Uncommitted → 설정해도 Read Committed로 동작 (Dirty Read 허용 안 함)
Repeatable Read  → 동작하지만 Serializable에 가까운 수준 (스냅샷 + 첫 번째 업데이트 우선)
```

PostgreSQL은 Dirty Read를 아예 허용하지 않는 설계다. 사실상 **3단계**라고 보면 된다: Read Committed / Repeatable Read / Serializable(SSI).

#### Oracle

```
Read Uncommitted  → 미지원 (에러)
Repeatable Read   → 미지원 (에러)
```

**Read Committed와 Serializable만 지원한다.** Spring Boot에서 `Isolation.REPEATABLE_READ`를 설정하면 런타임 에러가 발생한다.

```java
// Oracle에서 이렇게 하면 에러! (ORA-02179)
@Transactional(isolation = Isolation.REPEATABLE_READ)

// Oracle에서 Repeatable Read가 필요하면 → 명시적 락으로 대체
@Transactional
public void doSomething() {
    repository.findByIdForUpdate(id);  // SELECT ... FOR UPDATE
}
```

#### MySQL (InnoDB)

4가지 전부 지원, 기본값 Repeatable Read. MVCC + Next-Key Lock으로 Phantom Read도 대부분 방지한다. 단, **Lost Update는 방지 안 됨** → `FOR UPDATE` 필요.

#### MariaDB (InnoDB)

MySQL과 거의 동일하게 동작한다. 4가지 전부 지원, 기본값 Repeatable Read. MariaDB 10.5+ 이후 일부 내부 구현 차이가 있지만 격리 수준 동작은 동일하다.

#### SQL Server

4가지 전부 지원 + **Snapshot Isolation** (5번째 격리 수준)을 추가로 제공한다. 기본 Read Committed는 락 기반이라 RCSI 활성화를 권장한다.

```sql
-- SQL Server 전용: Snapshot Isolation 활성화
ALTER DATABASE mydb SET ALLOW_SNAPSHOT_ISOLATION ON;
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
```

### 7.4 실무에서는 격리 수준을 바꾸나?

**거의 바꾸지 않는다.** 재고 차감, 포인트 차감 같은 동시성 이슈는 **격리 수준이 아니라 명시적 락(`FOR UPDATE`)으로 해결**하는 게 표준 패턴이다.

```java
// 실무에서 가장 흔한 코드. isolation 설정 자체가 없다.
@Transactional
public void deductStock(Long productId) {
    Product product = productRepository.findByIdForUpdate(productId);  // FOR UPDATE
    if (product.getStock() <= 0) {
        throw new SoldOutException();
    }
    product.decreaseStock();
}
```

```java
// Repository에서 FOR UPDATE (비관적 락)
public interface ProductRepository extends JpaRepository<Product, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Product p WHERE p.id = :id")
    Product findByIdForUpdate(@Param("id") Long id);
}
```

왜 격리 수준을 안 바꿔도 되는 걸까? `FOR UPDATE`가 행을 잠그는 순간, **격리 수준과 무관하게 동일한 결과**가 나오기 때문이다:

- Read Committed + `FOR UPDATE` → 락 걸림, 다른 TX 대기, 최신 값 읽음
- Repeatable Read + `FOR UPDATE` → 락 걸림, 다른 TX 대기, 최신 값 읽음
- 결과가 **동일**하다

격리 수준이 영향을 미치는 건 **락 없는 일반 SELECT**의 동작이다. `FOR UPDATE`를 쓰는 순간 격리 수준의 차이가 사라진다.

> 그러면 `@Transactional(isolation = ...)`은 언제 쓸까? 격리 수준을 명시적으로 변경하는 경우는 **금융 정산처럼 모든 SELECT까지 엄격하게 제어해야 하는 극단적인 경우** 정도다. 일반 웹 서비스에서는 거의 쓸 일이 없다.

### 7.5 격리 수준 설정 문법 (참고용)

쓸 일은 거의 없지만, 문법은 알아두면 좋다:

```java
// 메서드 단위로 격리 수준 지정 (극히 드문 경우에만 사용)
@Transactional(isolation = Isolation.SERIALIZABLE)
public void settlePayments() { ... }

// Isolation.DEFAULT = DB의 기본값 사용
// MySQL: Repeatable Read, PostgreSQL/Oracle/SQL Server: Read Committed
@Transactional(isolation = Isolation.DEFAULT)  // @Transactional과 동일

// 트랜잭션 중첩 시 내부 트랜잭션의 isolation은 무시됨
@Transactional(isolation = Isolation.SERIALIZABLE)
public void outer() {
    inner();  // inner의 설정은 무시, outer의 SERIALIZABLE 적용
}
```

### 7.6 실무 요약

| 상황 | 코드 | 격리 수준 변경? |
|------|------|:---:|
| 일반 CRUD | `@Transactional` | X (DB 기본값) |
| 재고 차감, 포인트 차감 | `@Transactional` + `FOR UPDATE` | X (락이 핵심) |
| 게시글 수정 (충돌 드묾) | `@Transactional` + `@Version` (낙관적 락) | X |
| 금융 정산 (극히 드묾) | `@Transactional(isolation = Isolation.SERIALIZABLE)` | O |

**핵심: 99%의 경우 격리 수준은 건드리지 않고, 필요하면 명시적 락으로 해결한다.**

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **격리 수준이란?** | 동시 트랜잭션 간에 데이터를 얼마나 보이게 할지 결정하는 설정 |
| **높을수록 안전, 낮을수록 빠름** | 트레이드오프. 무조건 높이는 건 정답이 아님 |
| **실무 기본값** | PostgreSQL/Oracle → Read Committed, MySQL → Repeatable Read |
| **선착순 시스템에서는?** | Read Committed + 명시적 락(`FOR UPDATE`)이 일반적 |

다음 글에서는 **각 격리 수준에서 데드락이 발생하는 실제 케이스**를 다루고, 이를 어떻게 방지하는지 알아본다.
