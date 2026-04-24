---
title: "RDB 설계 시리즈 7편: 안티패턴과 시간 데이터 설계 — EAV, God Table, Temporal Table, 이벤트 소싱까지"
description: "스키마 설계에서 반복적으로 실패하는 패턴을 정리한다. EAV, God Table, Polymorphic Association, Soft Delete의 함정을 다루고, 시간 데이터 설계(Temporal Table, SCD)와 이벤트 소싱 스키마의 기초까지. '하지 말아야 할 것'을 아는 것이 설계 실력이다."
pubDate: 2026-04-16T18:00:00+09:00
tags:
  - Database
  - RDB
  - Schema Design
  - Anti-pattern
  - Temporal Data
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbAntipatternTemporalDesignGuide.png"
---

## 서론

[이전 글](/blog/rdb-index-join-strategy-guide)에서 인덱스 설계와 JOIN 전략을 다뤘다. 여기까지 오면 "어떻게 설계해야 하는가"에 대한 도구는 갖춘 셈이다 — 네이밍, 정규화, 제약조건, 관계 패턴, 인덱스까지.

하지만 좋은 설계를 아는 것만으로는 부족하다. **나쁜 설계를 알아보는 능력**이 없으면, 코드 리뷰에서 문제를 지적하지 못하고, 레거시를 리팩터링할 기준이 없다.

이 글은 두 가지를 다룬다:

1. **안티패턴** — 반복적으로 실패하는 설계 패턴. "왜 나쁜지"와 "대안이 뭔지"를 같이 다룬다.
2. **시간 데이터 설계** — 데이터가 "언제부터 언제까지 유효한가"를 표현하는 패턴. 안티패턴과 달리 **적극적으로 써야 하는 패턴**이다.

---

## 1. EAV (Entity-Attribute-Value) 안티패턴

### 1.1 EAV란?

속성(attribute)을 컬럼이 아니라 <strong>행(row)</strong>으로 저장하는 패턴이다.

```sql
-- 일반적인 설계
CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200),
    price DECIMAL(10,2),
    weight DECIMAL(8,2),
    color VARCHAR(50)
);

-- EAV 설계
CREATE TABLE product_attributes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,  -- 'color', 'weight', 'price' 등
    attribute_value TEXT NOT NULL,          -- 모든 값이 문자열
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

EAV 데이터 예시:

| product_id | attribute_name | attribute_value |
|:---:|---|---|
| 1 | color | red |
| 1 | weight | 2.5 |
| 1 | price | 29900 |
| 2 | color | blue |
| 2 | size | XL |

### 1.2 왜 EAV를 선택하게 되나?

- "상품마다 속성이 다르니까 컬럼을 고정할 수 없어"
- "새 속성이 추가될 때마다 ALTER TABLE 하기 싫어"
- "유연한 구조가 필요해"

이유는 합리적으로 **들린다.** 하지만 대가가 크다.

### 1.3 EAV의 문제

**1) 타입 안전성이 없다**

모든 값이 `TEXT`에 들어간다. `price`에 `"abc"`가 들어가도 DB가 막지 못한다. CHECK 제약도 걸 수 없다.

**2) 제약조건을 걸 수 없다**

```sql
-- 일반 설계에서는 가능
ALTER TABLE products ADD CONSTRAINT chk_price CHECK (price > 0);

-- EAV에서는? attribute_name = 'price'인 행만 걸어야 하는데
-- 이런 조건부 CHECK는 대부분의 DB에서 불가능
```

NOT NULL, UNIQUE, FK — 컬럼 단위 제약이 전부 무력화된다.

**3) 쿼리가 지옥이 된다**

"빨간색이면서 무게가 2kg 이상인 상품"을 찾으려면:

```sql
-- 일반 설계
SELECT * FROM products WHERE color = 'red' AND weight >= 2.0;

-- EAV
SELECT p.id
FROM products p
JOIN product_attributes a1 ON p.id = a1.product_id
    AND a1.attribute_name = 'color' AND a1.attribute_value = 'red'
JOIN product_attributes a2 ON p.id = a2.product_id
    AND a2.attribute_name = 'weight' AND CAST(a2.attribute_value AS DECIMAL) >= 2.0;
```

속성 하나당 JOIN 하나. 속성 5개 조건이면 JOIN 5개. **성능과 가독성 둘 다 망가진다.**

**4) 집계가 어렵다**

```sql
-- 일반 설계: 평균 가격
SELECT AVG(price) FROM products;

