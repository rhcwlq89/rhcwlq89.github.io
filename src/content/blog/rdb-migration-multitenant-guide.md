---
title: "RDB 설계 시리즈 8편: 무중단 마이그레이션과 멀티테넌트 설계 — ALTER TABLE 함정부터 Expand-Contract, 테넌트 격리 전략까지"
description: "운영 중인 서비스에서 스키마를 바꾸는 건 '설계'만큼이나 어렵다. ALTER TABLE의 락 함정, Expand-Contract 패턴으로 무중단 컬럼 변경, Flyway와 Liquibase 비교, 롤백 전략, 그리고 멀티테넌트 스키마 설계의 세 가지 전략까지. 시리즈의 마지막 편이다."
pubDate: 2026-04-16T22:00:00+09:00
tags:
  - Database
  - RDB
  - Schema Design
  - Migration
  - Multi-tenant
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbMigrationMultitenantGuide.png"
---

## 서론

[이전 글](/blog/rdb-antipattern-temporal-design-guide)에서 안티패턴과 시간 데이터 설계를 다뤘다. 7편까지 오면서 "어떻게 설계하고, 무엇을 피해야 하는가"를 전부 다뤘다.

하지만 현실에서는 **처음부터 완벽한 스키마를 만드는 일은 없다.** 요구사항이 바뀌고, 도메인이 확장되고, 성능 병목이 발견된다. 스키마는 반드시 변경된다.

문제는 **운영 중인 서비스에서 스키마를 바꾸는 건 위험하다**는 것이다. 잘못하면 테이블 락으로 서비스가 멈추고, 롤백할 수 없는 상태에 빠진다. "설계를 잘하는 것"만큼 "설계를 안전하게 바꾸는 것"이 중요하다.

이 글은 두 가지를 다룬다:

1. **스키마 마이그레이션** — ALTER TABLE의 함정, 무중단 변경 패턴, 마이그레이션 도구, 롤백 전략
2. **멀티테넌트 설계** — 하나의 시스템에서 여러 고객(테넌트)의 데이터를 격리하는 스키마 전략

---

## 1. ALTER TABLE의 함정

### 1.1 ALTER TABLE은 왜 위험한가?

개발 환경에서 ALTER TABLE은 순식간에 끝난다. 하지만 **운영 환경의 수천만 행 테이블**에서는 이야기가 다르다.

```sql
-- 개발 환경: 0.01초
ALTER TABLE orders ADD COLUMN memo VARCHAR(500);

-- 운영 환경 (orders 5천만 행): 수 분 ~ 수십 분
-- 이 동안 테이블에 락이 걸린다
```

핵심 문제는 **락(lock)**이다. ALTER TABLE이 실행되는 동안 다른 쿼리가 대기하면, 서비스가 사실상 멈춘다.

### 1.2 MySQL의 Online DDL

MySQL 5.6+에서 Online DDL이 도입되면서, **일부 ALTER TABLE은 테이블을 잠그지 않고 실행**할 수 있게 됐다.

```sql
-- ALGORITHM과 LOCK 옵션으로 제어
ALTER TABLE orders ADD COLUMN memo VARCHAR(500),
    ALGORITHM=INPLACE, LOCK=NONE;
```

**ALGORITHM 옵션:**

| ALGORITHM | 동작 | 특징 |
|-----------|------|------|
| **COPY** | 테이블 전체를 복사해서 새 테이블 생성 | 느리고 공간 2배 필요. 모든 DDL 가능 |
| **INPLACE** | 원본 테이블에서 직접 변경 | 빠르지만 일부 DDL만 가능 |
| **INSTANT** | 메타데이터만 변경 (MySQL 8.0.12+) | 즉시 완료. 극히 일부 DDL만 가능 |

**LOCK 옵션:**

| LOCK | DML 허용 | 설명 |
|------|----------|------|
| **NONE** | ✅ 읽기/쓰기 모두 가능 | 무중단. Online DDL의 목표 |
| **SHARED** | ✅ 읽기만 가능 | 쓰기 차단 |
| **EXCLUSIVE** | ❌ 전부 차단 | 사실상 서비스 중단 |

