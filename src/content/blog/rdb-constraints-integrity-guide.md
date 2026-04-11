---
title: "RDB 설계 시리즈 3편: 제약조건과 데이터 무결성 — 스키마로 버그를 막는 법"
description: "CHECK, UNIQUE, FK, DEFAULT, Generated Column까지 — 제약조건은 '귀찮은 것'이 아니라 '스키마 레벨의 방어 코드'다. DB vs 앱 어디서 검증할지, FK를 걸어야 할지 말아야 할지, 실무 판단 기준을 제시한다."
pubDate: 2026-04-07T14:00:00+09:00
tags:
  - Database
  - RDB
  - Schema Design
  - Constraints
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbConstraintsIntegrityGuide.png"
---

## 서론

[이전 글](/blog/rdb-normalization-guide)에서 테이블을 어떻게 나누고 묶을 것인지 — 정규화와 반정규화의 판단 기준을 다뤘다. 이번 글에서는 한 단계 더 들어가서 — **"잘못된 데이터가 들어오는 것 자체를 어떻게 막을 것인가?"** 를 다룬다.

많은 개발자가 데이터 검증을 **애플리케이션 코드에서만** 한다. Service 계층에서 `if (age < 0) throw ...` 이런 식으로. 물론 앱 레벨 검증은 필수다. 하지만 **앱만 믿으면 언젠가 뚫린다.**

```
관리자가 DB에 직접 INSERT한다 → 앱 검증 우회
다른 서비스가 같은 DB에 쓴다 → 앱 검증 우회
데이터 마이그레이션 스크립트를 돌린다 → 앱 검증 우회
ORM 버그로 잘못된 값이 들어간다 → 앱 검증 우회
```

**제약조건은 "최후의 방어선"이다.** 앱이 실수해도 DB가 막아준다.

이 글에서는 5가지 제약조건을 다룬다:

1. CHECK — 값의 범위/조건 강제
2. UNIQUE — 중복 방지 (부분/복합)
3. FK — 참조 무결성과 트레이드오프
4. DEFAULT / Generated Column — 자동 값 채우기
5. 방어적 스키마 설계 — 스키마로 잘못된 상태를 방지하는 패턴

---

## 1. CHECK 제약조건 — "이 값은 이 범위 안에 있어야 한다"

### 1.1 기본 사용법

```sql
-- 나이는 0 이상이어야 한다
ALTER TABLE users ADD CONSTRAINT chk_users_age CHECK (age >= 0);

-- 가격은 양수여야 한다
ALTER TABLE products ADD CONSTRAINT chk_products_price CHECK (price > 0);

-- 상태는 정해진 값만 허용
ALTER TABLE orders ADD CONSTRAINT chk_orders_status
    CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED'));

-- 시작일이 종료일보다 앞서야 한다
ALTER TABLE events ADD CONSTRAINT chk_events_date_range
    CHECK (start_date <= end_date);
```

```sql
-- CHECK 위반 시
INSERT INTO users (name, age) VALUES ('김철수', -5);
-- ❌ ERROR: Check constraint 'chk_users_age' is violated.

INSERT INTO orders (status) VALUES ('UNKNOWN');
-- ❌ ERROR: Check constraint 'chk_orders_status' is violated.
```

### 1.2 MySQL vs PostgreSQL 차이

| 특성 | MySQL | PostgreSQL |
|------|-------|------------|
| CHECK 지원 시작 | **8.0.16** (2019) — 그 이전엔 구문만 파싱하고 **무시**했음 | 초기 버전부터 지원 |
| 서브쿼리 | 불가 | 불가 (CHECK 안에서 SELECT 불가) |
| 다른 테이블 참조 | 불가 | 불가 (같은 행의 컬럼만 참조 가능) |
| 함수 사용 | 비결정적 함수 제한 (`NOW()` 불가) | 불변(IMMUTABLE) 함수만 허용 |

각 항목을 좀 더 자세히 살펴보자.

#### 서브쿼리 불가

CHECK 제약조건 안에서는 `SELECT` 문을 사용할 수 없다. 즉, 다른 테이블이든 같은 테이블이든 쿼리로 데이터를 조회하는 것 자체가 불가능하다.

```sql
-- ❌ 이렇게 하고 싶지만 불가능
ALTER TABLE orders ADD CONSTRAINT chk_valid_product
    CHECK (product_id IN (SELECT id FROM products));
--                        ^^^^^^^^^^^^^^^^^^^^^^^^ CHECK 안에서 SELECT 불가!

-- ✅ 이런 검증이 필요하다면 FK를 사용해야 한다
ALTER TABLE orders ADD CONSTRAINT fk_orders_product
    FOREIGN KEY (product_id) REFERENCES products(id);
```

CHECK는 매 INSERT/UPDATE마다 평가되는데, 만약 서브쿼리를 허용하면 매번 다른 테이블에 대한 조회가 발생해 성능 저하와 동시성 문제(락 충돌)가 생길 수 있다. SQL 표준에서부터 이를 금지한 이유다.

#### 다른 테이블 참조 불가

CHECK는 **현재 INSERT/UPDATE되는 바로 그 행의 컬럼**만 참조할 수 있다. 같은 테이블의 다른 행도, 다른 테이블의 컬럼도 참조할 수 없다.

```sql
-- ✅ 가능: 같은 행의 컬럼끼리 비교
ALTER TABLE events ADD CONSTRAINT chk_date_range
    CHECK (end_date > start_date);
--       ^^^^^^^^     ^^^^^^^^^^ 둘 다 같은 행의 컬럼이므로 OK

-- ❌ 불가능: 다른 테이블의 컬럼 참조
ALTER TABLE orders ADD CONSTRAINT chk_enough_stock
    CHECK (quantity <= (SELECT stock FROM products WHERE id = product_id));
--                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 다른 테이블!
```

"주문 수량이 재고를 초과하지 않는지 검증" 같은 크로스 테이블 규칙은 CHECK로 구현할 수 없다. 이런 경우는 **트리거(Trigger)** 또는 **앱 레벨 검증**으로 처리해야 한다.

#### 함수 사용 제한

CHECK 안에서 함수를 쓸 수 있지만, **호출할 때마다 결과가 바뀌는 함수**는 사용할 수 없다.