-- EAV: CAST 필수, 잘못된 데이터 있으면 에러
SELECT AVG(CAST(attribute_value AS DECIMAL))
FROM product_attributes
WHERE attribute_name = 'price';
```

### 1.4 "EAV가 필요하다"는 신호 — NoSQL을 검토하라

흔히 EAV가 **유일한 선택**이라고 말하는 상황들이 있다:

- **속성이 수백 개이고 상품마다 다른 쇼핑몰**: 전자제품은 CPU/RAM/해상도, 의류는 소재/사이즈/시즌
- **사용자 정의 필드**: SaaS에서 고객이 직접 필드를 추가하는 경우
- **설정 저장소**: key-value 형태가 자연스러운 경우

하지만 이 정도의 스키마 유연성이 필요하다면, **RDB에서 EAV로 억지로 구현할 게 아니라 NoSQL(MongoDB, DynamoDB 등)을 쓰는 것이 맞다.** 문서형 DB는 이런 유연한 구조를 위해 설계된 도구이기 때문이다.

```json
// MongoDB — 상품마다 다른 속성을 자연스럽게 저장
{ "_id": 1, "name": "노트북", "price": 1290000, "cpu": "M3", "ram": "16GB", "screen": "14inch" }
{ "_id": 2, "name": "티셔츠", "price": 29900, "size": "XL", "material": "cotton", "season": "summer" }
```

EAV의 모든 문제(타입 안전성, JOIN 지옥, 제약조건 무력화)가 문서형 DB에서는 **구조적으로 발생하지 않는다.** 스키마가 유동적인 데이터에 관계형 모델을 강제하는 것 자체가 안티패턴이다.

> **원칙**: "EAV가 필요하다"고 느끼는 순간이 NoSQL을 검토할 타이밍이다. RDB에 남아야 한다면 1.5절의 JSON 컬럼이 차선이다.

### 1.5 대안: JSON 컬럼

MySQL 5.7+, PostgreSQL 9.4+에서 JSON을 지원한다. EAV의 유연성을 가지면서 테이블 하나로 해결할 수 있다.

```sql
CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    price DECIMAL(10,2) NOT NULL,      -- 핵심 속성은 컬럼
    attributes JSONB NOT NULL DEFAULT '{}'  -- 가변 속성은 JSON
);

-- 데이터 예시
INSERT INTO products (id, name, price, attributes) VALUES
(1, '노트북', 1290000, '{"cpu": "M3", "ram": "16GB", "screen": "14inch"}'),
(2, '티셔츠', 29900, '{"size": "XL", "material": "cotton", "season": "summer"}');

-- 조회: JSON 인덱스 활용 (PostgreSQL)
CREATE INDEX idx_products_cpu ON products USING GIN (attributes);
SELECT * FROM products WHERE attributes @> '{"cpu": "M3"}';
```

| 비교 | EAV | JSON 컬럼 |
|------|-----|----------|
| 유연성 | ✅ 높음 | ✅ 높음 |
| 쿼리 복잡도 | ❌ JOIN 지옥 | ✅ 단일 테이블 |
| 인덱스 | ❌ 어려움 | ✅ GIN/가상 컬럼 |
| 타입 검증 | ❌ 불가 | ⚠️ 앱 레벨 검증 필요 |
| DB 호환 | ✅ 어디서나 | ⚠️ MySQL/PG만 완전 지원 |

> **권장**: 핵심 속성은 정규 컬럼 + 가변 속성은 JSON. EAV는 최후의 수단이다.

---

## 2. God Table 안티패턴

### 2.1 God Table이란?

하나의 테이블에 **모든 도메인의 데이터**를 우겨넣는 패턴이다. "만능 테이블"이라고도 한다.

```sql
-- God Table의 전형적 모습
CREATE TABLE entities (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    type VARCHAR(50) NOT NULL,         -- 'user', 'product', 'order', 'review'
    name VARCHAR(200),
    email VARCHAR(200),                -- user일 때만 사용
    price DECIMAL(10,2),               -- product일 때만 사용
    quantity INT,                       -- order일 때만 사용
    rating INT,                         -- review일 때만 사용
    parent_id BIGINT,                  -- 자기참조 (뭐든 연결)
    data1 TEXT,                         -- 범용 필드 1
    data2 TEXT,                         -- 범용 필드 2
    data3 TEXT,                         -- 범용 필드 3
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 증상

God Table이 있다는 신호:

- `type` 또는 `category` 컬럼으로 행의 종류를 구분한다
- 컬럼의 절반 이상이 **대부분의 행에서 NULL**이다
- `data1`, `data2`, `extra_info` 같은 **범용 컬럼**이 있다
- 테이블 이름이 `entities`, `items`, `objects`, `records` 같은 추상적 이름이다
- 새 기능을 추가할 때마다 컬럼을 추가한다

### 2.3 문제

**1) NULL 지옥**