**Online DDL이 가능한 작업 (MySQL 8.0):**

| 작업 | ALGORITHM | LOCK=NONE |
|------|-----------|-----------|
| 컬럼 추가 (끝에) | INSTANT | ✅ |
| 컬럼 삭제 | INPLACE | ✅ |
| 컬럼 이름 변경 | INPLACE | ✅ |
| VARCHAR 길이 확장 | INPLACE | ✅ |
| 인덱스 추가 | INPLACE | ✅ |
| 인덱스 삭제 | INPLACE | ✅ |
| 컬럼 타입 변경 | COPY | ❌ |
| 컬럼 순서 변경 | COPY | ❌ |
| PRIMARY KEY 변경 | COPY | ❌ |

> **주의**: Online DDL도 **시작과 끝에 잠깐 메타데이터 락(MDL)**을 잡는다. 테이블에 장시간 트랜잭션이 걸려 있으면 이 MDL 대기가 길어져서 후속 쿼리가 줄줄이 밀린다. `LOCK=NONE`이라고 완전히 안전한 건 아니다.

### 1.3 PostgreSQL의 Lock 수준

PostgreSQL은 MySQL과 다른 방식으로 DDL을 처리한다. 핵심은 **Lock Level**이다.

| 작업 | Lock Level | DML 차단 여부 |
|------|-----------|-------------|
| 컬럼 추가 (NULL 허용, DEFAULT 없음) | ACCESS EXCLUSIVE (순간) | ⚠️ 매우 짧음 |
| 컬럼 추가 (DEFAULT 포함, PG 11+) | ACCESS EXCLUSIVE (순간) | ⚠️ 매우 짧음 |
| 컬럼 추가 (DEFAULT 포함, PG 10 이하) | ACCESS EXCLUSIVE (전체) | ❌ 전체 재작성 |
| 컬럼 삭제 | ACCESS EXCLUSIVE (순간) | ⚠️ 매우 짧음 |
| 컬럼 타입 변경 | ACCESS EXCLUSIVE (전체) | ❌ 전체 재작성 |
| NOT NULL 추가 | ACCESS EXCLUSIVE | ❌ 전체 스캔 |
| 인덱스 생성 | SHARE (쓰기 차단) | ⚠️ 읽기만 가능 |
| 인덱스 생성 (CONCURRENTLY) | SHARE UPDATE EXCLUSIVE | ✅ 읽기/쓰기 가능 |

**PostgreSQL의 강점**: `CREATE INDEX CONCURRENTLY`

```sql
-- 일반 인덱스 생성: 쓰기 차단
CREATE INDEX idx_orders_user ON orders (user_id);

-- CONCURRENTLY: 읽기/쓰기 모두 허용
CREATE INDEX CONCURRENTLY idx_orders_user ON orders (user_id);
-- 시간은 더 걸리지만, 서비스 영향 없음
```

> **PG 11+ 핵심 개선**: DEFAULT 값이 있는 컬럼 추가가 **테이블 재작성 없이** 가능해졌다. PG 10 이하에서는 이 작업이 전체 테이블을 재작성해서 대형 테이블에서 치명적이었다.

### 1.4 pt-online-schema-change와 gh-ost

MySQL에서 COPY ALGORITHM이 필요한 변경(컬럼 타입 변경 등)은 Online DDL이 불가능하다. 이런 경우 **외부 도구**를 사용한다.

**pt-online-schema-change (Percona Toolkit)**

```bash
pt-online-schema-change \
    --alter "MODIFY COLUMN price DECIMAL(12,2)" \
    D=mydb,t=products \
    --execute
```

동작 원리:
1. 새 구조의 빈 테이블 생성 (`_products_new`)
2. 원본 테이블에 트리거 설치 (INSERT/UPDATE/DELETE를 새 테이블에도 반영)
3. 기존 데이터를 청크 단위로 복사
4. 복사 완료 후 `RENAME TABLE`로 교체 (원자적)
5. 트리거와 이전 테이블 제거

**gh-ost (GitHub)**

