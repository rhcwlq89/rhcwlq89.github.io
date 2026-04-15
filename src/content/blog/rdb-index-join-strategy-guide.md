---
title: "RDB 설계 시리즈 6편: 인덱스 설계와 JOIN 전략 — 옵티마이저까지"
description: "인덱스의 기초를 넘어 설계 관점으로 들어간다. 커버링 인덱스, 부분 인덱스, 카디널리티 분석부터 JOIN 알고리즘(Nested Loop, Hash, Merge)의 선택 기준, EXPLAIN ANALYZE 읽는 법, 그리고 N+1 문제까지. 인덱스를 '만드는 것'이 아니라 '설계하는 것'으로 바꾸는 글."
pubDate: 2026-04-15T18:00:00+09:00
tags:
  - Database
  - RDB
  - Index
  - JOIN
  - Query Optimization
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbIndexJoinStrategyGuide.png"
---

## 서론

[이전 글](/blog/rdb-domain-schema-design-guide)에서 주문/결제 도메인을 실무 수준으로 설계했다. 테이블 구조, 관계, 제약조건까지 — 스키마의 "형태"는 완성됐다.

그런데 스키마만 잘 짜면 쿼리가 빠를까? **아니다.**

테이블 설계가 건축의 도면이라면, 인덱스 설계는 건물의 엘리베이터 배치다. 도면이 아무리 좋아도 엘리베이터가 없으면 30층까지 계단으로 올라가야 한다. 반대로 엘리베이터를 아무 데나 마구 설치하면 유지비만 폭발한다.

이 글은 인덱스 "기초"를 다루지 않는다. B+Tree가 뭔지, CREATE INDEX 문법이 뭔지는 이미 안다고 가정한다. 대신 **설계 판단**에 집중한다:

1. **인덱스 설계 전에 알아야 할 것** — 왜 B+Tree가 기본이고, 언제 다른 걸 쓰는가
2. **설계 레벨 인덱스** — 커버링 인덱스, 부분 인덱스, Expression 인덱스, 카디널리티 분석
3. **JOIN 알고리즘** — Nested Loop, Hash Join, Merge Join의 작동 원리와 선택 조건
4. **EXPLAIN ANALYZE 읽기** — 실행 계획을 읽고, 옵티마이저의 판단을 이해하기
5. **실전 패턴** — N+1 문제, JOIN 순서, 대량 데이터 튜닝

---

## 1. 인덱스 설계 전에 알아야 할 것

### 1.1 B+Tree — 왜 기본인가

MySQL(InnoDB), PostgreSQL, SQL Server, Oracle 등 주요 RDBMS 모두 기본 인덱스 구조는 **B+Tree**다. 이유는 단순하다:

| 연산 | B+Tree 시간복잡도 | Full Scan |
|------|-------------------|-----------|
| 등가 검색 (`=`) | O(log N) | O(N) |
| 범위 검색 (`BETWEEN`, `>`, `<`) | O(log N + M) | O(N) |
| 정렬 (`ORDER BY`) | 이미 정렬됨 | O(N log N) |
| MIN/MAX | O(log N) | O(N) |

100만 건 테이블에서 등가 검색은 약 20번의 페이지 접근으로 끝난다(log₂(1,000,000) ≈ 20). Full Scan이면 수천 페이지를 읽어야 한다.

**B+Tree의 핵심 특성:**

- **리프 노드가 연결 리스트**로 이어져 있어 범위 스캔에 강하다
- **높이가 3~4로 유지**되어 디스크 I/O가 예측 가능하다
- **정렬 상태를 유지**하므로 ORDER BY에 추가 정렬 비용이 없다

### 1.2 B+Tree 말고 다른 선택지

모든 상황에 B+Tree가 최선은 아니다. DBMS별로 다른 인덱스 구조를 지원한다.

| 인덱스 타입 | 지원 DBMS | 적합한 상황 | 부적합한 상황 |
|------------|-----------|------------|-------------|
| **Hash** | PG (명시적), MySQL (Memory 엔진) | 등가 비교만 하는 경우 | 범위 검색, 정렬 |
| **GIN** | PG | 배열, JSONB, 전문 검색 | 단순 스칼라 값 |
| **GiST** | PG | 지리 데이터, 범위 타입 | 등가 비교 위주 |
| **BRIN** | PG | 물리적 정렬과 논리적 정렬이 일치하는 대용량 테이블 | 랜덤 삽입 패턴 |

MySQL InnoDB는 사실상 B+Tree만 쓴다. PostgreSQL은 상황에 따라 다양한 인덱스를 선택할 수 있다 — 이것이 PG가 "인덱스 설계"에서 유리한 이유 중 하나다.

### 1.3 클러스터드 인덱스 vs 힙 테이블

MySQL(InnoDB)과 PostgreSQL의 가장 큰 구조적 차이다.

**MySQL InnoDB — 클러스터드 인덱스:**

```
PK 인덱스 (클러스터드)
├── [PK=1] → 실제 행 데이터
├── [PK=2] → 실제 행 데이터
└── [PK=3] → 실제 행 데이터

세컨더리 인덱스
├── [email='a@x.com'] → PK=2
└── [email='b@x.com'] → PK=1
    ↓
    PK 인덱스에서 다시 조회 (bookmark lookup)
```

