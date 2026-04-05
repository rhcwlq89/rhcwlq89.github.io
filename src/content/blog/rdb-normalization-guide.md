---
title: "RDB 설계 시리즈 2편: 정규화와 반정규화 — 이론이 아니라 판단 기준"
description: "정규화는 '무조건 해야 하는 것'이 아니고, 반정규화는 '성능을 위한 타협'이 아니다. 1NF부터 3NF까지 실무 예제로 정리하고, 언제 정규화를 깨는 게 맞는지 MySQL/PostgreSQL 기준으로 판단 기준을 제시한다."
pubDate: 2026-04-05T16:00:00+09:00
tags:
  - Database
  - RDB
  - Schema Design
  - Normalization
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbNormalizationGuide.png"
---

## 서론

[이전 글](/blog/rdb-schema-basics-guide)에서 테이블을 만들기 전에 결정해야 하는 기초(네이밍, 데이터 타입, PK, NULL)를 다뤘다. 이번 글에서는 한 단계 더 들어가서 — **"컬럼을 어떻게 나누고 묶을 것인가?"** 를 다룬다.

정규화(Normalization)라는 단어를 들으면 교과서가 먼저 떠오른다. 1NF, 2NF, 3NF... 시험 문제 같은 용어들. 하지만 실무에서 정규화는 **"이 컬럼이 여기 있어야 하나?"** 라는 질문에 답하는 도구다.

문제는 정규화만 알면 안 된다는 것이다. 서비스가 커지면 **"이미 정규화된 구조가 성능을 죽이는 순간"** 이 온다. 그때 필요한 게 반정규화(Denormalization)다.

이 글에서는:
1. 1NF ~ 3NF를 실무 예제로 빠르게 정리한다
2. BCNF를 간략히 소개한다
3. **언제 정규화를 깨는 게 맞는지** 판단 기준을 제시한다
4. MySQL/PostgreSQL에서의 차이를 다룬다

---

## 1. 정규화란?

한 줄 요약: **데이터 중복을 제거하고, 한 곳에서만 관리하도록 테이블을 쪼개는 과정.**

왜 중복이 나쁜가? 예시를 보면 바로 와닿는다.

### 정규화 전: 중복이 있는 테이블

```sql
CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY,
    customer_name VARCHAR(50),
    customer_email VARCHAR(320),
    customer_phone VARCHAR(20),
    product_name VARCHAR(100),
    product_price DECIMAL(15, 0),
    quantity INT,
    order_date TIMESTAMP
);
```

```
| order_id | customer_name | customer_email    | product_name | product_price | quantity |
|----------|--------------|-------------------|-------------|--------------|---------|
| 1        | 김철수        | kim@email.com     | 키보드        | 50000         | 1       |
| 2        | 김철수        | kim@email.com     | 마우스        | 30000         | 2       |
| 3        | 이영희        | lee@email.com     | 키보드        | 50000         | 1       |
```

#### 세 가지 문제 (이상 현상, Anomaly)

| 이상 현상 | 상황 | 결과 |
|-----------|------|------|
| **삽입 이상** (Insert) | 아직 주문이 없는 신규 고객 정보를 저장하고 싶다 | 주문 없이는 고객 정보를 넣을 수 없음 (PK가 order_id) |
| **갱신 이상** (Update) | 김철수의 이메일이 바뀌었다 | 2개 행을 다 수정해야 함. 하나 빼먹으면 데이터 불일치 |
| **삭제 이상** (Delete) | 이영희의 주문 #3을 취소한다 | 이영희의 고객 정보 자체가 사라짐 |

정규화는 이 세 가지 이상 현상을 방지하기 위한 것이다.

---

## 2. 정규화 단계

### 2.1 제1정규형 (1NF) — 원자값

**규칙: 모든 컬럼은 하나의 값만 가져야 한다.**

