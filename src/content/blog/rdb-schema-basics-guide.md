---
title: "RDB 설계 시리즈 1편: 스키마 기초 — 네이밍, 데이터 타입, PK 전략, NULL"
description: "RDB 테이블을 설계할 때 가장 먼저 결정해야 하는 것들을 다룬다. 네이밍 컨벤션, 데이터 타입 선택, PK 전략(AUTO_INCREMENT vs UUID vs ULID), NULL 시맨틱까지 — 대충 넘어가면 나중에 마이그레이션으로 고생한다."
pubDate: 2026-04-05T14:00:00+09:00
tags:
  - Database
  - RDB
  - Schema Design
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbSchemaBasicsGuide.png"
---

## 서론

"테이블 하나 만드는 건데 뭐가 어렵지?" — 처음엔 다 그렇게 생각한다. `CREATE TABLE`에 컬럼 몇 개 넣으면 끝이니까.

하지만 서비스가 커지면 **처음에 대충 정한 것들**이 발목을 잡는다. 컬럼 이름이 제각각이라 쿼리마다 헷갈리고, `VARCHAR(255)`를 아무 생각 없이 붙여서 인덱스가 비대해지고, PK를 `INT`로 잡았다가 21억을 넘겨서 새벽에 긴급 마이그레이션을 하게 된다.

이 글에서는 **테이블을 만들기 전에 결정해야 하는 4가지**를 다룬다:

1. 네이밍 컨벤션
2. 데이터 타입 선택
3. PK 전략
4. NULL 시맨틱

전부 "당장 안 중요해 보이지만, 나중에 바꾸기 엄청 비싼 것들"이다.

---

## 1. 네이밍 컨벤션

### 1.1 왜 중요한가?

테이블, 컬럼 이름은 코드보다 오래 산다. 애플리케이션은 리팩토링하면 되지만, 컬럼 이름을 바꾸려면 **모든 쿼리, ORM 매핑, API 응답, 인덱스, 제약조건**을 다 건드려야 한다.

```
-- 이런 테이블을 인수인계 받으면 어떤 기분일까?
CREATE TABLE TBL_USR_INF (
    usrSeqNo BIGINT,
    usrNm VARCHAR(100),
    usrStCd VARCHAR(2),      -- 01: 활성, 02: 탈퇴, 03: 정지...?
    crtDtm DATETIME,
    updDtm DATETIME
);
```

약어와 한글 주석 없이는 아무것도 알 수 없다. 이런 스키마는 **쿼리를 짤 때마다 ERD를 펼쳐야 하는** 고통을 준다.

### 1.2 테이블 이름

| 규칙 | 좋은 예 | 나쁜 예 | 이유 |
|------|---------|---------|------|
| **snake_case** | `order_item` | `OrderItem`, `orderitem` | DB는 대소문자 처리가 OS마다 다름 (Linux MySQL은 대소문자 구분) |
| **복수형** | `orders`, `users` | `order`, `user` | 테이블은 행의 집합. 복수형이 자연스러움 |
| **접두어 금지** | `orders` | `tbl_orders`, `t_orders` | 접두어는 정보량 제로. 노이즈만 추가 |
| **예약어 회피** | `user_accounts` | `user`, `order` | `user`는 PostgreSQL/MySQL 예약어. 매번 백틱/따옴표 필요 |

> **단수 vs 복수 논쟁**: 솔직히 둘 다 쓰는 팀이 많다. 중요한 건 **하나로 통일하는 것**이다. 이 글에서는 복수형을 권장하지만, 팀 컨벤션이 단수라면 단수로 통일하면 된다.

#### 예약어 함정

```sql
-- PostgreSQL에서 user는 예약어
SELECT * FROM user;          -- ❌ 에러
SELECT * FROM "user";        -- ⭕ 동작하지만 매번 따옴표 필요
SELECT * FROM users;         -- ⭕ 깔끔

-- MySQL에서 order는 예약어
SELECT * FROM order;         -- ❌ 에러
SELECT * FROM `order`;       -- ⭕ 매번 백틱 필요
SELECT * FROM orders;        -- ⭕ 깔끔
```

### 1.3 컬럼 이름