- PK 순서대로 데이터가 물리적으로 저장된다
- 세컨더리 인덱스는 PK 값을 저장하고, 실제 데이터를 읽으려면 **PK 인덱스를 한 번 더** 거친다
- PK가 크면(예: UUID) 모든 세컨더리 인덱스의 크기가 함께 커진다

**PostgreSQL — 힙 테이블:**

```
인덱스 (어떤 인덱스든)
├── [email='a@x.com'] → ctid (0,2)
└── [email='b@x.com'] → ctid (0,1)
    ↓
    힙 테이블에서 직접 조회

힙 테이블
├── (0,1) → 실제 행 데이터
├── (0,2) → 실제 행 데이터
└── (0,3) → 실제 행 데이터
```

- 인덱스가 행의 물리적 위치(ctid)를 직접 가리킨다
- PK 크기가 다른 인덱스에 영향을 주지 않는다
- 하지만 MVCC 때문에 **같은 행의 여러 버전**이 힙에 존재할 수 있고, 이를 정리하려면 VACUUM이 필요하다

**설계 시 시사점:**

| 항목 | MySQL (InnoDB) | PostgreSQL |
|------|---------------|------------|
| PK 크기 | 작게 유지 (세컨더리 인덱스에 복사됨) | 상대적으로 자유 |
| PK 순서 삽입 | 중요 (페이지 분할 방지) | 덜 중요 |
| UUID PK | 성능 이슈 있음 | 상대적으로 양호 |
| 세컨더리 인덱스 조회 | bookmark lookup 비용 | 힙 접근 1회 |

### 1.4 인덱스를 만들기 전에 생각할 것

인덱스는 **공짜가 아니다.** 읽기를 빠르게 하는 대신 쓰기에 비용을 더한다.

```
INSERT 1건 → 테이블 1회 쓰기 + 인덱스 N개 × 각 1회 쓰기
UPDATE 1건 → (인덱스 컬럼 변경 시) 인덱스 삭제 + 삽입
DELETE 1건 → 테이블 1회 + 인덱스 N개 × 각 1회 삭제 마킹
```

인덱스 5개짜리 테이블에 INSERT 하면 쓰기 I/O가 6배다. 이걸 모르고 "느리니까 인덱스 추가"만 반복하면, 읽기는 빨라지지만 쓰기가 느려지고, 결국 전체 성능이 떨어진다.

**인덱스 설계의 원칙:**

1. **WHERE, JOIN, ORDER BY에 등장하는 컬럼**부터 검토한다
2. **카디널리티가 높은 컬럼**을 우선한다 (뒤에서 자세히)
3. **쓰기 빈도와 읽기 빈도의 비율**을 따진다. 쓰기가 90%인 로그 테이블에 인덱스 5개는 과하다
4. **하나의 복합 인덱스가 여러 단일 인덱스보다 낫다** — 디스크 공간과 유지비용 모두
5. **사용하지 않는 인덱스는 삭제**한다. 공간과 쓰기 성능을 잡아먹는다

---

## 2. 설계 레벨 인덱스 — 기초를 넘어서

### 2.1 카디널리티 분석

**카디널리티(Cardinality)** = 컬럼에 들어 있는 고유 값의 수.

```sql
-- 카디널리티 확인
SELECT
    COUNT(DISTINCT status) AS status_cardinality,
    COUNT(DISTINCT email)  AS email_cardinality,
    COUNT(DISTINCT gender) AS gender_cardinality,
    COUNT(*)               AS total_rows
FROM users;
```

```
status_cardinality | email_cardinality | gender_cardinality | total_rows
-------------------+-------------------+--------------------+-----------
                 5 |         1,000,000 |                  3 |  1,000,000
```

- `email`: 카디널리티 100만 → **높음** → 인덱스 효과 큼 (한 값으로 1건 특정)
- `status`: 카디널리티 5 → **낮음** → 인덱스 단독 사용 시 효과 미미 (한 값으로 20만 건)
- `gender`: 카디널리티 3 → **매우 낮음** → 단독 인덱스 의미 없음

**카디널리티가 낮은 컬럼은 인덱스 효과가 없을까?**

단독으로는 효과가 적지만, **복합 인덱스의 선행 컬럼으로는 유효**하다:

```sql
-- status 단독 인덱스: 20만 건 스캔 → 비효율
SELECT * FROM orders WHERE status = 'PENDING';

-- 복합 인덱스 (status, created_at): 특정 기간의 PENDING만 → 효율적
CREATE INDEX idx_orders_status_created ON orders (status, created_at);
SELECT * FROM orders
WHERE status = 'PENDING'
  AND created_at >= '2026-04-01';
```

**선택도(Selectivity)** = 1 / 카디널리티. 선택도가 높을수록(값이 작을수록) 인덱스가 좋은 필터 역할을 한다.

### 2.2 복합 인덱스와 컬럼 순서

복합 인덱스에서 **컬럼 순서가 성능을 결정**한다. B+Tree는 왼쪽부터 정렬하기 때문이다.

```sql
CREATE INDEX idx_example ON orders (status, customer_id, created_at);
```

이 인덱스가 활용되는 쿼리:

```sql
-- ✅ 선행 컬럼부터 사용 → 인덱스 풀 활용
WHERE status = 'PAID' AND customer_id = 123 AND created_at > '2026-01-01'

-- ✅ 선행 컬럼 2개 사용 → 인덱스 부분 활용
WHERE status = 'PAID' AND customer_id = 123

-- ✅ 선행 컬럼 1개 사용 → 인덱스 부분 활용
WHERE status = 'PAID'

-- ❌ 선행 컬럼 건너뜀 → 인덱스 사용 불가 (또는 비효율적 스캔)
WHERE customer_id = 123 AND created_at > '2026-01-01'

-- ❌ 세 번째 컬럼만 → 인덱스 사용 불가
WHERE created_at > '2026-01-01'
```

