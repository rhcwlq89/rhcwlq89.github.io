---
title: "RDB Design Series Part 1: Schema Basics — Naming, Data Types, PK Strategy, NULL"
description: "The first decisions you need to make when designing RDB tables. Naming conventions, data type selection, PK strategies (AUTO_INCREMENT vs UUID vs ULID), and NULL semantics — skip these now, pay for it later with painful migrations."
pubDate: "2026-04-05T14:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbSchemaBasicsGuide.png"
lang: en
---

## Introduction

"How hard can it be to create a table?" — that's what everyone thinks at first. Just throw some columns into `CREATE TABLE` and you're done.

But as the service grows, **things you decided carelessly at the start** come back to haunt you. Column names are inconsistent so you have to check the ERD for every query, `VARCHAR(255)` everywhere bloats your indexes, and the `INT` primary key overflows past 2.1 billion, triggering an emergency migration at 3 AM.

This post covers **4 things you need to decide before creating a table**:

1. Naming conventions
2. Data type selection
3. PK strategy
4. NULL semantics

All of these "seem unimportant now but are extremely expensive to change later."

---

## 1. Naming Conventions

### 1.1 Why It Matters

Table and column names outlive your code. You can refactor the application anytime, but renaming a column means touching **every query, ORM mapping, API response, index, and constraint**.

```sql
-- Imagine inheriting this schema
CREATE TABLE TBL_USR_INF (
    usrSeqNo BIGINT,
    usrNm VARCHAR(100),
    usrStCd VARCHAR(2),      -- 01: active, 02: withdrawn, 03: suspended...?
    crtDtm DATETIME,
    updDtm DATETIME
);
```

Without abbreviation lookup tables, this schema is unreadable. It forces you to **open the ERD every time you write a query**.

### 1.2 Table Names

| Rule | Good | Bad | Why |
|------|------|-----|-----|
| **snake_case** | `order_item` | `OrderItem`, `orderitem` | Case sensitivity varies by DB (see below) |
| **Plural** | `orders`, `users` | `order`, `user` | A table is a collection of rows. Plural is natural |
| **No prefixes** | `orders` | `tbl_orders`, `t_orders` | Prefixes carry zero information. Just noise |
| **Avoid reserved words** | `user_accounts` | `user`, `order` | `user` is reserved in PostgreSQL/MySQL. Requires quoting every time |

> **Singular vs plural debate**: Honestly, both conventions are common. What matters is **picking one and sticking to it**. This guide recommends plural, but if your team uses singular, stay consistent.

#### Case Sensitivity: MySQL vs PostgreSQL

This is a subtle issue that many people overlook until it breaks in production.

```sql
-- MySQL: depends on lower_case_table_names setting
-- 0 (Linux default): case-sensitive -> OrderItems != orderitems
-- 1 (Windows/macOS default): stored as lowercase -> OrderItems = orderitems
-- 2 (macOS): compared as lowercase but original name preserved

-- PostgreSQL: always folds to lowercase without quotes
CREATE TABLE OrderItems (...);   -- Actually creates "orderitems"
SELECT * FROM OrderItems;        -- Queries orderitems
SELECT * FROM "OrderItems";      -- This preserves case (not recommended)
```

| Behavior | MySQL | PostgreSQL |
|----------|-------|------------|
| Case sensitivity | Depends on OS/setting (`lower_case_table_names`) | Always folds to lowercase without quotes |
| Accessing `OrderItems` | Success or failure depending on setting | Accessible as `orderitems`, `"OrderItems"` is separate |
| **Conclusion** | snake_case is safe | snake_case is safe |

**Regardless of which DB you use, sticking to snake_case eliminates this problem entirely.**

#### Reserved Word Pitfalls

```sql
-- In PostgreSQL, "user" is reserved
SELECT * FROM user;          -- Error
SELECT * FROM "user";        -- Works, but requires quotes every time
SELECT * FROM users;         -- Clean

-- In MySQL, "order" is reserved
SELECT * FROM order;         -- Error
SELECT * FROM `order`;       -- Works, but requires backticks every time
SELECT * FROM orders;        -- Clean
```