```sql
-- ❌ MySQL: NOW()는 비결정적(non-deterministic) — 호출 시점마다 결과가 달라진다
ALTER TABLE events ADD CONSTRAINT chk_future_event
    CHECK (event_date > NOW());
-- INSERT 시점에는 통과했지만, 시간이 지나면 기존 행이 제약을 위반하게 된다
-- DB는 이런 "시간이 지나면 위반되는 제약"을 허용하지 않는다

-- ❌ PostgreSQL: IMMUTABLE이 아닌 함수는 불가
-- NOW()는 STABLE 함수이므로 CHECK에서 사용 불가

-- ✅ 가능: UPPER(), LENGTH() 같은 결정적/불변 함수
ALTER TABLE users ADD CONSTRAINT chk_email_format
    CHECK (LENGTH(email) >= 5);
-- 같은 입력에 항상 같은 결과를 반환하므로 안전하다
```

핵심은 CHECK 제약조건이 **"이 행의 데이터가 유효한가?"를 행 단위로, 결정적으로 판단하는 도구**라는 점이다. 서브쿼리, 다른 테이블, 비결정적 함수가 제한되는 이유는 모두 이 원칙에서 비롯된다.

> ⚠️ **MySQL 8.0.15 이하를 쓰고 있다면 CHECK가 동작하지 않는다.** `ALTER TABLE` 실행해도 에러 없이 성공하지만, 실제로는 검증을 하지 않는다. 반드시 MySQL 버전을 확인해야 한다.

### 1.3 DB 검증 vs 앱 검증 — 어디서 할 것인가?

**둘 다 해야 한다.** 역할이 다르다.

| 구분 | 앱 레벨 검증 | DB CHECK 제약 |
|------|-------------|--------------|
| **역할** | 사용자 피드백 (에러 메시지, 필드 하이라이트) | 최후의 방어선 (데이터 무결성 보장) |
| **우회 가능성** | 높음 (직접 SQL, 마이그레이션, 다른 서비스) | 없음 (DB가 거부) |
| **에러 메시지** | 사용자 친화적 ("나이는 0 이상이어야 합니다") | 기술적 (`Check constraint 'chk_users_age' is violated`) |
| **복잡한 규칙** | 가능 (다른 테이블 참조, 외부 API 호출) | 불가 (같은 행의 컬럼만) |
| **성능 영향** | 없음 (INSERT 전에 검증) | 미미 (매 INSERT/UPDATE마다 평가) |

```
앱 검증: "사용자에게 친절한 에러를 보여주는 것"     → UX
DB CHECK: "어떤 경로로든 잘못된 값이 들어가는 것을 막는 것" → 무결성
```

#### 실무 규칙

```
1. 단순한 값 범위, 허용 목록 → DB CHECK + 앱 검증 모두
   예: age >= 0, status IN ('A', 'B', 'C'), price > 0

2. 복잡한 비즈니스 규칙 → 앱 검증만
   예: "재고가 있어야 주문 가능", "VIP 회원만 할인 적용"

3. 다른 테이블을 참조하는 규칙 → 앱 검증 + FK 제약
   예: "주문의 user_id는 존재하는 회원이어야 한다"
```

### 1.4 CHECK에 ENUM 값 넣기 vs 참조 테이블

[1편](/blog/rdb-schema-basics-guide)에서 ENUM vs 참조 테이블을 다뤘다. CHECK와의 관계를 정리하면:

| 방식 | 값 추가 시 | 값이 몇 개일 때 적합 |
|------|-----------|-------------------|
| **CHECK + VARCHAR** | `ALTER TABLE` (DDL 변경) | 3~5개, 거의 안 바뀌는 값 |
| **참조 테이블 + FK** | `INSERT` 한 줄 (DML) | 5개 이상, 또는 바뀔 가능성 있는 값 |

값이 자주 바뀔 수 있다면 CHECK보다 참조 테이블이 낫다.

#### 실무에서의 CHECK — 솔직한 현실

CHECK 제약조건은 이론적으로 훌륭하지만, 실무에서는 **적극적으로 사용하는 팀이 많지 않다.** 그 이유는:

1. **MySQL의 늦은 지원**: MySQL 8.0.16(2019년)이 되어서야 CHECK가 동작했다. 그 이전 수십 년간 MySQL 생태계에서는 "CHECK는 없는 것"으로 취급되었고, 이 관성이 아직도 남아 있다. 기존 프로젝트에 CHECK를 새로 추가하자는 제안은 팀 내에서 합의를 얻기 어려운 경우가 많다.
2. **ORM과의 궁합**: Spring Data JPA, Django ORM, ActiveRecord 등 대부분의 ORM은 CHECK 제약조건을 자동 생성하지 않는다. DDL을 직접 관리하거나 마이그레이션 도구(Flyway, Alembic 등)로 별도 추가해야 하는데, 이 단계를 빼먹기 쉽다.
3. **에러 메시지의 불친절함**: CHECK가 위반되면 `Check constraint 'chk_users_age' is violated` 같은 기술적 에러가 반환된다. 사용자에게 보여줄 메시지로는 쓸 수 없으므로, 결국 앱에서도 검증 로직을 짜게 되고, "그러면 앱에서 다 하면 되는 거 아닌가?"라는 생각으로 이어진다.

**그럼에도 CHECK를 써야 하는 순간**:

- **직접 SQL로 데이터를 수정하는 일이 잦은 경우**: 운영 DB에서 `UPDATE` 문을 직접 실행할 때 앱 검증은 동작하지 않는다. CHECK만이 마지막 방어선이 된다.
- **여러 서비스/배치가 같은 테이블에 쓰는 경우**: 모든 진입점에서 동일한 검증을 보장하려면 DB 레벨 제약이 가장 확실하다.
- **금융, 의료 등 데이터 무결성이 법적 요구인 도메인**: "앱 버그로 잘못된 값이 들어갔습니다"가 용납되지 않는 환경이라면 CHECK는 필수다.

> **현실적 조언**: 새 프로젝트를 시작한다면 `price > 0`, `quantity >= 1`, `status IN (...)` 같은 기본적인 CHECK는 처음부터 걸어두는 것을 추천한다. 나중에 추가하려면 기존 데이터 검증부터 해야 하므로 훨씬 번거롭다.

---

## 2. UNIQUE 제약조건 — "이 조합은 딱 하나만 존재해야 한다"

### 2.1 단일 컬럼 UNIQUE

```sql
-- 이메일은 중복 불가
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- 위반 시
INSERT INTO users (email) VALUES ('kim@email.com');
INSERT INTO users (email) VALUES ('kim@email.com');
-- ❌ ERROR: Duplicate entry 'kim@email.com' for key 'uq_users_email'
```

### 2.2 복합 UNIQUE

```sql
-- 같은 주문에 같은 상품은 한 번만
ALTER TABLE order_items
    ADD CONSTRAINT uq_order_items_order_product
    UNIQUE (order_id, product_id);

-- user_id + provider 조합이 유일해야 한다 (소셜 로그인)
ALTER TABLE social_accounts
    ADD CONSTRAINT uq_social_provider
    UNIQUE (user_id, provider);
```