**복합 인덱스 컬럼 순서 결정 기준:**

1. **등가 조건(`=`)으로 쓰이는 컬럼을 앞에** 둔다
2. 등가 조건 중에서는 **카디널리티가 높은 것을 앞에** 둔다
3. **범위 조건(`>`, `<`, `BETWEEN`)은 마지막에** 둔다 — 범위 조건 뒤의 컬럼은 인덱스를 탈 수 없다

```sql
-- 좋은 순서: 등가(높은 카디널리티) → 등가(낮은 카디널리티) → 범위
CREATE INDEX idx_good ON orders (customer_id, status, created_at);

-- 나쁜 순서: 범위가 앞에 오면 뒤 컬럼은 인덱스 활용 불가
CREATE INDEX idx_bad ON orders (created_at, customer_id, status);
```

### 2.3 커버링 인덱스

쿼리가 필요로 하는 모든 컬럼이 인덱스에 포함되어 있으면, **테이블(힙) 접근 없이 인덱스만으로 결과를 반환**할 수 있다. 이를 **커버링 인덱스(Covering Index)** 또는 **Index-Only Scan**이라 한다.

```sql
-- 인덱스: (customer_id, status, created_at)
-- 이 쿼리는 인덱스만으로 응답 가능 (커버링)
SELECT status, created_at
FROM orders
WHERE customer_id = 123;

-- 이 쿼리는 커버링 불가 (total_amount가 인덱스에 없음)
SELECT status, created_at, total_amount
FROM orders
WHERE customer_id = 123;
```

**MySQL의 INCLUDE 대안:**

MySQL에는 PostgreSQL의 `INCLUDE` 구문이 없다. 대신 커버링이 필요한 컬럼을 인덱스 끝에 추가한다:

```sql
-- MySQL: 커버링을 위해 컬럼 추가
CREATE INDEX idx_covering ON orders (customer_id, status, created_at, total_amount);
```

단점은 이 추가 컬럼이 정렬 키로도 작동한다는 것이다. 인덱스 크기가 커지고, 삽입/갱신 비용도 증가한다.

**PostgreSQL의 INCLUDE:**

```sql
-- PG: INCLUDE로 비정렬 컬럼을 인덱스에 포함
CREATE INDEX idx_covering ON orders (customer_id)
    INCLUDE (status, created_at, total_amount);
```

`INCLUDE` 컬럼은 **검색에는 사용되지 않고 결과 반환에만** 쓰인다. 인덱스 트리의 정렬 키를 오염시키지 않으면서 커버링을 달성할 수 있다.

**EXPLAIN에서 확인하는 법:**

```sql
-- MySQL: Extra 컬럼에 "Using index" 표시
EXPLAIN SELECT status FROM orders WHERE customer_id = 123;
-- → Extra: Using index

-- PostgreSQL: "Index Only Scan" 노드
EXPLAIN SELECT status FROM orders WHERE customer_id = 123;
-- → Index Only Scan using idx_covering on orders
```

### 2.4 부분 인덱스 (PostgreSQL)

**전체 행이 아니라, 조건에 맞는 행만 인덱스에 포함**시킨다. PostgreSQL 전용이다.

```sql
-- 전체 인덱스: 100만 건 모두 인덱스에 포함
CREATE INDEX idx_orders_status ON orders (status);

-- 부분 인덱스: 처리 대기 중인 주문만 (전체의 5%라면 인덱스 크기 95% 절감)
CREATE INDEX idx_orders_pending ON orders (created_at)
    WHERE status = 'PENDING';
```

**언제 쓰는가:**

- **특정 상태의 행만 자주 조회**할 때: `WHERE status = 'PENDING'`, `WHERE deleted_at IS NULL`
- **소프트 삭제 패턴**: 삭제되지 않은 행만 인덱스에 유지
- **핫 데이터와 콜드 데이터 분리**: 최근 30일 데이터만 인덱싱

```sql
-- 소프트 삭제: 활성 사용자만 인덱스
CREATE INDEX idx_active_users_email ON users (email)
    WHERE deleted_at IS NULL;

-- UNIQUE 제약 + 부분 인덱스: 활성 사용자 중 이메일 중복 방지
CREATE UNIQUE INDEX idx_unique_active_email ON users (email)
    WHERE deleted_at IS NULL;
```

이 마지막 예시는 강력하다 — 삭제된 사용자의 이메일은 중복을 허용하면서, 활성 사용자의 이메일은 유니크를 보장한다. MySQL에서는 이 패턴을 구현할 수 없다.

**MySQL의 대안:**

MySQL에는 부분 인덱스가 없다. 비슷한 효과를 내려면:

1. **Generated Column + 인덱스**: 조건을 컬럼으로 만들어 인덱스를 건다
2. **애플리케이션 레벨에서 관리**: 쿼리에 항상 조건을 포함

```sql
-- MySQL: Generated Column으로 부분 인덱스 흉내
ALTER TABLE orders ADD COLUMN is_pending TINYINT
    GENERATED ALWAYS AS (IF(status = 'PENDING', 1, NULL)) STORED;

CREATE INDEX idx_pending ON orders (is_pending, created_at);
```

