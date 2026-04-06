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

### 1.2 왜 snake_case인가?

DB 세계에서 snake_case를 기본으로 쓰는 데는 명확한 이유가 있다.

| 이유 | 설명 |
|------|------|
| **대소문자 함정 회피** | MySQL은 OS에 따라, PostgreSQL은 따옴표 유무에 따라 대소문자 처리가 달라진다. `OrderItem`이 어떤 환경에서는 되고 어떤 환경에서는 안 된다. snake_case는 전부 소문자이므로 **어떤 DB, 어떤 OS에서든 동일하게 동작**한다 |
| **SQL과의 궁합** | SQL 키워드는 대문자 (`SELECT`, `FROM`, `WHERE`)로 쓰는 관례가 있다. 테이블/컬럼도 대문자가 섞이면 **키워드와 식별자의 구분이 흐려진다**. `SELECT OrderDate FROM OrderItems` vs `SELECT order_date FROM order_items` — 후자가 한눈에 읽힌다 |
| **ORM 자동 매핑** | JPA/Hibernate는 `camelCase` 엔티티 필드를 자동으로 `snake_case` 컬럼으로 매핑한다 (`ImplicitNamingStrategy`). DB가 snake_case면 별도 `@Column(name=...)` 없이 그냥 동작한다 |
| **CLI/터미널 편의성** | `psql`, `mysql` 클라이언트에서 따옴표/백틱 없이 바로 쓸 수 있다. `SELECT * FROM "OrderItems"` 매번 따옴표 치는 건 고통이다 |
| **업계 표준** | PostgreSQL 공식 문서, MySQL 공식 예제, Rails/Django/Laravel 등 주요 프레임워크가 모두 snake_case를 기본으로 사용한다 |

```sql
-- camelCase를 쓰면 생기는 현실적인 문제
CREATE TABLE "OrderItems" ("orderId" BIGINT, "productName" VARCHAR(100));

-- 1. 모든 쿼리에 따옴표 필수 (PostgreSQL)
SELECT "orderId", "productName" FROM "OrderItems";  -- 매번 이렇게

-- 2. 따옴표 빼먹으면 에러
SELECT orderId FROM OrderItems;  -- ❌ "orderitems"의 "orderid"를 찾음

-- 3. pg_dump 등 도구에서 따옴표 누락 → 복원 실패

-- snake_case면?
CREATE TABLE order_items (order_id BIGINT, product_name VARCHAR(100));
SELECT order_id, product_name FROM order_items;  -- 따옴표 없이 깔끔
```

### 1.3 테이블 이름

| 규칙 | 좋은 예 | 나쁜 예 | 이유 |
|------|---------|---------|------|
| **snake_case** | `order_item` | `OrderItem`, `orderitem` | 위에서 설명한 모든 이유 |
| **복수형** | `orders`, `users` | `order`, `user` | 테이블은 행의 집합. 복수형이 자연스러움 |
| **접두어 금지** | `orders` | `tbl_orders`, `t_orders` | 접두어는 정보량 제로. 노이즈만 추가 |
| **예약어 회피** | `user_accounts` | `user`, `order` | `user`는 PostgreSQL/MySQL 예약어. 매번 백틱/따옴표 필요 |

> **단수 vs 복수 논쟁**: 솔직히 둘 다 쓰는 팀이 많다. 중요한 건 **하나로 통일하는 것**이다. 이 글에서는 복수형을 권장하지만, 팀 컨벤션이 단수라면 단수로 통일하면 된다.

#### 대소문자 처리: MySQL vs PostgreSQL

이건 많은 사람이 모르고 넘어가다가 운영 환경에서 터지는 문제다.

```sql
-- MySQL: lower_case_table_names 설정에 따라 다름
-- 0 (Linux 기본값): 대소문자 구분 → OrderItems ≠ orderitems
-- 1 (Windows/macOS 기본값): 소문자로 저장 → OrderItems = orderitems
-- 2 (macOS): 소문자로 비교하지만 원본 이름 보존

-- PostgreSQL: 따옴표 없으면 항상 소문자로 변환
CREATE TABLE OrderItems (...);   -- 실제로는 "orderitems"로 생성됨
SELECT * FROM OrderItems;        -- orderitems에서 조회
SELECT * FROM "OrderItems";      -- 이렇게 해야 대문자 유지 (비추천)
```

| 특성 | MySQL | PostgreSQL |
|------|-------|------------|
| 대소문자 구분 | OS/설정에 따라 다름 (`lower_case_table_names`) | 따옴표 없으면 항상 소문자로 변환 |
| `OrderItems` 접근 | 설정에 따라 성공 또는 실패 | `orderitems`로 접근 가능, `"OrderItems"`는 별개 |
| **결론** | snake_case가 안전 | snake_case가 안전 |

**어떤 DB를 쓰든 snake_case로 통일하면 이 문제를 아예 만날 일이 없다.**

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