복합 UNIQUE는 **"이 조합이 비즈니스적으로 하나만 존재해야 하는가?"** 를 기준으로 판단한다.

### 2.3 부분 UNIQUE (조건부 유니크)

"삭제되지 않은 사용자 중에서만 이메일이 유일하면 된다" — 이런 경우가 실무에서 자주 나온다.

```sql
-- PostgreSQL: 부분 인덱스로 조건부 UNIQUE
CREATE UNIQUE INDEX uq_users_email_active
    ON users (email) WHERE deleted_at IS NULL;

-- 삭제된 사용자는 이메일 중복 허용
-- 활성 사용자끼리만 이메일 중복 불가
```

MySQL에는 부분 인덱스가 없다. 대안:

```sql
-- MySQL: Generated Column + UNIQUE로 우회
ALTER TABLE users
    ADD COLUMN email_unique_key VARCHAR(320)
    GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN email ELSE NULL END
    ) STORED;

ALTER TABLE users ADD CONSTRAINT uq_users_email_active UNIQUE (email_unique_key);
-- NULL은 UNIQUE에서 중복 허용되므로, 삭제된 사용자는 NULL → 중복 OK
-- 활성 사용자는 email 값 → 중복 불가
```

> **MySQL의 Generated Column + UNIQUE 우회가 다소 지저분하다는 건 맞다.** 하지만 Soft Delete 패턴에서 "활성 사용자 이메일 중복 방지"는 매우 흔한 요구사항이다. PostgreSQL이라면 부분 인덱스 한 줄로 깔끔하게 해결된다.

### 2.4 UNIQUE와 NULL

[1편](/blog/rdb-schema-basics-guide)에서 다뤘듯이, NULL과 UNIQUE의 동작은 DB마다 다르다.

| DB | NULL 중복 허용 |
|----|:---:|
| MySQL | ✅ (NULL은 여러 개 가능) |
| PostgreSQL 14 이하 | ✅ |
| PostgreSQL 15+ | 선택 가능 (`NULLS NOT DISTINCT`) |
| SQL Server | ❌ (NULL도 하나만) |

```sql
-- PostgreSQL 15+: NULL도 하나만 허용하고 싶다면
CREATE TABLE users (
    email VARCHAR(320),
    CONSTRAINT uq_users_email UNIQUE NULLS NOT DISTINCT (email)
);
```

### 2.5 UNIQUE 인덱스 vs UNIQUE 제약조건

```sql
-- 방법 1: 제약조건으로 추가
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- 방법 2: 유니크 인덱스로 추가
CREATE UNIQUE INDEX idx_users_email ON users (email);
```

두 방법 모두 내부적으로 유니크 인덱스를 생성한다. 차이는:

| 구분 | UNIQUE 제약조건 | UNIQUE 인덱스 |
|------|:---:|:---:|
| FK에서 참조 가능 | ✅ | DB에 따라 다름 |
| `WHERE` 조건 (부분) | ❌ | ✅ (PostgreSQL) |
| 의미론적 명확성 | "비즈니스 규칙" | "성능 최적화" |

#### FK 참조 가능 여부 — DB별 차이

SQL 표준에서는 FK가 참조할 수 있는 대상을 PRIMARY KEY 또는 UNIQUE **제약조건**으로 명시하고 있다. 즉, 표준만 놓고 보면 UNIQUE 인덱스는 FK의 참조 대상이 아니다. 하지만 현실의 DB 엔진들은 이 규칙을 각자 다르게 해석한다:

- **PostgreSQL / MySQL / SQL Server**: 유니크 인덱스만 존재해도 FK 참조를 허용한다. 이 DB들은 "유니크함이 보장되면 충분하다"는 입장이기 때문에, 제약조건이든 인덱스든 내부적으로 유니크 인덱스가 있으면 FK 생성이 가능하다.
- **Oracle**: 반드시 UNIQUE **제약조건**이 선언되어 있어야 FK 참조가 가능하다. 유니크 인덱스만 있으면 `ORA-02270: no matching unique or primary key for this column-list` 에러가 발생한다.

결론적으로, 특정 컬럼이 다른 테이블의 FK로 참조될 가능성이 있다면, DB 이식성과 명확성을 위해 유니크 인덱스가 아닌 `CONSTRAINT`로 선언하는 것이 안전하다. 나중에 DB를 마이그레이션하거나 멀티 DB를 지원할 때 예상치 못한 에러를 방지할 수 있다.

#### 부분(Partial) 유니크 — 실무에서 가장 큰 차이

UNIQUE 제약조건은 테이블 전체 행을 대상으로 유니크를 검증한다. 조건을 붙여서 "특정 행만 유니크하게" 만들 수 없다. 반면 UNIQUE 인덱스는 `WHERE` 절을 붙여서 <strong>부분 유니크(Partial Unique)</strong>를 구현할 수 있다. 이 차이가 실무에서 가장 크게 체감되는 부분이다.

```sql
-- UNIQUE 제약조건: 테이블의 모든 행에 대해 유니크를 강제한다
-- 조건을 붙일 수 없으므로, 삭제된 행도 유니크 검사 대상이 된다
ALTER TABLE users ADD CONSTRAINT uq_email UNIQUE (email);

-- UNIQUE 인덱스 + WHERE: 특정 조건을 만족하는 행만 유니크를 검사한다 (PostgreSQL)
-- deleted_at이 NULL인 (= 활성 상태인) 행만 유니크 대상이 된다
CREATE UNIQUE INDEX idx_users_active_email
    ON users (email)
    WHERE deleted_at IS NULL;
```

대표적인 사례가 **Soft Delete 패턴**이다. 많은 서비스에서 사용자 탈퇴 시 행을 물리적으로 삭제하지 않고 `deleted_at` 타임스탬프를 기록하는 방식을 쓴다. 이때 탈퇴한 사용자와 같은 이메일로 재가입하려는 상황을 생각해 보자:

- **UNIQUE 제약조건만 있는 경우**: 탈퇴한 행의 `email = 'user@example.com'`이 여전히 테이블에 남아 있으므로, 같은 이메일로 INSERT 시 중복 에러(`duplicate key value violates unique constraint`)가 발생한다. 이를 피하려면 탈퇴 시 이메일을 `user@example.com_deleted_1712345678` 같은 형태로 변조하는 우회 로직이 필요한데, 이는 데이터의 원래 값을 훼손시킨다.
- **부분 유니크 인덱스를 쓰는 경우**: `WHERE deleted_at IS NULL` 조건 덕분에 탈퇴한 행(`deleted_at IS NOT NULL`)은 유니크 검사에서 완전히 제외된다. 따라서 같은 이메일로 새 행을 INSERT해도 활성 행 중에 중복이 없으면 정상적으로 들어간다. 이메일 값을 변조할 필요가 없으므로 데이터 무결성도 유지된다.