### 2.5 Expression 인덱스 (함수 기반 인덱스)

컬럼 값이 아니라 **표현식의 결과에 인덱스**를 건다.

```sql
-- PostgreSQL
CREATE INDEX idx_users_lower_email ON users (LOWER(email));

-- MySQL 8.0+
CREATE INDEX idx_users_lower_email ON users ((LOWER(email)));
-- MySQL은 괄호가 이중으로 필요하다
```

**없으면 어떻게 되나:**

```sql
-- Expression 인덱스가 없을 때
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';
-- → 인덱스가 email에 있어도 LOWER() 때문에 인덱스를 타지 못함 (Full Scan)

-- Expression 인덱스가 있을 때
-- → Index Scan on idx_users_lower_email
```

**자주 쓰는 패턴:**

```sql
-- 날짜 기반 조회 (날짜 부분만 추출)
-- PostgreSQL
CREATE INDEX idx_orders_date ON orders (DATE(created_at));
-- MySQL
CREATE INDEX idx_orders_date ON orders ((DATE(created_at)));

-- JSON 필드 인덱스 (PostgreSQL)
CREATE INDEX idx_metadata_type ON events ((metadata->>'type'));

-- JSON 필드 인덱스 (MySQL 8.0+)
-- Generated Column을 거쳐야 한다
ALTER TABLE events ADD COLUMN event_type VARCHAR(50)
    GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.type'))) STORED;
CREATE INDEX idx_event_type ON events (event_type);
```

### 2.6 인덱스 유지비용과 모니터링

인덱스는 만든 뒤가 더 중요하다. **사용하지 않는 인덱스**를 찾아서 제거해야 한다.

**PostgreSQL — 인덱스 사용 통계:**

```sql
SELECT
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS times_used,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

이 쿼리는 **한 번도 사용되지 않은 인덱스**를 크기순으로 보여준다. `idx_scan = 0`이고 크기가 크다면 삭제 후보다.

**MySQL — 인덱스 사용 통계:**

```sql
-- MySQL 8.0+ (performance_schema)
SELECT
    object_schema,
    object_name,
    index_name,
    count_star AS times_used
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE index_name IS NOT NULL
  AND count_star = 0
  AND object_schema = 'your_database'
ORDER BY object_name;
```

> **주의**: 통계는 서버 재시작 시 초기화된다. 최소 한 달 이상 운영 데이터를 축적한 뒤 판단해야 한다.

**중복 인덱스 찾기:**

```sql
-- MySQL: (a, b)와 (a)는 중복이다 — (a, b)가 (a) 단독 검색도 커버한다
-- 이런 패턴을 찾아서 단독 인덱스를 제거한다
```

```sql
-- PostgreSQL: 중복/유사 인덱스 확인
SELECT
    a.indexrelid::regclass AS index_1,
    b.indexrelid::regclass AS index_2,
    a.indrelid::regclass AS table_name
FROM pg_index a
JOIN pg_index b ON a.indrelid = b.indrelid
    AND a.indexrelid < b.indexrelid
    AND a.indkey::text = LEFT(b.indkey::text, LENGTH(a.indkey::text));
```

---

## 3. JOIN 알고리즘 — 옵티마이저가 고르는 방법

SQL에서 `JOIN`을 쓰면 DBMS의 옵티마이저가 **어떤 알고리즘으로 조인할지** 결정한다. 같은 쿼리도 데이터 크기, 인덱스 유무, 통계 정보에 따라 다른 알고리즘이 선택된다. 이걸 이해하면 "왜 이 쿼리가 느린가"를 설명할 수 있다.

### 3.1 Nested Loop Join (NLJ)

가장 직관적인 알고리즘이다. **바깥 테이블(driving table)의 각 행마다 안쪽 테이블을 검색**한다.

```
의사코드:
for each row in outer_table:        -- 바깥 루프
    for each row in inner_table:    -- 안쪽 루프
        if join_condition matches:
            emit row
```

**시간복잡도:**

- 인덱스 없음: O(N × M) — 최악
- 안쪽 테이블에 인덱스 있음: O(N × log M) — 빠름

```sql
-- 이 쿼리에서 orders.customer_id에 인덱스가 있으면 NLJ가 효율적
SELECT c.name, o.order_number
FROM customers c                    -- 바깥: 1,000건
JOIN orders o ON o.customer_id = c.id;  -- 안쪽: 인덱스로 각 고객의 주문을 빠르게 찾음
```

**NLJ가 선택되는 조건:**

- 바깥 테이블이 **작고**, 안쪽 테이블에 **인덱스**가 있을 때
- **소량의 행**을 조인할 때 (OLTP의 대부분)
- MySQL InnoDB의 **기본 조인 알고리즘** — MySQL은 8.0.18 이전까지 NLJ만 지원했다

### 3.2 Hash Join

**한쪽 테이블로 해시 테이블을 만들고**, 다른 쪽 테이블을 스캔하면서 해시 테이블에서 매칭한다.

```
의사코드:
-- Build 단계
hash_table = {}
for each row in smaller_table:
    hash_table[join_key] = row

-- Probe 단계
for each row in larger_table:
    if join_key in hash_table:
        emit row