`type = 'user'`인 행에서 `price`, `quantity`, `rating`은 전부 NULL이다. 행의 70%가 NULL인 테이블은 읽기도, 유지보수하기도 고통스럽다.

**2) 제약조건 무력화**

```sql
-- "상품 가격은 0보다 커야 한다"를 표현하려면?
-- type = 'product'일 때만 적용하고 싶지만...
ALTER TABLE entities ADD CONSTRAINT chk_price CHECK (price > 0);
-- → type = 'user'인 행은 price가 NULL인데, 이게 OK인가?

-- "사용자 이메일은 UNIQUE"를 표현하려면?
-- type = 'user'인 행만 UNIQUE — 대부분의 DB에서 직접 불가능
```

PostgreSQL의 부분 인덱스로 우회할 수는 있지만, 그 자체로 설계가 잘못됐다는 신호다.

**3) 성능 악화**

모든 도메인의 데이터가 한 테이블에 있으므로:

- 테이블 크기가 비정상적으로 크다
- 인덱스가 도메인별로 최적화될 수 없다
- `WHERE type = 'user'`가 모든 쿼리에 붙어야 한다

### 2.4 해결: 도메인별 테이블 분리

```sql
-- God Table 대신
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE
);

CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    price DECIMAL(10,2) NOT NULL CHECK (price > 0)
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    quantity INT NOT NULL CHECK (quantity > 0)
);
```

도메인별로 분리하면 각 테이블에 **적절한 NOT NULL, CHECK, UNIQUE, FK**를 걸 수 있다. 제약조건이 곧 문서화다 — [3편](/blog/rdb-constraints-integrity-guide) 참고.

---

## 3. Polymorphic Association 안티패턴

### 3.1 Polymorphic Association이란?

"댓글이 게시글에도 달리고, 상품에도 달리고, 리뷰에도 달린다"를 하나의 테이블로 표현하는 패턴이다.

```sql
-- Polymorphic Association
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    commentable_type VARCHAR(50) NOT NULL,  -- 'Post', 'Product', 'Review'
    commentable_id BIGINT NOT NULL,         -- 해당 타입의 PK
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Rails의 `belongs_to :commentable, polymorphic: true`가 대표적이다. ORM에서는 편하게 쓸 수 있지만, **DB 레벨에서 보면 문제가 많다.**

### 3.2 문제

**1) FK를 걸 수 없다**

```sql
-- commentable_id가 posts.id인지 products.id인지 DB는 모른다
-- 이 FK는 만들 수 없다
ALTER TABLE comments
    ADD FOREIGN KEY (commentable_id) REFERENCES ???(id);
```

`commentable_type`에 따라 참조 대상이 달라지므로, **참조 무결성을 DB가 보장하지 못한다.** posts에서 행을 삭제해도 orphan 댓글이 남는다.

**2) JOIN이 조건부**

```sql
-- 댓글과 원본을 함께 조회하려면
SELECT c.*, p.title
FROM comments c
LEFT JOIN posts p ON c.commentable_type = 'Post' AND c.commentable_id = p.id
LEFT JOIN products pr ON c.commentable_type = 'Product' AND c.commentable_id = pr.id
LEFT JOIN reviews r ON c.commentable_type = 'Review' AND c.commentable_id = r.id;
```

타입이 추가될 때마다 LEFT JOIN이 하나씩 늘어난다.

**3) 인덱스 효율 저하**

`(commentable_type, commentable_id)` 복합 인덱스를 만들어도, `commentable_type`의 카디널리티가 극히 낮아서 효율이 떨어진다.

### 3.3 대안 1: 타입별 FK 컬럼 (Exclusive Belongs-To)

```sql
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    post_id BIGINT,
    product_id BIGINT,
    review_id BIGINT,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (review_id) REFERENCES reviews(id),
    -- 정확히 하나만 NOT NULL이어야 한다
    CONSTRAINT chk_one_parent CHECK (
        (post_id IS NOT NULL)::INT +
        (product_id IS NOT NULL)::INT +
        (review_id IS NOT NULL)::INT = 1
    )
);
```

FK가 걸리므로 참조 무결성이 보장된다. 다만 타입이 많아지면 NULL 컬럼이 늘어나는 단점이 있다.

> MySQL에서는 `::INT` 캐스팅 대신 `(post_id IS NOT NULL) + (product_id IS NOT NULL) + (review_id IS NOT NULL) = 1`로 쓴다. MySQL 8.0.16+에서 CHECK 제약을 지원한다.

### 3.4 대안 2: 타입별 관계 테이블

```sql
-- 댓글 본체
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 관계 테이블
CREATE TABLE post_comments (
    post_id BIGINT NOT NULL REFERENCES posts(id),
    comment_id BIGINT NOT NULL REFERENCES comments(id) UNIQUE,
    PRIMARY KEY (post_id, comment_id)
);