### 1.4 컬럼 이름

| 규칙 | 좋은 예 | 나쁜 예 | 이유 |
|------|---------|---------|------|
| **snake_case** | `created_at` | `createdAt`, `CreatedAt` | ORM은 자동 변환 지원 (JPA: `ImplicitNamingStrategy`) |
| **약어 금지** | `status`, `description` | `sts`, `desc` | `desc`는 예약어이기도 함 (`ORDER BY ... DESC`) |
| **Boolean은 is/has 접두어** | `is_active`, `has_coupon` | `active`, `coupon_yn` | 의미가 명확해짐. `_yn`은 한국 레거시 관행 |
| **날짜는 _at 접미어** | `created_at`, `deleted_at` | `reg_date`, `crt_dtm` | 타임스탬프임을 명확히 표시 |
| **FK는 참조 테이블_id** | `user_id`, `order_id` | `usr_seq`, `fk_order` | 어떤 테이블의 PK를 참조하는지 바로 알 수 있음 |

**PK는 `id` vs `테이블명_id` — 어느 쪽이 맞나?**

| | `id` | `user_id` (본 테이블명 포함) |
|---|---|---|
| **장점** | 간결, ORM 기본값 (JPA `@Id`), 코드에서 `user.id`로 자연스럽게 읽힘 | JOIN 시 컬럼명만으로 출처가 명확, SQL 가독성 좋음 |
| **단점** | JOIN에서 `users.id = orders.user_id`처럼 항상 테이블명 필요 | `user.user_id`가 중복스러움, ORM 별도 매핑 필요 |
| **선호하는 곳** | Rails, JPA/Hibernate, Django 등 ORM 중심 | PostgreSQL 커뮤니티, DBA 중심 팀, SQL 헤비 환경 |

실무에서 가장 보편적인 패턴은 **본 테이블 PK는 `id`, FK는 `참조테이블_id`**다.

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,        -- 본 테이블: id
    name VARCHAR(50) NOT NULL
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY,        -- 본 테이블: id
    user_id BIGINT NOT NULL,      -- FK: 참조테이블_id
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

> 어느 쪽이든 **팀 내에서 하나로 통일**하는 게 가장 중요하다. 이 포스트에서는 ORM 친화적인 `id` + `참조테이블_id` 패턴을 사용한다.

### 1.5 인덱스/제약조건 이름

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

> **PostgreSQL은 다르다**: PostgreSQL은 내부적으로 `VARCHAR(n)`과 `TEXT`를 **동일한 방식**으로 저장한다. 길이 제한은 CHECK 제약처럼 동작할 뿐이고, 메모리 할당이나 성능 차이가 없다. 그래서 PostgreSQL 커뮤니티에서는 "길이 제한이 필요 없으면 그냥 `TEXT`를 써라"라는 조언이 흔하다. 하지만 **MySQL과 혼용할 가능성이 있거나, 스키마 자체를 문서로 쓰고 싶다면** 적절한 VARCHAR 길이를 지정하는 게 여전히 좋다.

#### 실무 권장 길이

| 용도 | 길이 | 근거 |
|------|------|------|
| 이름 (한국) | `VARCHAR(50)` | 한글 이름 최대 5자 내외, 외국인 이름 고려 |
| 이메일 | `VARCHAR(320)` | RFC 5321 기준 최대 320자 (local 64 + @ + domain 255) |
| 전화번호 | `VARCHAR(20)` | 국제 전화번호 최대 15자 + 구분자 |
| 우편번호 | `VARCHAR(10)` | 한국 5자리, 미국 ZIP+4 10자리 |
| URL | `VARCHAR(2048)` | 브라우저 실질적 최대 길이 |
| 짧은 코드/상태 | `VARCHAR(30)` | `ACTIVE`, `PENDING_APPROVAL` 등 |

> **DB별 참고사항**
> - **MySQL (InnoDB)**: VARCHAR 길이가 **255 이하면 길이 저장에 1바이트**, 256 이상이면 **2바이트**를 사용한다. 큰 차이는 아니지만, 255를 기준으로 내부 저장 방식이 달라진다는 점은 알아두자.
> - **Oracle**: `VARCHAR2`를 사용하며, `VARCHAR2(50 CHAR)` vs `VARCHAR2(50 BYTE)`처럼 **문자 단위와 바이트 단위를 명시적으로 구분**한다. 멀티바이트 문자(한글 등)를 다룬다면 반드시 `CHAR` 단위를 지정해야 한다.
> - **PostgreSQL**: 위에서 언급했듯이 VARCHAR(n)과 TEXT의 내부 저장 방식이 동일하므로, 길이 값 자체보다는 **비즈니스 규칙으로서의 제약**이 필요한지가 선택 기준이다.
> - **SQL Server**: `VARCHAR`는 **바이트 단위**, `NVARCHAR`는 **문자 단위**(UTF-16, 문자당 2바이트)다. 한글 등 비ASCII 문자를 저장한다면 `NVARCHAR`를 써야 하며, 최대 길이도 `VARCHAR(8000)` vs `NVARCHAR(4000)`으로 다르다.
>
> 위 표의 권장 길이는 **RFC, 국제 표준 등 비즈니스 규칙 기반**이므로 DB 종류와 무관하게 적용할 수 있다.