```

**시간복잡도:** O(N + M) — 인덱스 없이도 빠르다.

**Hash Join이 선택되는 조건:**

- **인덱스가 없는 대량 데이터** 조인
- **등가 조인(`=`)만** 가능 — 범위 조인(`>`, `<`)에는 사용 불가
- Build 테이블이 **메모리에 들어갈 만큼 작아야** 최적 (넘치면 디스크 사용)

**DBMS별 지원:**

| DBMS | Hash Join 지원 |
|------|---------------|
| PostgreSQL | 항상 지원 |
| MySQL | 8.0.18+ (인덱스 없는 등가 조인에서 자동 선택) |

```sql
-- MySQL 8.0.18+에서 Hash Join이 선택되는 예
-- 두 테이블 모두 조인 키에 인덱스가 없을 때
SELECT *
FROM large_table_a a
JOIN large_table_b b ON a.some_key = b.some_key;
```

### 3.3 Merge Join (Sort-Merge Join)

**두 테이블을 조인 키 기준으로 정렬한 뒤, 동시에 스캔하면서 머지**한다.

```
의사코드:
sort outer_table by join_key
sort inner_table by join_key

pointer_a = first row of outer
pointer_b = first row of inner

while both have rows:
    if outer.key == inner.key:
        emit row, advance both
    elif outer.key < inner.key:
        advance outer
    else:
        advance inner
```

**시간복잡도:**

- 정렬 필요 시: O(N log N + M log M)
- 이미 정렬되어 있으면: O(N + M) — 가장 빠를 수 있다

**Merge Join이 선택되는 조건:**

- **두 테이블 모두 조인 키로 이미 정렬**되어 있을 때 (인덱스가 정렬을 보장)
- PostgreSQL에서 주로 사용, MySQL에서는 지원하지 않는다
- **대량 데이터 + 범위 조인**에서 Hash Join보다 유리할 수 있다

### 3.4 알고리즘 선택 요약

| 상황 | 최적 알고리즘 | 이유 |
|------|-------------|------|
| 소량 조인 + 인덱스 있음 | Nested Loop | 인덱스 탐색이 O(log M), 전체 비용 낮음 |
| 대량 조인 + 인덱스 없음 + 등가 | Hash Join | O(N+M), 인덱스 불필요 |
| 대량 조인 + 이미 정렬됨 | Merge Join | 정렬 비용 없이 O(N+M) |
| 대량 조인 + 인덱스 없음 + 범위 | Merge Join (정렬 후) | Hash는 범위 조인 불가 |

**MySQL 사용자가 알아야 할 것:**

MySQL은 Merge Join을 지원하지 않는다. 따라서:
- 인덱스가 있으면 → NLJ
- 인덱스가 없는 등가 조인이면 → Hash Join (8.0.18+)
- 인덱스가 없는 범위 조인이면 → NLJ (Full Scan) → **느리다. 인덱스를 만들어라.**

---

## 4. EXPLAIN ANALYZE — 옵티마이저의 판단 읽기

인덱스를 만들고 JOIN을 작성했으면, **실제로 어떻게 실행되는지** 확인해야 한다. "이 인덱스 탈 거야"라는 추측은 위험하다 — 옵티마이저는 통계 기반으로 판단하고, 인간의 직관과 다를 수 있다.

### 4.1 MySQL의 EXPLAIN

```sql
EXPLAIN SELECT o.order_number, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'PENDING'
  AND o.created_at >= '2026-04-01';
```

```
+----+-------+--------+------+-------------------+-------------------+---------+-------+------+-------------+
| id | table | type   | key  | key_len           | ref               | rows    | Extra             |
+----+-------+--------+------+-------------------+-------------------+---------+-------+------+-------------+
|  1 | o     | range  | idx_orders_status_created | 9 | NULL      |    3500 | Using index condition |
|  1 | c     | eq_ref | PRIMARY                   | 8 | db.o.customer_id |       1 | NULL              |
+----+-------+--------+------+-------------------+-------------------+---------+-------+------+-------------+
```

**핵심 컬럼 해석:**

| 컬럼 | 의미 | 좋은 값 | 나쁜 값 |
|------|------|---------|---------|
| `type` | 접근 방식 | `const`, `eq_ref`, `ref`, `range` | `ALL` (Full Scan) |
| `key` | 사용된 인덱스 | 인덱스 이름 | NULL (인덱스 미사용) |
| `rows` | 예상 스캔 행 수 | 적을수록 좋음 | 전체 행 수에 가까우면 나쁨 |
| `Extra` | 추가 정보 | `Using index` (커버링) | `Using filesort`, `Using temporary` |

**type 값의 성능 순서 (좋은 것 → 나쁜 것):**

```
system > const > eq_ref > ref > range > index > ALL
```

- `const`: PK/UNIQUE로 1건 조회
- `eq_ref`: JOIN에서 PK/UNIQUE로 1건씩 매칭
- `ref`: 비고유 인덱스로 여러 건 매칭
- `range`: 인덱스 범위 스캔
- `index`: 인덱스 전체 스캔 (Full Index Scan)
- `ALL`: 테이블 전체 스캔 — **거의 항상 문제**

### 4.2 PostgreSQL의 EXPLAIN ANALYZE

PostgreSQL의 `EXPLAIN ANALYZE`는 **실제로 쿼리를 실행**하고 각 노드의 소요 시간을 보여준다.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o.order_number, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'PENDING'
  AND o.created_at >= '2026-04-01';
```