### 1.3 Column Names

| Rule | Good | Bad | Why |
|------|------|-----|-----|
| **snake_case** | `created_at` | `createdAt`, `CreatedAt` | ORMs handle auto-conversion (JPA: `ImplicitNamingStrategy`) |
| **No abbreviations** | `status`, `description` | `sts`, `desc` | `desc` is also a reserved word (`ORDER BY ... DESC`) |
| **Boolean: is/has prefix** | `is_active`, `has_coupon` | `active`, `coupon_yn` | Makes the meaning explicit. `_yn` is a legacy convention |
| **Timestamps: _at suffix** | `created_at`, `deleted_at` | `reg_date`, `crt_dtm` | Clearly indicates a timestamp |
| **FK: referenced_table_id** | `user_id`, `order_id` | `usr_seq`, `fk_order` | Immediately obvious which table's PK is referenced |

### 1.4 Index and Constraint Names

Without explicit names, the DB auto-generates names like `SYS_C007342`. When this shows up in production error logs, it's meaningless.

```sql
-- Recommended patterns
ALTER TABLE orders ADD CONSTRAINT pk_orders PRIMARY KEY (id);
ALTER TABLE orders ADD CONSTRAINT uq_orders_order_number UNIQUE (order_number);
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order_id
    FOREIGN KEY (order_id) REFERENCES orders(id);
CREATE INDEX idx_orders_user_id_created_at ON orders (user_id, created_at);
```

| Object | Pattern | Example |
|--------|---------|---------|
| PK | `pk_{table}` | `pk_orders` |
| Unique | `uq_{table}_{column}` | `uq_orders_order_number` |
| FK | `fk_{table}_{column}` | `fk_order_items_order_id` |
| Index | `idx_{table}_{columns}` | `idx_orders_user_id_created_at` |

---

## 2. Data Type Selection

### 2.1 VARCHAR — Why Length Matters More Than You Think

```sql
-- Common mistake: 255 for everything
CREATE TABLE users (
    name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(255),       -- 255 for a phone number?
    zip_code VARCHAR(255)     -- 255 for a zip code?
);
```

"It's variable length anyway, so why not go big?" — **Wrong.**

| Impact | Explanation |
|--------|-------------|
| **Index size** | InnoDB's max index key size is 3072 bytes. `VARCHAR(255)` + `utf8mb4` = up to 1020 bytes. Three composite columns and you're at the limit |
| **Memory allocation** | MySQL's `MEMORY` engine and temp tables allocate VARCHAR at **max length**. Ten `VARCHAR(255)` columns = 2,550 bytes per row |
| **Intent documentation** | `VARCHAR(20)` says "this field holds short values." 255 says "I didn't think about it" |

> **PostgreSQL is different**: PostgreSQL stores `VARCHAR(n)` and `TEXT` **identically** under the hood. The length limit acts like a CHECK constraint — there's no performance or storage difference. That's why the PostgreSQL community often advises "just use `TEXT` if you don't need a length limit." However, **if you might use MySQL too, or want the schema itself to serve as documentation**, specifying appropriate VARCHAR lengths is still a good practice.

#### Practical Length Guidelines

| Use Case | Length | Rationale |
|----------|--------|-----------|
| Person name | `VARCHAR(50)` | Covers most international names |
| Email | `VARCHAR(320)` | RFC 5321 max: 320 chars (local 64 + @ + domain 255) |
| Phone number | `VARCHAR(20)` | International format max 15 digits + separators |
| Zip/postal code | `VARCHAR(10)` | US ZIP+4 is 10 chars |
| URL | `VARCHAR(2048)` | Practical browser max |
| Short code/status | `VARCHAR(30)` | `ACTIVE`, `PENDING_APPROVAL`, etc. |

### 2.2 Integer Types — INT vs BIGINT

| Type | Bytes | Range (UNSIGNED) | When It Runs Out |
|------|:---:|------|------|
| `INT` | 4 | 0 ~ ~**2.1 billion** | 100K rows/day ~ 58 years. Looks safe, but... |
| `BIGINT` | 8 | 0 ~ ~**9.2 quintillion** | Effectively never |