```bash
gh-ost \
    --alter "MODIFY COLUMN price DECIMAL(12,2)" \
    --database=mydb --table=products \
    --execute
```

gh-ost는 트리거 대신 **바이너리 로그(binlog)**를 읽어서 변경분을 새 테이블에 적용한다. 트리거의 오버헤드가 없고, 일시 중지/재개가 가능하다.

| 비교 | pt-online-schema-change | gh-ost |
|------|------------------------|--------|
| 변경 추적 방식 | 트리거 | 바이너리 로그 |
| 원본 테이블 부하 | ⚠️ 트리거 오버헤드 | ✅ 최소 |
| 일시 중지/재개 | ❌ | ✅ |
| FK 지원 | ⚠️ 제한적 | ❌ |
| 설정 복잡도 | ✅ 단순 | ⚠️ binlog 설정 필요 |

---

## 2. Expand-Contract 패턴

ALTER TABLE의 함정을 피하는 **가장 안전한 전략**이 Expand-Contract 패턴이다. "확장 후 축소"라는 이름 그대로, 3단계로 스키마를 변경한다.

### 2.1 3단계 흐름

```
Phase 1: Expand (확장)
├── 새 컬럼/테이블 추가 (기존 구조 유지)
└── 애플리케이션이 양쪽에 쓰기 시작

Phase 2: Migrate (이전)
├── 기존 데이터를 새 구조로 복사
└── 새 구조에서 읽기 시작

Phase 3: Contract (축소)
├── 이전 컬럼/테이블 제거
└── 정리 완료
```

각 단계 사이에 **배포가 분리**되어 있다는 게 핵심이다. 한 번에 모든 걸 바꾸지 않으므로, 문제가 생기면 해당 단계만 롤백할 수 있다.

### 2.2 실전 예시: 컬럼 이름 변경

`users.name` → `users.full_name`으로 바꾸고 싶다.

**잘못된 방법:**

```sql
-- 서비스 중단 없이는 불가능
ALTER TABLE users RENAME COLUMN name TO full_name;
-- → 애플리케이션이 아직 'name'을 참조하고 있으면 즉시 에러
```

**Expand-Contract 방법:**

```sql
-- Phase 1: Expand
ALTER TABLE users ADD COLUMN full_name VARCHAR(100);
-- 배포 1: 양쪽에 쓰기
-- INSERT/UPDATE 시 name과 full_name 모두에 값 기록
```

```sql
-- Phase 2: Migrate
UPDATE users SET full_name = name WHERE full_name IS NULL;
-- 대량 테이블이면 배치로 나눠서 실행
-- 배포 2: full_name에서 읽기 시작, name은 여전히 쓰기 유지
```

```sql
-- Phase 3: Contract
-- 배포 3: name 참조 완전 제거 후
ALTER TABLE users DROP COLUMN name;
```

3번의 배포가 필요하다. 번거롭지만, **각 단계에서 서비스가 중단되지 않고, 롤백이 가능하다.**

### 2.3 실전 예시: 컬럼 타입 변경

`orders.amount`를 `INT` → `DECIMAL(12,2)`로 바꾸고 싶다.

직접 타입 변경은 MySQL에서 `COPY ALGORITHM`이 필요하고, PostgreSQL에서는 `ACCESS EXCLUSIVE LOCK`이 걸린다. 둘 다 대형 테이블에서 위험하다.

```sql
-- Phase 1: Expand — 새 컬럼 추가
ALTER TABLE orders ADD COLUMN amount_new DECIMAL(12,2);
-- 배포: 양쪽에 쓰기
-- amount_new = CAST(amount AS DECIMAL(12,2))

-- Phase 2: Migrate — 기존 데이터 이전
-- 배치 처리 (한 번에 1만 행씩)
UPDATE orders SET amount_new = amount WHERE amount_new IS NULL LIMIT 10000;
-- 반복 실행 (슬립 사이에 두어 부하 분산)

-- Phase 3: Contract — 이전 컬럼 제거
ALTER TABLE orders DROP COLUMN amount;
ALTER TABLE orders RENAME COLUMN amount_new TO amount;
```