```
Nested Loop  (cost=0.85..1234.56 rows=3500 width=48) (actual time=0.045..12.345 rows=3487 loops=1)
  Buffers: shared hit=4521
  ->  Index Scan using idx_orders_status_created on orders o
        (cost=0.42..567.89 rows=3500 width=24) (actual time=0.030..5.678 rows=3487 loops=1)
        Index Cond: ((status = 'PENDING') AND (created_at >= '2026-04-01'))
        Buffers: shared hit=3012
  ->  Index Scan using customers_pkey on customers c
        (cost=0.43..0.19 rows=1 width=24) (actual time=0.001..0.001 rows=1 loops=3487)
        Index Cond: (id = o.customer_id)
        Buffers: shared hit=1509
Planning Time: 0.234 ms
Execution Time: 13.456 ms
```

**읽는 법:**

1. **가장 안쪽(인덴트가 깊은) 노드부터** 읽는다 — 실행 순서는 안쪽에서 바깥쪽
2. `cost=시작..끝`: 옵티마이저의 **예상 비용** (상대적 단위, 절대값 아님)
3. `actual time=시작..끝`: **실제 소요 시간** (ms)
4. `rows=`: 예상 vs 실제 행 수 — **차이가 크면 통계가 부정확**하다는 신호
5. `Buffers: shared hit=`: 버퍼 캐시에서 읽은 페이지 수 (I/O 비용 판단)
6. `loops=`: 해당 노드가 몇 번 반복 실행됐는가 — actual time × loops가 진짜 시간

**위 예시 해석:**

- 옵티마이저가 **Nested Loop**를 선택했다
- 바깥 테이블: `orders`에서 인덱스 스캔으로 3,487건 추출
- 안쪽 테이블: 각 행마다 `customers` PK로 1건씩 조회 (3,487번 반복)
- 총 실행 시간: 13.456ms — 합리적

### 4.3 예상 행 수와 실제 행 수가 다를 때

```
->  Index Scan using idx_status on orders
      (cost=0.42..567.89 rows=100 ...) (actual ... rows=50000 loops=1)
```

예상 100건, 실제 50,000건 — **500배 차이**. 이런 경우 옵티마이저가 잘못된 실행 계획을 선택했을 가능성이 높다.

**원인과 해결:**

| 원인 | 해결 |
|------|------|
| 통계 정보가 오래됨 | `ANALYZE orders;` (PG) / `ANALYZE TABLE orders;` (MySQL) |
| 데이터 분포가 편향됨 | PG: `ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;` 후 ANALYZE |
| 상관관계 있는 컬럼 | PG 14+: `CREATE STATISTICS` 확장 통계 |

### 4.4 인덱스가 있는데 안 타는 경우

인덱스를 만들었는데 옵티마이저가 무시하는 상황이 있다. 이유를 알아야 고칠 수 있다.

**1. 함수/연산으로 컬럼을 감싼 경우:**

```sql
-- ❌ 인덱스 못 탐
WHERE YEAR(created_at) = 2026
WHERE amount + 100 > 500

-- ✅ 변환해서 인덱스 타게
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'
WHERE amount > 400
```

**2. 암묵적 형변환:**

```sql
-- phone_number가 VARCHAR인데 숫자로 비교
-- ❌ MySQL이 내부적으로 CAST해서 인덱스 못 탐
WHERE phone_number = 01012345678

-- ✅ 문자열로 비교
WHERE phone_number = '01012345678'
```

**3. 옵티마이저가 Full Scan이 더 낫다고 판단:**

테이블의 30% 이상을 읽어야 하면, 인덱스를 거치는 것보다 **Sequential Scan이 더 빠르다.** 인덱스는 랜덤 I/O, Full Scan은 순차 I/O이기 때문이다.

```sql
-- status = 'ACTIVE'가 전체의 80%라면
-- 옵티마이저는 인덱스를 무시하고 Full Scan을 선택한다 — 이것이 맞다
SELECT * FROM users WHERE status = 'ACTIVE';
```

이 경우 인덱스를 강제하는 힌트(`FORCE INDEX`, `SET enable_seqscan = off`)를 쓰면 **오히려 느려진다.** 옵티마이저를 믿어라 — 대부분의 경우 옵티마이저가 맞다.

---

## 5. 실전 패턴

### 5.1 N+1 문제와 인덱스

N+1 문제는 애플리케이션 레벨에서 발생하지만, **인덱스가 있어도 해결되지 않는다.** 문제의 본질은 쿼리 횟수이기 때문이다.

```sql
-- 1번 쿼리: 주문 목록 (1회)
SELECT * FROM orders WHERE customer_id = 123;
-- → 100건 반환

-- N번 쿼리: 각 주문의 아이템 (100회)
SELECT * FROM order_items WHERE order_id = ?;
SELECT * FROM order_items WHERE order_id = ?;
... (100번 반복)
```

`order_items.order_id`에 인덱스가 있으면 각 쿼리는 빠르다. 하지만 **100번의 네트워크 왕복**이 문제다. 쿼리 하나가 1ms라도, 100번이면 100ms + 네트워크 지연이다.

**해결: JOIN으로 1번에 가져오기:**

```sql
-- 1번의 쿼리로 해결
SELECT o.*, oi.*
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 123;
```

이때 `order_items.order_id`에 인덱스가 있으면 NLJ가 효율적으로 작동한다. **인덱스는 N+1을 해결하지 않지만, JOIN을 효율적으로 만든다.**

**ORM 사용 시:**