"2.1 billion should be enough, right?" — Here's the trap:

```
-- Consider these scenarios
1. Orders table: 500K/day x 365 days x 10 years = 1.825 billion -> INT almost maxed
2. Log table: 10M/day -> overflows in 7 months
3. Deletions: AUTO_INCREMENT never decreases after deletes
```

**Practical rule**: Always start PKs with `BIGINT`. Saving 4 bytes isn't worth an emergency migration at 3 AM.

#### INT to BIGINT Migration Cost: MySQL vs PostgreSQL

| DB | What INT -> BIGINT requires | Impact |
|----|---------------------------|--------|
| **MySQL (InnoDB)** | Table rebuild (`ALGORITHM=COPY`) | 100M rows = tens of minutes to hours, writes may be blocked |
| **PostgreSQL** | Also table rebuild (`ALTER COLUMN TYPE`) | `ACCESS EXCLUSIVE` lock on entire table -> reads AND writes blocked |

Both databases make this an **extremely expensive operation** on large tables. Start with BIGINT from the beginning.

> **Note**: MySQL has online DDL tools like `pt-online-schema-change` or `gh-ost` for zero-downtime changes. PostgreSQL uses a new-column + gradual-copy + column-swap strategy. Both are complex and risky.

### 2.3 Money — DECIMAL vs FLOAT

```sql
-- FLOAT trap
SELECT CAST(0.1 + 0.2 AS FLOAT);
-- Result: 0.30000000000000004  (not 0.30)

-- DECIMAL is exact
SELECT CAST(0.1 AS DECIMAL(10,2)) + CAST(0.2 AS DECIMAL(10,2));
-- Result: 0.30
```

| Type | Precision | Use Case |
|------|-----------|----------|
| `FLOAT` / `DOUBLE` | Approximate (IEEE 754) | Scientific calculations, coordinates, sensor data |
| `DECIMAL(p, s)` | Exact | **Money, quantities, rates** — anything where even 1 cent matters |

#### Choosing DECIMAL Precision

```sql
-- Currencies with no decimals (KRW, JPY)
price DECIMAL(15, 0)           -- Up to 999 trillion

-- Currencies with 2 decimals (USD, EUR)
price DECIMAL(15, 2)           -- Up to 9,999,999,999,999.99

-- Exchange rates, interest rates
exchange_rate DECIMAL(12, 6)   -- 1,234.567890
```

**Rule: Never use FLOAT for money columns. No exceptions.**

### 2.4 Date/Time — DATETIME vs TIMESTAMP

This matters more than you'd think — and **the same type name behaves differently in MySQL vs PostgreSQL**, so you must understand both.

#### MySQL Date/Time Types

| Property | `DATETIME` | `TIMESTAMP` |
|----------|-----------|------------|
| Storage | Stored as-is | **Converted to UTC** before storage |
| Range | `1000-01-01` ~ `9999-12-31` | `1970-01-01` ~ **`2038-01-19`** |
| Timezone | Not affected | Converted based on `time_zone` setting |
| Size | 5 bytes | 4 bytes |

```sql
-- MySQL: Timezone difference demo
SET time_zone = '+09:00';
INSERT INTO test (dt, ts) VALUES (NOW(), NOW());

SET time_zone = '+00:00';
SELECT dt, ts FROM test;
-- dt: 2026-04-05 14:00:00  (unchanged)
-- ts: 2026-04-05 05:00:00  (converted to UTC)
```

#### PostgreSQL Date/Time Types

| Property | `TIMESTAMP` | `TIMESTAMPTZ` |
|----------|------------|--------------|
| Storage | Stored as-is | **Converted to UTC** before storage |
| Range | `4713 BC` ~ `294276 AD` | `4713 BC` ~ `294276 AD` |
| Timezone | Not affected | Converted based on `timezone` setting |
| Size | 8 bytes | 8 bytes |

