---
title: "RDB 설계 시리즈 2편: 정규화와 반정규화 — 이론이 아니라 판단 기준"
description: "정규화는 '무조건 해야 하는 것'이 아니고, 반정규화는 '성능을 위한 타협'이 아니다. 쇼핑몰 시나리오 하나로 1NF부터 3NF까지 직관적으로 설명하고, 언제 정규화를 깨는 게 맞는지 MySQL/PostgreSQL 기준으로 판단 기준을 제시한다."
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

정규화라는 단어를 들으면 교과서가 먼저 떠오른다. 1NF, 2NF, 3NF... 하지만 실무에서 정규화는 단순한 질문이다: **"이 데이터를 여기에 두면 나중에 고생하지 않을까?"**

이 글에서는 **쇼핑몰**이라는 하나의 시나리오로 정규화를 처음부터 끝까지 설명한다. 이론 용어는 최소한으로 쓰고, "왜 이렇게 나누는 게 맞는지"를 직관적으로 느낄 수 있도록 구성했다.

---

## 1. 왜 테이블을 나눠야 하는가?

### 쇼핑몰을 하나의 테이블로 만들면?

신입 개발자가 쇼핑몰을 만들면서 모든 걸 하나의 테이블에 넣었다고 해보자.

```sql
CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY,
    customer_name VARCHAR(50),
    customer_email VARCHAR(320),
    product_name VARCHAR(100),
    product_price DECIMAL(15, 0),
    quantity INT,
    order_date TIMESTAMP
);
```

```
| order_id | customer_name | customer_email  | product_name | product_price | quantity |
|----------|--------------|-----------------|-------------|--------------|---------|
| 1        | 김철수        | kim@email.com   | 키보드        | 50,000        | 1       |
| 2        | 김철수        | kim@email.com   | 마우스        | 30,000        | 2       |
| 3        | 이영희        | lee@email.com   | 키보드        | 50,000        | 1       |
```

데이터는 잘 들어간다. 쿼리도 된다. 그런데 **운영을 시작하면 세 가지 고통이 찾아온다.**

### 고통 1: 같은 데이터를 여러 번 수정해야 한다

김철수가 이메일을 바꿨다.

```sql
UPDATE orders SET customer_email = 'new@email.com' WHERE customer_name = '김철수';
-- 2개 행을 수정해야 한다. 10개 주문이 있으면 10개. 100개면 100개.
-- 하나라도 빼먹으면? 김철수의 이메일이 두 가지가 된다.
```

> **비유**: 친구의 전화번호가 바뀌었는데, 연락처 앱에 같은 사람이 10번 저장되어 있다면? 10개를 다 바꿔야 한다. 하나라도 놓치면 옛날 번호로 전화하게 된다.

### 고통 2: 데이터를 넣고 싶은데 넣을 수 없다

신규 상품 "모니터"를 등록하고 싶다. 아직 아무도 주문하지 않았다.

```sql
INSERT INTO orders (product_name, product_price) VALUES ('모니터', 500000);
-- ❌ order_id(PK)가 없어서 넣을 수 없다!
-- 주문이 없으면 상품 정보도 저장할 방법이 없다.
```

> **비유**: 레스토랑 메뉴판에 새 메뉴를 추가하려는데, "누군가 주문해야만 메뉴에 올릴 수 있다"고 하는 것과 같다.

### 고통 3: 데이터를 삭제하면 관련 없는 것도 사라진다

이영희가 주문을 취소했다.

```sql
DELETE FROM orders WHERE order_id = 3;
-- 이영희의 주문을 삭제했더니... 이영희라는 고객이 존재했다는 정보 자체가 사라졌다!
-- "키보드가 50,000원"이라는 상품 정보도 함께 사라졌다.
```

> **비유**: 사진첩에서 작년 여행 사진을 삭제했더니, 그 여행에서 찍은 친구의 연락처까지 사라진 것이다.

### 이 세 가지를 정리하면

| 고통 | 원인 | 정식 이름 |
|------|------|-----------|
| 같은 데이터 여러 번 수정 | 한 사실이 여러 행에 중복 저장 | 갱신 이상 (Update Anomaly) |
| 넣고 싶은데 못 넣음 | 관련 없는 데이터가 하나의 테이블에 묶여 있음 | 삽입 이상 (Insert Anomaly) |
| 삭제하면 다른 것도 사라짐 | 관련 없는 데이터가 하나의 테이블에 묶여 있음 | 삭제 이상 (Delete Anomaly) |