CREATE TABLE product_comments (
    product_id BIGINT NOT NULL REFERENCES products(id),
    comment_id BIGINT NOT NULL REFERENCES comments(id) UNIQUE,
    PRIMARY KEY (product_id, comment_id)
);
```

타입이 늘어나도 테이블만 추가하면 되고, FK가 정확히 걸린다. 테이블 수가 늘어나는 게 단점이지만, **데이터 무결성이 보장**된다.

### 3.5 대안 3: 공유 부모 테이블 (상속)

```sql
-- 공통 부모
CREATE TABLE commentable_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    type VARCHAR(50) NOT NULL
);

CREATE TABLE posts (
    id BIGINT PRIMARY KEY REFERENCES commentable_items(id),
    title VARCHAR(200) NOT NULL
);

CREATE TABLE products (
    id BIGINT PRIMARY KEY REFERENCES commentable_items(id),
    price DECIMAL(10,2) NOT NULL
);

-- 댓글은 부모를 참조
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    commentable_item_id BIGINT NOT NULL REFERENCES commentable_items(id),
    body TEXT NOT NULL
);
```

FK가 `commentable_items`로 걸리므로 참조 무결성이 보장된다. 다만 INSERT 시 부모 테이블에 먼저 행을 넣어야 하는 번거로움이 있다.

### 3.6 어떤 대안을 선택할까?

| 상황 | 추천 대안 |
|------|----------|
| 타입이 2~3개이고 고정적 | 대안 1 (Exclusive FK) — 단순하고 제약 명확 |
| 타입이 4개 이상이거나 추가될 가능성 | 대안 2 (관계 테이블) — 확장성 좋음 |
| 타입 간 공통 속성이 많음 | 대안 3 (공유 부모) — 상속 구조 자연스러움 |
| ORM 호환이 최우선 | Polymorphic 유지 + 앱 레벨 검증 — 트레이드오프 인지 |

---

## 4. Soft Delete의 함정

### 4.1 Soft Delete란?

행을 실제로 삭제하지 않고, `deleted_at` 컬럼에 삭제 시각을 기록하는 패턴이다.

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL,
    name VARCHAR(100) NOT NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL  -- NULL이면 활성, 값 있으면 삭제됨
);

-- "삭제"
UPDATE users SET deleted_at = NOW() WHERE id = 1;

-- 조회 시 항상 필터링
SELECT * FROM users WHERE deleted_at IS NULL;
```

### 4.2 왜 사용하는가?

- "실수로 삭제하면 복구하고 싶어"
- "감사 로그가 필요해"
- "FK 참조가 있어서 물리 삭제가 안 돼"
- "삭제된 데이터도 분석에 쓰고 싶어"

이유는 타당하다. 하지만 **Soft Delete가 만드는 문제도 만만치 않다.**

### 4.3 문제

**1) 모든 쿼리에 WHERE 조건이 추가된다**

```sql
-- 활성 사용자 목록
SELECT * FROM users WHERE deleted_at IS NULL;

-- 활성 사용자의 주문
SELECT o.* FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.deleted_at IS NULL AND o.deleted_at IS NULL;

-- 한 곳이라도 빠뜨리면 삭제된 데이터가 노출된다
```

테이블이 10개면 JOIN마다 `deleted_at IS NULL`이 붙는다. **빠뜨리는 순간 버그**가 된다.

**2) UNIQUE 제약이 깨진다**

```sql
-- email이 UNIQUE인데, 삭제된 사용자가 있다면?
-- 1. user@test.com 계정 삭제 (deleted_at = '2026-01-01')
-- 2. 새 사용자가 user@test.com으로 가입 시도
-- → UNIQUE 위반! 삭제된 행이 여전히 인덱스에 있다
```

부분 인덱스로 우회할 수 있지만 (PostgreSQL), MySQL에서는 깔끔한 해결이 어렵다:

```sql
-- PostgreSQL: 활성 행만 UNIQUE
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE deleted_at IS NULL;

-- MySQL: 우회 — deleted_at을 UNIQUE에 포함 (불완전)
CREATE UNIQUE INDEX uq_users_email ON users (email, deleted_at);
-- → 같은 email로 삭제 2번이면? deleted_at이 다르니 OK... 하지만 활성 행 중복 방지가 안 됨
```

**3) 인덱스 비효율**

활성 데이터가 전체의 5%인데 인덱스는 100%를 포함한다. 시간이 지날수록 삭제된 행이 쌓여서 인덱스가 비대해진다.