```java
// ❌ N+1 (Lazy Loading)
List<Order> orders = orderRepository.findByCustomerId(123);
for (Order order : orders) {
    order.getItems().size();  // 각 주문마다 쿼리 발생
}

// ✅ JOIN Fetch (1회 쿼리)
@Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.customerId = :id")
List<Order> findWithItemsByCustomerId(@Param("id") Long id);
```

### 5.2 JOIN 순서와 성능

SQL에서 `FROM a JOIN b JOIN c`의 순서가 실제 실행 순서를 결정하지는 않는다. 옵티마이저가 통계를 기반으로 **최적의 순서를 알아서 결정**한다.

하지만 테이블 수가 많아지면 옵티마이저도 한계에 부딪힌다.

**MySQL:**

```sql
-- MySQL은 조인 테이블이 많으면 모든 순서를 탐색하지 못한다
-- optimizer_search_depth로 탐색 깊이 제한 (기본값: 62)
-- 테이블 10개를 조인하면 순열이 10! = 3,628,800개

-- 힌트로 순서 강제
SELECT /*+ JOIN_ORDER(small_table, medium_table, large_table) */ *
FROM large_table
JOIN medium_table ON ...
JOIN small_table ON ...;
```

**PostgreSQL:**

```sql
-- PG는 테이블 수가 geqo_threshold(기본 12)를 넘으면
-- 유전 알고리즘(GEQO)으로 전환 → 최적이 아닐 수 있다

-- 통계가 정확하면 대부분 옵티마이저가 올바른 순서를 선택한다
-- 문제가 있을 때만 개입한다
```

**실무 원칙:**

1. **작은 테이블(결과 집합)을 driving table로** — 옵티마이저가 대부분 알아서 하지만, 통계가 부정확하면 잘못된 선택을 한다
2. **조인 키에 인덱스를 보장**한다 — 이것이 가장 중요하다
3. **불필요한 조인을 제거**한다 — 사용하지 않는 테이블을 습관적으로 JOIN하지 않는다

### 5.3 대량 데이터 JOIN 튜닝

수백만~수천만 건을 조인할 때의 전략이다.

**1. 조인 전에 필터링:**

```sql
-- ❌ 전체 조인 후 필터
SELECT o.*, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-04-01'
  AND c.country = 'KR';

-- ✅ 서브쿼리로 먼저 필터 (옵티마이저가 보통 알아서 하지만, 안 할 때)
SELECT o.*, c.name
FROM (SELECT * FROM orders WHERE created_at >= '2026-04-01') o
JOIN (SELECT * FROM customers WHERE country = 'KR') c
  ON c.id = o.customer_id;
```

현대 옵티마이저는 대부분 **predicate pushdown**을 자동으로 수행한다. 위 두 쿼리는 보통 같은 실행 계획을 만든다. 하지만 복잡한 쿼리에서는 옵티마이저가 실패할 수 있으므로 EXPLAIN으로 확인해야 한다.

**2. 배치 처리:**

```sql
-- 한 번에 1억 건을 조인하는 대신, 날짜 범위로 나눠서 처리
-- 애플리케이션에서:
for each day in date_range:
    SELECT o.*, oi.*
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.created_at >= :day_start
      AND o.created_at < :day_end;
```

**3. work_mem / join_buffer_size 튜닝:**

```sql
-- PostgreSQL: Hash Join에 사용할 메모리
SET work_mem = '256MB';  -- 세션 단위로 조정 (기본 4MB)
-- 주의: 쿼리 노드마다 이 만큼 사용할 수 있으므로 과도하게 올리지 않는다

-- MySQL: NLJ 버퍼 크기
SET join_buffer_size = 256 * 1024 * 1024;  -- 256MB (기본 256KB)
-- Block Nested Loop / Hash Join에서 사용
```

### 5.4 FK 컬럼과 인덱스

이전 편들에서 만든 스키마를 떠올려보자. FK 컬럼에 인덱스가 없으면 조인이 Full Scan이 된다.

**MySQL(InnoDB):**

FK 제약조건을 걸면 **자동으로 인덱스를 생성**한다. 명시적으로 만들 필요 없다.

**PostgreSQL:**

FK 제약조건을 걸어도 **인덱스를 자동 생성하지 않는다.** 직접 만들어야 한다.

```sql
-- PostgreSQL: FK에 인덱스가 없으면 이런 일이 벌어진다
-- 1. JOIN이 느려진다 (NLJ에서 안쪽 테이블 Full Scan)
-- 2. 부모 행 DELETE/UPDATE 시 자식 테이블을 Full Scan한다
--    (ON DELETE CASCADE를 위해 자식 행을 찾아야 하므로)

-- 반드시 만들어야 할 인덱스
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_delivery_id ON order_items (order_delivery_id);
CREATE INDEX idx_payments_order_id ON payments (order_id);
CREATE INDEX idx_order_deliveries_order_id ON order_deliveries (order_id);
```

이 패턴은 **PostgreSQL 초보가 가장 흔히 놓치는 실수**다. FK 관계가 있으면 반사적으로 인덱스를 확인하는 습관을 들여야 한다.

---

## 6. MySQL vs PostgreSQL 옵티마이저 비교