### 2.4 실전 예시: 테이블 분리

God Table을 도메인별로 분리하는 것도 Expand-Contract로 안전하게 할 수 있다.

```sql
-- Phase 1: Expand — 새 테이블 생성
CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id),
    bio TEXT,
    avatar_url VARCHAR(500),
    website VARCHAR(300)
);
-- 배포: 양쪽에 쓰기 (users 테이블 + user_profiles 테이블)

-- Phase 2: Migrate — 기존 데이터 이전
INSERT INTO user_profiles (user_id, bio, avatar_url, website)
SELECT id, bio, avatar_url, website FROM users
WHERE bio IS NOT NULL OR avatar_url IS NOT NULL;
-- 배포: user_profiles에서 읽기 시작

-- Phase 3: Contract — 이전 컬럼 제거
ALTER TABLE users DROP COLUMN bio;
ALTER TABLE users DROP COLUMN avatar_url;
ALTER TABLE users DROP COLUMN website;
```

### 2.5 Expand-Contract의 비용

Expand-Contract는 안전하지만 **공짜가 아니다:**

- **배포 횟수 증가**: 한 번의 변경에 2~3번 배포
- **과도기 코드**: 양쪽에 쓰기하는 코드가 일시적으로 필요
- **데이터 동기화**: 이전 기간 동안 양쪽 데이터를 맞춰야 함
- **일정 압박**: "그냥 ALTER TABLE 하면 5분이면 되는데"라는 유혹

> **원칙**: 테이블 크기가 100만 행 이상이거나, 다운타임이 허용되지 않는 서비스라면 Expand-Contract를 사용한다. 작은 테이블이나 점검 시간이 있는 서비스라면 직접 ALTER TABLE도 괜찮다.

---

## 3. 마이그레이션 도구

스키마 변경을 "수동으로 SQL 실행"하는 건 위험하다. 어떤 변경이 적용됐는지 추적이 안 되고, 환경별(개발/스테이징/운영) 스키마가 달라진다. **버전 관리형 마이그레이션 도구**가 필요하다.

### 3.1 왜 필요한가?

```
문제 상황:
1. 개발자 A가 ALTER TABLE을 운영 DB에 직접 실행
2. 개발자 B는 그 사실을 모르고 같은 컬럼을 추가하는 마이그레이션 작성
3. 스테이징에서는 성공, 운영에서는 "column already exists" 에러
4. 개발 DB, 스테이징 DB, 운영 DB의 스키마가 전부 다른 상태
```

마이그레이션 도구가 해결하는 것:
- **변경 이력 추적**: 어떤 SQL이 언제 적용됐는지 기록
- **환경 일관성**: 모든 환경에서 같은 순서로 같은 마이그레이션 실행
- **팀 협업**: 마이그레이션 파일이 Git에 커밋되어 코드 리뷰 가능
- **자동화**: CI/CD 파이프라인에서 배포 시 자동 실행

### 3.2 Flyway

Flyway는 **컨벤션 기반**의 마이그레이션 도구다. SQL 파일 이름에 버전 번호를 넣으면 순서대로 실행한다.

**파일 구조:**

```
db/migration/
├── V1__create_users.sql
├── V2__create_orders.sql
├── V3__add_email_to_users.sql
└── V4__create_order_items.sql
```

**마이그레이션 파일 예시 (V3__add_email_to_users.sql):**

```sql
ALTER TABLE users ADD COLUMN email VARCHAR(200);
CREATE UNIQUE INDEX uq_users_email ON users (email);
```

**이력 테이블 (flyway_schema_history):**

| installed_rank | version | description | script | checksum | installed_on | success |
|:---:|---|---|---|---|---|:---:|
| 1 | 1 | create users | V1__create_users.sql | -12345 | 2026-01-01 | true |
| 2 | 2 | create orders | V2__create_orders.sql | -67890 | 2026-01-15 | true |
| 3 | 3 | add email to users | V3__add_email... | -11111 | 2026-02-01 | true |