### 2.2 Charset & Collation — 문자열의 숨은 지뢰

VARCHAR 길이만큼 중요하지만 훨씬 자주 무시되는 게 **charset(문자 인코딩)**과 **collation(정렬/비교 규칙)**이다.

#### MySQL: utf8 ≠ UTF-8

MySQL의 가장 유명한 함정:

```sql
-- ❌ utf8은 최대 3바이트 → 이모지(💡) 저장 불가
CREATE TABLE posts (
    title VARCHAR(200)
) CHARACTER SET utf8;

-- ✅ utf8mb4가 진짜 UTF-8 (최대 4바이트)
CREATE TABLE posts (
    title VARCHAR(200)
) CHARACTER SET utf8mb4;
```

MySQL 8.0부터 **기본 charset이 `utf8mb4`**로 바뀌었지만, 레거시 DB를 다룬다면 반드시 확인해야 한다.

#### Collation이 쿼리에 미치는 영향

Collation은 **문자열 비교와 정렬 방식**을 결정한다. 같은 데이터라도 collation에 따라 WHERE, ORDER BY 결과가 달라진다.

| Collation | 동작 | 용도 |
|-----------|------|------|
| `utf8mb4_unicode_ci` | 대소문자 무시, 악센트 무시 | 일반 텍스트 (이름, 이메일) |
| `utf8mb4_bin` | 바이트 단위 정확 비교 | 해시, 토큰, 비밀번호 해시 |
| `utf8mb4_0900_ai_ci` | MySQL 8.0 기본. Unicode 9.0 기반, 더 정확한 정렬 | MySQL 8.0 이상 신규 프로젝트 |

```sql
-- collation에 따라 결과가 달라지는 예
-- utf8mb4_unicode_ci: 'cafe' = 'café' = 'CAFE' (모두 같음)
-- utf8mb4_bin:        'cafe' ≠ 'café' ≠ 'CAFE' (모두 다름)

-- 실무 팁: 컬럼 단위로 collation을 다르게 지정할 수 있다
CREATE TABLE users (
    email VARCHAR(320) COLLATE utf8mb4_unicode_ci,  -- 대소문자 무시 검색
    api_key VARCHAR(64) COLLATE utf8mb4_bin          -- 정확 매칭
);
```

#### PostgreSQL: 인코딩은 간단, Collation은 복잡

PostgreSQL은 데이터베이스 생성 시 인코딩을 지정하며, **UTF-8이 사실상 표준**이다. MySQL처럼 charset 함정은 없다.

```sql
-- 데이터베이스 레벨에서 설정
CREATE DATABASE myapp
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8';

-- PostgreSQL 12+: ICU collation으로 더 정밀한 제어
CREATE COLLATION korean (provider = icu, locale = 'ko-KR');

ALTER TABLE users
    ALTER COLUMN name TYPE VARCHAR(50) COLLATE "korean";
```

PostgreSQL의 collation은 **OS 로케일에 의존**하는 기존 방식과 **ICU provider**를 사용하는 방식이 있다. 신규 프로젝트라면 ICU를 권장한다 — OS 업그레이드로 정렬 순서가 바뀌는 사고를 방지할 수 있다.

#### SQL Server: NVARCHAR + Collation

SQL Server는 테이블/컬럼이 아닌 **데이터베이스 레벨**에서 기본 collation을 지정한다.

```sql
-- 데이터베이스 기본 collation
CREATE DATABASE MyApp COLLATE Korean_Wansung_CI_AS;

-- CI = Case Insensitive, AS = Accent Sensitive
-- 한글 정렬이 필요하면 Korean_Wansung 계열 사용
```

**Collation 약어가 의미하는 것:**

| 약어 | 의미 | 예시 |
|------|------|------|
| **CI** (Case Insensitive) | 대소문자를 같게 취급 | `'abc' = 'ABC'` → `true` |
| **CS** (Case Sensitive) | 대소문자를 구분 | `'abc' = 'ABC'` → `false` |
| **AI** (Accent Insensitive) | 악센트/발음 부호를 같게 취급 | `'café' = 'cafe'` → `true` |
| **AS** (Accent Sensitive) | 악센트/발음 부호를 구분 | `'café' = 'cafe'` → `false` |

**Accent Sensitive가 실무에서 중요한 이유**: 유럽어권 데이터를 다룬다면 `é`, `ë`, `è`를 `e`와 같게 볼지 다르게 볼지가 검색 결과에 직접 영향을 준다. 한글 서비스에서는 악센트가 거의 없으므로 `AS`/`AI` 차이가 체감되지 않지만, 다국어 서비스라면 반드시 고려해야 한다.

