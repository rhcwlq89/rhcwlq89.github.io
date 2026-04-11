---
title: "RDB 설계 시리즈 4편: 관계 설계 패턴 — 1:1, 1:N, N:M 그리고 그 너머"
description: "테이블 관계를 설계할 때 '감으로' 하지 말자. 1:1 분리 기준, 1:N과 N:M의 판단법, 자기참조 트리, 다형성 관계까지 — 실무에서 마주치는 관계 설계의 모든 패턴을 다룬다."
pubDate: 2026-04-08T14:00:00+09:00
tags:
  - Database
  - RDB
  - Schema Design
  - Relationships
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbRelationshipPatternsGuide.png"
---

## 서론

[이전 글](/blog/rdb-constraints-integrity-guide)에서 제약조건으로 잘못된 데이터가 들어오는 것 자체를 막는 방법을 다뤘다. NOT NULL, CHECK, UNIQUE, FK, DEFAULT — 스키마 레벨의 방어 코드를 익혔다.

이제 한 단계 더 나아간다. **테이블을 만들 줄 알고, 제약조건도 걸 줄 안다. 그런데 테이블 사이의 "관계"를 어떻게 설계할 것인가?**

초보자는 "FK를 걸면 관계 설계 끝 아닌가?"라고 생각한다. 하지만 실무에서는 이런 질문이 끊임없이 나온다:

```
"이거 1:1인데 굳이 테이블 분리해야 하나?"
"댓글의 대댓글을 어떻게 저장하지?"
"좋아요가 게시글에도, 댓글에도 달릴 수 있는데 테이블을 어떻게 짜지?"
"N:M 관계 중간 테이블 PK를 뭘로 하지?"
```

이 글에서는 관계 설계의 모든 패턴을 다룬다:

1. **기본 관계** — 1:1, 1:N, N:M 판단 기준과 설계법
2. **자기참조** — 트리 구조(카테고리, 댓글, 조직도)를 저장하는 4가지 패턴
3. **다형성 관계** — "하나의 테이블이 여러 종류의 부모를 참조"하는 문제
4. **Junction Table 심화** — 중간 테이블의 진화와 3자 관계
5. **MySQL vs PostgreSQL** — 관계 설계 관련 기능 차이

---

## 1. 관계의 기본 — 1:1, 1:N, N:M

### 1.1 1:1 관계 — 언제 테이블을 분리하는가?

1:1 관계는 "A 하나에 B 하나가 대응"되는 관계다. 가장 먼저 떠오르는 질문은 이거다:

> **"1:1이면 그냥 한 테이블에 넣으면 안 되나?"**

**대부분의 경우, 한 테이블이 맞다.** 1:1 분리가 정당화되는 경우는 구체적이다:

| 분리 사유 | 예시 | 이유 |
|----------|------|------|
| **선택적 데이터** | 모든 사용자가 갖지 않는 프로필 상세 | 대부분의 행에서 NULL 컬럼이 수십 개 생기는 걸 방지 |
| **보안 분리** | 결제 정보, 주민번호 등 민감 데이터 | 메인 테이블과 접근 권한을 달리 설정 가능 |
| **성능 분리** | 자주 조회하는 핵심 컬럼 vs 가끔 쓰는 대용량 데이터 (BLOB, TEXT) | 메인 테이블의 row size를 줄여 캐시 효율 향상 |
| **독립적 변경 주기** | 사용자 기본 정보 vs 사용자 설정 | 설정이 수시로 바뀌어도 메인 테이블에 영향 없음 |

#### SQL 예시

```sql
-- 메인 테이블
CREATE TABLE users (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(320) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1:1 분리 테이블: 선택적 프로필 상세
CREATE TABLE user_profiles (
    user_id     BIGINT PRIMARY KEY,              -- PK이자 FK
    bio         TEXT,
    avatar_url  VARCHAR(500),
    birth_date  DATE,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_profiles_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

핵심은 **자식 테이블의 PK = FK**라는 점이다. `user_profiles.user_id`가 PK이므로 자동으로 UNIQUE가 보장되어 한 사용자에 프로필이 하나만 존재할 수 있다.

FK만 걸고 PK로 쓰지 않는다면? 그러면 한 user_id에 여러 프로필이 들어갈 수 있어서 1:N이 되어 버린다. 1:1을 강제하려면 반드시 FK에 UNIQUE 제약(또는 PK로 사용)을 걸어야 한다.

```sql
-- ❌ 이렇게 하면 1:N이 됨 (한 사용자에 프로필 여러 개 가능)
CREATE TABLE user_profiles (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    bio         TEXT,
    CONSTRAINT fk_user_profiles_user
        FOREIGN KEY (user_id) REFERENCES users(id)
    -- user_id에 UNIQUE 없음 → 1:N
);

-- ✅ FK + UNIQUE로 1:1 강제 (PK를 별도로 두는 스타일)
CREATE TABLE user_profiles (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL UNIQUE,          -- UNIQUE로 1:1 강제
    bio         TEXT,
    CONSTRAINT fk_user_profiles_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ✅ FK를 PK로 사용 (가장 깔끔한 1:1 패턴)
CREATE TABLE user_profiles (
    user_id     BIGINT PRIMARY KEY,              -- PK = FK → 자동으로 UNIQUE
    bio         TEXT,
    CONSTRAINT fk_user_profiles_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### Anti-pattern: 무의미한 1:1 분리

```
❌ "User 클래스와 Address 클래스가 분리되어 있으니까 테이블도 분리해야지"
❌ "컬럼이 15개 넘으면 테이블 나누는 게 좋다고 들었어"
❌ "나중에 확장성을 위해 미리 분리해 두자"
```

이런 이유로 1:1 분리를 하면 **불필요한 JOIN만 늘어난다.** 객체지향의 클래스 분리와 테이블 분리는 다른 문제다. 테이블 분리에는 I/O 비용이 따른다. "지금 당장 분리할 구체적인 이유"가 없다면 한 테이블에 두는 것이 정답이다.

#### 실무에서의 1:1 관계

1:1 분리는 실무에서 **생각보다 드물다.** 대부분의 경우 한 테이블로 충분하고, 실제로 분리하는 경우는 거의 다음 중 하나다:

- **결제/인증 정보 테이블** (PCI DSS 등 보안 규정 준수)
- **대용량 TEXT/BLOB을 별도 저장** (게시글 본문, 이미지 바이너리)
- **레거시 시스템과의 통합** (기존 테이블을 변경할 수 없어서 확장 테이블을 따로 만드는 경우)

> **"1:1이면 일단 한 테이블"을 기본 원칙으로 잡고, 위의 사유에 해당할 때만 분리하면 된다.**

---

### 1.2 1:N 관계 — 가장 흔한 관계

1:N은 RDB에서 가장 자주 등장하는 관계다. "하나의 주문에 여러 주문 항목", "하나의 사용자에 여러 주소", "하나의 게시글에 여러 댓글" — 전부 1:N이다.

#### 기본 패턴: 자식 테이블에 FK

```sql
CREATE TABLE orders (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    total_price DECIMAL(12, 2) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ordered_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE order_items (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id    BIGINT NOT NULL,
    product_id  BIGINT NOT NULL,
    quantity    INT NOT NULL,
    unit_price  DECIMAL(10, 2) NOT NULL,
    CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product
        FOREIGN KEY (product_id) REFERENCES products(id)
);

-- FK 컬럼에는 반드시 인덱스를 걸자
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
```

#### 설계 포인트

**1) FK 컬럼에 NOT NULL + 인덱스**

```sql
-- ❌ FK가 NULL 허용 → "어떤 주문에도 속하지 않는 주문 항목"이 가능해진다
order_id BIGINT,

-- ✅ FK는 NOT NULL이 기본
order_id BIGINT NOT NULL,
```

FK 컬럼에 NOT NULL을 빼먹는 실수가 의외로 잦다. "주문 항목인데 주문이 없다"는 말이 안 되므로 NOT NULL이 맞다.

인덱스도 마찬가지다. MySQL은 FK에 인덱스를 자동 생성하지만, PostgreSQL은 자동 생성하지 않는다. FK 컬럼에 인덱스가 없으면 `JOIN`이나 `ON DELETE CASCADE` 시 풀 스캔이 발생한다.

| DB | FK 컬럼에 인덱스 자동 생성 |
|----|:---:|
| MySQL | ✅ 자동 생성 |
| PostgreSQL | ❌ 수동으로 만들어야 함 |

**2) ON DELETE 전략**