**핵심 규칙:**
- 한 번 적용된 마이그레이션 파일은 **수정하면 안 된다** (checksum 검증)
- 버전 번호는 순차적이어야 한다
- 롤백은 수동으로 `undo` 마이그레이션을 작성해야 한다 (Flyway Teams 유료 기능으로 자동화 가능)

### 3.3 Liquibase

Liquibase는 **변경 세트(changeset)** 기반이다. XML, YAML, JSON, SQL 중 선택할 수 있고, DB 독립적인 추상화를 제공한다.

**파일 예시 (YAML):**

```yaml
databaseChangeLog:
  - changeSet:
      id: 1
      author: hojong
      changes:
        - createTable:
            tableName: users
            columns:
              - column:
                  name: id
                  type: BIGINT
                  constraints:
                    primaryKey: true
              - column:
                  name: name
                  type: VARCHAR(100)
                  constraints:
                    nullable: false

  - changeSet:
      id: 2
      author: hojong
      changes:
        - addColumn:
            tableName: users
            columns:
              - column:
                  name: email
                  type: VARCHAR(200)
      rollback:
        - dropColumn:
            tableName: users
            columnName: email
```

**핵심 특징:**
- `rollback` 블록을 changeset에 직접 정의할 수 있다
- DB 추상화 제공 — 같은 changeset이 MySQL/PostgreSQL 모두에서 동작
- `context`와 `label`로 환경별 조건부 실행 가능

### 3.4 비교

| 비교 | Flyway | Liquibase |
|------|--------|-----------|
| 마이그레이션 형식 | SQL 파일 (+ Java) | XML / YAML / JSON / SQL |
| 롤백 | ⚠️ 수동 (유료 자동화) | ✅ changeset에 정의 가능 |
| DB 추상화 | ❌ DB별 SQL 직접 작성 | ✅ DB 독립적 changeset |
| 학습 곡선 | ✅ 매우 낮음 | ⚠️ 중간 (XML/YAML 문법) |
| Spring Boot 통합 | ✅ 기본 지원 | ✅ 기본 지원 |
| diff 기능 | ❌ | ✅ DB 간 스키마 비교 가능 |
| 팀 규모 | 소~중규모 | 중~대규모 |

### 3.5 선택 기준

- **Flyway를 선택할 때**: SQL을 직접 쓰는 게 편하고, 단일 DB 환경이며, 팀이 작다
- **Liquibase를 선택할 때**: 멀티 DB 환경이거나, 롤백 자동화가 필요하거나, 대규모 팀에서 changeset 관리가 필요하다

> **실무 팁**: Spring Boot 프로젝트에서는 Flyway가 압도적으로 많이 쓰인다. 설정이 간단하고 SQL 파일만 추가하면 되기 때문이다. "어떤 도구를 쓸까" 고민된다면 Flyway부터 시작하는 게 맞다.

---

## 4. 롤백 전략

### 4.1 DDL 롤백이 어려운 이유

일반적인 코드 배포는 이전 버전으로 롤백하면 된다. 하지만 **스키마 변경은 롤백이 훨씬 어렵다.**

```
배포 v2.0: ALTER TABLE orders ADD COLUMN memo VARCHAR(500);
  → memo 컬럼에 데이터가 쌓이기 시작

롤백하려면: ALTER TABLE orders DROP COLUMN memo;
  → memo에 쌓인 데이터가 전부 유실된다
  → 이미 memo를 참조하는 코드가 있을 수 있다
```

더 심각한 경우:

```
배포 v2.0: ALTER TABLE users MODIFY COLUMN name VARCHAR(100) → VARCHAR(50);
  → 이미 50자 넘는 데이터가 있으면 롤백(다시 100으로) 해도 잘린 데이터는 복구 불가
```

### 4.2 Forward-Only Migration

**롤백 대신 "새로운 마이그레이션으로 전진"하는 전략**이다. 대부분의 성숙한 팀이 이 방식을 쓴다.

```
문제 발생 시:
✗ V3을 롤백한다
✓ V4에서 V3의 문제를 수정하는 마이그레이션을 작성한다
```