| 규칙 | 좋은 예 | 나쁜 예 | 이유 |
|------|---------|---------|------|
| **snake_case** | `created_at` | `createdAt`, `CreatedAt` | ORM은 자동 변환 지원 (JPA: `ImplicitNamingStrategy`) |
| **약어 금지** | `status`, `description` | `sts`, `desc` | `desc`는 예약어이기도 함 (`ORDER BY ... DESC`) |
| **Boolean은 is/has 접두어** | `is_active`, `has_coupon` | `active`, `coupon_yn` | 의미가 명확해짐. `_yn`은 한국 레거시 관행 |
| **날짜는 _at 접미어** | `created_at`, `deleted_at` | `reg_date`, `crt_dtm` | 타임스탬프임을 명확히 표시 |
| **FK는 참조 테이블_id** | `user_id`, `order_id` | `usr_seq`, `fk_order` | 어떤 테이블의 PK를 참조하는지 바로 알 수 있음 |

### 1.4 인덱스/제약조건 이름

이름 없이 만들면 DB가 자동 생성하는데, `SYS_C007342` 같은 이름이 된다. 운영 중 에러 로그에서 이걸 보면 뭔지 알 수 없다.

```sql
-- 권장 패턴
ALTER TABLE orders ADD CONSTRAINT pk_orders PRIMARY KEY (id);
ALTER TABLE orders ADD CONSTRAINT uq_orders_order_number UNIQUE (order_number);
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order_id
    FOREIGN KEY (order_id) REFERENCES orders(id);
CREATE INDEX idx_orders_user_id_created_at ON orders (user_id, created_at);
```

| 대상 | 패턴 | 예시 |
|------|------|------|
| PK | `pk_{테이블}` | `pk_orders` |
| Unique | `uq_{테이블}_{컬럼}` | `uq_orders_order_number` |
| FK | `fk_{테이블}_{컬럼}` | `fk_order_items_order_id` |
| Index | `idx_{테이블}_{컬럼들}` | `idx_orders_user_id_created_at` |

---

## 2. 데이터 타입 선택

### 2.1 VARCHAR — 길이를 생각 없이 정하면 안 되는 이유

```sql
-- 흔한 실수: 모든 문자열에 255
CREATE TABLE users (
    name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(255),       -- 전화번호에 255?
    zip_code VARCHAR(255)     -- 우편번호에 255?
);
```

"어차피 가변 길이인데 큰 거 잡으면 되는 거 아니야?" — **아니다.**

| 영향 | 설명 |
|------|------|
| **인덱스 크기** | InnoDB의 인덱스 키 최대 크기는 3072바이트. `VARCHAR(255)` + `utf8mb4` = 최대 1020바이트. 복합 인덱스 3개면 이미 한계 |
| **메모리 할당** | MySQL의 `MEMORY` 엔진, 임시 테이블은 VARCHAR를 **최대 길이로 고정 할당**함. `VARCHAR(255)` 10개 컬럼 = 행당 2,550바이트 |
| **의도 전달** | `VARCHAR(20)`은 "이 필드는 짧은 값"이라는 문서 역할. 255는 "몰라서 그냥 넣었다"는 뜻 |

#### 실무 권장 길이

| 용도 | 길이 | 근거 |
|------|------|------|
| 이름 (한국) | `VARCHAR(50)` | 한글 이름 최대 5자 내외, 외국인 이름 고려 |
| 이메일 | `VARCHAR(320)` | RFC 5321 기준 최대 320자 (local 64 + @ + domain 255) |
| 전화번호 | `VARCHAR(20)` | 국제 전화번호 최대 15자 + 구분자 |
| 우편번호 | `VARCHAR(10)` | 한국 5자리, 미국 ZIP+4 10자리 |
| URL | `VARCHAR(2048)` | 브라우저 실질적 최대 길이 |
| 짧은 코드/상태 | `VARCHAR(30)` | `ACTIVE`, `PENDING_APPROVAL` 등 |

### 2.2 정수 타입 — INT vs BIGINT

| 타입 | 바이트 | 범위 (UNSIGNED) | 한계 도달 시나리오 |
|------|:---:|------|------|
| `INT` | 4 | 0 ~ 약 **21억** | 하루 10만 건 → 약 58년. 안전해 보이지만... |
| `BIGINT` | 8 | 0 ~ 약 **922경** | 사실상 무한 |

"21억이면 충분하지 않나?" — 함정이 있다:

```
-- 이런 상황을 생각해보자
1. 주문 테이블: 하루 50만 건 × 365일 × 10년 = 18.25억 → INT 거의 한계
2. 로그 테이블: 하루 1,000만 건 → 7개월이면 21억 초과
3. 삭제 후 재생성: AUTO_INCREMENT는 삭제해도 줄어들지 않음
```

**실무 규칙**: PK는 무조건 `BIGINT`로 시작해라. 4바이트 아끼려다 새벽에 마이그레이션하는 게 훨씬 비싸다.

> MySQL 8.0 기준, `INT` → `BIGINT` 변경은 테이블 리빌드가 필요하다. 1억 행 테이블이면 **수십 분에서 수 시간** 걸린다. 그 동안 서비스 중단이 발생할 수 있다.

### 2.3 돈(Money) — DECIMAL vs FLOAT

```sql
-- FLOAT의 함정
SELECT CAST(0.1 + 0.2 AS FLOAT);
-- 결과: 0.30000000000000004  💀

-- DECIMAL은 정확
SELECT CAST(0.1 AS DECIMAL(10,2)) + CAST(0.2 AS DECIMAL(10,2));
-- 결과: 0.30
```

| 타입 | 정밀도 | 용도 |
|------|--------|------|
| `FLOAT` / `DOUBLE` | 근사값 (IEEE 754) | 과학 계산, 좌표, 센서 데이터 |
| `DECIMAL(p, s)` | 정확한 값 | **돈, 수량, 비율** — 1원이라도 틀리면 안 되는 모든 것 |

#### DECIMAL 자릿수 설계

```sql
-- 한국 원화 (소수점 없음)
price DECIMAL(15, 0)           -- 최대 999조 원

-- 달러/유로 (소수점 2자리)
price DECIMAL(15, 2)           -- 최대 9,999,999,999,999.99

-- 환율, 이자율 (소수점 많음)
exchange_rate DECIMAL(12, 6)   -- 1,234.567890
```

**원칙: 돈을 다루는 컬럼에 FLOAT를 쓰면 안 된다. 예외 없다.**

### 2.4 날짜/시간 — DATETIME vs TIMESTAMP

이건 생각보다 중요한 차이다:

| 특성 | `DATETIME` | `TIMESTAMP` |
|------|-----------|------------|
| 저장 방식 | 그대로 저장 | **UTC로 변환** 후 저장 |
| 범위 | `1000-01-01` ~ `9999-12-31` | `1970-01-01` ~ **`2038-01-19`** |
| 타임존 | 영향 없음 | `time_zone` 설정에 따라 변환 |
| 크기 (MySQL 8.0) | 5바이트 | 4바이트 |

```sql
-- 타임존 차이 시연
SET time_zone = '+09:00';
INSERT INTO test (dt, ts) VALUES (NOW(), NOW());

SET time_zone = '+00:00';
SELECT dt, ts FROM test;
-- dt: 2026-04-05 14:00:00  (변하지 않음)
-- ts: 2026-04-05 05:00:00  (UTC로 변환되어 출력)
```

#### 2038년 문제

`TIMESTAMP`는 내부적으로 4바이트 정수(Unix timestamp)로 저장된다. 2038년 1월 19일에 오버플로가 발생한다.

```
-- MySQL 8.0.28+에서는 8바이트로 확장 가능
-- 하지만 기존 데이터 마이그레이션이 필요할 수 있음
```

| 상황 | 권장 타입 | 이유 |
|------|-----------|------|
| 글로벌 서비스 | `TIMESTAMP` | 타임존 자동 변환 |
| 한국 전용 서비스 | `DATETIME` | 타임존 변환 불필요, 2038 문제 없음 |
| 생년월일 | `DATE` | 시간 불필요 |
| 이벤트 예약 시간 | `DATETIME` | "한국 시간 오후 2시"처럼 절대 시간이 중요 |
| `created_at`, `updated_at` | `TIMESTAMP` 또는 `DATETIME` | 팀 컨벤션에 따라 통일 |

> **PostgreSQL은 다르다**: PostgreSQL의 `TIMESTAMPTZ`는 MySQL `TIMESTAMP`와 유사하지만 8바이트이고 2038 문제가 없다. PostgreSQL에서는 항상 `TIMESTAMPTZ`를 쓰는 게 정답이다.