```sql
-- ❌ 1NF 위반: 하나의 셀에 여러 값
| order_id | products           |
|----------|--------------------|
| 1        | 키보드, 마우스       |
| 2        | 모니터              |

-- ⭕ 1NF 만족: 행을 분리
| order_id | product  |
|----------|----------|
| 1        | 키보드    |
| 1        | 마우스    |
| 2        | 모니터    |
```

#### 실무에서 자주 보는 1NF 위반

```sql
-- 패턴 1: 쉼표 구분 문자열
tags VARCHAR(500)  -- 값: "java,spring,docker"

-- 패턴 2: 번호 붙은 컬럼
phone1 VARCHAR(20),
phone2 VARCHAR(20),
phone3 VARCHAR(20)

-- 패턴 3: JSON 배열 (MySQL 5.7+, PostgreSQL 9.4+)
tags JSON  -- 값: ["java", "spring", "docker"]
```

| 패턴 | 문제 | 해결 |
|------|------|------|
| **쉼표 구분** | 검색 불가 (`WHERE tags LIKE '%spring%'`은 "springframework"도 매칭), 인덱스 못 탐 | 별도 테이블로 분리 |
| **번호 붙은 컬럼** | 4번째 전화번호가 필요하면 `ALTER TABLE`. 빈 컬럼 낭비 | 별도 테이블로 분리 |
| **JSON 배열** | MySQL: 인덱스 제한적 (Generated Column 필요). 정렬/집계 어려움 | 별도 테이블로 분리 (또는 PG의 GIN 인덱스 활용) |

> **JSON은 1NF 위반인가?** 엄밀히 말하면 그렇다. 하지만 PostgreSQL의 `JSONB` + GIN 인덱스는 검색 성능이 좋기 때문에, **비정형 데이터나 속성이 유동적인 경우**에는 실용적인 선택이다. "무조건 분리"가 아니라 "검색/집계가 필요한가?"로 판단하면 된다.

### 2.2 제2정규형 (2NF) — 부분 종속 제거

**규칙: 기본키의 일부에만 종속되는 컬럼을 제거한다.**

2NF는 **복합키**를 사용할 때만 의미가 있다. 단일 PK(AUTO_INCREMENT)를 쓰면 2NF는 자동으로 만족된다.

```sql
-- ❌ 2NF 위반: 복합키 (order_id, product_id)인데 product_name은 product_id에만 종속
CREATE TABLE order_items (
    order_id BIGINT,
    product_id BIGINT,
    product_name VARCHAR(100),    -- product_id만 알면 결정됨
    product_price DECIMAL(15, 0), -- product_id만 알면 결정됨
    quantity INT,
    PRIMARY KEY (order_id, product_id)
);
```

```
order_id + product_id → quantity        (전체 키에 종속 ✅)
product_id → product_name, product_price (부분 키에 종속 ❌)
```

```sql
-- ⭕ 2NF 만족: 부분 종속을 별도 테이블로
CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(15, 0) NOT NULL
);

CREATE TABLE order_items (
    order_id BIGINT,
    product_id BIGINT,
    quantity INT NOT NULL,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

> **실무에서 2NF를 의식적으로 적용하는 경우는 드물다.** 대부분 Surrogate Key(BIGINT AUTO_INCREMENT)를 PK로 쓰기 때문에 복합키 자체가 잘 나오지 않는다. 하지만 **Junction Table(N:M 관계)** 에서는 복합키를 쓰는 경우가 있으므로, 그때 2NF를 떠올리면 된다.

### 2.3 제3정규형 (3NF) — 이행 종속 제거

**규칙: 키가 아닌 컬럼이 다른 키가 아닌 컬럼에 종속되면 안 된다.**

쉽게 말하면: **"PK를 통해서만 모든 컬럼이 결정되어야 한다."**

```sql
-- ❌ 3NF 위반: department_name은 department_id에 종속 (PK인 employee_id가 아님)
CREATE TABLE employees (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    department_id INT NOT NULL,
    department_name VARCHAR(50)    -- department_id가 결정하는 값
);
```

```
id → name, department_id        (PK 종속 ✅)
department_id → department_name  (이행 종속 ❌: id → department_id → department_name)
```

```sql
-- ⭕ 3NF 만족
CREATE TABLE departments (
    id INT PRIMARY KEY,
    name VARCHAR(50) NOT NULL
);