### 4.4 대안

**대안 1: 아카이브 테이블**

```sql
-- 활성 테이블
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

-- 아카이브 테이블 (구조 동일 + 삭제 메타)
CREATE TABLE users_archive (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL,
    name VARCHAR(100) NOT NULL,
    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_by VARCHAR(100)  -- 누가 삭제했는지
);

-- "삭제" = 이동
BEGIN;
INSERT INTO users_archive SELECT *, NOW(), 'admin' FROM users WHERE id = 1;
DELETE FROM users WHERE id = 1;
COMMIT;
```

활성 테이블은 항상 깨끗하다. UNIQUE 문제 없고, WHERE 조건도 필요 없다.

**대안 2: status 컬럼 + 부분 인덱스**

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'))
);

-- 활성 사용자만 UNIQUE (PostgreSQL)
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE status = 'ACTIVE';
```

`deleted_at`보다 상태가 **명시적**이다. "삭제"뿐 아니라 "정지", "비활성" 같은 중간 상태도 표현할 수 있다.

| 비교 | Soft Delete (deleted_at) | 아카이브 테이블 | status 컬럼 |
|------|------------------------|---------------|------------|
| 쿼리 복잡도 | ❌ 항상 WHERE 추가 | ✅ 필요 없음 | ⚠️ WHERE 필요하지만 명시적 |
| UNIQUE | ❌ 깨짐 | ✅ 문제 없음 | ⚠️ 부분 인덱스 필요 |
| 복구 용이성 | ✅ UPDATE 한 줄 | ⚠️ INSERT + DELETE | ✅ UPDATE 한 줄 |
| 감사 이력 | ⚠️ 시점만 기록 | ✅ 별도 테이블에 상세 기록 가능 | ⚠️ 변경 이력은 별도 필요 |

---

## 5. Temporal Data 설계

여기서부터는 안티패턴이 아니라 **적극적으로 사용해야 하는 패턴**이다.

### 5.1 문제: "지금" 데이터만 저장하면 생기는 일

```sql
-- 상품 가격이 바뀌면?
UPDATE products SET price = 39900 WHERE id = 1;
-- → 이전 가격(29900)은 영원히 사라진다

-- 지난달 주문서에 "당시 가격"을 보여줘야 한다면?
-- → 불가능. 가격 이력이 없다.
```

[5편](/blog/rdb-domain-schema-design-guide)에서 **스냅샷 패턴**으로 주문 시점의 가격을 저장하는 방법을 다뤘다. Temporal Data는 그보다 더 **범용적인 접근**이다 — 데이터의 유효 기간 자체를 스키마에 녹이는 것이다.

### 5.2 유효 기간 패턴 (valid_from / valid_to)

```sql
CREATE TABLE product_prices (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL REFERENCES products(id),
    price DECIMAL(10,2) NOT NULL,
    valid_from TIMESTAMP NOT NULL,
    valid_to TIMESTAMP NOT NULL DEFAULT '9999-12-31 23:59:59',
    CONSTRAINT chk_valid_range CHECK (valid_from < valid_to)
);
```

| product_id | price | valid_from | valid_to |
|:---:|:---:|---|---|
| 1 | 29900 | 2026-01-01 | 2026-03-15 |
| 1 | 34900 | 2026-03-15 | 2026-04-01 |
| 1 | 39900 | 2026-04-01 | 9999-12-31 |

**현재 가격 조회:**

```sql
SELECT price FROM product_prices
WHERE product_id = 1 AND NOW() BETWEEN valid_from AND valid_to;
```

**특정 시점의 가격 조회:**

```sql
-- 2026년 2월 1일 기준 가격
SELECT price FROM product_prices
WHERE product_id = 1 AND '2026-02-01' BETWEEN valid_from AND valid_to;
```

### 5.3 겹침 방지

유효 기간이 겹치면 "현재 가격이 2개"가 되는 문제가 생긴다. 이걸 DB 레벨에서 방지해야 한다.

**PostgreSQL: Range Type + EXCLUDE 제약**

PostgreSQL은 범위 타입과 EXCLUDE 제약으로 겹침을 **DB가 직접 방지**할 수 있다:

```sql
CREATE TABLE product_prices (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id BIGINT NOT NULL REFERENCES products(id),
    price DECIMAL(10,2) NOT NULL,
    valid_during TSTZRANGE NOT NULL,
    -- 같은 product_id의 기간이 겹치면 에러
    CONSTRAINT no_overlap EXCLUDE USING GIST (
        product_id WITH =,
        valid_during WITH &&
    )
);