**정규화는 이 세 가지 고통을 없애는 과정이다.** 방법은 간단하다 — 관련 있는 것끼리 테이블을 나누면 된다.

---

## 2. 정규화 단계 — 쇼핑몰을 점점 깔끔하게

### 2.1 1NF — "한 칸에 하나만"

제1정규형의 규칙은 하나다: **하나의 셀에 하나의 값만.**

```sql
-- ❌ 한 칸에 여러 값이 들어있다
| order_id | products           |
|----------|--------------------|
| 1        | 키보드, 마우스       |
| 2        | 모니터              |
```

"주문 1에서 키보드만 취소하고 싶은데?" — 셀을 쪼개서 파싱해야 한다. 인덱스도 못 탄다.

```sql
-- ⭕ 행을 나누면 해결
| order_id | product  |
|----------|----------|
| 1        | 키보드    |
| 1        | 마우스    |
| 2        | 모니터    |
```

> **비유**: 엑셀에서 "서울, 부산, 대구"를 한 셀에 쓰면 필터링이 안 된다. 한 행에 하나씩 써야 정렬하고 검색할 수 있다.

#### 실무에서 자주 보는 1NF 위반

| 패턴 | 예시 | 왜 문제인가 |
|------|------|-----------|
| **쉼표 구분** | `tags = "java,spring,docker"` | `LIKE '%spring%'`은 "springframework"도 매칭. 인덱스 사용 불가 |
| **번호 붙은 컬럼** | `phone1`, `phone2`, `phone3` | 4번째 번호가 필요하면 `ALTER TABLE`. 빈 컬럼 낭비 |
| **JSON 배열** | `tags = ["java", "spring"]` | MySQL: 인덱스 제한적. 정렬/집계 어려움 |

해결은 전부 같다 — **별도 테이블로 분리**.

> **JSON은 예외가 될 수 있다**: PostgreSQL의 `JSONB` + GIN 인덱스는 검색 성능이 좋다. "이 데이터를 검색하거나 집계해야 하는가?"로 판단하면 된다. 검색 필요 없으면 JSON도 괜찮고, 필요하면 분리하는 게 맞다.

### 2.2 2NF — "PK 전체에 의존하는 것만"

1NF를 만족시킨 쇼핑몰 테이블을 보자:

```sql
CREATE TABLE order_items (
    order_id BIGINT,
    product_id BIGINT,
    product_name VARCHAR(100),     -- 🤔 이게 여기 있어야 하나?
    product_price DECIMAL(15, 0),  -- 🤔 이것도?
    quantity INT,
    PRIMARY KEY (order_id, product_id)
);
```

질문을 해보자: **"상품 이름을 알려면 뭐가 필요한가?"**

- `quantity`(수량) → `order_id`와 `product_id` **둘 다** 필요. "주문 1에서 상품 A를 몇 개 샀지?" ✅
- `product_name`(상품명) → `product_id`**만** 있으면 안다. 주문번호는 필요 없다. ❌

상품명은 주문과 상관없이 상품 자체의 정보다. 그런데 주문 테이블에 있으니까 **같은 상품이 100번 주문되면 상품명이 100번 중복**된다.