```sql
-- V3: 실수로 NOT NULL 없이 컬럼 추가
ALTER TABLE orders ADD COLUMN status VARCHAR(20);

-- V4: V3을 수정 (롤백이 아니라 전진)
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'PENDING';
UPDATE orders SET status = 'PENDING' WHERE status IS NULL;
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;
```

**Forward-Only가 안전한 이유:**
- 롤백 스크립트는 테스트되지 않는 경우가 많다 (장애 상황에서 처음 실행)
- 롤백은 데이터 유실 위험이 있다
- 전진 마이그레이션은 코드 리뷰와 테스트를 거칠 수 있다

### 4.3 롤백 가능하게 설계하는 법

Forward-Only가 원칙이지만, **롤백이 필요한 상황을 대비**해서 설계할 수는 있다.

**1) 컬럼 추가는 항상 NULL 허용으로**

```sql
-- ✅ 안전: NULL 허용으로 추가
ALTER TABLE orders ADD COLUMN memo VARCHAR(500) NULL;
-- 롤백 시 DROP COLUMN 해도 NULL이었으므로 데이터 유실 영향 최소

-- ❌ 위험: NOT NULL + DEFAULT로 추가
ALTER TABLE orders ADD COLUMN memo VARCHAR(500) NOT NULL DEFAULT '';
-- 롤백 시 이미 '' 값이 차 있어서 의미 있는 데이터와 구분 불가
```

**2) Expand-Contract를 항상 사용**

각 단계가 독립적이므로, 어느 단계에서든 이전 상태로 돌아갈 수 있다.

**3) 변경 전 스키마 스냅샷**

```bash
# MySQL
mysqldump --no-data mydb > schema_before_v3.sql

# PostgreSQL
pg_dump --schema-only mydb > schema_before_v3.sql
```

문제가 발생하면 스냅샷과 비교해서 차이를 파악할 수 있다.

---

## 5. 멀티테넌트 설계

### 5.1 멀티테넌트란?

하나의 애플리케이션과 인프라에서 **여러 고객(테넌트)**의 데이터를 서비스하는 아키텍처다. SaaS의 핵심 설계 패턴이다.

```
단일 테넌트: 고객마다 별도 서버 + 별도 DB
                → 고객 100명이면 서버 100대

멀티테넌트: 하나의 서버 + 하나(또는 소수)의 DB에서 모든 고객 서비스
                → 고객 100명이어도 서버 1~2대
```

멀티테넌트의 핵심 과제는 **데이터 격리(isolation)**다. 테넌트 A의 데이터가 테넌트 B에게 노출되면 보안 사고이고 서비스 신뢰가 무너진다.

스키마 레벨에서 멀티테넌트를 구현하는 전략은 세 가지가 있다.

### 5.2 전략 1: 테넌트별 DB (Database-per-Tenant)

테넌트마다 **독립된 데이터베이스**를 만든다.

```
tenant_acme    → DB: acme_db
tenant_globex  → DB: globex_db
tenant_initech → DB: initech_db
```

```sql
-- 테넌트 온보딩 시
CREATE DATABASE acme_db;
-- 모든 마이그레이션을 acme_db에 적용
```

| 항목 | 평가 |
|------|------|
| 데이터 격리 | ✅ 완전 격리. DB 레벨 |
| 성능 격리 | ✅ 테넌트 간 영향 없음 |
| 마이그레이션 | ❌ 모든 DB에 개별 적용 필요 |
| 리소스 효율 | ❌ DB 수만큼 커넥션 풀, 메모리 필요 |
| 테넌트 수 제한 | ⚠️ 수백 개까지 현실적 |
| 크로스 테넌트 쿼리 | ❌ 불가 (별도 ETL 필요) |

**적합한 경우**: 테넌트별 데이터 규모가 크고, 규제/컴플라이언스로 물리적 격리가 필요한 경우 (의료, 금융, 공공).

### 5.3 전략 2: 테넌트별 스키마 (Schema-per-Tenant)

하나의 DB 안에서 **테넌트마다 별도 스키마(namespace)**를 사용한다. PostgreSQL의 `schema` 기능이 이 전략에 적합하다.