앞서 DB별 참고사항에서 언급했듯이, 한글 등 비ASCII 문자를 다룬다면 `NVARCHAR`를 써야 한다.

#### 실무 규칙

| DB | charset 권장 | collation 권장 |
|----|-------------|---------------|
| **MySQL 8.0+** | `utf8mb4` (기본값) | `utf8mb4_0900_ai_ci` (기본값, AI=Accent Insensitive, CI=Case Insensitive) |
| **MySQL 5.7** | `utf8mb4` (명시 필요!) | `utf8mb4_unicode_ci` |
| **PostgreSQL** | `UTF8` | ICU provider 기반 (`ko-KR` 등) |
| **SQL Server** | `NVARCHAR` 사용 | `Korean_Wansung_CI_AS` (한글 서비스) |

> **핵심**: charset과 collation은 **프로젝트 초기에 한 번 제대로 정하고 통일**하는 게 중요하다. 나중에 바꾸면 테이블 리빌드 + 인덱스 재생성이 필요하다.

### 2.3 정수 타입 — INT vs BIGINT

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

#### INT → BIGINT 변경 비용: MySQL vs PostgreSQL

| DB | INT → BIGINT 변경 시 | 영향 |
|----|---------------------|------|
| **MySQL (InnoDB)** | 테이블 리빌드 필요 (`ALGORITHM=COPY`) | 1억 행이면 수십 분~수 시간, 그동안 쓰기 차단 가능 |
| **PostgreSQL** | 마찬가지로 테이블 리빌드 (`ALTER COLUMN TYPE`) | 전체 테이블 `ACCESS EXCLUSIVE` 락 → 읽기/쓰기 모두 차단 |

두 DB 모두 **대형 테이블에서는 매우 비싼 작업**이다. 처음부터 BIGINT로 시작하는 게 정답이다.

> **참고**: MySQL은 `pt-online-schema-change`나 `gh-ost` 같은 온라인 DDL 도구로 무중단 변경이 가능하고, PostgreSQL은 새 컬럼 추가 + 점진적 데이터 복사 + 컬럼 스왑 전략을 쓴다. 하지만 둘 다 복잡하고 위험하다.

### 2.4 돈(Money) — DECIMAL vs FLOAT

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

### 2.5 날짜/시간 — DATETIME vs TIMESTAMP

이건 생각보다 중요한 차이다. 그리고 **MySQL과 PostgreSQL에서 같은 이름의 타입이 다르게 동작**하기 때문에 반드시 구분해야 한다.

#### MySQL의 날짜/시간 타입

| 특성 | `DATETIME` | `TIMESTAMP` |
|------|-----------|------------|
| 저장 방식 | 그대로 저장 | **UTC로 변환** 후 저장 |
| 범위 | `1000-01-01` ~ `9999-12-31` | `1970-01-01` ~ **`2038-01-19`** |
| 타임존 | 영향 없음 | `time_zone` 설정에 따라 변환 |
| 크기 | 5바이트 | 4바이트 |

```sql
-- MySQL: 타임존 차이 시연
SET time_zone = '+09:00';
INSERT INTO test (dt, ts) VALUES (NOW(), NOW());

SET time_zone = '+00:00';
SELECT dt, ts FROM test;
-- dt: 2026-04-05 14:00:00  (변하지 않음)
-- ts: 2026-04-05 05:00:00  (UTC로 변환되어 출력)
```

#### PostgreSQL의 날짜/시간 타입

| 특성 | `TIMESTAMP` | `TIMESTAMPTZ` |
|------|------------|--------------|
| 저장 방식 | 그대로 저장 | **UTC로 변환** 후 저장 |
| 범위 | `4713 BC` ~ `294276 AD` | `4713 BC` ~ `294276 AD` |
| 타임존 | 영향 없음 | `timezone` 설정에 따라 변환 |
| 크기 | 8바이트 | 8바이트 |

```sql
-- PostgreSQL: 타임존 차이 시연
SET timezone = 'Asia/Seoul';
INSERT INTO test (ts, tstz) VALUES (NOW(), NOW());

SET timezone = 'UTC';
SELECT ts, tstz FROM test;
-- ts: 2026-04-05 14:00:00    (변하지 않음 — 입력한 그대로)
-- tstz: 2026-04-05 05:00:00  (UTC로 변환되어 출력)
```

#### SQL Server의 날짜/시간 타입

| 특성 | `DATETIME2` | `DATETIMEOFFSET` |
|------|------------|-----------------|
| 저장 방식 | 그대로 저장 | **UTC 오프셋과 함께** 저장 |
| 범위 | `0001-01-01` ~ `9999-12-31` | `0001-01-01` ~ `9999-12-31` |
| 타임존 | 영향 없음 | 오프셋 정보 포함 (`+09:00` 등) |
| 크기 | 6~8바이트 (정밀도에 따라) | 8~10바이트 |
| 정밀도 | 최대 100나노초 (`DATETIME2(7)`) | 최대 100나노초 |