```sql
-- PostgreSQL: Timezone difference demo
SET timezone = 'Asia/Seoul';
INSERT INTO test (ts, tstz) VALUES (NOW(), NOW());

SET timezone = 'UTC';
SELECT ts, tstz FROM test;
-- ts: 2026-04-05 14:00:00    (unchanged — stored exactly as entered)
-- tstz: 2026-04-05 05:00:00  (converted to UTC for display)
```

#### MySQL vs PostgreSQL Type Mapping

| Purpose | MySQL | PostgreSQL | Note |
|---------|-------|------------|------|
| Timezone-aware time | `TIMESTAMP` | `TIMESTAMPTZ` | Different names, same role |
| Timezone-naive time | `DATETIME` | `TIMESTAMP` | **Caution: same name, different role!** |
| Date only | `DATE` | `DATE` | Same |
| Time only | `TIME` | `TIME` / `TIMETZ` | PostgreSQL has timezone variant |

> **Confusion point**: MySQL's `TIMESTAMP` and PostgreSQL's `TIMESTAMP` share the same name but **behave differently**. MySQL `TIMESTAMP` is timezone-aware, while PostgreSQL `TIMESTAMP` is timezone-naive. PostgreSQL's timezone-aware type is `TIMESTAMPTZ`.

#### The 2038 Problem

MySQL's `TIMESTAMP` is internally stored as a 4-byte integer (Unix timestamp). It overflows on January 19, 2038. **PostgreSQL uses 8 bytes, so it doesn't have this problem.**

| Scenario | MySQL | PostgreSQL |
|----------|-------|------------|
| Global service | `TIMESTAMP` (watch for 2038) | `TIMESTAMPTZ` |
| Single-region service | `DATETIME` | `TIMESTAMPTZ` (still recommended) |
| Birth date | `DATE` | `DATE` |
| Event scheduling | `DATETIME` | `TIMESTAMP` |
| `created_at`, `updated_at` | `TIMESTAMP` or `DATETIME` | `TIMESTAMPTZ` |

> **PostgreSQL tip**: The official PostgreSQL docs recommend **"use `TIMESTAMPTZ` for almost everything."** Plain `TIMESTAMP` (without timezone) is only for rare cases where you need an absolute time in a specific timezone, like "2 PM KST for an event."

### 2.5 ENUM vs Lookup Tables

```sql
-- Option 1: ENUM
CREATE TABLE orders (
    status ENUM('PENDING', 'PAID', 'SHIPPED', 'CANCELLED')
);

-- Option 2: Lookup table
CREATE TABLE order_statuses (
    id INT PRIMARY KEY,
    name VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE orders (
    status_id INT REFERENCES order_statuses(id)
);

-- Option 3: Plain VARCHAR
CREATE TABLE orders (
    status VARCHAR(30) NOT NULL  -- Used with CHECK constraint
);
```

| Approach | Pros | Cons |
|----------|------|------|
| **ENUM** | Storage efficient (1-2 bytes), value restriction | Adding/removing values requires `ALTER TABLE` (MySQL: table rebuild). PostgreSQL allows `ADD VALUE` but **can't remove or rename — requires type recreation** |
| **Lookup table** | Flexible add/remove, can hold extra attributes (description, sort order, active flag) | Requires JOIN, slightly more complex |
| **VARCHAR + CHECK** | Simple, more flexible than ENUM | Adding values requires `ALTER TABLE DROP/ADD CONSTRAINT` (DDL change). Typo risk, larger storage |

#### The "It'll Never Change" Trap

At first, `PENDING`, `PAID`, `CANCELLED` — 3 values seem enough. But in production:

```
v1.0: PENDING, PAID, CANCELLED                          — 3 values
v1.3: + REFUNDED                                        — 4 values
v2.0: + PARTIAL_REFUND, DISPUTED, PAYMENT_FAILED        — 7 values
v2.5: CANCELLED -> CANCELLED_BY_USER, CANCELLED_BY_ADMIN — 8 values + rename
```

With ENUM or VARCHAR+CHECK, **every change requires a DDL modification**. On large tables, that can impact the live service.