```sql
-- 주문 삭제 시 주문 항목도 함께 삭제
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE

-- 사용자 삭제 시 주문의 user_id를 NULL로 변경 (주문 이력 보존)
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL

-- 자식이 있으면 삭제 자체를 막음
FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
```

[3편](/blog/rdb-constraints-integrity-guide)에서 ON DELETE 전략을 자세히 다뤘다. 여기서 핵심만 다시 정리하면:

| 전략 | 사용 시점 |
|------|----------|
| `CASCADE` | 부모 없이 자식이 의미 없을 때 (주문 → 주문 항목) |
| `SET NULL` | 참조만 끊으면 되는 경우 (작성자 탈퇴 → 게시글은 남기되 작성자 NULL) |
| `RESTRICT` | 실수 방지 — 자식이 있으면 삭제 자체를 막아야 할 때 |

#### 1:N에서 N이 무한히 커질 때의 문제

1:N 관계에서 N이 수백만, 수억 건으로 커지면 문제가 생긴다. 대표적인 사례:

```
사용자 → 활동 로그         (하루에 수백 건 × 365일)
기기 → 센서 데이터         (초당 1건 × 수만 대)
서비스 → 요청 이벤트 로그   (초당 수천 건)
```

이런 경우의 대응:

1. **파티셔닝**: 날짜 기반으로 테이블을 분할해서 오래된 데이터를 빠르게 정리
2. **아카이빙**: 일정 기간이 지난 데이터를 별도 테이블/저장소로 이동
3. **별도 저장소**: 시계열 DB(InfluxDB, TimescaleDB), Elasticsearch 등 전용 솔루션으로 분리

```sql
-- PostgreSQL: 날짜 기반 파티셔닝
CREATE TABLE activity_logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id     BIGINT NOT NULL,
    action      VARCHAR(50) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (created_at);

CREATE TABLE activity_logs_2026_01 PARTITION OF activity_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE activity_logs_2026_02 PARTITION OF activity_logs
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ...
```

#### 실무에서의 1:N 관계

1:N은 가장 기본적이고 직관적인 관계라 설계 자체는 어렵지 않다. 실무에서 실수가 발생하는 지점은 대부분 다음 두 가지다:

1. **FK 컬럼에 인덱스를 안 걸어서 JOIN이 느린 경우** — 특히 PostgreSQL. 서비스 초기엔 데이터가 적어서 문제가 안 보이다가, 데이터가 쌓이면 갑자기 느려진다. FK를 만들면 인덱스도 같이 만드는 걸 습관으로 잡아야 한다.
2. **N이 무한히 커지는 테이블을 방치하는 경우** — "일단 쌓고 나중에 정리하자"는 말은 보통 "영원히 정리하지 않는다"는 뜻이다. 로그성 테이블은 초기부터 보관 정책(retention policy)을 정해 두는 게 좋다.

---

### 1.3 N:M 관계 — Junction Table이 필요한 순간

N:M은 "A 하나에 B 여러 개, B 하나에도 A 여러 개"인 관계다. 예를 들면:

```
학생 ↔ 과목   → 한 학생이 여러 과목 수강, 한 과목에 여러 학생
게시글 ↔ 태그  → 한 게시글에 여러 태그, 한 태그에 여러 게시글
사용자 ↔ 역할  → 한 사용자에 여러 역할, 한 역할에 여러 사용자
```

**RDB에서는 N:M을 직접 표현할 수 없다.** 컬럼에 배열을 넣는 건 1NF 위반이다. 그래서 <strong>중간 테이블(Junction Table / Bridge Table / Pivot Table)</strong>이 필요하다.

#### 기본 패턴

```sql
-- 학생
CREATE TABLE students (
    id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL
);

-- 과목
CREATE TABLE courses (
    id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    title   VARCHAR(200) NOT NULL
);

-- N:M 중간 테이블
CREATE TABLE enrollments (
    student_id  BIGINT NOT NULL,
    course_id   BIGINT NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    grade       VARCHAR(2),                          -- 추가 속성
    PRIMARY KEY (student_id, course_id),             -- 복합 PK
    CONSTRAINT fk_enrollments_student
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_enrollments_course
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- course_id로 조회할 때를 위한 역방향 인덱스
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);
```

복합 PK `(student_id, course_id)`가 하는 일:
- **PK** → 인덱스 자동 생성 (student_id, course_id 순서)
- **UNIQUE** → 같은 학생이 같은 과목을 중복 수강할 수 없음
- student_id 기반 조회는 복합 인덱스의 선두 컬럼이라 커버됨
- course_id 기반 조회를 위해 별도 인덱스 필요 → `idx_enrollments_course_id`

#### Junction Table에 추가 컬럼 넣기

중간 테이블은 단순히 두 FK만 가지는 경우가 드물다. 관계 자체에 속성이 생기는 경우가 많다:

```sql
-- 수강 관계에 "수강 일시", "성적", "상태" 같은 속성이 있다
CREATE TABLE enrollments (
    student_id  BIGINT NOT NULL,
    course_id   BIGINT NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    grade       VARCHAR(2),
    status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, DROPPED, COMPLETED
    PRIMARY KEY (student_id, course_id),
    CONSTRAINT fk_enrollments_student
        FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT fk_enrollments_course
        FOREIGN KEY (course_id) REFERENCES courses(id)
);
```

#### PK 전략: 복합 PK vs Surrogate PK

중간 테이블의 PK를 어떻게 잡을 것인가? 두 가지 선택지가 있다.

| 전략 | 구조 | 장점 | 단점 |
|------|------|------|------|
| **복합 PK** | `PRIMARY KEY (student_id, course_id)` | 자연스러운 중복 방지, 추가 인덱스 불필요 | API에서 리소스 식별 시 복합 키 전달 불편 |
| **Surrogate PK** | `id BIGINT PK` + `UNIQUE(student_id, course_id)` | 단일 키로 행 식별, API/ORM 친화적 | 별도 UNIQUE 제약 필요, 저장 공간 약간 증가 |

```sql
-- 패턴 A: 복합 PK
CREATE TABLE enrollments (
    student_id  BIGINT NOT NULL,
    course_id   BIGINT NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, course_id)
);

-- 패턴 B: Surrogate PK
CREATE TABLE enrollments (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    student_id  BIGINT NOT NULL,
    course_id   BIGINT NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_enrollments_student_course UNIQUE (student_id, course_id)
);
```

**실무 판단 기준:**
- Junction Table이 **순수 매핑 테이블**(추가 컬럼 없음)이면 → **복합 PK**가 깔끔
- Junction Table에 **자체 속성이 많고**, API에서 개별 행을 수정/삭제하는 일이 잦으면 → **Surrogate PK**가 편리
- ORM을 사용한다면 → ORM이 복합 PK를 잘 지원하는지 확인. JPA는 `@IdClass`나 `@EmbeddedId`로 복합 PK를 지원하지만, 단일 PK보다 번거롭다

#### Junction Table이 자체 엔티티가 되는 순간

N:M 중간 테이블은 시간이 지나면서 점점 컬럼이 추가되고, 자체적인 비즈니스 로직이 생기면서 **독립적인 엔티티**로 진화하는 경우가 많다.

```
처음: enrollments = (student_id, course_id)                      ← 순수 매핑
  ↓ "수강 일시를 기록하자"
중간: enrollments = (student_id, course_id, enrolled_at)          ← 속성 추가
  ↓ "성적, 출석률, 수강 상태도 필요해"
나중: enrollments = (id, student_id, course_id, enrolled_at,      ← 독립 엔티티
      grade, attendance_rate, status, dropped_at, certificate_id)
```