> 부분 인덱스는 **PostgreSQL**에서 지원한다. MySQL은 부분 인덱스를 지원하지 않으므로, 유사한 효과를 내려면 `deleted_at` 대신 `is_active` 같은 컬럼을 만들고 `(email, is_active)` 복합 유니크를 거는 등의 별도 트릭이 필요하다.

#### 의미론적 차이 — 스키마가 전달하는 의도

기능적으로는 둘 다 유니크를 보장하지만, 스키마를 읽는 사람에게 전달하는 **의도**가 다르다.

- **CONSTRAINT**: "이 컬럼의 값은 비즈니스적으로 절대 중복되어서는 안 된다"는 **규칙 선언**이다. 이메일, 주문번호, 사업자등록번호처럼 도메인 규칙 자체가 유니크를 요구하는 경우에 적합하다. 다른 개발자가 스키마를 보면 "아, 이건 비즈니스 요구사항이구나"라고 즉시 파악할 수 있다.
- **INDEX**: "이 컬럼에 인덱스를 걸어서 조회 성능을 높이겠다"는 **성능 최적화**로 읽힌다. 유니크 인덱스를 봤을 때 그것이 비즈니스 규칙인지 성능 목적인지 한눈에 구분하기 어렵다.

이 차이는 6개월 뒤 스키마를 처음 보는 팀원, 혹은 코드 리뷰 시에 의미가 커진다. 제약조건으로 선언해 두면 "이 유니크를 제거해도 되나?"라는 질문에 "비즈니스 규칙이니 안 된다"는 답이 스키마에서 바로 나온다. 인덱스로만 되어 있으면 그 판단을 내리기 위해 별도의 문서나 히스토리를 찾아봐야 한다.

#### 실무 판단 기준

| 상황 | 선택 | 이유 |
|------|------|------|
| 이메일, 주민번호 등 비즈니스 유니크 | `UNIQUE CONSTRAINT` | 비즈니스 규칙임을 스키마에서 명시 |
| FK로 참조될 예정인 컬럼 | `UNIQUE CONSTRAINT` | DB 이식성 보장 (Oracle 등) |
| Soft Delete + 조건부 유니크 | `UNIQUE INDEX + WHERE` | 제약조건은 WHERE 조건 불가 |
| 유니크하면서 특정 포함 컬럼 필요 | `UNIQUE INDEX` (INCLUDE 절) | INCLUDE는 인덱스 전용 기능 |

**실무 규칙**: 비즈니스 규칙이면 제약조건(`CONSTRAINT`)으로, 조건부 유니크나 성능 목적이면 인덱스로.

#### 실무에서의 UNIQUE — 가장 많이 쓰이는 제약조건

CHECK나 FK와 달리, UNIQUE는 **실무에서 거의 100% 사용된다.** 이유는 단순하다 — UNIQUE 없이는 중복 데이터를 앱 레벨만으로 완벽하게 막을 수 없기 때문이다.

```sql
-- 앱에서 "이메일 중복 체크" 후 INSERT하는 흐름
-- 1. SELECT * FROM users WHERE email = 'a@b.com'  → 없음
-- 2. INSERT INTO users (email) VALUES ('a@b.com')
-- 하지만 1과 2 사이에 다른 요청이 같은 이메일로 INSERT하면? → 중복 발생!
-- (Race Condition)
```

이 <strong>레이스 컨디션(Race Condition)</strong>은 앱 레벨 검증만으로는 원천 차단이 불가능하다. `SELECT` 후 `INSERT` 사이에 다른 트랜잭션이 끼어들 수 있기 때문이다. DB의 UNIQUE 제약조건만이 이를 원자적으로 보장한다.

실무에서의 패턴:
- **이메일, 로그인 ID, 전화번호** → 거의 무조건 UNIQUE
- **주문번호, 결제 트랜잭션 ID** → 중복 결제 방지를 위해 반드시 UNIQUE
- **API 멱등성 키(idempotency key)** → 중복 요청 방지에 UNIQUE 활용
- **Soft Delete 환경** → 부분 유니크 인덱스(`WHERE deleted_at IS NULL`)를 아는 팀은 적극 활용하지만, 모르는 팀은 이메일 변조 등 우회 로직으로 고생하는 경우가 많다

> **현실적 조언**: "이 값이 중복되면 안 되는데?"라는 생각이 드는 컬럼이 있다면, 망설이지 말고 UNIQUE를 걸어라. 앱에서 아무리 체크해도 동시성 상황에서 뚫린다.

---

## 3. FK(Foreign Key) — 참조 무결성의 양날의 검

### 3.1 FK가 하는 일

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- FK가 보장하는 것:
-- 1. orders.user_id에 넣는 값은 users.id에 반드시 존재해야 한다
-- 2. users에서 행을 삭제할 때 orders에 참조가 있으면 거부된다 (기본 동작)
```

```sql
-- 존재하지 않는 유저로 주문 생성
INSERT INTO orders (id, user_id) VALUES (1, 9999);
-- ❌ ERROR: a]foreign key constraint fails

-- 주문이 있는 유저 삭제
DELETE FROM users WHERE id = 1;
-- ❌ ERROR: Cannot delete or update a parent row
```

### 3.2 CASCADE 옵션

FK의 동작은 `ON DELETE`와 `ON UPDATE`로 제어한다.

| 옵션 | 부모 삭제 시 | 적합한 경우 |
|------|------------|-----------|
| `RESTRICT` (기본) | 에러 — 삭제 거부 | 대부분의 경우 (안전한 기본값) |
| `CASCADE` | 자식도 함께 삭제 | 부모-자식이 생명주기를 공유 (주문 → 주문상세) |
| `SET NULL` | 자식의 FK를 NULL로 | 관계가 끊어져도 자식이 독립적으로 의미 있을 때 |
| `SET DEFAULT` | 자식의 FK를 DEFAULT로 | 거의 안 씀 |
| `NO ACTION` | RESTRICT와 거의 동일 | 트랜잭션 종료 시점에 검증 (PostgreSQL에서 차이) |

```sql
-- CASCADE 예시: 주문 삭제 시 주문 상세도 함께 삭제
ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE;

-- SET NULL 예시: 작성자가 탈퇴해도 게시글은 남김
ALTER TABLE posts
    ADD CONSTRAINT fk_posts_author
    FOREIGN KEY (author_id) REFERENCES users(id)
    ON DELETE SET NULL;