### 2.5 ENUM vs 참조 테이블(Lookup Table)

```sql
-- 방법 1: ENUM
CREATE TABLE orders (
    status ENUM('PENDING', 'PAID', 'SHIPPED', 'CANCELLED')
);

-- 방법 2: 참조 테이블
CREATE TABLE order_statuses (
    id INT PRIMARY KEY,
    name VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE orders (
    status_id INT REFERENCES order_statuses(id)
);

-- 방법 3: VARCHAR 그대로
CREATE TABLE orders (
    status VARCHAR(30) NOT NULL  -- CHECK 제약조건과 함께 사용
);
```

| 방식 | 장점 | 단점 |
|------|------|------|
| **ENUM** | 저장 효율 (1~2바이트), 값 제한 | 값 추가/삭제에 `ALTER TABLE` 필요 (MySQL: 테이블 리빌드). PostgreSQL은 `ADD VALUE`로 간단하지만 삭제는 안 됨 |
| **참조 테이블** | 유연한 추가/삭제, 추가 속성 가능 (설명, 정렬, 활성 여부) | JOIN 필요, 약간의 복잡도 |
| **VARCHAR** | 단순, 추가/삭제 자유 | 오타 위험, 저장 공간 큼 |

#### 실무 판단 기준

```
상태 값이 3~5개이고 거의 바뀌지 않는다  → ENUM 또는 VARCHAR + CHECK
상태 값이 자주 추가/변경된다            → 참조 테이블
상태에 부가 정보가 필요하다 (설명, 색상) → 참조 테이블
```

### 2.6 BOOLEAN 타입

```sql
-- MySQL: 실제로는 TINYINT(1)의 별칭
is_active BOOLEAN DEFAULT TRUE    -- 내부: TINYINT(1) DEFAULT 1

-- PostgreSQL: 진짜 BOOLEAN
is_active BOOLEAN DEFAULT TRUE    -- true/false/null 저장
```

주의할 점:

```sql
-- MySQL에서 BOOLEAN은 TINYINT(1)이므로 이런 일이 가능
INSERT INTO users (is_active) VALUES (2);   -- 에러 없이 들어감!
INSERT INTO users (is_active) VALUES (99);  -- 이것도 들어감!

-- 방어하려면 CHECK 제약조건 추가 (MySQL 8.0.16+)
ALTER TABLE users ADD CONSTRAINT chk_is_active CHECK (is_active IN (0, 1));
```

### 2.7 TEXT vs VARCHAR

| 특성 | `VARCHAR(n)` | `TEXT` |
|------|-------------|--------|
| 최대 크기 | MySQL: 65,535바이트 (행 전체) | MySQL: 65,535바이트, PostgreSQL: 1GB |
| 인덱스 | 직접 가능 | **접두어 인덱스만** 가능 (MySQL) |
| 기본값 | 설정 가능 | MySQL: 불가, PostgreSQL: 가능 |
| 용도 | 길이 예측 가능한 짧은 문자열 | 게시글 본문, 설명, JSON 등 |

**실무 규칙**: 길이를 합리적으로 예측할 수 있으면 `VARCHAR`, 없으면 `TEXT`.

---

## 3. PK(Primary Key) 전략

PK 선택은 단순한 "id를 뭘로 할까?"가 아니다. **인덱스 구조, INSERT 성능, 분산 환경 호환성**에 직결되는 아키텍처 결정이다.

### 3.1 AUTO_INCREMENT (순차 정수)

```sql
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ...
);
```

| 장점 | 단점 |
|------|------|
| 단순하고 직관적 | 외부 노출 시 보안 위험 (총 주문 수 추측 가능) |
| 클러스터드 인덱스와 궁합 최고 (순차 삽입 → 페이지 분할 없음) | 분산 환경에서 충돌 (다중 DB 서버) |
| 정렬 = 생성 순서 | DB에 의존적 (INSERT 전에 ID를 알 수 없음) |
| 크기 작음 (8바이트) | 테이블 간 마이그레이션 시 ID 충돌 |

#### 클러스터드 인덱스란?

InnoDB(MySQL)에서 **PK = 클러스터드 인덱스**다. 데이터가 PK 순서대로 물리적으로 정렬되어 저장된다.