```sql
-- ⭕ 상품 정보는 상품 테이블로
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

> **비유**: 반 명단에 학생 이름과 제출한 과제를 적는다고 해보자. "김철수 — 과제1, 김철수 — 과제2, 김철수 — 과제3"... 김철수라는 이름이 계속 반복된다. 학생 명단과 과제 제출 목록을 나누면 이름은 한 번만 쓰면 된다.

> **실무 팁**: 대부분 `BIGINT AUTO_INCREMENT` 단일 PK를 쓰기 때문에 2NF 위반은 잘 발생하지 않는다. **복합키를 쓰는 중간 테이블(N:M 관계)**에서만 주의하면 된다.

### 2.3 3NF — "PK에서 직접 결정되는 것만"

2NF를 만족시킨 상태에서, 직원 테이블을 보자:

```sql
CREATE TABLE employees (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50),
    department_id INT,
    department_name VARCHAR(50)   -- 🤔 이게 여기 있어야 하나?
);
```

```
| id | name   | department_id | department_name |
|----|--------|:---:|------------|
| 1  | 김철수  | 10  | 개발팀      |
| 2  | 이영희  | 10  | 개발팀      |
| 3  | 박민수  | 20  | 마케팅팀    |
```

질문: **"부서 이름을 알려면 뭐가 필요한가?"**

- 직원 ID → 부서 ID → 부서 이름. **부서 이름은 직원이 아니라 부서가 결정하는 값**이다.
- 그런데 직원 테이블에 있으니까, 개발팀에 100명이 있으면 "개발팀"이라는 글자가 100번 저장된다.

개발팀 이름이 "엔지니어링팀"으로 바뀌면?

```sql
UPDATE employees SET department_name = '엔지니어링팀' WHERE department_id = 10;
-- 100명분 다 수정해야 한다. 하나라도 빠뜨리면?
-- department_id = 10인데 이름이 "개발팀"인 사람과 "엔지니어링팀"인 사람이 공존한다.
```

```sql
-- ⭕ 부서 정보는 부서 테이블로
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
-- 부서 이름 변경 = departments 테이블 1행만 수정하면 끝
```

> **비유**: 우편번호와 주소의 관계를 생각하면 된다. 우편번호 "06234"의 주소가 바뀌면, 우편번호 테이블 한 곳만 수정하면 된다. 모든 고객의 주소를 일일이 수정할 필요가 없다.

#### 3NF 위반의 핵심 징후

**"이 컬럼의 값이 바뀌었을 때, 여러 행을 수정해야 하나?"** — 그렇다면 3NF 위반일 가능성이 높다.

| 위반 | 뭘 수정하면 여러 행에 영향? | 해결 |
|------|-------------------------|------|
| `orders.customer_name` | 고객 이름 변경 | customers 테이블 분리 |
| `products.category_name` | 카테고리 이름 변경 | categories 테이블 분리 |
| `employees.department_name` | 부서 이름 변경 | departments 테이블 분리 |

### 2.4 BCNF — 3NF의 특수한 경우

실무에서는 드물지만, 간략히 소개한다.

3NF까지 했는데도 문제가 남는 경우가 있다. **"PK가 아닌 컬럼이 다른 컬럼을 결정하는 경우"**다.

```
예: 대학 수강 시스템
- 한 교수는 하나의 과목만 가르친다
- 학생은 여러 과목을 듣는다

| student_id | course | professor |
|:---:|--------|-----------|
| 1          | DB설계  | 김교수     |
| 1          | 네트워크 | 이교수     |
| 2          | DB설계  | 김교수     |

PK: (student_id, course)
문제: professor → course (김교수를 알면 과목이 결정됨)
     하지만 professor는 PK가 아니다!

→ 교수-과목 테이블을 따로 만들어야 한다.
```

> **실무에서는 3NF까지 지키면 충분하다.** BCNF는 복합키가 많고 비즈니스 규칙이 복잡한 경우(학사 시스템, 예약 시스템)에서만 신경 쓰면 된다.

---

## 3. 정규화 요약 — 한눈에 보기

| 정규형 | 한 줄 요약 | 실무 빈도 |
|--------|-----------|:---:|
| **1NF** | 한 칸에 하나의 값만 | 자주 위반 (쉼표 구분, JSON 배열) |
| **2NF** | 복합키 일부에만 의존하는 컬럼 제거 | 드묾 (단일 PK 사용 시 자동 만족) |
| **3NF** | PK가 아닌 컬럼이 결정하는 값 제거 | **가장 자주 위반** |
| **BCNF** | 모든 결정자가 후보키여야 함 | 거의 안 만남 |

**정규화의 핵심 질문 하나**: "이 컬럼이 바뀌면 여러 행을 수정해야 하는가?" → **그렇다면 테이블을 나눠야 한다.**

---

## 4. 반정규화 — 언제 정규화를 깨도 되는가?

정규화는 **데이터 무결성**을 위한 것이고, 반정규화는 **조회 성능**을 위한 것이다. 둘은 트레이드오프 관계다.

### 4.1 반정규화가 필요한 신호

```
"이 쿼리에 JOIN이 5개나 들어가는데, 매번 이걸 실행해야 해?"
"매출 통계 API가 3초나 걸려서 사용자가 불만이야"
"같은 JOIN 패턴이 10곳에서 반복되고 있어"
```

> **반정규화는 최후의 수단이다.** 이 순서를 먼저 시도하고, 다 해봤는데도 느리면 그때 반정규화를 고려한다:
> 1. 인덱스 추가/최적화
> 2. 쿼리 리팩토링
> 3. 캐싱 (Redis, 애플리케이션 캐시)
> 4. 읽기 전용 레플리카
> 5. Materialized View (PostgreSQL)
> 6. **그래도 안 되면** → 반정규화

### 4.2 반정규화 패턴 — 쇼핑몰 사례

#### 패턴 1: 미리 계산해두기

주문 목록 API에서 주문 총액을 보여줘야 한다.

```sql
-- 정규화 상태: 매번 계산
SELECT o.id, SUM(oi.price * oi.quantity) AS total
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;
-- 주문이 100만 건이면? 매번 JOIN + SUM은 느리다.