```

> ⚠️ **CASCADE는 편하지만 위험하다.** `DELETE FROM users WHERE id = 1` 한 줄로 해당 유저의 주문, 리뷰, 댓글이 전부 사라질 수 있다. **Soft Delete 패턴을 쓰는 서비스에서 CASCADE는 거의 쓸 일이 없다.** 실제 삭제를 하지 않으니까.

#### RESTRICT vs NO ACTION — 미묘한 차이

| 동작 | RESTRICT | NO ACTION |
|------|----------|-----------|
| MySQL | 즉시 검증 | RESTRICT와 동일 |
| PostgreSQL | 즉시 검증 | **트랜잭션 종료 시점에 검증** |

PostgreSQL에서 `NO ACTION` + `DEFERRABLE`을 쓰면 트랜잭션 안에서 순서를 유연하게 처리할 수 있다:

```sql
-- PostgreSQL: 순환 참조나 복잡한 삽입 순서가 필요할 때
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    DEFERRABLE INITIALLY DEFERRED;

-- 트랜잭션 안에서 순서 상관없이 삽입 가능
BEGIN;
INSERT INTO orders (id, user_id) VALUES (1, 100);  -- users에 100번이 아직 없지만 OK
INSERT INTO users (id, name) VALUES (100, '김철수');  -- 여기서 만듦
COMMIT;  -- 이 시점에서 FK 검증 → 통과!
```

### 3.3 FK를 걸어야 하는가, 말아야 하는가?

이건 실무에서 가장 논쟁이 많은 주제 중 하나다.

#### FK를 거는 것이 유리한 경우

```
✅ 데이터 무결성이 핵심인 도메인 (금융, 의료, 결제)
✅ 단일 DB, 모놀리식 아키텍처
✅ 참조 관계가 변경될 일이 적은 테이블 (사용자 → 주문)
✅ 주니어가 많은 팀 (실수 방지)
```

#### FK를 안 거는 것이 유리한 경우

```
⚠️ MSA에서 서비스별 DB가 분리된 경우 (크로스 DB FK 불가)
⚠️ 대량 INSERT/UPDATE가 빈번한 테이블 (FK 검증 = 매번 부모 테이블 조회)
⚠️ 데이터 마이그레이션/ETL이 자주 일어나는 경우 (FK가 순서를 강제)
⚠️ 파티셔닝된 테이블 (MySQL에서 파티션 테이블은 FK 불가)
```

#### FK의 성능 영향

FK가 있으면 매 INSERT/UPDATE마다 부모 테이블의 인덱스를 조회해서 참조 무결성을 검증한다.

```
[FK 있을 때의 INSERT 흐름]
1. order_items에 INSERT 시도
2. orders 테이블의 PK 인덱스에서 order_id 존재 여부 확인 ← 추가 조회
3. products 테이블의 PK 인덱스에서 product_id 존재 여부 확인 ← 추가 조회
4. 검증 통과 → INSERT 실행

[FK 없을 때]
1. order_items에 INSERT 실행 → 끝
```

| 시나리오 | FK 성능 영향 |
|---------|:---:|
| 단건 INSERT | 거의 무시 가능 |
| 벌크 INSERT (수만~수십만 건) | **체감 가능** — 트랜잭션이 길어짐 |
| 부모 테이블이 매우 큰 경우 | 인덱스 조회 비용 증가 |
| 쓰기가 초당 수천 건 | FK 검증이 병목이 될 수 있음 |

```sql
-- MySQL: 벌크 로드 시 FK 검증 임시 비활성화
SET FOREIGN_KEY_CHECKS = 0;
LOAD DATA INFILE '/data/order_items.csv' INTO TABLE order_items ...;
SET FOREIGN_KEY_CHECKS = 1;
-- ⚠️ 반드시 다시 켜야 한다! 그리고 데이터 정합성을 별도로 검증해야 한다.
```

#### FK 없이 무결성을 유지하는 방법

FK를 안 건다고 "아무 값이나 넣어도 된다"는 뜻이 아니다.

```
1. 애플리케이션 레벨 검증
   - Service 계층에서 INSERT 전에 부모 존재 여부 확인
   - 장점: 유연, 에러 메시지 커스텀 가능
   - 단점: 직접 SQL, 마이그레이션 등 우회 가능

2. 정합성 검증 배치
   - 주기적으로 고아 데이터(orphan)를 찾는 쿼리 실행
   - 모니터링 + 알람 연동

3. CDC/이벤트 기반 검증
   - 부모 삭제 이벤트 발생 시 자식 데이터 처리
```

```sql
-- 고아 데이터 탐지 쿼리
SELECT oi.id, oi.order_id
FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id
WHERE o.id IS NULL;
-- 결과가 나오면 정합성이 깨진 것 → 알람!
```

#### 실무 판단 기준

```
기본 선택              → FK를 건다 (무결성이 기본)
쓰기가 많은 환경           → 벤치마크 후 판단 (FK 유무 성능 비교)
MSA + DB 분리        → FK 불가 → 앱 검증 + 정합성 배치
파티셔닝 필요 (MySQL) → FK 불가 → 앱 검증 + 정합성 배치
```

> **핵심**: FK를 안 거는 건 "무결성을 포기하는 것"이 아니라 <strong>"무결성을 보장하는 책임을 DB에서 앱으로 옮기는 것"</strong>이다. 그 책임을 질 준비가 되어 있을 때만 FK를 빼야 한다.

#### 실무에서의 FK — 가장 의견이 갈리는 제약조건

FK는 제약조건 중에서 **팀과 아키텍처에 따라 채택 여부가 가장 극명하게 갈린다.**

**FK를 적극 쓰는 환경**:
- 모놀리식 아키텍처 + 단일 DB (전통적인 웹 서비스)
- 금융/의료/결제 등 데이터 정합성이 법적 요구인 도메인
- DBA가 있는 조직 — DBA는 대체로 FK를 강력히 권장한다

**FK를 안 쓰는(못 쓰는) 환경**:
- MSA + 서비스별 DB 분리 — 물리적으로 FK를 걸 수 없다
- 대규모 트래픽 서비스 — 쓰기 성능 최적화를 위해 FK를 제거하는 경우가 많다. 실제로 대형 인터넷 서비스(쿠팡, 배달의민족, 네이버 등)의 가이드라인에서 FK 미사용을 권장하는 경우가 있다
- Sharded DB 환경 — 샤드 간 FK는 불가능하다

**현실적인 타협점**:
- 스타트업 초기나 소규모 서비스 → FK를 걸어라. 데이터 정합성 문제를 디버깅하는 시간이 FK 성능 오버헤드보다 훨씬 비싸다.
- 서비스가 성장해서 FK가 병목이 될 때 → 그때 벤치마크하고 제거해도 늦지 않다. "나중에 추가"보다 "나중에 제거"가 훨씬 쉽다.
- FK를 제거한다면 → 반드시 고아 데이터 탐지 배치와 모니터링을 함께 구축해야 한다. FK 없이 모니터링도 없으면 데이터가 조용히 망가진다.

> **현실적 조언**: "우리 서비스에 FK를 걸어야 하나?"라는 질문의 답은 대부분 <strong>"일단 걸어라"</strong>이다. FK 때문에 성능 문제가 생기는 규모라면, 그때쯤이면 이 판단을 스스로 내릴 수 있는 팀이 되어 있을 것이다.

---

## 4. DEFAULT와 Generated Column — 자동으로 값 채우기

### 4.1 DEFAULT — 빠뜨린 값을 자동으로

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- INSERT 시 status, retry_count, created_at을 생략하면 DEFAULT가 적용
INSERT INTO orders (id) VALUES (1);
-- status = 'PENDING', retry_count = 0, created_at = 현재 시간
```