-- 사용
INSERT INTO product_prices (product_id, price, valid_during) VALUES
(1, 29900, '[2026-01-01, 2026-03-15)'),
(1, 34900, '[2026-03-15, 2026-04-01)'),
(1, 39900, '[2026-04-01,)');  -- 상한 없음 = 현재 유효

-- 겹치는 기간 삽입 시 에러
INSERT INTO product_prices (product_id, price, valid_during) VALUES
(1, 25000, '[2026-02-01, 2026-05-01)');
-- ERROR: conflicting key value violates exclusion constraint "no_overlap"
```

> `[` 는 이상(포함), `)` 는 미만(제외)을 의미한다. `[2026-01-01, 2026-03-15)`는 1월 1일 이상, 3월 15일 미만이다.

**MySQL: 트리거 또는 앱 레벨 검증**

MySQL은 Range Type이 없으므로 `valid_from`, `valid_to` 컬럼으로 표현하고, 겹침 방지는 트리거나 애플리케이션에서 처리해야 한다.

```sql
-- 삽입 전 겹침 확인 (앱 레벨)
SELECT COUNT(*) FROM product_prices
WHERE product_id = 1
AND valid_from < '2026-05-01'  -- 새 행의 valid_to
AND valid_to > '2026-02-01';   -- 새 행의 valid_from
-- COUNT > 0이면 겹침 → 삽입 거부
```

### 5.4 인덱스 전략

```sql
-- MySQL: valid_from, valid_to 컬럼 방식
CREATE INDEX idx_prices_lookup
ON product_prices (product_id, valid_from, valid_to);

-- PostgreSQL: GiST 인덱스 (Range Type 사용 시)
CREATE INDEX idx_prices_lookup
ON product_prices USING GIST (product_id, valid_during);
```

현재 유효한 행만 자주 조회한다면 부분 인덱스도 고려:

```sql
-- PostgreSQL: 현재 유효한 행만 인덱싱
CREATE INDEX idx_prices_current
ON product_prices (product_id)
WHERE upper(valid_during) IS NULL OR upper(valid_during) > NOW();
```

### 5.5 Temporal Data가 필요한 실무 사례

| 도메인 | 시간 데이터 | 왜 필요한가 |
|--------|-----------|-----------|
| **가격 정책** | 상품 가격 변동 이력 | 과거 주문의 "당시 가격" 확인 |
| **조직도** | 부서 배치 이력 | "작년 이 시점에 이 팀 소속이었나?" |
| **보험/계약** | 약관 버전별 유효 기간 | 계약 시점의 약관 적용 |
| **환율** | 일별 환율 | 특정 날짜의 환산 금액 계산 |
| **권한** | 역할 부여/해제 이력 | "이 시점에 이 권한이 있었나?" 감사 |

---

## 6. Slowly Changing Dimension (SCD)

SCD는 데이터 웨어하우스에서 나온 개념이지만, **OLTP에서도 마스터 데이터 변경을 관리할 때** 유용하다.

### 6.1 Type 1: 덮어쓰기

이전 값을 버리고 **최신 값으로 대체**한다.

```sql
-- 고객의 주소가 변경되면
UPDATE customers SET address = '새 주소' WHERE id = 1;
```

- **장점**: 단순하다. 항상 최신 데이터.
- **단점**: 이력이 없다. "이전 주소"를 알 수 없다.
- **적합한 경우**: 오타 수정, 이력이 불필요한 속성

### 6.2 Type 2: 새 행 추가 (유효 기간)

변경 시 기존 행을 마감하고 **새 행을 삽입**한다. 위의 Temporal Data 패턴과 동일하다.

```sql
-- 기존 행 마감
UPDATE customers
SET valid_to = NOW(), is_current = FALSE
WHERE id = 1 AND is_current = TRUE;