-- 반정규화: 총액을 orders에 미리 저장
ALTER TABLE orders ADD COLUMN total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0;
```

**핵심**: 조회가 빨라지는 대신, 주문 항목이 변경될 때마다 총액을 다시 계산해서 업데이트해야 한다.

```sql
-- MySQL: 트리거로 자동 동기화
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

-- PostgreSQL: 트리거 함수
CREATE OR REPLACE FUNCTION update_order_total()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET total_amount = (
        SELECT COALESCE(SUM(price * quantity), 0)
        FROM order_items WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_items_after_insert
AFTER INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION update_order_total();
```

> **PostgreSQL이라면 Materialized View를 먼저 검토**하라. 테이블에 컬럼을 추가하지 않고도 집계 결과를 캐싱할 수 있다.
> ```sql
> CREATE MATERIALIZED VIEW order_totals AS
> SELECT order_id, SUM(price * quantity) AS total_amount
> FROM order_items GROUP BY order_id;
>
> -- 데이터 갱신 (읽기 차단 없음)
> REFRESH MATERIALIZED VIEW CONCURRENTLY order_totals;
> ```
> MySQL에는 이 기능이 없어서 직접 요약 테이블을 관리해야 한다.

#### 패턴 2: 요약 테이블

매출 대시보드에서 일별 매출을 보여줘야 한다.

```sql
-- 매번 전체 주문에서 계산하면 느리다
SELECT DATE(order_date) AS day, COUNT(*), SUM(total_amount)
FROM orders WHERE order_date >= '2026-01-01'
GROUP BY DATE(order_date);

-- 요약 테이블로 미리 집계
CREATE TABLE daily_sales_summary (
    sale_date DATE PRIMARY KEY,
    total_orders INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

```sql
-- MySQL: UPSERT로 갱신
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON DUPLICATE KEY UPDATE
    total_orders = VALUES(total_orders),
    total_amount = VALUES(total_amount),
    updated_at = CURRENT_TIMESTAMP;

-- PostgreSQL: ON CONFLICT로 갱신
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON CONFLICT (sale_date) DO UPDATE SET
    total_orders = EXCLUDED.total_orders,
    total_amount = EXCLUDED.total_amount,
    updated_at = CURRENT_TIMESTAMP;
```

> **비유**: 매일 도서관의 모든 책을 세는 대신, "오늘의 대출 현황" 요약 보드를 따로 만들어두는 것이다. 실시간은 아니지만 충분히 빠르다.

#### 패턴 3: 스냅샷 저장 (이건 사실 반정규화가 아니다!)

```sql
-- 주문 시점의 상품 가격을 보존
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    unit_price DECIMAL(15, 0) NOT NULL, -- 주문 시점 가격
    quantity INT NOT NULL
);
```

상품 가격이 50,000원에서 60,000원으로 올랐다. 이전에 50,000원에 산 고객의 주문 금액이 60,000원으로 바뀌면? **소송감**이다.

| 구분 | 의미 | 예시 |
|------|------|------|
| **스냅샷** | 그 시점의 값을 보존해야 하는 **비즈니스 요구사항** | 주문 시점 가격, 배송지, 약관 버전 |
| **반정규화** | 조회 성능을 위해 **의도적으로 중복** 저장 | 주문 테이블에 고객 이름 저장 |

**스냅샷은 올바른 설계**이고, 반정규화는 트레이드오프다. 둘을 혼동하면 안 된다.

#### 패턴 4: 테이블 병합

```sql
-- 1:1 관계인 두 테이블
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id),
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048)
);
-- 거의 항상 함께 조회 → 매번 JOIN

-- 하나로 합침
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048)
);
```

| 합쳐도 되는 경우 | 합치면 안 되는 경우 |
|-----------------|-------------------|
| 1:1이고 거의 항상 함께 조회 | 한쪽만 자주 조회 (불필요한 데이터 로딩) |
| 분리된 테이블이 작다 | 한쪽이 매우 크다 (행 크기 ↑ → 캐시 효율 ↓) |
| 나눈 이유가 "그래야 할 것 같아서" | 접근 권한이 다르다 (비밀번호 vs 프로필) |

### 4.3 반정규화 전 체크리스트

```
□ 인덱스 최적화를 시도했는가?
□ 쿼리를 리팩토링했는가?
□ 캐싱 계층(Redis 등)을 검토했는가?
□ 읽기 전용 레플리카를 고려했는가?
□ Materialized View(PostgreSQL)를 검토했는가?

→ 다 해봤는데도 느리다 → 이제 반정규화를 고려한다
```

**반정규화를 했다면 반드시**:
- 갱신 로직을 **트리거 또는 이벤트로 자동화** (수동은 반드시 누락됨)
- 원본과 중복 데이터의 **불일치 감지 쿼리** 작성
- 왜 반정규화했는지 **주석으로 기록** (`-- 반정규화: 주문 목록 API 3초 → 0.2초 개선 (2026-04)`)

---

## 5. 정규화 vs 반정규화 — 판단 기준

| 상황 | 정규화 유지 | 반정규화 고려 |
|------|:---------:|:----------:|
| 데이터 변경이 빈번하다 | ✅ | |
| 무결성이 핵심이다 (금융, 의료) | ✅ | |
| 테이블이 작다 (수만 건 이하) | ✅ | |
| 읽기가 쓰기보다 압도적으로 많다 | | ✅ |
| 집계/통계 쿼리가 빈번하다 | | ✅ |
| JOIN 5개 이상 쿼리가 반복된다 | | ✅ |
| 인덱스/캐싱을 다 적용한 후에도 느리다 | | ✅ |

### OLTP vs OLAP — 정규화 수준이 다른 이유

데이터베이스의 용도는 크게 두 가지로 나뉜다.

**OLTP (Online Transaction Processing)** — "지금 주문을 처리하는 DB"

```
- 사용자가 주문을 넣고, 결제하고, 취소하고, 배송 상태를 변경한다
- 한 번에 1~10행을 읽고 쓰는 짧은 트랜잭션이 초당 수백~수천 건 실행된다
- 핵심: "이 주문 데이터가 정확해야 한다" → 무결성이 최우선
- 정규화를 높이는 게 유리 (중복 없이 정확하게)
```

**OLAP (Online Analytical Processing)** — "어제 매출이 얼마인지 보는 DB"

```
- 관리자가 대시보드를 보고, 월별 매출 추이를 분석하고, 리포트를 뽑는다
- 수백만~수억 행을 한 번에 읽어서 집계하는 무거운 쿼리가 실행된다
- 핵심: "빨리 결과를 보여줘야 한다" → 조회 속도가 최우선
- 반정규화가 유리 (JOIN 줄이고 미리 집계해두기)
```

| 특성 | OLTP (주문, 결제) | OLAP (대시보드, 리포트) |
|------|:---:|:---:|
| **대표 쿼리** | `INSERT`, `UPDATE`, `SELECT ... WHERE id = ?` | `SELECT SUM/AVG/COUNT ... GROUP BY ... 날짜 범위` |
| **한 번에 다루는 데이터** | 1~10행 | 수만~수억 행 |
| **정규화 수준** | 높음 (3NF) | 낮음 (반정규화, 스타 스키마) |
| **최적화 대상** | 쓰기 속도, 무결성 | 읽기 속도, 집계 성능 |
| **실무 예시** | 서비스 DB (MySQL, PostgreSQL) | DW, BI (BigQuery, Redshift, ClickHouse) |

#### 왜 같은 DB에서 둘 다 하면 안 되는가?

```
시나리오: 서비스 DB(OLTP)에서 매출 리포트(OLAP)를 직접 돌림

1. SELECT SUM(total_amount) FROM orders WHERE order_date >= '2026-01-01'
   → 100만 행을 풀스캔하면서 테이블 락/IO를 잡아먹음

2. 그 사이에 사용자의 주문 INSERT가 밀리기 시작
   → "주문이 안 돼요" 장애 발생

3. 리포트 쿼리도 트랜잭션 격리 때문에 느려짐
   → 둘 다 느림. 아무도 행복하지 않음.
```

#### 실무에서 분리하는 방법

```
[OLTP DB]  →  동기화  →  [OLAP DB / DW]
(서비스용)     (CDC, ETL)    (분석용)

- CDC (Change Data Capture): DB의 변경 로그를 실시간으로 분석 DB에 전달
  예: Debezium, AWS DMS
- ETL (Extract-Transform-Load): 정기적으로 데이터를 추출해서 변환 후 적재
  예: Airflow, dbt
- 간단한 경우: Materialized View(PostgreSQL) 또는 Read Replica
```

> **정리**: OLTP DB는 정규화를 유지하고, 분석이 필요하면 별도의 OLAP DB로 분리한다. **"서비스 DB에서 직접 리포트 쿼리를 돌리는 것"은 OLTP/OLAP를 섞는 대표적인 실수**다.

---

## 6. MySQL vs PostgreSQL — 정규화/반정규화 관련 차이

| 기능 | MySQL | PostgreSQL | 반정규화 대안으로의 가치 |
|------|-------|------------|----------------------|
| **Materialized View** | 없음 | 있음 (`REFRESH CONCURRENTLY` 지원) | PG에서는 반정규화 전에 MV를 먼저 검토 |
| **부분 인덱스** | 없음 | `CREATE INDEX ... WHERE 조건` | 특정 조건 조회를 인덱스로 해결 → 반정규화 불필요 |
| **Generated Column** | `VIRTUAL` + `STORED` | `STORED`만 | 같은 테이블 내 계산은 두 DB 모두 가능 |
| **JSONB** | `JSON` (제한적 인덱싱) | `JSONB` + GIN (강력) | PG는 반정형 데이터를 정규화 없이 효율적 처리 |
| **UPSERT** | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` | 요약 테이블 갱신은 두 DB 모두 지원 |
| **트리거** | `FOR EACH ROW`만 | `FOR EACH ROW` + `FOR EACH STATEMENT` | PG 트리거가 더 유연 |

> **PostgreSQL은 Materialized View, 부분 인덱스, JSONB 덕분에 MySQL보다 반정규화가 덜 필요한 경우가 많다.** MySQL에서 성능 때문에 반정규화했던 것이 PostgreSQL에서는 MV나 부분 인덱스로 해결되는 경우가 있다.

---

## 정리

| 핵심 | 내용 |
|------|------|
| **정규화 = 중복 제거** | "이 데이터가 바뀌면 여러 행을 수정해야 하는가?" → 그렇다면 테이블을 나눠라 |
| **실무에서는 3NF까지** | 1NF(한 칸에 하나) → 2NF(복합키 주의) → 3NF(PK가 아닌 것이 결정하는 값 분리) |
| **반정규화는 최후의 수단** | 인덱스 → 쿼리 최적화 → 캐싱 → MV → 그래도 안 되면 반정규화 |
| **스냅샷 ≠ 반정규화** | 주문 시점 가격/주소 저장은 비즈니스 요구사항이지 중복이 아니다 |
| **MySQL vs PG** | PG는 MV, 부분 인덱스, JSONB 덕분에 반정규화가 덜 필요 |

다음 편에서는 **제약조건과 데이터 무결성** — CHECK, UNIQUE, FK 트레이드오프, 방어적 스키마 설계를 다룬다.