#### MySQL vs PostgreSQL DEFAULT 차이

| 특성 | MySQL | PostgreSQL |
|------|-------|------------|
| 함수 DEFAULT | 제한적 (`CURRENT_TIMESTAMP`만 일반적) | 거의 모든 함수 사용 가능 |
| `ON UPDATE CURRENT_TIMESTAMP` | 지원 (MySQL 고유) | 미지원 → 트리거 또는 앱에서 처리 |
| Expression DEFAULT | MySQL 8.0.13+ (제한적) | 자유롭게 사용 가능 |

```sql
-- MySQL: updated_at 자동 갱신
CREATE TABLE orders (
    ...
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- PostgreSQL: 트리거로 처리
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4.2 Generated Column — 다른 컬럼에서 자동 계산

[2편](/blog/rdb-normalization-guide)의 반정규화 섹션에서 잠깐 소개했다. 여기서 더 자세히 다룬다.

```sql
-- 주문 항목의 소계를 자동 계산
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    unit_price DECIMAL(15, 0) NOT NULL,
    quantity INT NOT NULL,
    subtotal DECIMAL(15, 0) GENERATED ALWAYS AS (unit_price * quantity) STORED
);

-- subtotal은 INSERT/UPDATE할 수 없다. DB가 알아서 관리한다.
INSERT INTO order_items (id, order_id, product_id, unit_price, quantity)
VALUES (1, 100, 200, 50000, 3);
-- subtotal = 150000 (자동)
```

#### VIRTUAL vs STORED

| 타입 | 저장 | 인덱스 | 성능 |
|------|:---:|:---:|------|
| **VIRTUAL** | ❌ (읽을 때 계산) | MySQL: 세컨더리 인덱스만 | 저장 공간 절약, 읽기 시 CPU 사용 |
| **STORED** | ✅ (디스크에 저장) | 모든 인덱스 가능 | 쓰기 시 계산, 읽기 빠름 |

| DB | VIRTUAL | STORED |
|----|:---:|:---:|
| MySQL | ✅ | ✅ |
| PostgreSQL | ❌ (17부터 지원 예정) | ✅ |

```sql
-- MySQL: VIRTUAL (디스크 절약, 읽기 시 계산)
ALTER TABLE order_items
    ADD COLUMN subtotal DECIMAL(15, 0)
    GENERATED ALWAYS AS (unit_price * quantity) VIRTUAL;

-- MySQL: STORED (디스크 저장, 인덱스 가능)
ALTER TABLE order_items
    ADD COLUMN subtotal DECIMAL(15, 0)
    GENERATED ALWAYS AS (unit_price * quantity) STORED;

-- PostgreSQL: STORED만 가능
ALTER TABLE order_items
    ADD COLUMN subtotal DECIMAL(15, 0)
    GENERATED ALWAYS AS (unit_price * quantity) STORED;
```

#### 언제 Generated Column을 쓸까?

| 상황 | Generated Column | 앱에서 계산 |
|------|:---:|:---:|
| 같은 테이블의 컬럼 조합 | ✅ | |
| 다른 테이블의 값 참조 | | ✅ |
| 인덱스가 필요한 계산 값 | ✅ (STORED) | |
| 단순 조회용 | ✅ (VIRTUAL, MySQL) | |
| 복잡한 비즈니스 로직 | | ✅ |

**Generated Column의 가장 큰 장점**: 동기화 걱정이 없다. `unit_price`나 `quantity`가 바뀌면 `subtotal`도 자동으로 바뀐다. 반정규화처럼 "갱신 로직을 잊어먹는" 일이 불가능하다.

#### 실무에서의 DEFAULT와 Generated Column

**DEFAULT는 거의 모든 프로젝트에서 사용한다.** `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `status VARCHAR DEFAULT 'PENDING'`, `retry_count INT DEFAULT 0` 같은 패턴은 사실상 표준이다. ORM도 DEFAULT를 잘 지원하고, 개발자들도 거부감 없이 받아들인다. DEFAULT를 안 쓰는 것이 오히려 이상한 수준이다.

**Generated Column은 아직 인지도가 낮다.** 존재 자체를 모르는 개발자가 많고, 알아도 다음과 같은 이유로 꺼리는 경우가 있다:

- **ORM 호환성 우려**: JPA의 `@Column`과 Generated Column의 궁합에 대한 걱정. 실제로는 `insertable = false, updatable = false`만 설정하면 잘 동작하지만, 처음 접하면 어색하게 느껴진다.
- **PostgreSQL의 VIRTUAL 미지원**: MySQL에서는 VIRTUAL로 디스크 절약이 가능하지만, PostgreSQL은 STORED만 지원한다(17부터 VIRTUAL 예정). 디스크 사용량이 늘어나는 게 마음에 걸리는 팀이 있다.
- **"앱에서 계산하면 되잖아"**: 맞는 말이지만, 여러 서비스가 같은 테이블을 읽을 때 모든 서비스에서 동일한 계산 로직을 구현해야 한다. Generated Column이면 DB가 일관성을 보장한다.

**특히 유용한 실무 사례**:
- `subtotal = unit_price * quantity` — 주문 항목의 소계 자동 계산
- `full_name = first_name || ' ' || last_name` — 검색용 풀네임 자동 생성
- `is_expired = (expire_date < CURRENT_DATE)` — 만료 여부 자동 판정 (MySQL VIRTUAL로 저장 공간 0)
- Soft Delete 환경의 `active_email` (MySQL에서 부분 유니크를 흉내내는 트릭)