#### ENUM Pitfalls by Database

| Issue | MySQL | PostgreSQL |
|-------|-------|------------|
| Adding values | `ALTER TABLE` -> table rebuild (minutes on large tables) | `ALTER TYPE ... ADD VALUE` -> fast, but can't run inside a transaction |
| Removing/renaming values | `ALTER TABLE` -> table rebuild | **Not possible** — must create a new type and swap |
| ORM sync | Java enum <-> DB ENUM mismatch = runtime error. DB must be updated before app deployment | Same |
| Sorting | Sorts by internal index (declaration order) | Declaration order, not alphabetical — unexpected sort results |

#### Lookup Tables Are Better

```sql
-- Adding a value: one INSERT. No DDL change. Zero service impact.
INSERT INTO order_statuses (id, name) VALUES (5, 'REFUNDED');

-- Freely add metadata later
ALTER TABLE order_statuses ADD COLUMN display_name VARCHAR(50);
ALTER TABLE order_statuses ADD COLUMN is_terminal BOOLEAN DEFAULT FALSE;
```

"But what about JOIN cost?" — Lookup tables typically have tens of rows. The **entire table is cached in memory**, so the measured performance difference is negligible. Application-level caching eliminates the JOIN entirely.

#### Decision Guide

```
Default choice                          -> Lookup table (most flexible and safe)
Values that absolutely never change     -> ENUM or VARCHAR+CHECK (e.g., gender M/F/X, weekdays, ISO codes)
No permission to create new tables      -> VARCHAR+CHECK (when lookup tables aren't an option)
```

> **Practical tip**: Don't trust "this value will never change" at face value. When in doubt, a lookup table is the choice that **causes the least pain down the road**.

### 2.6 BOOLEAN Type

```sql
-- MySQL: Actually an alias for TINYINT(1)
is_active BOOLEAN DEFAULT TRUE    -- Internal: TINYINT(1) DEFAULT 1

-- PostgreSQL: Real BOOLEAN
is_active BOOLEAN DEFAULT TRUE    -- Stores true/false/null
```

Watch out:

```sql
-- MySQL BOOLEAN is TINYINT(1), so this works
INSERT INTO users (is_active) VALUES (2);   -- No error!
INSERT INTO users (is_active) VALUES (99);  -- Also fine!

-- Defend with CHECK constraint (MySQL 8.0.16+)
ALTER TABLE users ADD CONSTRAINT chk_is_active CHECK (is_active IN (0, 1));
```

### 2.7 TEXT vs VARCHAR

| Property | `VARCHAR(n)` | `TEXT` |
|----------|-------------|--------|
| Max size | MySQL: 65,535 bytes (per row) | MySQL: 65,535 bytes, PostgreSQL: 1GB |
| Indexing | Direct | **Prefix index only** (MySQL) |
| Default value | Supported | MySQL: not supported, PostgreSQL: supported |
| Use case | Short strings with predictable length | Post bodies, descriptions, JSON, etc. |

#### MySQL vs PostgreSQL Differences

```
MySQL:      VARCHAR(n) != TEXT — different storage, indexing, and default value support
PostgreSQL: VARCHAR(n) ≈ TEXT — identical internal storage. VARCHAR(n) just adds a length check
```

| Difference | MySQL | PostgreSQL |
|------------|-------|------------|
| INDEX on TEXT | Prefix index only (`INDEX(col(255))`) | Regular index possible (up to ~2700 bytes) |
| DEFAULT on TEXT | Not supported | Supported |
| VARCHAR vs TEXT performance | VARCHAR can be better (temp tables) | No difference |

**Practical rule**: For MySQL, use `VARCHAR` when length is predictable, `TEXT` otherwise. For PostgreSQL, use `VARCHAR(n)` only when length limits are a business rule — otherwise `TEXT` is fine for everything.

---

## 3. PK (Primary Key) Strategy

Choosing a PK isn't just "what should the id be?" It's an architectural decision that directly affects **index structure, INSERT performance, and distributed system compatibility**.