```sql
-- 테넌트 온보딩 시
CREATE SCHEMA tenant_acme;
CREATE SCHEMA tenant_globex;

-- 테넌트별 테이블
CREATE TABLE tenant_acme.orders (...);
CREATE TABLE tenant_globex.orders (...);

-- 쿼리 시 search_path로 전환
SET search_path TO tenant_acme;
SELECT * FROM orders;  -- tenant_acme.orders를 조회
```

| 항목 | 평가 |
|------|------|
| 데이터 격리 | ✅ 스키마 레벨 격리 |
| 성능 격리 | ⚠️ 같은 DB이므로 I/O 공유 |
| 마이그레이션 | ⚠️ 모든 스키마에 개별 적용 (자동화 가능) |
| 리소스 효율 | ⚠️ 스키마 수가 많아지면 카탈로그 부하 |
| 테넌트 수 제한 | ⚠️ 수천 개까지 가능하지만 성능 저하 |
| 크로스 테넌트 쿼리 | ✅ 같은 DB이므로 가능 |

> **MySQL 참고**: MySQL에는 PostgreSQL의 `schema` 개념이 없다. MySQL에서 `CREATE SCHEMA`는 `CREATE DATABASE`의 동의어다. 따라서 MySQL에서 이 전략을 쓰려면 사실상 전략 1(DB-per-Tenant)과 동일해진다.

**적합한 경우**: PostgreSQL을 사용하고, 테넌트 수가 수백~수천 개이며, 테넌트별 스키마 커스터마이징이 필요한 경우.

### 5.4 전략 3: 공유 테이블 + tenant_id (Shared Schema)

모든 테넌트가 **같은 테이블**을 공유하고, `tenant_id` 컬럼으로 데이터를 구분한다.

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tenant_user (tenant_id, user_id)
);

-- 모든 쿼리에 tenant_id 필터 필수
SELECT * FROM orders WHERE tenant_id = 42 AND user_id = 100;
```

| 항목 | 평가 |
|------|------|
| 데이터 격리 | ⚠️ 앱 레벨 (WHERE 누락 시 노출) |
| 성능 격리 | ❌ 대형 테넌트가 전체 성능에 영향 |
| 마이그레이션 | ✅ 한 번만 실행하면 됨 |
| 리소스 효율 | ✅ 최고 (테이블/인덱스 공유) |
| 테넌트 수 제한 | ✅ 수만 개 이상 가능 |
| 크로스 테넌트 쿼리 | ✅ 쉬움 |

**tenant_id 누락 방지 전략:**

```sql
-- PostgreSQL: Row-Level Security (RLS)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant')::BIGINT);

-- 애플리케이션에서 커넥션마다 테넌트 설정
SET app.current_tenant = '42';
SELECT * FROM orders;  -- 자동으로 tenant_id = 42 필터 적용
```

RLS를 사용하면 **WHERE 절을 빠뜨려도 DB가 필터링**해준다. `tenant_id` 누락으로 인한 데이터 유출을 구조적으로 방지할 수 있다.

```sql
-- MySQL: 뷰(View)로 유사하게 구현 가능하지만 RLS만큼 강력하지 않다
-- 보통 앱 레벨에서 ORM/미들웨어로 tenant_id를 강제한다