> **현실적 조언**: DEFAULT는 무조건 써라. Generated Column은 "같은 테이블 내 컬럼을 조합해서 자주 조회하는 값"이 있다면 적극 도입을 고려해라. 특히 반정규화를 고민 중이라면, Generated Column이 트리거나 앱 로직 없이 같은 효과를 낼 수 있는지 먼저 검토해 보자.

---

## 5. 방어적 스키마 설계 — 스키마로 잘못된 상태를 방지하기

"코드에서 검증하면 되잖아?"는 맞지만, **스키마 자체가 잘못된 상태를 허용하지 않으면** 버그를 원천 차단할 수 있다.

### 5.1 상태 전이를 스키마로 강제하기

```sql
-- ❌ 나쁜 설계: 모순되는 상태가 가능
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    is_paid BOOLEAN NOT NULL DEFAULT FALSE,
    is_shipped BOOLEAN NOT NULL DEFAULT FALSE,
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE
);

-- 이런 데이터가 들어갈 수 있다:
-- is_paid = TRUE, is_shipped = TRUE, is_cancelled = TRUE
-- 결제됐고 배송됐는데 취소됐다? 뭐가 맞는 거지?
```

```sql
-- ✅ 좋은 설계: 상태를 하나의 컬럼으로
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT chk_orders_status
        CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'))
);

-- 상태는 항상 하나. 모순 불가.
```

> 여러 개의 boolean 플래그로 상태를 관리하면 **2^n개의 조합**이 가능해진다. 3개면 8가지, 4개면 16가지. 그중 유효한 건 보통 4~5개뿐이다. 나머지는 전부 버그다. **하나의 상태 컬럼이 확실히 낫다.**

### 5.2 Soft Delete에서 활성 데이터 보호

```sql
-- 이메일은 활성 사용자 간에만 유일해야 한다
-- PostgreSQL
CREATE UNIQUE INDEX uq_users_email_active
    ON users (email) WHERE deleted_at IS NULL;

-- MySQL (Generated Column 우회)
ALTER TABLE users
    ADD COLUMN active_email VARCHAR(320)
    GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN email ELSE NULL END
    ) STORED;

ALTER TABLE users ADD CONSTRAINT uq_users_active_email UNIQUE (active_email);
```

### 5.3 양방향 범위가 겹치지 않도록 강제

이벤트의 유효 기간이 겹치면 안 되는 경우:

```sql
-- PostgreSQL: EXCLUDE 제약조건 (범위 겹침 방지)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE promotions (
    id BIGINT PRIMARY KEY,
    product_id BIGINT NOT NULL,
    discount_rate DECIMAL(5, 2) NOT NULL,
    valid_during TSTZRANGE NOT NULL,
    CONSTRAINT no_overlapping_promotions
        EXCLUDE USING GIST (product_id WITH =, valid_during WITH &&)
);

-- 같은 상품에 대해 기간이 겹치는 프로모션을 넣으면 에러
INSERT INTO promotions VALUES (1, 100, 10.00, '[2026-04-01, 2026-04-30]');
INSERT INTO promotions VALUES (2, 100, 20.00, '[2026-04-15, 2026-05-15]');
-- ❌ ERROR: conflicting key value violates exclusion constraint
```

> MySQL에는 EXCLUDE 제약조건이 없다. 이런 경우 앱 레벨에서 검증하거나, 트리거로 처리해야 한다.

### 5.4 숫자 범위를 스키마로 보호

```sql
-- 할인율은 0~100% 사이
ALTER TABLE promotions
    ADD CONSTRAINT chk_discount_rate
    CHECK (discount_rate >= 0 AND discount_rate <= 100);

-- 재고는 음수가 될 수 없다
ALTER TABLE products
    ADD CONSTRAINT chk_stock_non_negative
    CHECK (stock >= 0);

-- 주문 수량은 1 이상
ALTER TABLE order_items
    ADD CONSTRAINT chk_quantity_positive
    CHECK (quantity >= 1);
```

이 CHECK들이 없으면 **할인율 150%, 재고 -3, 수량 0** 같은 데이터가 들어갈 수 있다. 앱에서 잡으면 되지만, 직접 SQL로 데이터를 수정하는 상황에서는 앱 검증이 무력화된다.

### 5.5 NOT NULL로 "빈 상태" 방지

```sql
-- ❌ nullable이면: 주문인데 금액이 NULL? 고객이 NULL?
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT,         -- NULL이면 누구의 주문인지 모름
    total_amount DECIMAL,   -- NULL이면 금액을 모름
    status VARCHAR(20)      -- NULL이면 상태를 모름
);

-- ✅ NOT NULL로 강제: 주문이라면 반드시 있어야 하는 값
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**원칙**: 컬럼을 만들 때 "이 값이 없는 행이 존재할 수 있는가?"를 반드시 질문한다. 대답이 "아니오"면 `NOT NULL`.

#### 실무에서의 방어적 스키마 — 이상과 현실의 간극

방어적 스키마 설계는 "알면 좋지만 실제로 적용하는 팀은 많지 않다"가 현실이다.

**잘 적용되는 것들**:
- `NOT NULL` — 가장 기본적이고, ORM이 `nullable = false`로 쉽게 설정해 주므로 거부감이 없다. 실무에서 가장 많이, 가장 쉽게 적용되는 방어적 설계다.
- `status VARCHAR + CHECK` — boolean 플래그 대신 상태 컬럼을 쓰는 것은 경험 있는 팀에서는 당연하게 받아들여진다. 다만 CHECK까지 거는 팀과 앱에서만 검증하는 팀으로 나뉜다.
- `price > 0`, `quantity >= 1` 같은 기본 CHECK — 금융/결제 도메인에서는 거의 필수로 사용된다.

**잘 안 쓰이는 것들**:
- `EXCLUDE` 제약 (범위 겹침 방지) — PostgreSQL 전용이고 `btree_gist` 확장이 필요해서 존재 자체를 모르는 개발자가 대부분이다. 알고 있으면 매우 강력하지만, 현실에서는 앱 레벨이나 트리거로 처리하는 경우가 많다.
- 복잡한 CHECK (여러 컬럼 조합 검증) — 비즈니스 로직이 자주 바뀌면 CHECK도 함께 ALTER TABLE해야 해서 부담이 된다. 변경이 잦은 규칙은 앱에서 처리하는 게 현실적이다.

**핵심은 "안 하면 어떻게 되는가"를 기준으로 판단하는 것이다**:
- NOT NULL 없이 → NULL이 들어가면 앱 전체에서 NullPointerException 지뢰밭이 된다 → **반드시 써야 한다**
- 재고 CHECK 없이 → 음수 재고가 들어가면 정산이 꼬인다 → 금융/커머스라면 **반드시 써야 한다**
- EXCLUDE 없이 → 프로모션 기간 겹침 → 비즈니스 임팩트가 크면 도입, 아니면 앱에서 처리

> **현실적 조언**: NOT NULL은 기본, `price > 0` 같은 단순 CHECK는 최대한 걸어두고, EXCLUDE 같은 고급 기능은 "이거 없으면 운영 사고가 터질 수 있다"는 확신이 있을 때 도입하라.

---

## 6. 제약조건 네이밍 컨벤션

제약조건에 이름을 안 붙이면 DB가 자동으로 만든다. 문제는 자동 이름이 `SYS_C007234` 같은 무의미한 형태라서, 에러가 났을 때 어떤 제약조건이 위반된 건지 알 수 없다는 것이다.

| 제약조건 | 네이밍 패턴 | 예시 |
|---------|-----------|------|
| PRIMARY KEY | `pk_테이블` | `pk_orders` |
| FOREIGN KEY | `fk_자식테이블_부모테이블` | `fk_orders_users` |
| UNIQUE | `uq_테이블_컬럼` | `uq_users_email` |
| CHECK | `chk_테이블_설명` | `chk_orders_status` |
| DEFAULT | 보통 이름 안 붙임 | — |

```sql
-- ❌ 이름 없이
ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);
-- 에러: Cannot delete or update a parent row: a foreign key constraint fails
-- (`mydb`.`orders`, CONSTRAINT `orders_ibfk_1`, ...)  ← 뭔지 모름