CREATE TABLE employees (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    department_id INT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
);
```

#### 3NF 위반의 실무 예시

| 위반 패턴 | 예시 | 문제 |
|-----------|------|------|
| 주문에 고객 이름 저장 | `orders.customer_name` | 고객 이름 변경 시 모든 주문 수정 필요 |
| 상품에 카테고리 이름 저장 | `products.category_name` | 카테고리 이름 변경 시 모든 상품 수정 필요 |
| 직원에 부서 주소 저장 | `employees.department_address` | 부서 이전 시 모든 직원 수정 필요 |

> **3NF가 실무에서 가장 자주 위반되는 정규형**이다. "JOIN이 귀찮아서" 또는 "조회 성능 때문에" 다른 테이블의 값을 가져다 놓는 게 3NF 위반이다. 이것이 의도적인 반정규화인지, 실수인지는 뒤에서 다룬다.

### 2.4 BCNF (Boyce-Codd Normal Form) — 3NF의 강화

3NF를 만족해도 BCNF를 위반하는 경우가 있다. 실무에서는 드물지만, 알아두면 좋다.

**규칙: 모든 결정자(Determinant)가 후보키여야 한다.**

```sql
-- 대학 수강 시스템 예시
-- 제약: 각 교수는 하나의 과목만 담당
CREATE TABLE course_assignments (
    student_id BIGINT,
    course VARCHAR(50),
    professor VARCHAR(50),
    PRIMARY KEY (student_id, course)
);
```

```
student_id + course → professor  (PK 종속 ✅, 3NF 만족)
professor → course               (교수가 과목을 결정 — 하지만 professor는 후보키가 아님!)
→ BCNF 위반
```

```sql
-- ⭕ BCNF 만족
CREATE TABLE professor_courses (
    professor VARCHAR(50) PRIMARY KEY,
    course VARCHAR(50) NOT NULL
);

CREATE TABLE enrollments (
    student_id BIGINT,
    professor VARCHAR(50),
    PRIMARY KEY (student_id, professor),
    FOREIGN KEY (professor) REFERENCES professor_courses(professor)
);
```

> **실무에서는 3NF까지 적용하면 충분**하다. BCNF까지 신경 쓸 필요가 있는 경우는 복합키가 많고 비즈니스 규칙이 복잡한 도메인(학사 관리, 예약 시스템 등)뿐이다.

---

## 3. 정규화 요약 — 한눈에 보기

| 정규형 | 한 줄 요약 | 제거하는 것 | 실무 중요도 |
|--------|-----------|-----------|:---:|
| **1NF** | 하나의 셀에 하나의 값 | 다중 값, 반복 그룹 | 높음 |
| **2NF** | 복합키의 일부에 종속 금지 | 부분 종속 | 보통 (단일 PK면 자동 만족) |
| **3NF** | 비키 컬럼 간 종속 금지 | 이행 종속 | **매우 높음** (가장 자주 위반) |
| **BCNF** | 모든 결정자가 후보키 | 결정자 ≠ 후보키 | 낮음 (복잡한 복합키에서만) |

---

## 4. 반정규화 — 언제 정규화를 깨는가?

정규화된 스키마는 **데이터 무결성**에서는 최선이지만, **조회 성능**에서는 최선이 아닐 수 있다. 이 트레이드오프를 의식적으로 선택하는 게 반정규화다.

### 4.1 반정규화가 필요한 신호

```
1. JOIN이 5개 이상인 쿼리가 빈번하게 실행된다
2. 집계/통계 쿼리가 느려서 사용자 경험에 영향을 준다
3. 같은 데이터를 여러 테이블에서 반복 JOIN하여 읽는다
4. 인덱스 최적화, 쿼리 튜닝을 다 해봤는데도 느리다
```

> **중요: 반정규화는 최후의 수단이다.** 인덱스 추가, 쿼리 최적화, 캐싱(Redis 등)을 먼저 시도하고, 그래도 안 되면 반정규화를 고려한다.

### 4.2 반정규화 패턴

#### 패턴 1: 계산된 컬럼 (Derived Column)

```sql
-- 정규화 상태: 주문 총액을 매번 계산
SELECT o.id, SUM(oi.price * oi.quantity) AS total
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;