-- Spring Boot 예시 (Hibernate Filter)
-- @FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = "long"))
-- @Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
```

**적합한 경우**: 테넌트 수가 많고(수천~수만), 데이터 규모가 작거나 균등하며, 운영 효율이 최우선인 경우. 대부분의 SaaS가 이 전략을 사용한다.

### 5.5 전략 비교 요약

| 기준 | DB-per-Tenant | Schema-per-Tenant | Shared Schema |
|------|:---:|:---:|:---:|
| 데이터 격리 | ✅✅✅ | ✅✅ | ⚠️ |
| 성능 격리 | ✅✅✅ | ⚠️ | ❌ |
| 운영 복잡도 | ❌ 높음 | ⚠️ 중간 | ✅ 낮음 |
| 마이그레이션 난이도 | ❌ 높음 | ⚠️ 중간 | ✅ 낮음 |
| 리소스 효율 | ❌ 낮음 | ⚠️ 중간 | ✅ 높음 |
| 최대 테넌트 수 | 수백 | 수천 | 수만+ |
| 대표 사례 | Salesforce (엔터프라이즈 티어) | Notion, Citus | Slack, Shopify |

### 5.6 하이브리드 전략

실무에서는 **단일 전략만 쓰는 경우보다 혼합**하는 경우가 많다.

```
무료/기본 플랜 → Shared Schema (tenant_id)
엔터프라이즈 플랜 → Database-per-Tenant (규제 요건 충족)
```

**티어별 격리 수준을 다르게** 제공하면 비용 효율과 격리 요건을 동시에 만족할 수 있다. Salesforce가 이 전략의 대표적 사례다.

---

## 6. 설계 리뷰 체크리스트

### 6.1 마이그레이션 점검

- [ ] **ALTER TABLE 전에 테이블 크기를 확인했는가?** 100만 행 이상이면 Online DDL/외부 도구/Expand-Contract를 검토
- [ ] **MySQL에서 ALGORITHM과 LOCK 옵션을 명시했는가?** 암묵적으로 COPY가 선택될 수 있다
- [ ] **PostgreSQL에서 인덱스 생성 시 CONCURRENTLY를 사용했는가?** 일반 CREATE INDEX는 쓰기를 차단한다
- [ ] **마이그레이션 도구를 사용하고 있는가?** 수동 SQL 실행은 환경별 스키마 불일치의 원인

### 6.2 Expand-Contract 점검

- [ ] **한 번의 배포에 스키마 변경 + 코드 변경을 동시에 하고 있는가?** 분리해야 한다
- [ ] **과도기에 양쪽 쓰기를 구현했는가?** 새 컬럼에만 쓰면 이전 코드 배포 시 데이터 유실
- [ ] **대량 데이터 이전을 배치로 처리했는가?** 한 번에 전체 UPDATE는 락과 복제 지연을 유발

### 6.3 멀티테넌트 점검

- [ ] **tenant_id 누락 가능성을 구조적으로 방지했는가?** PostgreSQL RLS 또는 ORM 레벨 필터
- [ ] **테넌트 간 성능 격리가 필요한가?** 대형 테넌트의 쿼리가 다른 테넌트에 영향을 주는지 확인
- [ ] **마이그레이션 전략이 테넌트 수에 맞는가?** DB-per-Tenant에서 수백 개 DB 마이그레이션은 자동화 필수

---

## 정리

이 글에서 다룬 핵심:

1. **ALTER TABLE은 운영 환경에서 위험하다.** MySQL의 Online DDL과 PostgreSQL의 Lock Level을 이해하고, 대형 테이블에서는 pt-online-schema-change나 gh-ost 같은 외부 도구를 사용한다.
2. **Expand-Contract는 무중단 스키마 변경의 핵심 패턴이다.** 확장 → 이전 → 축소 3단계로 나누면, 각 단계에서 서비스가 중단되지 않고 롤백도 가능하다.
3. **마이그레이션 도구는 필수다.** Flyway는 간단하고 SQL 기반, Liquibase는 DB 추상화와 롤백을 지원한다. 수동 SQL 실행은 스키마 불일치의 원인이다.
4. **롤백보다 Forward-Only가 안전하다.** 문제가 생기면 이전으로 되돌리지 말고, 새 마이그레이션으로 수정한다.
5. **멀티테넌트는 격리 수준과 운영 효율의 트레이드오프다.** DB-per-Tenant(완전 격리, 높은 비용), Schema-per-Tenant(중간), Shared Schema(낮은 격리, 높은 효율) 중 서비스 요건에 맞게 선택한다.

**8편에 걸쳐 RDB 스키마 설계의 기초부터 운영까지 다뤘다.** 네이밍과 데이터 타입부터, 정규화, 제약조건, 관계 패턴, 도메인 설계, 인덱스와 JOIN, 안티패턴, 그리고 마이그레이션까지. 이 시리즈가 "감으로 하는 설계"에서 "근거 있는 설계"로 넘어가는 데 도움이 됐기를 바란다.