```
[AUTO_INCREMENT — 순차 삽입]
페이지 1: [1, 2, 3, 4, 5]
페이지 2: [6, 7, 8, 9, 10]
페이지 3: [11, 12, ...]        ← 항상 마지막 페이지에 추가. 깔끔.

[UUID — 랜덤 삽입]
페이지 1: [3a2f..., 7b1c..., a9d4...]
페이지 2: [1e8b..., 5c3a..., f2e1...]
INSERT → 0x4d7... → 페이지 1과 2 사이에 끼워야 함 → 페이지 분할 발생!
```

페이지 분할이 발생하면 **디스크 I/O 증가, 인덱스 단편화, INSERT 성능 저하**로 이어진다.

### 3.2 UUID v4 (랜덤)

```sql
-- MySQL 8.0
CREATE TABLE orders (
    id BINARY(16) PRIMARY KEY,  -- UUID를 바이너리로 저장 (36바이트 문자열 대신)
    ...
);

-- PostgreSQL
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ...
);
```

| 장점 | 단점 |
|------|------|
| 전역 고유 — 분산 환경에서 충돌 없음 | **랜덤이라 클러스터드 인덱스 성능 저하** (페이지 분할) |
| DB 없이 클라이언트에서 생성 가능 | 크기 큼 (16바이트 바이너리, 문자열이면 36바이트) |
| ID로 데이터 추측 불가 | 사람이 읽기 어려움 (`550e8400-e29b-41d4-a716-446655440000`) |
| | 인덱스 크기 증가 → 모든 세컨더리 인덱스에 PK가 포함됨 |

> MySQL에서 UUID를 `VARCHAR(36)`으로 저장하는 건 최악이다. 반드시 `BINARY(16)`으로 변환해서 저장해야 한다. 또는 MySQL 8.0의 `UUID_TO_BIN(uuid, 1)` 함수를 사용하면 시간 기반 정렬도 가능하다.

### 3.3 UUID v7 / ULID (시간 정렬 가능)

UUID v4의 단점(랜덤 → 페이지 분할)을 해결한 대안이다.

```
UUID v7 구조:
|-- 48비트 타임스탬프 --|-- 랜덤 --|
017F22E2-79B0-7CC3-98C4-DC0C0C07398F
^^^^^^^^^^^^^^^^
시간순 정렬 가능!

ULID 구조:
|-- 48비트 타임스탬프 --|-- 80비트 랜덤 --|
01ARZ3NDEKTSV4RRFFQ69G5FAV
^^^^^^^^^^
시간순 정렬 가능!
```

| 특성 | UUID v4 | UUID v7 | ULID |
|------|:---:|:---:|:---:|
| 시간순 정렬 | ❌ | ✅ | ✅ |
| 클러스터드 인덱스 친화적 | ❌ | ✅ | ✅ |
| 크기 | 16바이트 | 16바이트 | 16바이트 (26자 문자열) |
| 표준 | RFC 4122 | RFC 9562 (2024) | 비공식 (사실상 표준) |
| DB 네이티브 지원 | PostgreSQL ✅ | PostgreSQL 17+ | ❌ (앱에서 생성) |

```java
// Java에서 UUID v7 생성 (JDK 없이 라이브러리 필요)
// com.github.f4b6a3:uuid-creator
UUID uuidV7 = UuidCreator.getTimeOrderedEpoch();

// ULID 생성
// com.github.f4b6a3:ulid-creator
Ulid ulid = UlidCreator.getMonotonicUlid();
```

### 3.4 Snowflake ID (분산 환경)

Twitter가 만든 방식. 64비트 정수에 시간 + 머신 ID + 시퀀스를 인코딩한다.

```
Snowflake 구조 (64비트):
|1비트(미사용)|41비트(타임스탬프)|10비트(머신ID)|12비트(시퀀스)|

- 타임스탬프: 약 69년 커버
- 머신 ID: 최대 1,024대
- 시퀀스: 밀리초당 4,096개
```

| 장점 | 단점 |
|------|------|
| `BIGINT`에 저장 가능 (8바이트) | ID 생성 서버 필요 (또는 라이브러리) |
| 시간순 정렬 가능 | 머신 ID 관리 필요 |
| 분산 환경에서 충돌 없음 | 시계 동기화 의존 (NTP) |
| 클러스터드 인덱스 친화적 | 구현 복잡도 |