-- 반정규화: 총액을 미리 저장
ALTER TABLE orders ADD COLUMN total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0;

-- INSERT/UPDATE 시 총액도 함께 갱신
UPDATE orders SET total_amount = (
    SELECT SUM(price * quantity) FROM order_items WHERE order_id = orders.id
) WHERE id = ?;
```

| 장점 | 단점 |
|------|------|
| 조회 시 JOIN + SUM 불필요 | 주문 항목 변경 시 총액도 갱신해야 함 |
| 인덱스로 총액 기준 정렬/필터 가능 | 갱신 누락 시 데이터 불일치 |

#### MySQL vs PostgreSQL 구현 차이

```sql
-- MySQL: Generated Column (가상 컬럼은 저장 안 됨, STORED는 저장됨)
-- ⚠️ 주의: Generated Column은 같은 테이블의 컬럼만 참조 가능. 다른 테이블 JOIN 불가.
ALTER TABLE order_items
ADD COLUMN line_total DECIMAL(15, 0) GENERATED ALWAYS AS (price * quantity) STORED;

-- PostgreSQL: Generated Column (STORED만 지원)
ALTER TABLE order_items
ADD COLUMN line_total DECIMAL(15, 0) GENERATED ALWAYS AS (price * quantity) STORED;

-- PostgreSQL: Materialized View (다른 테이블 JOIN 가능)
CREATE MATERIALIZED VIEW order_totals AS
SELECT order_id, SUM(price * quantity) AS total_amount
FROM order_items
GROUP BY order_id;

-- 데이터 갱신
REFRESH MATERIALIZED VIEW CONCURRENTLY order_totals;
```

> **PostgreSQL의 Materialized View**는 반정규화의 강력한 대안이다. 테이블에 중복 컬럼을 추가하지 않으면서도 집계 결과를 캐싱할 수 있다. `CONCURRENTLY` 옵션을 쓰면 갱신 중에도 읽기가 가능하다. MySQL에는 이 기능이 없어서 직접 요약 테이블을 관리해야 한다.

#### 패턴 2: 요약 테이블 (Summary Table)

```sql
-- 문제: 일별 매출 통계를 매번 전체 주문에서 계산
SELECT DATE(order_date) AS day, SUM(total_amount) AS daily_sales
FROM orders
WHERE order_date >= '2026-01-01'
GROUP BY DATE(order_date);
-- 주문이 수백만 건이면 매번 느림