이 시점에서 `enrollments`는 더 이상 "학생과 과목의 연결"이 아니라 <strong>"수강 이력"</strong>이라는 독립적인 도메인이다. 이름도 `enrollments`에서 `enrollment_histories`나 `course_registrations`으로 바꾸는 게 더 적절할 수 있다.

> 이 진화를 미리 예측해서 처음부터 Surrogate PK를 넣을 필요는 없다. 필요할 때 추가하면 된다. 다만 **"이 테이블이 점점 커지고 있다"는 신호를 인식하는 것**이 중요하다.

#### 실무에서의 N:M 관계

N:M 관계 자체는 매우 흔하다. 태그, 역할, 권한, 카테고리 분류 등 사방에 있다. 실무에서 주의할 점:

1. **Junction Table 이름**: `student_courses`처럼 양쪽 테이블명을 합치는 것보다, `enrollments`처럼 **관계의 의미를 나타내는 이름**이 낫다. 나중에 컬럼이 추가되었을 때 자연스럽다.
2. **양방향 인덱스**: 복합 PK `(A_id, B_id)`로 잡으면 A 기반 조회는 빠르지만, B 기반 조회를 위해 별도 인덱스가 필요하다. 이걸 빼먹으면 한쪽 방향 조회가 느려진다.
3. **중복 방지 UNIQUE 잊지 말기**: Surrogate PK를 쓸 때 `UNIQUE (student_id, course_id)`를 빼먹으면 같은 학생이 같은 과목을 여러 번 수강할 수 있게 된다. 비즈니스적으로 허용되는 경우(예: 재수강)가 아니라면 반드시 걸어야 한다.

---

### 1.4 관계 판단 플로우차트

실무에서 "이건 1:1인가 1:N인가 N:M인가?"를 판단하는 흐름:

```
Q1. A 하나에 B가 최대 몇 개?
    ├── 정확히 1개 → Q2로
    └── 여러 개 → Q3으로

Q2. B 하나에 A가 최대 몇 개?
    ├── 정확히 1개 → 1:1 관계
    │   └── "정말 테이블 분리가 필요한가?" → 대부분 한 테이블로 충분
    └── 여러 개 → 1:N 관계 (방향 반대)

Q3. B 하나에 A가 최대 몇 개?
    ├── 정확히 1개 → 1:N 관계 (A가 1, B가 N)
    │   └── 자식 테이블(B)에 FK 컬럼
    └── 여러 개 → N:M 관계
        └── Junction Table 필요

추가 질문:
- "같은 조합이 여러 번 가능한가?" (재수강, 재주문)
  → Yes: Junction Table에 Surrogate PK + 복합 UNIQUE 없음
  → No: 복합 PK 또는 복합 UNIQUE
```

---

## 2. 자기참조 (Self-Referencing) 관계

자기참조는 **같은 테이블의 행이 같은 테이블의 다른 행을 참조**하는 패턴이다. 트리/계층 구조를 저장할 때 등장한다:

```
카테고리: 전자제품 > 노트북 > 게이밍 노트북
조직도: CEO > VP > Director > Manager
댓글: 원댓글 > 대댓글 > 대대댓글
폴더: Documents > Projects > 2026
```

### 2.1 기본 패턴 — parent_id

가장 단순하고 직관적인 방법. 같은 테이블에 `parent_id` FK를 건다.

```sql
-- 카테고리 트리
CREATE TABLE categories (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    parent_id   BIGINT,                          -- NULL이면 루트 노드
    CONSTRAINT fk_categories_parent
        FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX idx_categories_parent_id ON categories(parent_id);

-- 데이터 예시
INSERT INTO categories (id, name, parent_id) VALUES
    (1, '전자제품', NULL),       -- 루트
    (2, '노트북', 1),           -- 전자제품 > 노트북
    (3, '게이밍 노트북', 2),    -- 전자제품 > 노트북 > 게이밍 노트북
    (4, '데스크톱', 1),         -- 전자제품 > 데스크톱
    (5, '의류', NULL);          -- 루트
```

```sql
-- 조직도
CREATE TABLE employees (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    title       VARCHAR(100) NOT NULL,
    manager_id  BIGINT,                          -- NULL이면 최상위 (CEO)
    CONSTRAINT fk_employees_manager
        FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL
);
```

**장점**: 직관적이고 구현이 쉽다. INSERT/UPDATE/DELETE가 단순하다.

**단점**: 깊은 트리를 한 번에 조회하려면 **재귀 쿼리**가 필요하다. "루트부터 리프까지 전체 경로"나 "특정 노드의 모든 하위 노드"를 구하는 게 한 번의 쿼리로 안 된다(재귀 CTE 없이는).

### 2.2 재귀 쿼리 — WITH RECURSIVE (CTE)

MySQL 8.0+와 PostgreSQL 모두 <strong>재귀 CTE(Common Table Expression)</strong>를 지원한다.

#### 예시 1: 특정 카테고리의 모든 하위 카테고리 조회

```sql
-- "전자제품(id=1)" 아래의 모든 카테고리를 찾아라
WITH RECURSIVE category_tree AS (
    -- 기저 조건 (Anchor): 시작 노드
    SELECT id, name, parent_id, 0 AS depth
    FROM categories
    WHERE id = 1

    UNION ALL

    -- 재귀 조건: 자식 노드를 반복적으로 찾기
    SELECT c.id, c.name, c.parent_id, ct.depth + 1
    FROM categories c
    INNER JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT * FROM category_tree;
```

결과:

```
id | name            | parent_id | depth
---+-----------------+-----------+------
 1 | 전자제품         | NULL      | 0
 2 | 노트북           | 1         | 1
 3 | 게이밍 노트북     | 2         | 2
 4 | 데스크톱         | 1         | 1
```

#### 예시 2: 특정 노드의 루트까지의 경로 (상위 조회)

```sql
-- "게이밍 노트북(id=3)"에서 루트까지의 경로
WITH RECURSIVE ancestors AS (
    SELECT id, name, parent_id, 0 AS depth
    FROM categories
    WHERE id = 3

    UNION ALL

    SELECT c.id, c.name, c.parent_id, a.depth + 1
    FROM categories c
    INNER JOIN ancestors a ON c.id = a.parent_id
)
SELECT * FROM ancestors ORDER BY depth DESC;
```

결과:

```
id | name            | parent_id | depth
---+-----------------+-----------+------
 1 | 전자제품         | NULL      | 2
 2 | 노트북           | 1         | 1
 3 | 게이밍 노트북     | 2         | 0
```

#### 성능 주의사항

- 재귀 CTE는 **매 실행마다 트리를 순회**한다. 깊이가 깊고 노드가 많으면 느려질 수 있다.
- MySQL에서는 `cte_max_recursion_depth` 시스템 변수로 최대 재귀 깊이를 제한한다 (기본값 1000).
- PostgreSQL에서는 무한 루프 방지를 위해 `CYCLE` 절을 사용할 수 있다 (PostgreSQL 14+).

```sql
-- PostgreSQL 14+: CYCLE 절로 무한 루프 방지
WITH RECURSIVE category_tree AS (
    SELECT id, name, parent_id
    FROM categories
    WHERE id = 1

    UNION ALL

    SELECT c.id, c.name, c.parent_id
    FROM categories c
    INNER JOIN category_tree ct ON c.parent_id = ct.id
) CYCLE id SET is_cycle USING path
SELECT * FROM category_tree WHERE NOT is_cycle;
```

---

### 2.3 대안 패턴들

parent_id + 재귀 CTE가 만능은 아니다. 트리 구조를 다루는 대안 패턴이 있고, 각각 트레이드오프가 다르다.

#### Materialized Path (경로 저장)

각 노드에 **루트부터 자신까지의 전체 경로**를 문자열로 저장하는 패턴.

```sql
CREATE TABLE categories (
    id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    path    VARCHAR(500) NOT NULL           -- 경로 저장
);

-- 데이터 예시
INSERT INTO categories (id, name, path) VALUES
    (1, '전자제품',       '/1/'),
    (2, '노트북',         '/1/2/'),
    (3, '게이밍 노트북',   '/1/2/3/'),
    (4, '데스크톱',       '/1/4/'),
    (5, '의류',           '/5/');
```