| 항목 | MySQL (InnoDB) | PostgreSQL |
|------|---------------|------------|
| **기본 JOIN 알고리즘** | NLJ (+ Hash Join 8.0.18+) | NLJ, Hash Join, Merge Join 모두 |
| **부분 인덱스** | 미지원 (Generated Column 우회) | `WHERE` 절로 지원 |
| **Expression 인덱스** | 8.0+ 지원 (이중 괄호) | 지원 |
| **INCLUDE 인덱스** | 미지원 | 지원 |
| **병렬 쿼리** | 8.0+ 제한적 (COUNT 등) | 9.6+ Parallel Seq Scan, Hash Join 등 |
| **EXPLAIN 상세도** | 테이블 기반, 행 단위 | 트리 기반, 노드별 시간/버퍼 |
| **FK 자동 인덱스** | 자동 생성 | 수동 생성 필요 |
| **통계 수집** | 제한적 (히스토그램 8.0+) | 상세 (MCV, 히스토그램, 확장 통계) |
| **힌트 시스템** | 옵티마이저 힌트 (주석 문법) | `SET` 파라미터 + `pg_hint_plan` 확장 |

**요약하면:**

- MySQL은 **단순하고 예측 가능**하다. NLJ 중심이므로 "인덱스를 잘 만들면 대부분 해결된다."
- PostgreSQL은 **다양한 알고리즘과 인덱스 옵션**이 있어 복잡한 쿼리에서 유리하지만, 그만큼 **이해해야 할 것도 많다.**

---

## 7. 인덱스 설계 체크리스트

실무에서 스키마 리뷰 시 인덱스를 점검하는 체크리스트다. [5편의 설계 리뷰 체크리스트](/blog/rdb-domain-schema-design-guide)와 함께 사용한다.

### 7.1 기본 점검

- [ ] **모든 FK 컬럼에 인덱스가 있는가?** (PostgreSQL은 자동 생성하지 않음)
- [ ] **WHERE 절에 자주 등장하는 컬럼에 인덱스가 있는가?**
- [ ] **ORDER BY / GROUP BY에 쓰이는 컬럼이 인덱스와 정렬 순서가 일치하는가?**
- [ ] **UNIQUE 제약이 필요한 곳에 UNIQUE 인덱스를 사용했는가?** (일반 인덱스 + 애플리케이션 체크는 레이스 컨디션에 취약)

### 7.2 설계 심화

- [ ] **복합 인덱스의 컬럼 순서가 쿼리 패턴과 일치하는가?** (등가 → 범위 순)
- [ ] **중복 인덱스가 없는가?** (`(a)` + `(a, b)` → `(a)` 제거 가능)
- [ ] **커버링 인덱스가 유효한 곳에 적용되었는가?** (빈번한 SELECT 컬럼이 적을 때)
- [ ] **카디널리티가 극히 낮은 컬럼에 단독 인덱스를 만들지 않았는가?** (boolean, status)
- [ ] **쓰기 비중이 높은 테이블에 불필요한 인덱스가 없는가?**

### 7.3 PostgreSQL 추가

- [ ] **부분 인덱스로 대체 가능한 전체 인덱스가 있는가?** (특정 상태만 조회하는 패턴)
- [ ] **INCLUDE를 활용해 커버링을 달성할 수 있는가?**
- [ ] **VACUUM이 정상 동작하고 있는가?** (Index-Only Scan 효과에 영향)

### 7.4 운영

- [ ] **사용되지 않는 인덱스를 주기적으로 모니터링하고 있는가?**
- [ ] **인덱스 크기가 테이블 크기에 비해 과도하지 않은가?** (테이블보다 인덱스가 클 때 주의)
- [ ] **EXPLAIN ANALYZE로 주요 쿼리의 실행 계획을 확인했는가?**

---

## 정리

이 글에서 다룬 핵심:

1. **인덱스는 읽기 성능을 사는 대신 쓰기 비용을 지불하는 트레이드오프**다. 무조건 많이 만드는 것이 아니라, 쿼리 패턴과 쓰기/읽기 비율을 분석해서 설계해야 한다.
2. **카디널리티와 선택도가 인덱스 효과를 결정**한다. 카디널리티가 낮은 컬럼이라도 복합 인덱스의 선행 컬럼으로는 유효하다.
3. **커버링 인덱스, 부분 인덱스, Expression 인덱스**는 "인덱스를 만드는 것"을 넘어 "설계하는 것"으로 가는 도구다. 특히 PostgreSQL의 부분 인덱스 + UNIQUE 조합은 MySQL에서는 불가능한 강력한 패턴이다.
4. **JOIN 알고리즘은 옵티마이저가 선택**한다. NLJ는 인덱스가 있을 때, Hash Join은 대량 등가 조인에, Merge Join은 정렬된 대량 데이터에 적합하다. MySQL은 NLJ 중심이므로 인덱스 의존도가 높다.
5. **EXPLAIN ANALYZE를 읽는 습관**이 가장 중요하다. 예상 행 수와 실제 행 수의 차이가 크면 통계를 갱신하고, 인덱스가 안 타면 왜 안 타는지 원인을 분석해야 한다.

**"인덱스를 만들 줄 아는 것"과 "인덱스를 설계할 줄 아는 것"은 다른 능력이다.** CREATE INDEX 하나가 쿼리 성능을 1000배 바꿀 수 있고, 잘못 만든 인덱스 5개가 쓰기 성능을 반토막 낼 수 있다. 이 글이 그 판단력을 키우는 데 도움이 됐기를 바란다.

다음 편에서는 **안티패턴과 시간 데이터 설계** — EAV, God Table, Temporal Table, 이벤트 소싱 스키마까지 다룬다.