```sql
-- SQL Server: 타임존 차이 시연
DECLARE @dt DATETIME2 = '2026-04-05 14:00:00';
DECLARE @dto DATETIMEOFFSET = '2026-04-05 14:00:00 +09:00';

SELECT @dt;   -- 2026-04-05 14:00:00.0000000 (오프셋 없음)
SELECT @dto;  -- 2026-04-05 14:00:00.0000000 +09:00

-- UTC로 변환
SELECT SWITCHOFFSET(@dto, '+00:00');
-- 2026-04-05 05:00:00.0000000 +00:00
```

> **`DATETIME` vs `DATETIME2`**: SQL Server에는 레거시 `DATETIME` 타입도 있지만, 범위(`1753~9999`)와 정밀도(3.33ms)가 제한적이다. **신규 프로젝트에서는 항상 `DATETIME2`를 사용**해야 한다.

#### MySQL vs PostgreSQL vs SQL Server 타입 대응표

| 용도 | MySQL | PostgreSQL | SQL Server | 비고 |
|------|-------|------------|------------|------|
| 타임존 인식 시간 | `TIMESTAMP` | `TIMESTAMPTZ` | `DATETIMEOFFSET` | 이름은 다르지만 역할은 같음 |
| 타임존 무관 시간 | `DATETIME` | `TIMESTAMP` | `DATETIME2` | **주의: 같은 이름인데 역할이 다름!** |
| 날짜만 | `DATE` | `DATE` | `DATE` | 동일 |
| 시간만 | `TIME` | `TIME` / `TIMETZ` | `TIME` | PostgreSQL은 타임존 버전도 있음 |

> **혼동 포인트**: MySQL의 `TIMESTAMP`와 PostgreSQL의 `TIMESTAMP`는 이름만 같고 **동작이 다르다**. MySQL `TIMESTAMP`는 타임존을 인식하지만, PostgreSQL `TIMESTAMP`는 타임존을 무시한다. PostgreSQL에서 타임존을 인식하는 타입은 `TIMESTAMPTZ`다. SQL Server는 `DATETIMEOFFSET`이라는 별도 이름이라 혼동이 적다.

#### 2038년 문제

MySQL `TIMESTAMP`는 내부적으로 4바이트 정수(Unix timestamp)로 저장된다. 2038년 1월 19일에 오버플로가 발생한다. **PostgreSQL은 8바이트, SQL Server의 `DATETIME2`는 6~8바이트를 사용하므로 이 문제가 없다.**

| 상황 | MySQL 권장 | PostgreSQL 권장 | SQL Server 권장 |
|------|-----------|----------------|----------------|
| 글로벌 서비스 | `TIMESTAMP` (2038 주의) | `TIMESTAMPTZ` | `DATETIMEOFFSET` |
| 단일 리전 서비스 | `DATETIME` | `TIMESTAMPTZ` (여전히 권장) | `DATETIME2` |
| 생년월일 | `DATE` | `DATE` | `DATE` |
| 이벤트 예약 시간 | `DATETIME` | `TIMESTAMP` | `DATETIME2` |
| `created_at`, `updated_at` | `TIMESTAMP` 또는 `DATETIME` | `TIMESTAMPTZ` | `DATETIME2` 또는 `DATETIMEOFFSET` |

> **PostgreSQL 팁**: PostgreSQL 공식 문서에서도 **"거의 모든 경우에 `TIMESTAMPTZ`를 쓰라"** 고 권장한다. `TIMESTAMP`(타임존 없음)는 "한국 시간 오후 2시"처럼 특정 타임존의 절대 시간이 필요한 극히 드문 경우에만 사용한다.
>
> **SQL Server 팁**: `DATETIMEOFFSET`은 오프셋 값(`+09:00`)을 함께 저장하므로, "이 데이터가 어느 타임존에서 입력됐는지"까지 보존된다. 글로벌 서비스에서 유용하다. 단일 리전이라면 `DATETIME2`로 충분하다.

### 2.6 ENUM vs 참조 테이블(Lookup Table)

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
| **ENUM** | 저장 효율 (1~2바이트), 값 제한 | 값 추가/삭제에 `ALTER TABLE` 필요 (MySQL: 테이블 리빌드). PostgreSQL은 `ADD VALUE`로 간단하지만 **삭제/이름 변경은 타입 재생성 필요** |
| **참조 테이블** | 유연한 추가/삭제, 추가 속성 가능 (설명, 정렬, 활성 여부) | JOIN 필요, 약간의 복잡도 |
| **VARCHAR + CHECK** | 단순, ENUM보다 유연 | 값 추가 시 `ALTER TABLE DROP/ADD CONSTRAINT` 필요 (DDL 변경). 오타 위험, 저장 공간 큼 |