```sql
-- "전자제품" 아래의 모든 카테고리 → LIKE 한 번으로 끝
SELECT * FROM categories WHERE path LIKE '/1/%';

-- 특정 노드의 깊이 계산
SELECT *, (LENGTH(path) - LENGTH(REPLACE(path, '/', ''))) - 1 AS depth
FROM categories;

-- 루트까지의 조상 노드 ID 추출 → 앱에서 path를 파싱
```

**장점**: 하위 노드 전체 조회가 단순한 `LIKE` 검색 하나로 가능. 재귀 쿼리 불필요. 깊이 계산도 쉬움.

**단점**: 노드를 이동하면 해당 노드와 모든 하위 노드의 `path`를 갱신해야 한다. path 문자열 길이에 한계가 있다. 인덱스 효율이 `LIKE '/1/%'`(prefix match)일 때만 좋다.

#### Closure Table (조상-자손 관계 테이블)

**별도 테이블에 모든 조상-자손 쌍**을 저장하는 패턴.

```sql
CREATE TABLE categories (
    id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL
);

-- 모든 조상-자손 관계를 저장하는 별도 테이블
CREATE TABLE category_closure (
    ancestor_id     BIGINT NOT NULL,
    descendant_id   BIGINT NOT NULL,
    depth           INT NOT NULL,           -- 조상에서 자손까지의 거리
    PRIMARY KEY (ancestor_id, descendant_id),
    CONSTRAINT fk_closure_ancestor
        FOREIGN KEY (ancestor_id) REFERENCES categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_closure_descendant
        FOREIGN KEY (descendant_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX idx_closure_descendant ON category_closure(descendant_id);

-- 데이터 예시: 전자제품(1) > 노트북(2) > 게이밍 노트북(3)
INSERT INTO category_closure (ancestor_id, descendant_id, depth) VALUES
    -- 자기 자신 참조 (depth = 0)
    (1, 1, 0), (2, 2, 0), (3, 3, 0),
    -- 부모-자식
    (1, 2, 1), (2, 3, 1),
    -- 조부모-손자
    (1, 3, 2);
```

```sql
-- "전자제품"의 모든 하위 카테고리
SELECT c.* FROM categories c
INNER JOIN category_closure cc ON c.id = cc.descendant_id
WHERE cc.ancestor_id = 1 AND cc.depth > 0;

-- "게이밍 노트북"의 모든 조상
SELECT c.* FROM categories c
INNER JOIN category_closure cc ON c.id = cc.ancestor_id
WHERE cc.descendant_id = 3 AND cc.depth > 0;

-- 직접 자식만 (depth = 1)
SELECT c.* FROM categories c
INNER JOIN category_closure cc ON c.id = cc.descendant_id
WHERE cc.ancestor_id = 1 AND cc.depth = 1;
```

**장점**: 하위 노드 조회, 조상 조회, 특정 깊이 조회 모두 JOIN 한 번으로 가능. 성능이 좋다.

**단점**: 노드를 추가/삭제/이동할 때 closure 테이블의 행을 여러 개 INSERT/DELETE해야 한다. 노드 N개인 트리에서 closure 테이블의 행 수는 최악의 경우 O(N²).

#### Nested Set (좌우 번호)

각 노드에 **left/right 번호**를 매겨서 트리 구조를 표현하는 패턴.

```sql
CREATE TABLE categories (
    id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    lft     INT NOT NULL,       -- left 번호
    rgt     INT NOT NULL        -- right 번호
);

-- 데이터 예시:
--     전자제품 [1, 8]
--       ├── 노트북 [2, 5]
--       │     └── 게이밍 노트북 [3, 4]
--       └── 데스크톱 [6, 7]
INSERT INTO categories (id, name, lft, rgt) VALUES
    (1, '전자제품',       1, 8),
    (2, '노트북',         2, 5),
    (3, '게이밍 노트북',   3, 4),
    (4, '데스크톱',       6, 7);
```

```sql
-- "전자제품"의 모든 하위 노드: lft와 rgt 사이에 있는 것
SELECT * FROM categories
WHERE lft > 1 AND rgt < 8;

-- 리프 노드만 (자식이 없는 노드): rgt = lft + 1
SELECT * FROM categories WHERE rgt = lft + 1;

-- 노드 수 계산: (rgt - lft - 1) / 2
SELECT *, (rgt - lft - 1) / 2 AS descendant_count FROM categories;
```

**장점**: 하위 노드 전체 조회가 범위 쿼리(BETWEEN)로 매우 빠르다. 단일 쿼리로 깊이, 리프 여부, 자손 수 등을 모두 계산 가능.

**단점**: **노드 삽입/이동/삭제 시 많은 행의 lft/rgt를 재계산**해야 한다. 쓰기가 매우 비효율적이다. 동시성 제어가 어렵다. 실무에서 거의 사용되지 않는 패턴.

#### 패턴 비교

| 패턴 | 하위 노드 조회 | 조상 노드 조회 | 삽입 | 이동 | 구현 난이도 |
|------|:---:|:---:|:---:|:---:|:---:|
| **parent_id (Adjacency List)** | 재귀 CTE 필요 | 재귀 CTE 필요 | 쉬움 | 쉬움 | ★☆☆ |
| **Materialized Path** | LIKE 한 줄 | 앱에서 파싱 | 쉬움 | 하위 전체 갱신 | ★★☆ |
| **Closure Table** | JOIN 한 번 | JOIN 한 번 | 다수 INSERT | 다수 DELETE+INSERT | ★★★ |
| **Nested Set** | BETWEEN 한 번 | BETWEEN 한 번 | 많은 행 갱신 | 매우 복잡 | ★★★ |

---

### 2.4 댓글 시스템 — 자기참조의 대표적 실무 사례

댓글 시스템은 자기참조의 가장 흔한 실무 사례다. 대부분의 서비스에서 "대댓글" 기능이 있다.

#### 단일 깊이 댓글 (depth = 1)

대부분의 서비스(쇼핑몰 리뷰, 블로그 댓글 등)는 원댓글 + 대댓글(1 depth)만 지원한다.

```sql
CREATE TABLE comments (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    post_id     BIGINT NOT NULL,
    parent_id   BIGINT,                          -- NULL이면 원댓글, 있으면 대댓글
    content     TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comments_post
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_parent
        FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_parent_id ON comments(parent_id);
```

```sql
-- 게시글의 댓글 + 대댓글을 한 번에 가져오기
SELECT
    c.id,
    c.parent_id,
    c.content,
    c.created_at
FROM comments c
WHERE c.post_id = 123
ORDER BY
    COALESCE(c.parent_id, c.id),  -- 같은 스레드끼리 묶기
    c.parent_id IS NOT NULL,       -- 원댓글이 먼저
    c.created_at;                  -- 시간순
```

#### 무한 깊이 대댓글

Reddit, Hacker News 같은 서비스는 무한 깊이 대댓글을 지원한다. 이때 parent_id만으로는 전체 트리를 효율적으로 정렬해서 가져오기 어렵다. **Materialized Path가 가장 실용적**이다.

```sql
CREATE TABLE comments (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    post_id     BIGINT NOT NULL,
    parent_id   BIGINT,
    path        VARCHAR(500) NOT NULL,           -- Materialized Path
    depth       INT NOT NULL DEFAULT 0,
    content     TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comments_post
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_parent
        FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL
);

CREATE INDEX idx_comments_post_path ON comments(post_id, path);
```

```sql
-- 댓글 삽입 시 path 생성
-- 원댓글: path = '/00001/'
-- 대댓글: path = '/00001/00003/'
-- 대대댓글: path = '/00001/00003/00007/'
-- (숫자를 고정 자릿수로 만들어야 문자열 정렬이 올바르게 동작)

-- 게시글의 전체 댓글을 트리 순서로 조회
SELECT * FROM comments
WHERE post_id = 123
ORDER BY path;

-- 특정 댓글의 모든 하위 댓글
SELECT * FROM comments
WHERE post_id = 123 AND path LIKE '/00001/00003/%';
```