-- 새 행 삽입
INSERT INTO customers (id, name, address, valid_from, valid_to, is_current)
VALUES (1, '홍길동', '새 주소', NOW(), '9999-12-31', TRUE);
```

- **장점**: 완전한 이력 보존. 과거 시점 조회 가능.
- **단점**: 행이 계속 늘어난다. 현재 행 조회 시 `is_current = TRUE` 필터 필요.
- **적합한 경우**: 가격, 약관, 조직도 등 이력이 중요한 데이터

### 6.3 Type 3: 이전/현재 컬럼

테이블에 `previous_` 컬럼을 추가해서 **직전 값만 보존**한다.

```sql
CREATE TABLE customers (
    id BIGINT PRIMARY KEY,
    address VARCHAR(200) NOT NULL,
    previous_address VARCHAR(200),           -- 직전 주소
    address_changed_at TIMESTAMP             -- 마지막 변경 시점
);
```

- **장점**: 단순하다. 추가 행 없이 직전 값 보존.
- **단점**: **직전 1건만** 보존 가능. 2번 이전은 유실.
- **적합한 경우**: "이전 값 하나만 알면 되는" 경우 (실무에서 드묾)

### 6.4 어떤 타입을 선택할까?

| 요구사항 | 추천 |
|---------|------|
| 이력 불필요, 항상 최신만 | Type 1 (덮어쓰기) |
| 전체 변경 이력이 필요 | Type 2 (유효 기간) |
| 직전 값 하나만 필요 | Type 3 (이전/현재 컬럼) |
| 변경 빈도가 매우 높음 | Type 1 + 별도 이력 테이블 |

> 실무에서는 **Type 1 + 별도 이력(audit) 테이블** 조합이 가장 흔하다. 메인 테이블은 항상 최신 상태를 유지하고, 변경 이력은 `_history` 테이블에 쌓는다.

---

## 7. 이벤트 소싱 스키마

### 7.1 기존 CRUD vs 이벤트 소싱

**CRUD**: 현재 상태를 직접 수정한다.

```sql
-- 잔액 변경
UPDATE accounts SET balance = balance - 10000 WHERE id = 1;
-- → 이전 잔액은 사라진다
```

**이벤트 소싱**: 상태를 직접 수정하지 않고, <strong>발생한 사건(이벤트)</strong>을 순서대로 기록한다. 현재 상태는 이벤트를 순서대로 재생(replay)해서 도출한다.

```sql
-- 이벤트 저장
INSERT INTO account_events (account_id, event_type, amount, created_at) VALUES
(1, 'DEPOSIT',    100000, '2026-01-01 10:00:00'),
(1, 'WITHDRAW',    30000, '2026-01-15 14:00:00'),
(1, 'WITHDRAW',    10000, '2026-02-01 09:00:00');