### 3.1 AUTO_INCREMENT / IDENTITY (Sequential Integer)

```sql
-- MySQL
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ...
);

-- PostgreSQL (recommended: IDENTITY — SQL standard)
CREATE TABLE orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ...
);

-- PostgreSQL (legacy: SERIAL — sequence-based)
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,   -- Internally: sequence + DEFAULT combo
    ...
);
```

> **PostgreSQL SERIAL vs IDENTITY**: `SERIAL` is PostgreSQL-specific syntax, while `GENERATED ALWAYS AS IDENTITY` is SQL:2003 standard. For new projects, `IDENTITY` is recommended. `SERIAL` has messy sequence ownership management and allows users to INSERT arbitrary values.

| Pros | Cons |
|------|------|
| Simple and intuitive | Security risk if exposed (total order count guessable) |
| Best fit for clustered indexes (sequential inserts = no page splits) | Collisions in distributed setups (multiple DB servers) |
| Sort order = creation order | DB-dependent (can't know ID before INSERT) |
| Small (8 bytes) | ID conflicts during cross-table migrations |

#### What Is a Clustered Index?

In InnoDB (MySQL), **PK = clustered index**. Data is physically stored in PK order.

> **PostgreSQL is different**: PostgreSQL has **no clustered index by default**. Tables (heaps) store data in insertion order, and the PK is just a separate B-Tree index. The `CLUSTER` command can sort data once, but subsequent INSERTs won't maintain order. This means **random UUID inserts aren't as devastating as in MySQL** — though index size and cache efficiency concerns still apply.

```
[AUTO_INCREMENT — Sequential inserts]
Page 1: [1, 2, 3, 4, 5]
Page 2: [6, 7, 8, 9, 10]
Page 3: [11, 12, ...]        <- Always appends to last page. Clean.

[UUID — Random inserts]
Page 1: [3a2f..., 7b1c..., a9d4...]
Page 2: [1e8b..., 5c3a..., f2e1...]
INSERT -> 0x4d7... -> Must squeeze between pages 1 and 2 -> Page split!
```

Page splits cause **increased disk I/O, index fragmentation, and degraded INSERT performance**.

### 3.2 UUID v4 (Random)

```sql
-- MySQL 8.0
CREATE TABLE orders (
    id BINARY(16) PRIMARY KEY,  -- Store UUID as binary (not 36-byte string)
    ...
);

-- PostgreSQL
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ...
);
```

| Pros | Cons |
|------|------|
| Globally unique — no collisions in distributed systems | **Random = poor clustered index performance** (page splits) |
| Can be generated client-side without DB | Large (16 bytes binary, 36 bytes as string) |
| Can't guess data from ID | Hard for humans to read (`550e8400-e29b-41d4-a716-446655440000`) |
| | Larger indexes — every secondary index includes the PK |

> Storing UUID as `VARCHAR(36)` in MySQL is the worst option. Always convert to `BINARY(16)`. MySQL 8.0's `UUID_TO_BIN(uuid, 1)` function can also enable time-based ordering.

### 3.3 UUID v7 / ULID (Time-Sortable)

These solve UUID v4's main weakness (random = page splits).

```
UUID v7 structure:
|-- 48-bit timestamp --|-- random --|
017F22E2-79B0-7CC3-98C4-DC0C0C07398F
^^^^^^^^^^^^^^^^
Time-sortable!

ULID structure:
|-- 48-bit timestamp --|-- 80-bit random --|
01ARZ3NDEKTSV4RRFFQ69G5FAV
^^^^^^^^^^
Time-sortable!
```

| Property | UUID v4 | UUID v7 | ULID |
|----------|:---:|:---:|:---:|
| Time-sortable | No | Yes | Yes |
| Clustered index friendly | No | Yes | Yes |
| Size | 16 bytes | 16 bytes | 16 bytes (26-char string) |
| Standard | RFC 4122 | RFC 9562 (2024) | Unofficial (de facto standard) |
| Native DB support | PostgreSQL | PostgreSQL 17+ | No (app-generated) |

```java
// Generating UUID v7 in Java (requires library)
// com.github.f4b6a3:uuid-creator
UUID uuidV7 = UuidCreator.getTimeOrderedEpoch();

// Generating ULID
// com.github.f4b6a3:ulid-creator
Ulid ulid = UlidCreator.getMonotonicUlid();
```

### 3.4 Snowflake ID (Distributed)

Created by Twitter. Encodes time + machine ID + sequence into a 64-bit integer.

```
Snowflake structure (64-bit):
|1 bit (unused)|41 bits (timestamp)|10 bits (machine ID)|12 bits (sequence)|

- Timestamp: ~69 years of coverage
- Machine ID: up to 1,024 machines
- Sequence: 4,096 per millisecond
```

| Pros | Cons |
|------|------|
| Fits in `BIGINT` (8 bytes) | Needs ID generation server (or library) |
| Time-sortable | Machine ID management required |
| No collisions in distributed systems | Clock synchronization dependency (NTP) |
| Clustered index friendly | Implementation complexity |

### 3.5 Which PK Strategy Should You Use?

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Single DB, typical service | **AUTO_INCREMENT (BIGINT)** | Simple, best performance, sufficient for most cases |
| ID exposed externally | **UUID v7 or ULID** | Can't guess order or total count |
| Microservices, multi-DB | **UUID v7 or Snowflake** | Generate IDs without DB, no collisions |
| Event sourcing | **UUID v7** | Event ordering + global uniqueness |

> **Practical tip**: "Start with AUTO_INCREMENT and switch when needed" is the most realistic approach. But **always start with BIGINT for the PK type**. INT to BIGINT requires a table rebuild, while BIGINT to UUID can be done via a new column + gradual migration.

#### Natural Key vs Surrogate Key

One more important decision: **Should you use a business value as the PK?**

```sql
-- Natural Key: business value = PK
CREATE TABLE countries (
    code CHAR(2) PRIMARY KEY,  -- 'KR', 'US', 'JP'
    name VARCHAR(100)
);

-- Surrogate Key: artificial key = PK
CREATE TABLE countries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code CHAR(2) NOT NULL UNIQUE,
    name VARCHAR(100)
);
```

| Type | Pros | Cons |
|------|------|------|
| **Natural Key** | Meaningful without JOIN, built-in dedup | Business rule changes require PK changes -> cascading FK updates |
| **Surrogate Key** | PK never changes, easy FK management | Need JOIN to see meaning, separate UNIQUE constraint needed |

**Practical rule**: Almost always use a **Surrogate Key as the PK**, and protect Natural Keys with `UNIQUE` constraints. Exceptions are only for codes that **never change** — like ISO country codes or currency codes.

---

## 4. NULL Semantics

NULL doesn't mean "no value." It means **"unknown."** This distinction is where all the confusion starts.

### 4.1 Three-Valued Logic

SQL uses three-valued logic with `TRUE`, `FALSE`, and **`UNKNOWN`**.

```sql
-- Comparisons with NULL always yield UNKNOWN
SELECT NULL = NULL;      -- NULL (not TRUE!)
SELECT NULL != NULL;     -- NULL (not TRUE!)
SELECT NULL > 0;         -- NULL
SELECT NULL = 0;         -- NULL

-- UNKNOWN acts like FALSE in WHERE clauses
SELECT * FROM users WHERE deleted_at = NULL;     -- 0 rows!
SELECT * FROM users WHERE deleted_at IS NULL;    -- Correct way
```

#### NULL Traps

```sql
-- Trap 1: NOT IN with NULL
SELECT * FROM orders WHERE user_id NOT IN (1, 2, NULL);
-- Result: 0 rows! (Every comparison becomes UNKNOWN, filtering everything)

-- Safe alternative
SELECT * FROM orders WHERE user_id NOT IN (1, 2);
-- Or
SELECT * FROM orders WHERE user_id NOT IN (
    SELECT id FROM blocked_users WHERE id IS NOT NULL
);

-- Trap 2: Aggregate functions and NULL
SELECT AVG(score) FROM reviews;
-- NULL rows are ignored. If 2 of 5 rows are NULL, it averages only 3

SELECT COUNT(score) FROM reviews;  -- Excludes NULL
SELECT COUNT(*) FROM reviews;      -- Includes all rows

-- Trap 3: UNIQUE constraint and NULL
-- MySQL: NULL is allowed multiple times in UNIQUE columns
INSERT INTO users (email) VALUES (NULL);  -- OK
INSERT INTO users (email) VALUES (NULL);  -- Also OK! (NULL != NULL)

-- PostgreSQL 14 and below: same as MySQL (multiple NULLs allowed)
-- PostgreSQL 15+: NULLS NOT DISTINCT option added
CREATE TABLE users (
    email VARCHAR(320),
    CONSTRAINT uq_users_email UNIQUE NULLS NOT DISTINCT (email)
);
-- Now NULL is only allowed once!

-- SQL Server: Only one NULL allowed (default behavior)
```

### 4.2 NOT NULL + DEFAULT vs Nullable

```sql
-- Option 1: Nullable (NULL until deleted)
deleted_at TIMESTAMP NULL

-- Option 2: NOT NULL + DEFAULT
status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
retry_count INT NOT NULL DEFAULT 0
```

#### Decision Guide

| NULL Is Appropriate | NOT NULL Is Appropriate |
|---------------------|------------------------|
| "Unknown" is meaningful (`deleted_at`, `approved_at`) | Value should always exist (`name`, `email`, `created_at`) |
| Optional relationship (`mentor_id` — might not have a mentor) | Default is obvious (`retry_count DEFAULT 0`) |
| Value not yet determined (`graduated_at` — still enrolled) | NULL checks would be needed everywhere in business logic |

### 4.3 NULL and Indexes

```sql
-- MySQL InnoDB: NULL values ARE included in indexes
CREATE INDEX idx_users_deleted_at ON users (deleted_at);
-- IS NULL conditions CAN use the index
SELECT * FROM users WHERE deleted_at IS NULL;  -- Index usable

-- PostgreSQL: Same — NULL is included in indexes
-- But partial indexes are more efficient
CREATE INDEX idx_users_active ON users (id) WHERE deleted_at IS NULL;
-- Only indexes non-deleted users -> dramatically smaller index
```

### 4.4 Practical NULL Design Principles

```
1. Default to NOT NULL
   - When adding a column, always ask: "Can this value be absent?"
   - If the answer is "no", make it NOT NULL

2. When allowing NULL, make the meaning explicit
   - deleted_at IS NULL -> "not deleted" (clear)
   - phone IS NULL -> "phone not registered" (clear)
   - score IS NULL -> "not yet graded" vs 0 points (clear distinction)

3. Defend in application code
   - Java: Wrap with Optional, @Column(nullable = false)
   - SQL: Use COALESCE for default values
```

```java
// JPA defense
@Entity
public class User {
    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String email;

    private LocalDateTime deletedAt;  // nullable — NULL until deleted
}
```

```sql
-- Safe NULL handling with COALESCE
SELECT
    name,
    COALESCE(phone, 'Not registered') AS phone,
    COALESCE(score, 0) AS score
FROM users;
```

---

## Summary

| Topic | Key Principle |
|-------|--------------|
| **Naming** | snake_case, plural tables, no abbreviations, avoid reserved words. **Consistency is what matters most** |
| **Data types** | VARCHAR lengths with justification, DECIMAL for money, BIGINT for PKs, time types matched to service needs |
| **PK strategy** | AUTO_INCREMENT + BIGINT covers most cases. UUID v7 or ULID for external exposure or distributed systems |
| **NULL** | Default to NOT NULL. When allowing NULL, you must be able to answer "what does the absence of this value mean?" |

Cutting corners on these 4 decisions means **coming back later for a migration**. Spending 5 extra minutes when first creating a table is 100x cheaper than changing a column type on a live service.

Next up: **Normalization and Denormalization** — not the theory, but the practical judgment calls for when it's right to break normalization rules.