#### "거의 안 바뀐다"의 함정

처음엔 `PENDING`, `PAID`, `CANCELLED` — 3개면 충분해 보인다. 하지만 서비스가 운영되면:

```
v1.0: PENDING, PAID, CANCELLED                          — 3개
v1.3: + REFUNDED                                        — 4개
v2.0: + PARTIAL_REFUND, DISPUTED, PAYMENT_FAILED        — 7개
v2.5: CANCELLED → CANCELLED_BY_USER, CANCELLED_BY_ADMIN — 8개 + 이름 변경
```

ENUM이나 VARCHAR+CHECK를 쓰고 있었다면, **매번 DDL 변경**이 필요하다. 대형 테이블이면 서비스 영향도 있다.

#### ENUM의 DB별 실무 문제

| 문제 | MySQL | PostgreSQL |
|------|-------|------------|
| 값 추가 | `ALTER TABLE` → 테이블 리빌드 (대형 테이블이면 분 단위) | `ALTER TYPE ... ADD VALUE` → 빠르지만 트랜잭션 안에서 불가 |
| 값 삭제/이름 변경 | `ALTER TABLE` → 테이블 리빌드 | **불가** — 타입을 새로 만들어서 교체해야 함 |
| ORM 동기화 | Java enum ↔ DB ENUM 불일치 시 런타임 에러. 앱 배포 전에 DB 먼저 변경해야 함 | 동일 |
| 정렬 | 내부 인덱스 순서로 정렬 (선언 순서) | 알파벳 순이 아닌 선언 순서 — 의도치 않은 정렬 발생 |

#### 참조 테이블이 낫다

```sql
-- 값 추가: INSERT 한 줄이면 끝. DDL 변경 없음. 서비스 영향 제로.
INSERT INTO order_statuses (id, name) VALUES (5, 'REFUNDED');

-- 부가 정보도 자유롭게 추가
ALTER TABLE order_statuses ADD COLUMN display_name VARCHAR(50);
ALTER TABLE order_statuses ADD COLUMN is_terminal BOOLEAN DEFAULT FALSE;
```

"JOIN 비용이 걱정되는데?" — 참조 테이블은 보통 수십 건이다. **전체가 메모리에 캐싱**되기 때문에 실측 성능 차이는 무시할 수 있는 수준이다. 애플리케이션 레벨에서 캐싱하면 JOIN 자체가 불필요해진다.

#### 실무 판단 기준

```
기본 선택                               → 참조 테이블 (가장 유연하고 안전)
값이 절대 변하지 않는 표준 코드          → ENUM 또는 VARCHAR+CHECK (예: 성별 M/F/X, 요일, ISO 코드)
DB 스키마 변경 권한이 없는 환경          → VARCHAR+CHECK (참조 테이블 생성 불가 시)
```

> **실무 팁**: "이 값은 절대 안 바뀔 것 같다"는 말을 100% 믿으면 안 된다. 확신이 없으면 참조 테이블을 쓰는 게 **나중에 가장 덜 고생하는 선택**이다.

### 2.7 BOOLEAN 타입

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

### 2.8 TEXT vs VARCHAR

| 특성 | `VARCHAR(n)` | `TEXT` |
|------|-------------|--------|
| 최대 크기 | MySQL: 65,535바이트 (행 전체) | MySQL: 65,535바이트, PostgreSQL: 1GB |
| 인덱스 | 직접 가능 | **접두어 인덱스만** 가능 (MySQL) |
| 기본값 | 설정 가능 | MySQL: 불가, PostgreSQL: 가능 |
| 용도 | 길이 예측 가능한 짧은 문자열 | 게시글 본문, 설명, JSON 등 |

#### MySQL vs PostgreSQL 차이

```
MySQL:    VARCHAR(n) ≠ TEXT — 저장 방식, 인덱싱, 기본값 지원이 다름
PostgreSQL: VARCHAR(n) ≈ TEXT — 내부 저장 방식이 동일. VARCHAR(n)은 길이 제한만 추가
```

| 차이점 | MySQL | PostgreSQL |
|--------|-------|------------|
| TEXT에 인덱스 | 접두어 인덱스만 (`INDEX(col(255))`) | 일반 인덱스 가능 (최대 ~2700바이트) |
| TEXT에 DEFAULT | 불가 | 가능 |
| VARCHAR vs TEXT 성능 | VARCHAR가 유리한 경우 있음 (임시 테이블) | 차이 없음 |

**실무 규칙**: MySQL이면 길이 예측 가능한 건 `VARCHAR`, 나머지는 `TEXT`. PostgreSQL이면 길이 제한이 비즈니스 규칙인 경우만 `VARCHAR(n)`, 나머지는 `TEXT`로 통일해도 된다.

---

## 3. PK(Primary Key) 전략