-- 현재 잔액 = 이벤트 재생
-- 100000 - 30000 - 10000 = 60000
```

### 7.2 이벤트 테이블 설계

```sql
CREATE TABLE events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    aggregate_type VARCHAR(50) NOT NULL,   -- 'Account', 'Order' 등
    aggregate_id BIGINT NOT NULL,          -- 해당 엔티티의 ID
    event_type VARCHAR(100) NOT NULL,      -- 'DEPOSIT', 'WITHDRAW', 'ORDER_PLACED'
    event_data JSON NOT NULL,              -- 이벤트 상세 데이터
    version INT NOT NULL,                  -- 낙관적 동시성 제어
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (aggregate_type, aggregate_id, version)  -- 동일 버전 중복 방지
);
```

**핵심 원칙:**

- 이벤트는 <strong>불변(immutable)</strong>이다. INSERT만 있고 UPDATE/DELETE는 없다.
- `version`으로 **순서와 동시성**을 제어한다. 같은 aggregate에 동시 쓰기 시 version 충돌로 하나가 실패한다.
- `event_data`는 JSON으로 이벤트마다 다른 구조를 허용한다.

### 7.3 스냅샷 최적화

이벤트가 수만 건 쌓이면 매번 처음부터 재생하는 건 비효율적이다. **스냅샷**을 주기적으로 저장한다.

```sql
CREATE TABLE snapshots (
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    version INT NOT NULL,              -- 이 스냅샷 시점의 버전
    state JSON NOT NULL,               -- 해당 시점의 전체 상태
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (aggregate_type, aggregate_id)
);
```

**상태 조회 흐름:**

```
1. 스냅샷 조회 → version 50의 상태 (balance: 500000)
2. 이벤트 조회 → version 51~현재까지의 이벤트만 재생
3. 최종 상태 도출
```

스냅샷이 없으면 이벤트 1번부터 재생해야 하지만, 스냅샷이 있으면 **차이분만 재생**하면 된다.

### 7.4 이벤트 소싱의 트레이드오프

| 항목 | CRUD | 이벤트 소싱 |
|------|------|-----------|
| 현재 상태 조회 | ✅ SELECT 한 번 | ⚠️ 재생 필요 (스냅샷으로 완화) |
| 이력 추적 | ❌ 별도 audit 테이블 필요 | ✅ 이벤트 자체가 이력 |
| 디버깅 | ⚠️ "왜 이 상태가 됐지?" | ✅ 이벤트를 순서대로 보면 됨 |
| 복잡도 | ✅ 단순 | ❌ 높음 (이벤트 설계, 재생 로직, 스냅샷) |
| 저장 공간 | ✅ 현재 상태만 | ❌ 모든 이벤트 누적 |
| 쿼리 | ✅ 일반 SQL | ❌ 집계/조회 어려움 (CQRS 필요할 수 있음) |

### 7.5 이벤트 소싱이 적합한 경우

- **금융**: 모든 거래가 감사 대상. "왜 이 잔액이 됐는가"를 증명해야 한다.
- **물류**: 배송 상태 추적. 이벤트 자체가 비즈니스 데이터.
- **협업 도구**: 문서 편집 이력. 되돌리기(undo) 기능.

**적합하지 않은 경우:**

- 단순 CRUD가 대부분인 서비스
- 이력 추적 요구사항이 없는 도메인
- 팀이 이벤트 소싱 경험이 없는 경우 (학습 곡선이 가파르다)

> **실무 권장**: 대부분의 서비스는 CRUD + audit 테이블로 충분하다. 이벤트 소싱은 **이력이 곧 비즈니스 로직**인 도메인에서만 도입을 검토한다. "멋있어 보여서" 도입하면 복잡도만 폭발한다.

---

## 8. 설계 리뷰 체크리스트

### 8.1 안티패턴 점검

- [ ] **EAV를 사용하고 있는가?** 그 수준의 유연성이 필요하면 NoSQL 검토. RDB에 남아야 한다면 핵심 속성은 컬럼, 가변 속성은 JSON으로 분리했는가?
- [ ] **God Table이 있는가?** `type` 컬럼으로 행의 종류를 구분하는 테이블이 있다면 분리를 검토
- [ ] **Polymorphic Association이 있는가?** FK 없이 `_type` + `_id` 조합이 있다면 대안을 검토
- [ ] **Soft Delete가 모든 쿼리에 부담을 주고 있는가?** 아카이브 테이블이나 status 컬럼 전환을 검토

### 8.2 시간 데이터 점검

- [ ] **이력이 필요한 데이터에 UPDATE만 하고 있는가?** 가격, 약관, 권한 등은 유효 기간 패턴을 적용
- [ ] **유효 기간 겹침이 DB 레벨에서 방지되는가?** PostgreSQL은 EXCLUDE 제약, MySQL은 앱 레벨 검증
- [ ] **SCD 타입을 의식적으로 선택했는가?** 대부분 Type 1 + audit 테이블이 적합

### 8.3 이벤트 소싱 점검

- [ ] **이벤트 소싱이 정말 필요한가?** CRUD + audit 테이블로 충분하지 않은지 먼저 검토
- [ ] **스냅샷 전략이 있는가?** 이벤트가 수만 건 쌓일 때의 재생 성능을 고려했는가?
- [ ] **이벤트 스키마 버전 관리 계획이 있는가?** 이벤트 구조가 변경될 때 하위 호환을 어떻게 유지할 것인가?

---

## 정리

이 글에서 다룬 핵심:

1. **EAV는 유연해 보이지만 타입 안전성, 제약조건, 쿼리 성능을 전부 포기하는 패턴이다.** EAV가 필요한 수준의 유연성이라면 NoSQL을 검토하고, RDB에 남아야 한다면 핵심 속성은 컬럼 + 가변 속성은 JSON으로 분리한다.
2. **God Table은 모든 도메인의 제약조건을 무력화한다.** 도메인별 테이블 분리가 유일한 해결책이다.
3. **Polymorphic Association은 FK 없는 참조**다. Exclusive FK, 관계 테이블, 공유 부모 테이블로 데이터 무결성을 확보할 수 있다.
4. **Soft Delete는 단순해 보이지만 UNIQUE 제약 파괴, 쿼리 누락, 인덱스 비효율을 유발한다.** 아카이브 테이블이나 status 컬럼이 더 깔끔하다.
5. **시간 데이터 설계(valid_from/valid_to)는 "데이터에 시간축을 추가하는 것"이다.** PostgreSQL의 Range Type + EXCLUDE 제약이 가장 강력하다.
6. **이벤트 소싱은 강력하지만 복잡하다.** 대부분의 서비스는 CRUD + audit 테이블로 충분하며, 이력이 곧 비즈니스 로직인 도메인에서만 검토한다.

**"좋은 설계를 아는 것"과 "나쁜 설계를 알아보는 것"은 다른 능력이다.** 안티패턴을 인식하는 눈이 있어야 코드 리뷰에서 문제를 잡을 수 있고, 레거시를 개선할 방향이 보인다. 이 글이 그 눈을 키우는 데 도움이 됐기를 바란다.

다음 편에서는 **무중단 마이그레이션과 멀티테넌트 설계** — ALTER TABLE의 락 함정, Expand-Contract 패턴, Flyway와 Liquibase 비교, 멀티테넌트 스키마 전략까지 다룬다.