-- 해결: 요약 테이블
CREATE TABLE daily_sales_summary (
    sale_date DATE PRIMARY KEY,
    total_orders INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 배치 또는 이벤트로 갱신
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders
WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON DUPLICATE KEY UPDATE  -- MySQL
    total_orders = VALUES(total_orders),
    total_amount = VALUES(total_amount),
    updated_at = CURRENT_TIMESTAMP;
```

```sql
-- PostgreSQL: ON CONFLICT 사용
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders
WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON CONFLICT (sale_date) DO UPDATE SET
    total_orders = EXCLUDED.total_orders,
    total_amount = EXCLUDED.total_amount,
    updated_at = CURRENT_TIMESTAMP;
```

#### 패턴 3: 중복 컬럼 (Redundant Column)

```sql
-- 정규화 상태: 주문 목록에서 고객 이름을 보려면 항상 JOIN
SELECT o.id, o.order_date, c.name AS customer_name
FROM orders o
JOIN customers c ON c.id = o.customer_id;

-- 반정규화: 주문에 고객 이름을 중복 저장
ALTER TABLE orders ADD COLUMN customer_name VARCHAR(50);
```

**이건 가장 위험한 반정규화**다. 고객 이름이 바뀌면 `orders`의 모든 행을 수정해야 한다.

하지만 정당한 경우도 있다:

```sql
-- ⭕ 정당한 경우: "주문 시점의 배송지"를 보존해야 할 때
ALTER TABLE orders ADD COLUMN shipping_address TEXT NOT NULL;
-- 고객이 주소를 바꿔도 이미 발송된 주문의 배송지는 바뀌면 안 된다
-- 이건 반정규화가 아니라 "스냅샷" — 비즈니스 요구사항이다

-- ⭕ 정당한 경우: "주문 시점의 상품 가격"을 보존해야 할 때
ALTER TABLE order_items ADD COLUMN unit_price DECIMAL(15, 0) NOT NULL;
-- 상품 가격이 바뀌어도 이전 주문의 금액은 그대로여야 한다
```

> **"스냅샷"과 "반정규화"를 구분**해야 한다. 주문 시점의 가격/주소 저장은 비즈니스 요구사항이지, 성능 때문에 중복을 넣은 게 아니다. 이건 정규화 위반이 아니라 **올바른 설계**다.

#### 패턴 4: 테이블 병합

```sql
-- 정규화 상태: 사용자와 프로필이 분리
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY,
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
-- 조회 시 항상 JOIN 필요

-- 반정규화: 병합
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048)
);
```

| 병합이 적절한 경우 | 병합하면 안 되는 경우 |
|-------------------|---------------------|
| 1:1 관계이고, 거의 항상 함께 조회된다 | 한쪽만 자주 조회된다 (불필요한 데이터 로딩) |
| 분리된 테이블 중 하나가 매우 작다 | 한쪽이 매우 크다 (행 크기 증가 → 버퍼 캐시 효율 감소) |
| 분리 이유가 "원래 그래야 할 것 같아서"뿐이다 | 접근 권한이 다르다 (비밀번호 테이블 vs 프로필 테이블) |

### 4.3 반정규화 판단 체크리스트

반정규화를 하기 전에 이 질문들을 먼저 확인하라:

```
□ 인덱스 최적화를 시도했는가?
□ 쿼리를 리팩토링했는가? (불필요한 JOIN 제거, 서브쿼리 → JOIN 변환 등)
□ 캐싱 계층(Redis, 애플리케이션 캐시)을 검토했는가?
□ 읽기 전용 레플리카로 부하 분산을 고려했는가?
□ Materialized View(PostgreSQL)를 검토했는가?
```

**위 항목을 모두 검토한 후에도** 성능이 부족하면 반정규화를 고려한다.

#### 반정규화 시 필수 조치

| 조치 | 이유 |
|------|------|
| **갱신 로직 문서화** | 중복 데이터를 누가, 언제, 어떻게 갱신하는지 명시 |
| **트리거 또는 이벤트로 동기화** | 수동 갱신은 반드시 누락됨. 자동화 필수 |
| **불일치 감지 쿼리 작성** | 정기적으로 원본과 중복 데이터의 일치 여부 확인 |
| **주석으로 이유 남기기** | `-- 반정규화: 주문 목록 API 응답 시간 개선 (2026-04-05)` |

```sql
-- MySQL: 트리거로 요약 테이블 동기화
DELIMITER //
CREATE TRIGGER trg_order_items_after_insert
AFTER INSERT ON order_items
FOR EACH ROW
BEGIN
    UPDATE orders
    SET total_amount = (
        SELECT SUM(price * quantity) FROM order_items WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
END //
DELIMITER ;
```

```sql
-- PostgreSQL: 트리거 함수
CREATE OR REPLACE FUNCTION update_order_total()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET total_amount = (
        SELECT COALESCE(SUM(price * quantity), 0)
        FROM order_items
        WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_items_after_insert
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION update_order_total();
```

---

## 5. 정규화 vs 반정규화 — 실무 판단 매트릭스

| 상황 | 정규화 유지 | 반정규화 고려 |
|------|:---------:|:----------:|
| 데이터 변경이 빈번하다 | ✅ | |
| 데이터 무결성이 핵심이다 (금융, 의료) | ✅ | |
| 테이블 규모가 작다 (수만 건 이하) | ✅ | |
| 읽기가 쓰기보다 압도적으로 많다 | | ✅ |
| 집계/통계 쿼리가 빈번하다 | | ✅ |
| JOIN 5개 이상 쿼리가 반복된다 | | ✅ |
| 이미 인덱스/캐싱을 다 적용했다 | | ✅ |

### OLTP vs OLAP

| 특성 | OLTP (트랜잭션 처리) | OLAP (분석 처리) |
|------|:---:|:---:|
| 정규화 수준 | 높음 (3NF 이상) | 낮음 (반정규화, 스타 스키마) |
| 최적화 대상 | 쓰기 속도, 데이터 무결성 | 읽기 속도, 집계 성능 |
| 예시 | 주문, 결제, 회원가입 | 매출 대시보드, 리포트, BI |

> **같은 DB에서 OLTP와 OLAP를 동시에 하려고 하면 둘 다 망한다.** OLTP용 정규화된 스키마에서 무거운 집계 쿼리를 돌리면 서비스 응답이 느려지고, 반정규화하면 쓰기 로직이 복잡해진다. 분석용 데이터가 필요하면 **별도의 분석 DB(Data Warehouse)나 Materialized View**로 분리하는 게 맞다.

---

## 6. MySQL vs PostgreSQL — 정규화/반정규화 관련 차이

| 기능 | MySQL | PostgreSQL | 반정규화 대안으로서의 가치 |
|------|-------|------------|----------------------|
| **Materialized View** | 없음 (수동 요약 테이블 필요) | 있음 (`REFRESH CONCURRENTLY` 지원) | PG에서는 반정규화 전에 MV를 먼저 검토 |
| **Generated Column** | `VIRTUAL` (저장 안 됨) + `STORED` | `STORED`만 지원 | 같은 테이블 내 계산은 두 DB 모두 가능 |
| **JSON 지원** | `JSON` 타입, 제한적 인덱싱 (Generated Column + Index) | `JSONB` + GIN 인덱스 (강력) | PG는 반정형 데이터를 정규화 없이 효율적으로 처리 |
| **부분 인덱스** | 없음 | `CREATE INDEX ... WHERE 조건` | PG에서는 특정 조건의 조회를 인덱스로 해결 가능 → 반정규화 불필요한 경우 많음 |
| **UPSERT** | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` | 요약 테이블 갱신 패턴은 두 DB 모두 지원 |
| **트리거** | `BEFORE/AFTER` + `FOR EACH ROW` | 동일 + `INSTEAD OF`, `FOR EACH STATEMENT` | PG 트리거가 더 유연 (Statement-level 트리거로 배치 갱신) |

> **결론**: PostgreSQL은 Materialized View, 부분 인덱스, JSONB 같은 기능 덕분에 **MySQL보다 반정규화를 덜 해도 되는 경우가 많다.** MySQL에서 성능 때문에 반정규화했던 것이 PostgreSQL에서는 MV나 부분 인덱스로 해결되는 경우가 있다.

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **정규화란?** | 데이터 중복을 제거하여 이상 현상(삽입/갱신/삭제)을 방지하는 과정 |
| **실무에서는 3NF까지** | 1NF(원자값) → 2NF(부분 종속 제거) → 3NF(이행 종속 제거)가 기본 |
| **반정규화는 최후의 수단** | 인덱스, 쿼리 최적화, 캐싱, MV를 먼저 시도. 그래도 안 되면 고려 |
| **스냅샷 ≠ 반정규화** | 주문 시점 가격/주소 저장은 비즈니스 요구사항이지 중복이 아니다 |
| **MySQL vs PostgreSQL** | PG는 MV, 부분 인덱스, JSONB 덕분에 반정규화가 덜 필요한 경우가 많다 |

다음 편에서는 **제약조건과 데이터 무결성** — CHECK, UNIQUE, FK 트레이드오프, 방어적 스키마 설계를 다룬다.