#### 실무 추천

```
서비스 유형                    → 추천 패턴
────────────────────────────────────────────
쇼핑몰 리뷰, 블로그 댓글       → parent_id + depth 컬럼 (2 depth면 충분)
SNS, 커뮤니티                  → parent_id + depth (보통 3 depth)
Reddit, Hacker News 스타일     → Materialized Path
사내 문서 관리, Wiki            → Closure Table (이동이 잦으면)
```

### 2.5 실무에서의 자기참조

자기참조 관계에서 실무적으로 가장 중요한 포인트:

1. **parent_id로 시작하는 것이 거의 항상 정답이다.** 대안 패턴(Materialized Path, Closure Table, Nested Set)은 parent_id로 성능 문제가 실제로 발생했을 때 도입해도 늦지 않다. 처음부터 복잡한 패턴을 선택하면 쓰기 로직이 복잡해져서 버그가 늘어난다.
2. **깊이 제한을 두는 것이 안전하다.** 무한 깊이를 허용하면 UI 렌더링, 조회 성능, 사용자 경험 모두 문제가 된다. 대부분의 서비스는 3~5 depth면 충분하다. 앱 레벨에서 depth를 제한하고, 가능하다면 DB에서도 CHECK로 강제하면 좋다.
3. **루트 노드 조회가 빈번하다면 `parent_id IS NULL` 인덱스가 필요하다.** PostgreSQL이라면 `CREATE INDEX idx_root_categories ON categories(id) WHERE parent_id IS NULL` 같은 부분 인덱스를 만들 수 있다.
4. **재귀 CTE 성능은 생각보다 나쁘지 않다.** 수천~수만 노드 수준의 트리에서는 재귀 CTE가 충분히 빠르다. 수십만 노드가 넘어가는 극단적인 경우에만 대안 패턴을 고려하면 된다.

---

## 3. 다형성 관계 (Polymorphic Associations)

다형성 관계는 <strong>"하나의 테이블이 여러 종류의 부모를 참조해야 한다"</strong>는 문제에서 시작한다.

```
댓글이 게시글에도, 사진에도, 동영상에도 달릴 수 있다
좋아요가 게시글에도, 댓글에도, 리뷰에도 달릴 수 있다
파일 첨부가 프로필에도, 게시글에도, 메시지에도 될 수 있다
```

이걸 어떻게 설계할 것인가? 4가지 패턴이 있다.

### 3.1 패턴 1: STI (Single Table Inheritance)

**하나의 테이블에 모든 타입의 데이터를 넣고, `type` 컬럼으로 구분**하는 패턴.

```sql
-- "알림(notification)"이 여러 종류: 이메일, SMS, 푸시
CREATE TABLE notifications (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    type        VARCHAR(20) NOT NULL,             -- 'EMAIL', 'SMS', 'PUSH'

    -- 공통 컬럼
    user_id     BIGINT NOT NULL,
    message     TEXT NOT NULL,
    sent_at     TIMESTAMP,

    -- 이메일 전용 컬럼
    email_subject   VARCHAR(200),
    email_to        VARCHAR(320),

    -- SMS 전용 컬럼
    phone_number    VARCHAR(20),

    -- 푸시 전용 컬럼
    device_token    VARCHAR(500),
    badge_count     INT,

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_notifications_type ON notifications(type);
```

**장점:**
- 조인 없이 한 테이블에서 모든 타입 조회 가능
- 단순하다. 테이블이 하나니까.
- 전체 알림 목록을 type 필터만으로 가져올 수 있다

**단점:**
- 타입별로 사용하지 않는 컬럼이 NULL로 채워진다 (이메일이면 phone_number, device_token은 NULL)
- 타입별 NOT NULL 제약을 DB 레벨에서 걸기 어렵다 (CHECK로 조건부 NOT NULL은 가능하지만 번거롭다)
- 타입이 추가될 때마다 컬럼이 늘어난다

```sql
-- CHECK로 타입별 NOT NULL을 강제할 수는 있다 (번거롭지만 가능)
ALTER TABLE notifications ADD CONSTRAINT chk_email_fields
    CHECK (type != 'EMAIL' OR (email_subject IS NOT NULL AND email_to IS NOT NULL));

ALTER TABLE notifications ADD CONSTRAINT chk_sms_fields
    CHECK (type != 'SMS' OR phone_number IS NOT NULL);
```

**적합한 경우**: 타입 수가 적고(3~5개), 타입별 고유 컬럼이 적을 때. 타입이 10개 넘어가면 NULL 컬럼이 너무 많아져서 관리가 어려워진다.

### 3.2 패턴 2: 별도 테이블 (Class Table Inheritance)

**공통 컬럼은 부모 테이블에, 타입별 고유 컬럼은 자식 테이블에** 분리하는 패턴.

```sql
-- 부모 테이블: 공통 컬럼
CREATE TABLE notifications (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    type        VARCHAR(20) NOT NULL,
    user_id     BIGINT NOT NULL,
    message     TEXT NOT NULL,
    sent_at     TIMESTAMP,
    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 자식 테이블: 이메일 전용
CREATE TABLE notification_emails (
    notification_id BIGINT PRIMARY KEY,
    email_subject   VARCHAR(200) NOT NULL,
    email_to        VARCHAR(320) NOT NULL,
    CONSTRAINT fk_notification_emails
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

-- 자식 테이블: SMS 전용
CREATE TABLE notification_sms (
    notification_id BIGINT PRIMARY KEY,
    phone_number    VARCHAR(20) NOT NULL,
    CONSTRAINT fk_notification_sms
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

-- 자식 테이블: 푸시 전용
CREATE TABLE notification_pushes (
    notification_id BIGINT PRIMARY KEY,
    device_token    VARCHAR(500) NOT NULL,
    badge_count     INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_notification_pushes
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);
```

```sql
-- 이메일 알림을 상세 정보와 함께 조회
SELECT n.*, ne.email_subject, ne.email_to
FROM notifications n
INNER JOIN notification_emails ne ON n.id = ne.notification_id
WHERE n.type = 'EMAIL';

-- 전체 알림 목록 (타입 무관)은 부모 테이블만으로
SELECT * FROM notifications WHERE user_id = 123 ORDER BY sent_at DESC;
```

**장점:**
- 깔끔한 스키마 — NULL 컬럼 없음
- 타입별 고유 컬럼에 NOT NULL, FK 등 제약조건을 제대로 걸 수 있다
- 공통 속성 조회는 부모 테이블만으로 가능

**단점:**
- 특정 타입의 상세 정보를 보려면 JOIN이 필요
- 테이블 수가 늘어남 (타입 수 + 1)
- INSERT 시 부모 + 자식 두 테이블에 넣어야 한다 (트랜잭션 필요)

**적합한 경우**: 타입별 고유 컬럼이 많고, 각 타입에 고유한 제약조건이 필요할 때. 데이터 무결성이 중요한 도메인.

### 3.3 패턴 3: JSON 컬럼

타입별로 다른 가변 속성을 **JSON으로 저장**하는 패턴.

```sql
-- MySQL
CREATE TABLE notifications (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    type        VARCHAR(20) NOT NULL,
    user_id     BIGINT NOT NULL,
    message     TEXT NOT NULL,
    details     JSON,                            -- 타입별 가변 속성
    sent_at     TIMESTAMP,
    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users(id)
);

-- PostgreSQL (JSONB 사용 — 바이너리 저장, 인덱싱 가능)
CREATE TABLE notifications (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type        VARCHAR(20) NOT NULL,
    user_id     BIGINT NOT NULL,
    message     TEXT NOT NULL,
    details     JSONB,                           -- JSONB!
    sent_at     TIMESTAMP,
    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users(id)
);
```

```sql
-- 이메일 알림 INSERT
INSERT INTO notifications (type, user_id, message, details) VALUES
('EMAIL', 1, '가입을 환영합니다', '{"subject": "Welcome!", "to": "kim@email.com"}');

-- SMS 알림 INSERT
INSERT INTO notifications (type, user_id, message, details) VALUES
('SMS', 1, '인증번호 123456', '{"phone_number": "+821012345678"}');
```