PK 선택은 단순한 "id를 뭘로 할까?"가 아니다. **인덱스 구조, INSERT 성능, 분산 환경 호환성**에 직결되는 아키텍처 결정이다.

### 3.1 AUTO_INCREMENT / IDENTITY (순차 정수)

```sql
-- MySQL
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ...
);

-- PostgreSQL (권장: IDENTITY — SQL 표준)
CREATE TABLE orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ...
);

-- PostgreSQL (레거시: SERIAL — 시퀀스 기반)
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,   -- 내부적으로 시퀀스 + DEFAULT 조합
    ...
);
```

> **왜 SERIAL 대신 BIGINT + IDENTITY인가?**
>
> 이 선택에는 **문법**과 **크기**, 두 가지 독립적인 이유가 있다.
>
> **문법: SERIAL vs IDENTITY**
> - `SERIAL`은 PostgreSQL 고유 문법이다. 내부적으로 시퀀스를 만들고 `DEFAULT nextval(...)`을 설정하는 **매크로**일 뿐이다.
> - 문제 1: 시퀀스 소유권 관리가 지저분하다. 테이블을 `DROP`해도 시퀀스가 남거나, `pg_dump` 시 순서가 꼬일 수 있다.
> - 문제 2: `INSERT INTO orders(id) VALUES (999)`처럼 **임의 값 삽입을 막지 못한다.** 시퀀스와 실제 데이터가 어긋나면 이후 INSERT에서 중복 키 에러가 난다.
> - `GENERATED ALWAYS AS IDENTITY`는 SQL:2003 표준이며, 임의 값 삽입을 기본적으로 차단한다. (`OVERRIDING SYSTEM VALUE` 없이는 불가)
>
> **크기: INT(SERIAL) vs BIGINT(BIGSERIAL)**
> - `SERIAL` = `INTEGER` (4바이트, 최대 21억), `BIGSERIAL` = `BIGINT` (8바이트)
> - 2.3절에서 다뤘듯이, INT는 생각보다 빨리 한계에 도달한다. 행당 4바이트 절약으로 새벽 3시 긴급 마이그레이션을 맞는 건 나쁜 트레이드오프다.
> - INT→BIGINT 전환은 **PK + 모든 FK 컬럼 타입 변경 + 인덱스 재생성**을 의미한다. 대형 테이블에서는 수 시간의 다운타임이 필요할 수 있다.
>
> **결론**: `SERIAL`이나 `BIGSERIAL` 대신 **`BIGINT GENERATED ALWAYS AS IDENTITY`**를 쓰면 문법과 크기 문제를 동시에 해결한다.

| 장점 | 단점 |
|------|------|
| 단순하고 직관적 | 외부 노출 시 보안 위험 (총 주문 수 추측 가능) |
| 클러스터드 인덱스와 궁합 최고 (순차 삽입 → 페이지 분할 없음) | 분산 환경에서 충돌 (다중 DB 서버) |
| 정렬 = 생성 순서 | DB에 의존적 (INSERT 전에 ID를 알 수 없음) |
| 크기 작음 (8바이트) | 테이블 간 마이그레이션 시 ID 충돌 |

#### 클러스터드 인덱스란?

InnoDB(MySQL)에서 **PK = 클러스터드 인덱스**다. 데이터가 PK 순서대로 물리적으로 정렬되어 저장된다.

> **PostgreSQL은 다르다**: PostgreSQL은 기본적으로 **클러스터드 인덱스가 없다**. 테이블(heap)은 삽입 순서대로 저장되고, PK는 별도의 B-Tree 인덱스일 뿐이다. `CLUSTER` 명령으로 한 번 정렬할 수 있지만, 이후 INSERT에서는 다시 순서가 섞인다. 따라서 **UUID의 랜덤 삽입이 MySQL만큼 큰 문제가 되지 않는다** — 다만 인덱스 자체의 크기와 캐시 효율 문제는 여전히 있다.

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

한 가지 더 중요한 결정이 있다: **비즈니스 값을 PK로 쓸 것인가, 의미 없는 인조 키를 PK로 쓸 것인가?**

- **Natural Key(자연키)**: 데이터 자체에서 나온 고유 값을 PK로 사용 (주민번호, 이메일, 학번 등)
- **Surrogate Key(대리키/인조키)**: 비즈니스 의미 없는 값을 PK로 사용 (AUTO_INCREMENT id, UUID 등)

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

#### 왜 Natural Key가 위험한가? — 실무 시나리오

Natural Key가 문제를 일으키는 건 **"이 값은 절대 안 바뀐다"는 가정이 깨질 때**다.

**시나리오: 이메일을 PK로 쓴 경우**

```sql
-- 설계 시점: "이메일은 유저마다 고유하니까 PK로 쓰자"
CREATE TABLE users (
    email VARCHAR(320) PRIMARY KEY,
    name VARCHAR(50)
);

CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(320) REFERENCES users(email),  -- FK
    amount DECIMAL(10,2)
);

CREATE TABLE reviews (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(320) REFERENCES users(email),  -- FK
    content TEXT
);
```