### 3.5 어떤 PK 전략을 쓸까?

| 상황 | 권장 전략 | 이유 |
|------|-----------|------|
| 단일 DB, 일반 서비스 | **AUTO_INCREMENT (BIGINT)** | 단순, 성능 최고, 대부분의 상황에 충분 |
| 외부에 ID 노출 | **UUID v7 또는 ULID** | 순서/총 수 추측 불가 |
| MSA, 다중 DB | **UUID v7 또는 Snowflake** | DB 없이 ID 생성, 충돌 없음 |
| 이벤트 소싱 | **UUID v7** | 이벤트 순서 보장 + 전역 고유 |

> **실무 팁**: "일단 AUTO_INCREMENT로 시작하고, 필요하면 바꾼다"가 가장 현실적이다. 다만 **PK 타입은 반드시 BIGINT**로 시작해야 한다. INT → BIGINT 변환은 테이블 리빌드가 필요하지만, BIGINT에서 UUID로 전환하는 건 새 컬럼 추가 + 점진적 마이그레이션으로 가능하다.

#### Natural Key vs Surrogate Key

한 가지 더 중요한 결정이 있다: **비즈니스 값을 PK로 쓸 것인가?**

```sql
-- Natural Key: 비즈니스 값 = PK
CREATE TABLE countries (
    code CHAR(2) PRIMARY KEY,  -- 'KR', 'US', 'JP'
    name VARCHAR(100)
);

-- Surrogate Key: 인조 키 = PK
CREATE TABLE countries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code CHAR(2) NOT NULL UNIQUE,
    name VARCHAR(100)
);
```

| 유형 | 장점 | 단점 |
|------|------|------|
| **Natural Key** | JOIN 없이 의미 파악, 중복 방지 자동 | 비즈니스 규칙 변경 시 PK 변경 필요 → 참조하는 모든 FK 연쇄 수정 |
| **Surrogate Key** | PK 불변, FK 관리 쉬움 | JOIN해야 의미 파악, 별도 UNIQUE 제약 필요 |

**실무 규칙**: 거의 모든 경우에 **Surrogate Key(인조 키)를 PK로** 쓰고, Natural Key는 `UNIQUE` 제약조건으로 보호한다. 예외는 ISO 국가 코드, 통화 코드처럼 **절대 바뀌지 않는** 표준 코드뿐이다.

---

## 4. NULL 시맨틱

NULL은 "값이 없다"가 아니라 **"알 수 없다(Unknown)"** 라는 뜻이다. 이 차이가 모든 혼란의 시작이다.

### 4.1 3값 논리(Three-Valued Logic)

SQL은 `TRUE`, `FALSE`에 더해 **`UNKNOWN`** 이 있는 3값 논리를 사용한다.

```sql
-- NULL과의 비교는 항상 UNKNOWN
SELECT NULL = NULL;      -- NULL (TRUE가 아님!)
SELECT NULL != NULL;     -- NULL (TRUE가 아님!)
SELECT NULL > 0;         -- NULL
SELECT NULL = 0;         -- NULL

-- UNKNOWN은 WHERE에서 FALSE처럼 동작
SELECT * FROM users WHERE deleted_at = NULL;     -- ❌ 결과 0건!
SELECT * FROM users WHERE deleted_at IS NULL;    -- ⭕ 올바른 방법
```

#### NULL의 함정들

```sql
-- 함정 1: NOT IN과 NULL
SELECT * FROM orders WHERE user_id NOT IN (1, 2, NULL);
-- 결과: 0건! (모든 비교가 UNKNOWN이 되어 전부 필터링됨)

-- 안전한 대안
SELECT * FROM orders WHERE user_id NOT IN (1, 2);
-- 또는
SELECT * FROM orders WHERE user_id NOT IN (
    SELECT id FROM blocked_users WHERE id IS NOT NULL
);

-- 함정 2: 집계 함수와 NULL
SELECT AVG(score) FROM reviews;
-- NULL인 행은 무시됨. 5건 중 2건이 NULL이면 3건의 평균

SELECT COUNT(score) FROM reviews;  -- NULL 제외 카운트
SELECT COUNT(*) FROM reviews;      -- NULL 포함 전체 행 수

-- 함정 3: UNIQUE 제약조건과 NULL
-- MySQL/PostgreSQL: NULL은 UNIQUE에서 중복 허용
INSERT INTO users (email) VALUES (NULL);  -- 성공
INSERT INTO users (email) VALUES (NULL);  -- 또 성공! (NULL != NULL이므로)
-- SQL Server: NULL도 한 번만 허용 (기본 동작)
```