```sql
-- MySQL: JSON 속성 조회
SELECT *, JSON_EXTRACT(details, '$.subject') AS subject
FROM notifications
WHERE type = 'EMAIL';

-- PostgreSQL: JSONB 속성 조회
SELECT *, details->>'subject' AS subject
FROM notifications
WHERE type = 'EMAIL';

-- PostgreSQL: JSONB 인덱스
CREATE INDEX idx_notifications_details ON notifications USING GIN (details);
```

#### MySQL JSON vs PostgreSQL JSONB

| 특성 | MySQL JSON | PostgreSQL JSONB |
|------|-----------|-----------------|
| **저장 방식** | 텍스트로 파싱 후 바이너리 저장 | 바이너리로 저장 (분해/재구성) |
| **중복 키** | 보존 | 마지막 값만 유지 |
| **키 순서** | 보존 | 보장 안 됨 |
| **인덱스** | Generated Column + 인덱스 (간접) | GIN 인덱스 (직접) |
| **부분 업데이트** | `JSON_SET()` (내부적으론 전체 재작성) | `jsonb_set()` (진짜 부분 업데이트, PG 14+) |
| **연산자** | `->`, `->>`, `JSON_EXTRACT()` | `->`, `->>`, `@>`, `?`, `?&`, `?\|` 등 풍부 |
| **전체 텍스트 검색** | 제한적 | `@>` 포함 검색, GIN 인덱스 활용 |

> PostgreSQL JSONB가 기능적으로 압도적이다. MySQL에서 JSON을 본격적으로 활용하려면 Generated Column을 통한 간접 인덱싱 등 우회가 필요하다.

**장점:**
- 유연하다. 스키마 변경 없이 속성 추가/삭제 가능
- 타입이 수십 개여도 테이블 하나로 충분
- 각 타입의 속성 구조가 자주 바뀌는 경우에 특히 유리

**단점:**
- JSON 내부 값에 NOT NULL, FK 같은 DB 레벨 제약조건을 걸 수 없다
- MySQL의 JSON 인덱싱이 불편 (Generated Column 필요)
- 타입별 스키마 검증은 앱 레벨에서 해야 한다

**적합한 경우**: 타입 수가 많고, 각 타입의 속성이 자주 바뀌며, DB 레벨 제약조건보다 유연성이 더 중요할 때.

### 3.4 패턴 4: 다형성 FK (commentable_type + commentable_id)

**Rails의 Polymorphic Association, Laravel의 Morphable** — 프레임워크에서 유명한 패턴이다.

```sql
-- 댓글이 여러 종류의 대상에 달릴 수 있다
CREATE TABLE comments (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    commentable_type    VARCHAR(50) NOT NULL,    -- 'Post', 'Photo', 'Video'
    commentable_id      BIGINT NOT NULL,         -- 대상의 PK
    content             TEXT NOT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_comments_commentable
    ON comments(commentable_type, commentable_id);
```

```sql
-- 게시글(id=1)의 댓글 조회
SELECT * FROM comments
WHERE commentable_type = 'Post' AND commentable_id = 1;

-- 사진(id=5)의 댓글 조회
SELECT * FROM comments
WHERE commentable_type = 'Photo' AND commentable_id = 5;
```

**장점:**
- 유연하다. 새로운 대상 타입이 추가되어도 comments 테이블을 변경할 필요 없다
- 테이블 하나로 모든 대상의 댓글을 관리

**단점 — 그리고 이 패턴에 대한 비판:**

이 패턴의 가장 큰 문제는 **DB 레벨에서 FK 제약을 걸 수 없다**는 것이다.

```sql
-- ❌ 이런 FK는 걸 수 없다
-- commentable_id가 posts.id를 참조할 수도, photos.id를 참조할 수도 있기 때문
FOREIGN KEY (commentable_id) REFERENCES ???(id)
```

FK가 없으므로:
- **참조 무결성을 앱에서 관리**해야 한다 → Post가 삭제되어도 그 Post의 댓글이 남아 있을 수 있다 (고아 데이터)
- `commentable_type = 'Postt'` (오타)를 DB가 막아주지 않는다
- JOIN이 단순하지 않다 — `commentable_type` 값에 따라 다른 테이블과 JOIN해야 하므로 동적 쿼리가 필요하다

```sql
-- 댓글과 대상 정보를 함께 가져오려면 UNION 또는 LEFT JOIN을 여러 번 해야 한다
SELECT c.*, p.title AS target_title
FROM comments c
LEFT JOIN posts p ON c.commentable_type = 'Post' AND c.commentable_id = p.id
LEFT JOIN photos ph ON c.commentable_type = 'Photo' AND c.commentable_id = ph.id
WHERE c.id = 123;
-- commentable_type이 늘어날수록 LEFT JOIN도 늘어난다
```

> **데이터베이스 관점에서 이 패턴은 "안티 패턴"이다.** Bill Karwin의 《SQL Antipatterns》에서도 이 패턴을 명시적으로 안티 패턴으로 분류한다. FK 제약이 없으므로 데이터 무결성을 DB가 보장하지 못하고, 모든 책임이 앱으로 넘어간다.

**그럼에도 이 패턴이 널리 쓰이는 이유:**
- Rails, Laravel 등에서 매우 편리하게 지원한다 (한 줄 선언으로 관계 설정)
- 대상 타입이 자주 추가되는 환경에서는 테이블/FK를 추가하는 것보다 빠르다
- "어차피 ORM이 데이터를 관리하니까 DB FK가 꼭 필요하진 않다"는 입장도 있다

**실무 판단**: 참조 무결성이 중요하다면 (금융, 결제, 의료) 이 패턴은 피하고, CTI나 별도 FK 테이블을 쓰는 것이 안전하다. 빠른 개발이 우선이고 ORM이 데이터 접근을 통제하는 환경이라면 실용적으로 사용할 수 있다.

### 3.5 패턴 비교 표 + 실무 판단 기준

| 기준 | STI (Single Table) | CTI (Class Table) | JSON 컬럼 | 다형성 FK |
|------|:---:|:---:|:---:|:---:|
| **NULL 컬럼** | 많음 | 없음 | 없음 | 없음 |
| **FK 제약** | 가능 | 가능 | 불가 (JSON 내부) | 불가 |
| **타입별 NOT NULL** | CHECK로 가능 (번거로움) | 가능 | 불가 | 불가 |
| **JOIN 필요** | 불필요 | 필요 | 불필요 | 타입별 동적 JOIN |
| **타입 추가 시** | ALTER TABLE (컬럼 추가) | CREATE TABLE | 변경 없음 | 변경 없음 |
| **쿼리 복잡도** | 낮음 | 보통 | 보통 | 높음 |
| **인덱싱** | 일반 인덱스 | 일반 인덱스 | GIN (PG) / Generated Col (MySQL) | 복합 인덱스 |
| **ORM 지원** | 좋음 | 좋음 | 보통 | 매우 좋음 (Rails/Laravel) |
| **데이터 무결성** | 보통 | 높음 | 낮음 | 낮음 |

#### 실무 판단 기준

```
타입이 3~5개, 고유 컬럼이 적다        → STI (한 테이블에 type 컬럼)
타입별 고유 컬럼 많고 제약조건 중요     → CTI (부모 + 자식 테이블)
타입이 수시로 추가되고 속성이 유동적    → JSON 컬럼
Rails/Laravel로 빠른 개발 우선         → 다형성 FK (단, 무결성 리스크 인지)
```

#### 실무에서의 다형성 관계

다형성 관계는 설계 패턴 중 가장 "정답이 없는" 영역이다. 각 패턴마다 트레이드오프가 명확하고, 비즈니스 요구사항과 팀의 기술 스택에 따라 최선의 선택이 달라진다.

현실적으로 가장 많이 볼 수 있는 조합:

1. **Rails/Laravel 프로젝트** → 다형성 FK가 압도적으로 많다. 프레임워크가 강력히 지원하기 때문.
2. **Spring/Go 프로젝트** → CTI 또는 STI가 많다. ORM이 다형성 FK를 네이티브로 지원하지 않으므로.
3. **대규모 SaaS** → JSON 컬럼 + CTI 하이브리드가 늘어나고 있다. 공통 속성은 정규 컬럼, 가변 속성은 JSON으로 처리.

---

## 4. Junction Table 설계 심화

### 4.1 기본 Junction Table

N:M 관계의 기본 중간 테이블. 1.3절에서 다룬 내용을 간단히 복습하자.

```sql
-- 가장 단순한 형태: 두 FK의 복합 PK
CREATE TABLE post_tags (
    post_id     BIGINT NOT NULL,
    tag_id      BIGINT NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    CONSTRAINT fk_post_tags_post
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_post_tags_tag
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_post_tags_tag_id ON post_tags(tag_id);
```

이 형태는 **관계 자체에 추가 속성이 없을 때** 적합하다. 게시글-태그, 사용자-역할처럼 "연결 그 자체"만 의미 있는 경우.

### 4.2 Junction Table에 의미를 더하기

실무에서는 중간 테이블에 추가 정보가 필요한 경우가 대부분이다.

```sql
-- 팀 멤버십: "누가 어떤 팀에 어떤 역할로 언제 합류했는가"
CREATE TABLE team_members (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,   -- Surrogate PK
    team_id     BIGINT NOT NULL,
    user_id     BIGINT NOT NULL,
    role        VARCHAR(20) NOT NULL DEFAULT 'MEMBER',  -- OWNER, ADMIN, MEMBER
    joined_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    invited_by  BIGINT,                                 -- 초대한 사람
    CONSTRAINT uq_team_members UNIQUE (team_id, user_id),
    CONSTRAINT fk_team_members_team
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_members_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_members_inviter
        FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
);
```

여기서 `team_members`는 단순 매핑이 아니라 **"멤버십"이라는 자체적인 의미**를 가진다. role, joined_at, invited_by 같은 속성이 관계 자체에 속한다.

#### 언제 Surrogate PK를 추가해야 하는가

```
복합 PK만으로 충분한 경우:
  - 추가 컬럼이 없거나 1~2개
  - API에서 이 행을 개별 식별할 필요가 없음
  - ORM이 복합 PK를 잘 지원함

Surrogate PK가 필요한 경우:
  - 추가 컬럼이 3개 이상이고, 이 테이블이 독립적인 엔티티에 가까움
  - REST API에서 개별 행을 CRUD해야 함 (DELETE /team-members/123)
  - 다른 테이블이 이 중간 테이블을 FK로 참조함
  - 같은 조합이 여러 번 존재할 수 있음 (예: 같은 사용자가 같은 팀에서 역할 변경 이력)
```

### 4.3 3자 관계 (Ternary Relationship)

2개가 아닌 **3개 이상의 테이블을 연결**하는 Junction Table.

```sql
-- 프로젝트 멤버: user + project + role → 3자 관계
-- 같은 사용자가 프로젝트 A에서는 개발자, 프로젝트 B에서는 관리자일 수 있다
CREATE TABLE project_members (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    project_id  BIGINT NOT NULL,
    role_id     BIGINT NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_project_member UNIQUE (user_id, project_id),  -- 한 프로젝트에 한 역할
    CONSTRAINT fk_pm_user
        FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_pm_project
        FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_pm_role
        FOREIGN KEY (role_id) REFERENCES roles(id)
);
```

3자 관계에서 UNIQUE 제약의 범위가 중요하다:

```sql
-- "같은 사용자가 같은 프로젝트에 하나의 역할만"
UNIQUE (user_id, project_id)

-- "같은 사용자가 같은 프로젝트에 여러 역할 가능하되 같은 역할 중복 불가"
UNIQUE (user_id, project_id, role_id)
```

비즈니스 규칙에 따라 UNIQUE의 범위가 달라진다. 이 판단을 빼먹으면 "같은 사용자가 같은 프로젝트에 개발자 역할이 3개 들어가 있다" 같은 데이터 오류가 발생한다.

#### 더 복잡한 예시: 시간표

```sql
-- 시간표: 교수 + 과목 + 강의실 + 시간대
CREATE TABLE schedules (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    professor_id    BIGINT NOT NULL,
    course_id       BIGINT NOT NULL,
    room_id         BIGINT NOT NULL,
    day_of_week     SMALLINT NOT NULL,          -- 1(월) ~ 5(금)
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    CONSTRAINT fk_schedules_professor
        FOREIGN KEY (professor_id) REFERENCES professors(id),
    CONSTRAINT fk_schedules_course
        FOREIGN KEY (course_id) REFERENCES courses(id),
    CONSTRAINT fk_schedules_room
        FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT chk_schedules_time
        CHECK (end_time > start_time),
    CONSTRAINT chk_schedules_day
        CHECK (day_of_week BETWEEN 1 AND 5)
);
```

이런 다자 관계에서는 "같은 강의실에 같은 시간에 두 수업이 잡히면 안 된다"는 제약이 추가로 필요하다. 이건 단순 UNIQUE로 해결이 안 되고, PostgreSQL의 EXCLUDE 제약이나 앱 레벨 검증이 필요하다 — [3편](/blog/rdb-constraints-integrity-guide)에서 다룬 내용이다.

### 4.4 실무에서의 Junction Table

Junction Table은 실무에서 매우 빈번하게 사용된다. 주의할 점을 정리하면:

1. **이름을 잘 짓는 것이 중요하다.** `user_roles`보다 `role_assignments`, `post_tags`보다 `taggings` — 관계의 의미를 담은 이름이 낫다. 다만 이건 팀 컨벤션에 따라 다르므로, 기존 프로젝트의 네이밍을 따르는 것이 우선이다.
2. **양방향 인덱스를 잊지 않는다.** `PRIMARY KEY (a_id, b_id)`를 만들면 a_id 기반 조회는 빠르지만, b_id 기반 조회를 위한 인덱스가 별도로 필요하다. 이건 정말 자주 빠뜨리는 부분이다.
3. **Soft Delete가 필요하면 미리 고려한다.** Junction Table에 `deleted_at` 컬럼을 추가하면 UNIQUE 제약에 영향을 줄 수 있다. 예를 들어 팀 멤버를 탈퇴시켰다가 다시 초대하려면, `UNIQUE (team_id, user_id)` 때문에 막힌다. 이런 경우 [3편](/blog/rdb-constraints-integrity-guide)에서 다룬 부분 UNIQUE 인덱스(PostgreSQL)나 상태 컬럼 포함 복합 UNIQUE를 사용해야 한다.
4. **CASCADE 삭제를 제대로 설정한다.** Junction Table의 FK에 `ON DELETE CASCADE`를 빼먹으면, 부모 행을 삭제할 때 FK 위반 에러가 발생해서 "삭제가 안 된다"는 버그 리포트가 들어온다.

---

## 5. MySQL vs PostgreSQL — 관계 설계 관련 차이

관계 설계에 영향을 미치는 MySQL과 PostgreSQL의 주요 차이점을 정리한다.

### WITH RECURSIVE 지원

| 특성 | MySQL | PostgreSQL |
|------|-------|------------|
| 지원 시작 | 8.0+ (2018) | 8.4+ (2006) — 사실상 항상 지원 |
| 최대 재귀 깊이 | `cte_max_recursion_depth` (기본 1000) | 제한 없음 (메모리만큼) |
| CYCLE 감지 | 앱에서 처리 | `CYCLE` 절 지원 (14+) |
| 성능 | 충분히 빠름 (수만 노드 수준) | 충분히 빠름 |

### JSON/JSONB 차이

| 특성 | MySQL JSON | PostgreSQL JSONB |
|------|-----------|-----------------|
| 인덱싱 | Generated Column + B-Tree (간접) | GIN 인덱스 (직접) |
| 포함 검색 | 불편 (`JSON_CONTAINS`) | `@>` 연산자 |
| 부분 업데이트 | 전체 재작성 | 진짜 부분 업데이트 (14+) |
| JSON 경로 쿼리 | `JSON_EXTRACT`, `->`, `->>` | `->`, `->>`, `#>`, `@>`, `?`, `jsonpath` |