6개월 뒤, 유저가 **이메일 변경 기능**을 요청한다. 이때 벌어지는 일:

```sql
-- 이메일을 바꾸려면?
-- 1. users 테이블의 PK 변경
-- 2. orders 테이블의 FK도 변경
-- 3. reviews 테이블의 FK도 변경
-- 4. 이 외에 user_email을 참조하는 모든 테이블... 전부 수정

-- CASCADE 옵션을 걸었다면 자동으로 되긴 하지만,
-- 대형 테이블이면 수백만 행 UPDATE → 락 + 다운타임
UPDATE users SET email = 'new@email.com' WHERE email = 'old@email.com';
```

**Surrogate Key를 썼다면?**

```sql
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,  -- PK가 아닌 UNIQUE 제약
    name VARCHAR(50)
);

CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),  -- 숫자 FK
    amount DECIMAL(10,2)
);

-- 이메일 변경? users 테이블 1행만 UPDATE. FK는 건드릴 필요 없음.
UPDATE users SET email = 'new@email.com' WHERE id = 42;
```

#### 인덱스 효율 측면

Natural Key는 **FK로 사용될 때 인덱스 크기**에도 영향을 준다.

```
-- FK가 BIGINT(8바이트)인 경우
orders.user_id: 100만 행 × 8바이트 = ~8MB 인덱스

-- FK가 VARCHAR(320)(최대 1280바이트 in utf8mb4)인 경우
orders.user_email: 100만 행 × 평균 30바이트 = ~30MB 인덱스
-- 복합 인덱스까지 고려하면 차이는 더 벌어진다
```

#### 그래서 Natural Key는 언제 써도 되는가?

Natural Key가 안전한 조건은 **세 가지를 모두 만족**할 때다:

1. **값이 절대 변하지 않는다** — ISO 국가 코드(`KR`), 통화 코드(`USD`) 등 국제 표준
2. **다른 테이블에서 FK로 참조할 일이 적다** — 또는 참조하더라도 데이터 규모가 작다
3. **값이 짧고 고정 길이다** — `CHAR(2)`, `CHAR(3)` 수준. 인덱스 효율에 악영향이 없다

```sql
-- ✅ Natural Key가 적절한 경우
CREATE TABLE currencies (
    code CHAR(3) PRIMARY KEY,  -- 'USD', 'KRW', 'JPY' — ISO 4217, 절대 안 바뀜
    name VARCHAR(50),
    symbol VARCHAR(5)
);

-- ❌ Natural Key가 위험한 경우
CREATE TABLE users (
    email VARCHAR(320) PRIMARY KEY,     -- 바뀔 수 있음
    ...
);

CREATE TABLE products (
    sku VARCHAR(50) PRIMARY KEY,        -- 회사 정책 변경 시 SKU 체계 변경 가능
    ...
);
```

**실무 규칙**: 거의 모든 경우에 **Surrogate Key(인조 키)를 PK로** 쓰고, Natural Key는 `UNIQUE` 제약조건으로 보호한다. "이 값은 절대 안 바뀐다"라는 확신이 있어도, FK로 널리 참조되는 테이블이라면 Surrogate Key가 더 안전하다.

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
-- MySQL: NULL은 UNIQUE에서 중복 허용
INSERT INTO users (email) VALUES (NULL);  -- 성공
INSERT INTO users (email) VALUES (NULL);  -- 또 성공! (NULL != NULL이므로)

-- PostgreSQL 14 이하: MySQL과 동일 (NULL 중복 허용)
-- PostgreSQL 15+: NULLS NOT DISTINCT 옵션 추가
CREATE TABLE users (
    email VARCHAR(320),
    CONSTRAINT uq_users_email UNIQUE NULLS NOT DISTINCT (email)
);
-- 이제 NULL도 한 번만 허용!

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
| **데이터 타입** | VARCHAR 길이는 근거 있게, charset/collation은 초기에 통일, 돈은 DECIMAL, PK는 BIGINT, 시간은 서비스 특성에 맞게 |
| **PK 전략** | 대부분 AUTO_INCREMENT + BIGINT로 충분. 외부 노출/분산이면 UUID v7 또는 ULID |
| **NULL** | 기본은 NOT NULL. NULL 허용 시 "이 값이 없다는 것이 무엇을 의미하는가?"에 답할 수 있어야 함 |

이 4가지를 대충 넘기면 **나중에 마이그레이션으로 돌아와야 한다.** 테이블을 처음 만들 때 5분 더 생각하는 게, 서비스 운영 중 컬럼 타입을 바꾸는 것보다 100배 싸다.

다음 편에서는 **정규화와 반정규화** — 이론이 아니라 "언제 정규화를 깨는 게 맞는지"에 대한 실무 판단 기준을 다룬다.