### 4.2 NOT NULL + DEFAULT vs Nullable

```sql
-- 방법 1: Nullable (삭제되지 않은 경우 NULL)
deleted_at TIMESTAMP NULL

-- 방법 2: NOT NULL + DEFAULT
status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
retry_count INT NOT NULL DEFAULT 0
```

#### 판단 기준

| NULL이 적절한 경우 | NOT NULL이 적절한 경우 |
|-------------------|----------------------|
| "아직 모른다"가 의미 있을 때 (`deleted_at`, `approved_at`) | 항상 값이 있어야 할 때 (`name`, `email`, `created_at`) |
| 선택적 관계 (`mentor_id` — 멘토가 없을 수 있음) | 기본값이 명확할 때 (`retry_count DEFAULT 0`) |
| 아직 결정되지 않은 값 (`graduated_at` — 재학 중) | 비즈니스 로직에서 NULL 체크가 항상 필요해지는 경우 |

### 4.3 NULL과 인덱스

```sql
-- MySQL InnoDB: NULL 값도 인덱스에 포함됨
CREATE INDEX idx_users_deleted_at ON users (deleted_at);
-- IS NULL 조건도 인덱스를 탈 수 있음
SELECT * FROM users WHERE deleted_at IS NULL;  -- 인덱스 사용 가능

-- PostgreSQL: 동일하게 NULL도 인덱스에 포함
-- 하지만 부분 인덱스로 더 효율적으로 처리 가능
CREATE INDEX idx_users_active ON users (id) WHERE deleted_at IS NULL;
-- 삭제되지 않은 사용자만 인덱싱 → 인덱스 크기 대폭 감소
```

### 4.4 실무에서의 NULL 설계 원칙

```
1. 기본은 NOT NULL
   - 컬럼을 만들 때 "이 값이 없을 수 있는가?"를 반드시 질문한다
   - 대답이 "아니오"면 NOT NULL

2. NULL을 허용할 때는 의미를 명확히
   - deleted_at IS NULL → "삭제되지 않음" (명확)
   - phone IS NULL → "전화번호 미등록" (명확)
   - score IS NULL → "채점 전" vs "0점"의 차이 (명확히 구분)

3. 애플리케이션 코드에서의 방어
   - Java: Optional로 래핑, @Column(nullable = false)
   - SQL: COALESCE로 기본값 처리
```

```java
// JPA에서의 방어
@Entity
public class User {
    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String email;

    private LocalDateTime deletedAt;  // nullable — 삭제 전에는 NULL
}
```

```sql
-- COALESCE로 NULL 안전하게 처리
SELECT
    name,
    COALESCE(phone, '미등록') AS phone,
    COALESCE(score, 0) AS score
FROM users;
```

---

## 정리

| 주제 | 핵심 원칙 |
|------|-----------|
| **네이밍** | snake_case, 복수형 테이블, 약어 금지, 예약어 회피. **하나로 통일이 핵심** |
| **데이터 타입** | VARCHAR 길이는 근거 있게, 돈은 DECIMAL, PK는 BIGINT, 시간은 서비스 특성에 맞게 |
| **PK 전략** | 대부분 AUTO_INCREMENT + BIGINT로 충분. 외부 노출/분산이면 UUID v7 또는 ULID |
| **NULL** | 기본은 NOT NULL. NULL 허용 시 "이 값이 없다는 것이 무엇을 의미하는가?"에 답할 수 있어야 함 |

이 4가지를 대충 넘기면 **나중에 마이그레이션으로 돌아와야 한다.** 테이블을 처음 만들 때 5분 더 생각하는 게, 서비스 운영 중 컬럼 타입을 바꾸는 것보다 100배 싸다.

다음 편에서는 **정규화와 반정규화** — 이론이 아니라 "언제 정규화를 깨는 게 맞는지"에 대한 실무 판단 기준을 다룬다.