### 테이블 상속 (PostgreSQL 전용)

PostgreSQL은 <strong>테이블 상속(INHERITS)</strong>이라는 독자적 기능이 있다. CTI를 DB 레벨에서 직접 지원하는 것.

```sql
-- PostgreSQL: 테이블 상속
CREATE TABLE notifications (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    message     TEXT NOT NULL,
    sent_at     TIMESTAMP
);

-- email_notifications는 notifications의 모든 컬럼을 상속받는다
CREATE TABLE email_notifications (
    email_subject   VARCHAR(200) NOT NULL,
    email_to        VARCHAR(320) NOT NULL
) INHERITS (notifications);

-- sms_notifications도 상속
CREATE TABLE sms_notifications (
    phone_number    VARCHAR(20) NOT NULL
) INHERITS (notifications);
```

```sql
-- 부모 테이블을 조회하면 자식 테이블의 행도 함께 나온다!
SELECT * FROM notifications;     -- email + sms 모두 포함
SELECT * FROM ONLY notifications; -- 부모 테이블만
```

**하지만 실무에서 INHERITS는 거의 사용되지 않는다.** 이유:
- 자식 테이블의 PK, UNIQUE, FK 등 제약조건이 부모와 공유되지 않는다
- 부모 테이블의 인덱스가 자식에 자동 적용되지 않는다
- ORM 지원이 미흡하다
- 파티셔닝이 INHERITS의 상위 호환 기능으로 제공된다 (Declarative Partitioning, PG 10+)

> **PostgreSQL INHERITS는 "존재하지만 안 쓰는 기능"으로 분류된다.** 다형성 관계를 DB 레벨에서 해결하겠다는 아이디어 자체는 좋지만, 제약조건 공유 문제가 치명적이다. CTI가 필요하면 3.2절의 수동 방식이 더 안전하다.

### EXCLUDE 제약 (PostgreSQL 전용)

[3편](/blog/rdb-constraints-integrity-guide)에서 다뤘듯이, PostgreSQL의 EXCLUDE 제약은 <strong>"범위가 겹치면 안 된다"</strong>는 규칙을 DB 레벨에서 강제할 수 있다. 관계 설계에서는 시간표 충돌 방지, 예약 중복 방지 등에 활용된다.

```sql
-- PostgreSQL: 같은 강의실에 시간이 겹치는 수업 방지
CREATE TABLE schedules (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id     BIGINT NOT NULL,
    time_range  TSRANGE NOT NULL,   -- 시작~종료 시간 범위
    CONSTRAINT fk_schedules_room FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT excl_room_time
        EXCLUDE USING GIST (room_id WITH =, time_range WITH &&)
);

-- room_id가 같고(=) time_range가 겹치면(&&) INSERT/UPDATE를 거부한다
```

MySQL에는 이 기능이 없으므로, 앱 레벨에서 트랜잭션 + SELECT FOR UPDATE로 검증해야 한다.

### 비교 테이블

| 기능 | MySQL | PostgreSQL |
|------|-------|------------|
| **WITH RECURSIVE** | 8.0+ | 처음부터 지원 |
| **CYCLE 감지** | 미지원 | 14+ (`CYCLE` 절) |
| **JSON 인덱싱** | Generated Column (간접) | GIN 인덱스 (직접) |
| **JSONB 부분 업데이트** | 미지원 (전체 재작성) | 14+ (`jsonb_set`) |
| **테이블 상속 (INHERITS)** | 미지원 | 지원 (비추천) |
| **EXCLUDE 제약** | 미지원 | 지원 (범위 겹침 방지) |
| **FK 자동 인덱스** | ✅ 자동 생성 | ❌ 수동 생성 |
| **부분 인덱스** | 미지원 | 지원 (`WHERE` 절) |
| **DEFERRABLE FK** | 미지원 | 지원 (`INITIALLY DEFERRED`) |

> 관계 설계 측면에서 PostgreSQL이 더 많은 도구를 제공하는 것은 분명하다. 하지만 **MySQL로도 대부분의 관계 패턴을 충분히 구현할 수 있다.** 차이가 나는 부분은 앱 레벨에서 보완하면 된다. DB 선택이 관계 설계의 결정적 요인이 되어서는 안 된다.

---

## 정리

| 주제 | 핵심 원칙 |
|------|-----------|
| **1:1 관계** | 기본은 한 테이블. 분리는 보안/성능/선택적 데이터 사유가 있을 때만 |
| **1:N 관계** | 자식에 FK + NOT NULL + 인덱스. N이 무한히 커지면 파티셔닝 |
| **N:M 관계** | Junction Table 필수. 복합 PK vs Surrogate PK는 자체 속성 유무로 판단 |
| **자기참조** | parent_id로 시작. 성능 문제 시 Materialized Path 또는 Closure Table |
| **다형성 관계** | STI / CTI / JSON / 다형성 FK — 타입 수, 무결성 요구, 개발 속도로 선택 |
| **Junction Table** | 양방향 인덱스 필수. 자체 속성이 늘면 독립 엔티티로 승격 |
| **MySQL vs PG** | PG가 도구는 많지만 MySQL로도 충분. 차이는 앱 레벨에서 보완 |

**관계 설계에서 가장 중요한 원칙은 "단순하게 시작하고, 필요할 때 복잡하게"다.** 처음부터 Closure Table이나 다형성 FK 같은 복잡한 패턴을 도입하면 유지보수 비용이 급격히 늘어난다. parent_id로 시작하고, STI로 시작하고, 복합 PK로 시작한 뒤 — 실제 문제가 발생했을 때 더 복잡한 패턴으로 전환해도 늦지 않다.

### 실무 채택 현실 — 한눈에 보기

| 패턴 | 실무 채택률 | 현실 |
|------|:---:|------|
| **1:N (FK)** | ★★★★★ | 가장 기본적인 관계. 모든 프로젝트에서 사용 |
| **N:M (Junction Table)** | ★★★★★ | 태그, 역할, 권한 등 사방에 존재 |
| **1:1 분리** | ★★★☆☆ | "필요할 때만" — 무의미한 분리는 오히려 해가 됨 |
| **parent_id (자기참조)** | ★★★★☆ | 카테고리, 댓글, 조직도에서 거의 표준 |
| **Materialized Path** | ★★★☆☆ | 깊은 트리가 필요한 서비스에서 실용적 |
| **Closure Table** | ★★☆☆☆ | 조회 성능이 중요한 대규모 트리에서 가끔 사용 |
| **Nested Set** | ★☆☆☆☆ | 읽기 전용 카탈로그 외에는 거의 안 씀 |
| **STI** | ★★★★☆ | 타입 수가 적을 때 매우 실용적 |
| **CTI** | ★★★☆☆ | 타입별 제약이 중요한 도메인에서 채택 |
| **JSON 컬럼** | ★★★☆☆ | 가변 속성 저장에 점점 더 많이 사용. 특히 PostgreSQL JSONB |
| **다형성 FK** | ★★★☆☆ | Rails/Laravel 생태계에서 매우 흔함. 다른 스택에서는 드묾 |

```
[기본] 1:N FK + N:M Junction Table + parent_id    → 이것만으로도 대부분의 관계 커버 가능
[필요 시] STI/CTI + Materialized Path + JSON      → 문제에 맞는 패턴을 선택
[주의] 다형성 FK + Nested Set                      → 트레이드오프를 충분히 이해한 후에만
```

**"감으로 관계를 설계하지 말고, 패턴을 알고 의식적으로 선택하자."** 패턴을 모르면 매번 새로 고민해야 하지만, 패턴을 알면 "이 상황에는 이 패턴"이라는 판단이 빠르게 내려진다.

다음 편에서는 **실무 도메인 스키마 설계** — 이 모든 이론을 실제 도메인(이커머스, SNS, 예약 시스템 등)에 적용해 본다.