-- ✅ 이름 있으면
ALTER TABLE orders ADD CONSTRAINT fk_orders_users
    FOREIGN KEY (user_id) REFERENCES users(id);
-- 에러: ... CONSTRAINT `fk_orders_users` ...  ← 바로 파악 가능
```

---

## 7. MySQL vs PostgreSQL — 제약조건 관련 차이 종합

| 기능 | MySQL | PostgreSQL |
|------|-------|------------|
| **CHECK** | 8.0.16+ (이전 버전은 무시) | 처음부터 지원 |
| **부분 인덱스** | 없음 | `CREATE INDEX ... WHERE 조건` |
| **EXCLUDE 제약** | 없음 | 범위 겹침 방지 가능 |
| **DEFERRABLE FK** | 미지원 | 지원 (`INITIALLY DEFERRED`) |
| **Generated Column** | VIRTUAL + STORED | STORED만 (17부터 VIRTUAL 예정) |
| **NULLS NOT DISTINCT** | 미지원 | 15+ 지원 |
| **ON UPDATE CURRENT_TIMESTAMP** | 지원 (MySQL 고유) | 미지원 → 트리거 필요 |
| **FK + 파티셔닝** | 파티션 테이블에 FK 불가 | 지원 (12+) |

> **PostgreSQL은 제약조건 측면에서 확실히 더 강력하다.** 부분 인덱스, EXCLUDE 제약, DEFERRABLE FK, NULLS NOT DISTINCT 등 MySQL에 없는 기능이 많다. MySQL을 쓴다면 이런 부분을 앱 레벨에서 보완해야 한다.

---

## 정리

| 주제 | 핵심 원칙 |
|------|-----------|
| **CHECK** | 단순한 값 범위는 DB CHECK로 강제. 앱 검증과 이중으로. MySQL 8.0.16+ 확인 필수 |
| **UNIQUE** | 비즈니스 유일성은 반드시 DB에서 보장. Soft Delete 환경에서는 부분 UNIQUE 활용 |
| **FK** | 기본은 "건다". 안 거는 건 무결성 책임을 앱으로 옮기는 것 — 각오 필요 |
| **DEFAULT / Generated** | 빠뜨린 값은 DEFAULT, 계산 값은 Generated Column. 동기화 걱정 없음 |
| **방어적 설계** | boolean 플래그 대신 상태 컬럼, NOT NULL 기본, 스키마로 불가능한 상태 차단 |

**제약조건은 귀찮은 것이 아니라 "코드를 안 짜도 되는 검증"이다.** CHECK 하나가 `if` 문 10개를 대신할 수 있고, FK 하나가 고아 데이터 탐지 배치를 대신할 수 있다. 처음에 10분 더 쓰는 게, 운영 중 데이터 정합성 깨진 걸 수습하는 것보다 100배 싸다.

### 실무 채택 현실 — 한눈에 보기

| 제약조건 | 실무 채택률 | 현실 |
|---------|:---:|------|
| **NOT NULL** | ★★★★★ | 거의 모든 팀이 사용. 안 쓰는 게 오히려 이상 |
| **DEFAULT** | ★★★★★ | `created_at`, `status` 기본값 등 사실상 표준 |
| **UNIQUE** | ★★★★☆ | 이메일, 주문번호 등 핵심 컬럼에는 반드시 사용. 레이스 컨디션 방지에 필수 |
| **FK** | ★★★☆☆ | 모놀리스/소규모에선 적극 사용, MSA/대규모에선 안 쓰는 경우 많음 |
| **CHECK** | ★★☆☆☆ | MySQL 늦은 지원 + ORM 미지원으로 인지도 낮음. 금융/결제 도메인에서는 활발 |
| **Generated Column** | ★★☆☆☆ | 존재 자체를 모르는 개발자 다수. 알면 유용하지만 도입 사례 적음 |
| **EXCLUDE** | ★☆☆☆☆ | PostgreSQL 전용 + 인지도 극히 낮음. 아는 팀만 사용 |

**"다 걸어야 하나요?"에 대한 현실적인 답**:

```
[필수] NOT NULL + DEFAULT + UNIQUE   → 안 하면 바로 문제가 터진다
[권장] FK + 기본 CHECK (price > 0)    → 하면 확실히 안전하다
[선택] Generated Column + EXCLUDE    → 알면 강력하지만, 팀 합의가 필요하다
```

제약조건은 나중에 추가하는 것보다 처음부터 거는 게 훨씬 쉽다. 나중에 추가하려면 기존 데이터가 제약조건을 만족하는지 검증부터 해야 하고, 만족하지 않는 데이터를 정리하는 마이그레이션까지 필요하다. **"일단 없이 가고 나중에 필요하면 추가하자"는 대부분 "영원히 추가하지 않는다"와 같은 말이 된다.**

다음 편에서는 **관계 설계 패턴** — 1:1 / 1:N / N:M 판단 기준, 자기참조, 다형성 관계를 다룬다.
