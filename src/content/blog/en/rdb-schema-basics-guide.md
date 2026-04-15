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

### 1.2 Why snake_case?

There are clear reasons why snake_case is the default in the database world.

| Reason | Explanation |
|--------|-------------|
| **Avoids case sensitivity traps** | MySQL behavior varies by OS, PostgreSQL folds to lowercase without quotes. `OrderItem` works in some environments, fails in others. snake_case is all lowercase, so it **behaves identically across every DB and OS** |
| **Reads well with SQL** | SQL keywords are conventionally uppercase (`SELECT`, `FROM`, `WHERE`). Mixed-case identifiers blur the line between keywords and names. `SELECT OrderDate FROM OrderItems` vs `SELECT order_date FROM order_items` — the latter is immediately readable |
| **ORM auto-mapping** | JPA/Hibernate automatically maps `camelCase` entity fields to `snake_case` columns (`ImplicitNamingStrategy`). If the DB uses snake_case, everything works without `@Column(name=...)` annotations |
| **CLI/terminal convenience** | You can type identifiers directly in `psql`, `mysql` without quotes or backticks. Typing `SELECT * FROM "OrderItems"` with quotes every time is painful |
| **Industry standard** | PostgreSQL official docs, MySQL official examples, and major frameworks (Rails, Django, Laravel) all default to snake_case |

```sql
-- What happens when you use camelCase
CREATE TABLE "OrderItems" ("orderId" BIGINT, "productName" VARCHAR(100));

-- 1. Every query needs quotes (PostgreSQL)
SELECT "orderId", "productName" FROM "OrderItems";  -- every single time

-- 2. Forget quotes? Error.
SELECT orderId FROM OrderItems;  -- Looks for "orderitems"."orderid"

-- 3. pg_dump and other tools may drop quotes -> restore fails

-- With snake_case?
CREATE TABLE order_items (order_id BIGINT, product_name VARCHAR(100));
SELECT order_id, product_name FROM order_items;  -- clean, no quotes needed
```

### 1.3 Table Names

| Rule | Good | Bad | Why |
|------|------|-----|-----|
| **snake_case** | `order_item` | `OrderItem`, `orderitem` | All the reasons explained above |
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

### 1.4 Column Names

| Rule | Good | Bad | Why |
|------|------|-----|-----|
| **snake_case** | `created_at` | `createdAt`, `CreatedAt` | ORMs handle auto-conversion (JPA: `ImplicitNamingStrategy`) |
| **No abbreviations** | `status`, `description` | `sts`, `desc` | `desc` is also a reserved word (`ORDER BY ... DESC`) |
| **Boolean: is/has prefix** | `is_active`, `has_coupon` | `active`, `coupon_yn` | Makes the meaning explicit. `_yn` is a legacy convention |
| **Timestamps: _at suffix** | `created_at`, `deleted_at` | `reg_date`, `crt_dtm` | Clearly indicates a timestamp |
| **FK: referenced_table_id** | `user_id`, `order_id` | `usr_seq`, `fk_order` | Immediately obvious which table's PK is referenced |

**PK: `id` vs `table_name_id` — Which is Better?**

| | `id` | `user_id` (includes table name) |
|---|---|---|
| **Pros** | Concise, ORM default (JPA `@Id`), reads naturally as `user.id` | Column name alone shows origin in JOINs, better SQL readability |
| **Cons** | JOINs require table prefix: `users.id = orders.user_id` | `user.user_id` feels redundant, needs ORM mapping |
| **Preferred by** | Rails, JPA/Hibernate, Django (ORM-centric) | PostgreSQL community, DBA-led teams, SQL-heavy environments |

The most common pattern in practice is **`id` for the table's own PK, `referenced_table_id` for FKs**.

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,        -- Own table: id
    name VARCHAR(50) NOT NULL
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY,        -- Own table: id
    user_id BIGINT NOT NULL,      -- FK: referenced_table_id
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

> Either approach works — what matters most is **consistency within your team**. This post uses the ORM-friendly `id` + `referenced_table_id` pattern.

### 1.5 Index and Constraint Names

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

> **DB-Specific Notes**
> - **MySQL (InnoDB)**: VARCHAR lengths of **255 or less use 1 byte** to store the length prefix; **256 or more use 2 bytes**. It's a small difference, but worth knowing that internal storage behavior changes at the 255 boundary.
> - **Oracle**: Uses `VARCHAR2`, and you must explicitly choose between **character and byte semantics** — e.g., `VARCHAR2(50 CHAR)` vs `VARCHAR2(50 BYTE)`. When handling multibyte characters (Korean, Japanese, etc.), always specify `CHAR` semantics.
> - **PostgreSQL**: As noted above, VARCHAR(n) and TEXT are stored identically, so the choice is less about length and more about **whether the limit represents a business rule**.
> - **SQL Server**: `VARCHAR` is **byte-based**, while `NVARCHAR` is **character-based** (UTF-16, 2 bytes per character). For non-ASCII text (Korean, Japanese, etc.), use `NVARCHAR`. Note the max length difference: `VARCHAR(8000)` vs `NVARCHAR(4000)`.
>
> The recommended lengths in the table above are based on **RFCs and international standards** — they apply regardless of which database you use.

### 2.2 Charset & Collation — The Hidden Minefield of Strings

Just as important as VARCHAR length — but far more often ignored — are **charset (character encoding)** and **collation (sorting/comparison rules)**.

#### MySQL: utf8 ≠ UTF-8

MySQL's most famous gotcha:

```sql
-- ❌ utf8 is only 3 bytes max → can't store emoji (💡)
CREATE TABLE posts (
    title VARCHAR(200)
) CHARACTER SET utf8;

-- ✅ utf8mb4 is real UTF-8 (up to 4 bytes)
CREATE TABLE posts (
    title VARCHAR(200)
) CHARACTER SET utf8mb4;
```

Since MySQL 8.0, the **default charset is `utf8mb4`**, but if you're working with legacy databases, always verify.

#### How Collation Affects Your Queries

Collation determines **how strings are compared and sorted**. The same data can produce different results for WHERE and ORDER BY depending on the collation.

| Collation | Behavior | Use Case |
|-----------|----------|----------|
| `utf8mb4_unicode_ci` | Case-insensitive, accent-insensitive | General text (names, emails) |
| `utf8mb4_bin` | Exact byte-level comparison | Hashes, tokens, password hashes |
| `utf8mb4_0900_ai_ci` | MySQL 8.0 default. Unicode 9.0-based, more accurate sorting | New projects on MySQL 8.0+ |

```sql
-- Results differ based on collation
-- utf8mb4_unicode_ci: 'cafe' = 'café' = 'CAFE' (all equal)
-- utf8mb4_bin:        'cafe' ≠ 'café' ≠ 'CAFE' (all different)

-- Pro tip: you can set collation per column
CREATE TABLE users (
    email VARCHAR(320) COLLATE utf8mb4_unicode_ci,  -- case-insensitive search
    api_key VARCHAR(64) COLLATE utf8mb4_bin          -- exact matching
);
```

#### PostgreSQL: Encoding Is Simple, Collation Is Complex

PostgreSQL sets encoding at database creation, and **UTF-8 is the de facto standard**. There's no charset trap like MySQL's.

```sql
-- Set at database level
CREATE DATABASE myapp
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8';

-- PostgreSQL 12+: ICU collation for finer control
CREATE COLLATION korean (provider = icu, locale = 'ko-KR');

ALTER TABLE users
    ALTER COLUMN name TYPE VARCHAR(50) COLLATE "korean";
```

PostgreSQL collation comes in two flavors: the traditional **OS locale-dependent** approach and the **ICU provider**. For new projects, prefer ICU — it prevents the nasty surprise of sort order changing after an OS upgrade.

#### SQL Server: NVARCHAR + Collation

SQL Server sets the default collation at the **database level**, not per table or column.

```sql
-- Database default collation
CREATE DATABASE MyApp COLLATE Korean_Wansung_CI_AS;

-- CI = Case Insensitive, AS = Accent Sensitive
-- Use Korean_Wansung family for Korean sorting
```

**What the Collation Abbreviations Mean:**

| Abbreviation | Meaning | Example |
|------|------|------|
| **CI** (Case Insensitive) | Treats upper/lowercase as equal | `'abc' = 'ABC'` → `true` |
| **CS** (Case Sensitive) | Distinguishes upper/lowercase | `'abc' = 'ABC'` → `false` |
| **AI** (Accent Insensitive) | Treats accented chars as equal | `'café' = 'cafe'` → `true` |
| **AS** (Accent Sensitive) | Distinguishes accented chars | `'café' = 'cafe'` → `false` |

**Why Accent Sensitivity matters in practice**: If your application handles European languages, whether `é`, `ë`, `è` match `e` directly affects search results. For Korean-only services, the `AS`/`AI` difference is rarely noticeable since Korean doesn't use accents — but for multilingual services, this is a must-consider setting.

As mentioned in the DB-specific notes above, use `NVARCHAR` when handling non-ASCII characters like Korean or Japanese.

#### Practical Rules

| DB | Recommended Charset | Recommended Collation |
|----|--------------------|-----------------------|
| **MySQL 8.0+** | `utf8mb4` (default) | `utf8mb4_0900_ai_ci` (default, AI=Accent Insensitive, CI=Case Insensitive) |
| **MySQL 5.7** | `utf8mb4` (must specify!) | `utf8mb4_unicode_ci` |
| **PostgreSQL** | `UTF8` | ICU provider-based (`ko-KR`, etc.) |
| **SQL Server** | Use `NVARCHAR` | `Korean_Wansung_CI_AS` (for Korean services) |

> **Key takeaway**: Charset and collation should be **decided once at project inception and kept consistent**. Changing them later requires a table rebuild + index recreation.

### 2.3 Integer Types — INT vs BIGINT

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

### 2.4 Money — DECIMAL vs FLOAT

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

### 2.5 Date/Time — DATETIME vs TIMESTAMP

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

#### SQL Server Date/Time Types

| Property | `DATETIME2` | `DATETIMEOFFSET` |
|----------|------------|-----------------|
| Storage | Stored as-is | Stored **with UTC offset** |
| Range | `0001-01-01` ~ `9999-12-31` | `0001-01-01` ~ `9999-12-31` |
| Timezone | Not affected | Includes offset info (`+09:00`, etc.) |
| Size | 6-8 bytes (depends on precision) | 8-10 bytes |
| Precision | Up to 100 nanoseconds (`DATETIME2(7)`) | Up to 100 nanoseconds |

```sql
-- SQL Server: Timezone difference demo
DECLARE @dt DATETIME2 = '2026-04-05 14:00:00';
DECLARE @dto DATETIMEOFFSET = '2026-04-05 14:00:00 +09:00';

SELECT @dt;   -- 2026-04-05 14:00:00.0000000 (no offset)
SELECT @dto;  -- 2026-04-05 14:00:00.0000000 +09:00

-- Convert to UTC
SELECT SWITCHOFFSET(@dto, '+00:00');
-- 2026-04-05 05:00:00.0000000 +00:00
```

> **`DATETIME` vs `DATETIME2`**: SQL Server also has a legacy `DATETIME` type, but its range (`1753~9999`) and precision (3.33ms) are limited. **Always use `DATETIME2` for new projects.**

#### MySQL vs PostgreSQL vs SQL Server Type Mapping

| Purpose | MySQL | PostgreSQL | SQL Server | Note |
|---------|-------|------------|------------|------|
| Timezone-aware time | `TIMESTAMP` | `TIMESTAMPTZ` | `DATETIMEOFFSET` | Different names, same role |
| Timezone-naive time | `DATETIME` | `TIMESTAMP` | `DATETIME2` | **Caution: same name, different role!** |
| Date only | `DATE` | `DATE` | `DATE` | Same |
| Time only | `TIME` | `TIME` / `TIMETZ` | `TIME` | PostgreSQL has timezone variant |

> **Confusion point**: MySQL's `TIMESTAMP` and PostgreSQL's `TIMESTAMP` share the same name but **behave differently**. MySQL `TIMESTAMP` is timezone-aware, while PostgreSQL `TIMESTAMP` is timezone-naive. PostgreSQL's timezone-aware type is `TIMESTAMPTZ`. SQL Server uses a distinct name `DATETIMEOFFSET`, which avoids this confusion.

#### The 2038 Problem

MySQL's `TIMESTAMP` is internally stored as a 4-byte integer (Unix timestamp). It overflows on January 19, 2038. **PostgreSQL uses 8 bytes and SQL Server's `DATETIME2` uses 6-8 bytes, so neither has this problem.**

| Scenario | MySQL | PostgreSQL | SQL Server |
|----------|-------|------------|------------|
| Global service | `TIMESTAMP` (watch for 2038) | `TIMESTAMPTZ` | `DATETIMEOFFSET` |
| Single-region service | `DATETIME` | `TIMESTAMPTZ` (still recommended) | `DATETIME2` |
| Birth date | `DATE` | `DATE` | `DATE` |
| Event scheduling | `DATETIME` | `TIMESTAMP` | `DATETIME2` |
| `created_at`, `updated_at` | `TIMESTAMP` or `DATETIME` | `TIMESTAMPTZ` | `DATETIME2` or `DATETIMEOFFSET` |

> **PostgreSQL tip**: The official PostgreSQL docs recommend **"use `TIMESTAMPTZ` for almost everything."** Plain `TIMESTAMP` (without timezone) is only for rare cases where you need an absolute time in a specific timezone, like "2 PM KST for an event."
>
> **SQL Server tip**: `DATETIMEOFFSET` stores the offset value (`+09:00`) alongside the time, preserving which timezone the data was entered in. Useful for global services. For single-region apps, `DATETIME2` is sufficient.

### 2.6 ENUM vs Lookup Tables

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

### 2.7 BOOLEAN Type

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

### 2.8 TEXT vs VARCHAR

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

> **Why BIGINT + IDENTITY instead of SERIAL?**
>
> This choice addresses two independent concerns: **syntax** and **size**.
>
> **Syntax: SERIAL vs IDENTITY**
> - `SERIAL` is PostgreSQL-specific. Under the hood, it's just a **macro** that creates a sequence and sets `DEFAULT nextval(...)`.
> - Problem 1: Sequence ownership is messy. `DROP TABLE` may leave orphaned sequences, and `pg_dump` ordering can break.
> - Problem 2: Nothing stops `INSERT INTO orders(id) VALUES (999)` — **arbitrary values bypass the sequence.** When the sequence catches up to that value, you get duplicate key errors.
> - `GENERATED ALWAYS AS IDENTITY` is SQL:2003 standard and blocks arbitrary value insertion by default. (Requires explicit `OVERRIDING SYSTEM VALUE` to bypass.)
>
> **Size: INT (SERIAL) vs BIGINT (BIGSERIAL)**
> - `SERIAL` = `INTEGER` (4 bytes, max ~2.1 billion), `BIGSERIAL` = `BIGINT` (8 bytes)
> - As covered in section 2.3, INT runs out faster than you'd expect. Saving 4 bytes per row isn't worth a 3 AM emergency migration.
> - Switching INT→BIGINT means **changing the PK type + all FK column types + rebuilding every index.** On large tables, this can require hours of downtime.
>
> **Bottom line**: Use **`BIGINT GENERATED ALWAYS AS IDENTITY`** instead of `SERIAL` or `BIGSERIAL` — it solves both the syntax and size problems at once.

| Pros | Cons |
|------|------|
| Simple and intuitive | Security risk if exposed (total order count guessable) |
| Best fit for clustered indexes (sequential inserts = no page splits) | Collisions in distributed setups (multiple DB servers) |
| Sort order = creation order | DB-dependent (can't know ID before INSERT) |
| Small (8 bytes) | ID conflicts during cross-table migrations |

#### What Is a Clustered Index?

In InnoDB (MySQL), **PK = clustered index**. Data is physically stored in PK order.

> **PostgreSQL is different**: PostgreSQL has **no clustered index by default**. Tables (heaps) store data in insertion order, and the PK is just a separate B+Tree index. The `CLUSTER` command can sort data once, but subsequent INSERTs won't maintain order. This means **random UUID inserts aren't as devastating as in MySQL** — though index size and cache efficiency concerns still apply.

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

One more important decision: **Should the PK be a business value, or a meaningless artificial key?**

- **Natural Key**: A unique value from the data itself used as PK (email, SSN, student ID, etc.)
- **Surrogate Key**: A value with no business meaning used as PK (AUTO_INCREMENT id, UUID, etc.)

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
| **Natural Key** | Meaningful without JOIN, built-in dedup | Business rule changes require PK changes → cascading FK updates |
| **Surrogate Key** | PK never changes, easy FK management | Need JOIN to see meaning, separate UNIQUE constraint needed |

#### Why Natural Keys Are Dangerous — A Real-World Scenario

Natural Keys cause problems when **the assumption "this value never changes" breaks**.

**Scenario: Email as PK**

```sql
-- At design time: "Email is unique per user, let's make it the PK"
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

Six months later, users request an **email change feature**. Here's what happens:

```sql
-- To change an email:
-- 1. Update the PK in users table
-- 2. Update the FK in orders table
-- 3. Update the FK in reviews table
-- 4. Every other table referencing user_email... all of them

-- CASCADE handles this automatically, but
-- on large tables → millions of rows updated → locks + downtime
UPDATE users SET email = 'new@email.com' WHERE email = 'old@email.com';
```

**What if you'd used a Surrogate Key?**

```sql
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,  -- UNIQUE constraint, not PK
    name VARCHAR(50)
);

CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),  -- numeric FK
    amount DECIMAL(10,2)
);

-- Change email? Just 1 row in users. No FK changes needed.
UPDATE users SET email = 'new@email.com' WHERE id = 42;
```

#### Index Efficiency

Natural Keys also impact **index size when used as FKs**.

```
-- FK as BIGINT (8 bytes)
orders.user_id: 1M rows × 8 bytes = ~8MB index

-- FK as VARCHAR(320) (up to 1280 bytes in utf8mb4)
orders.user_email: 1M rows × ~30 bytes avg = ~30MB index
-- The gap widens further with composite indexes
```

#### When Is a Natural Key Actually Safe?

A Natural Key is safe when it meets **all three conditions**:

1. **The value never changes** — ISO country codes (`KR`), currency codes (`USD`), etc.
2. **Few FK references from other tables** — or the data volume is small even if referenced
3. **The value is short and fixed-length** — `CHAR(2)`, `CHAR(3)` level. No index efficiency concerns.

```sql
-- ✅ Natural Key is appropriate
CREATE TABLE currencies (
    code CHAR(3) PRIMARY KEY,  -- 'USD', 'KRW', 'JPY' — ISO 4217, never changes
    name VARCHAR(50),
    symbol VARCHAR(5)
);

-- ❌ Natural Key is risky
CREATE TABLE users (
    email VARCHAR(320) PRIMARY KEY,     -- can change
    ...
);

CREATE TABLE products (
    sku VARCHAR(50) PRIMARY KEY,        -- SKU scheme can change with company policy
    ...
);
```

**Practical rule**: Almost always use a **Surrogate Key as the PK**, and protect Natural Keys with `UNIQUE` constraints. Even when you're sure "this value will never change," if the table is widely referenced via FKs, a Surrogate Key is the safer bet.

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
| **Data types** | VARCHAR lengths with justification, charset/collation decided early and consistent, DECIMAL for money, BIGINT for PKs, time types matched to service needs |
| **PK strategy** | AUTO_INCREMENT + BIGINT covers most cases. UUID v7 or ULID for external exposure or distributed systems |
| **NULL** | Default to NOT NULL. When allowing NULL, you must be able to answer "what does the absence of this value mean?" |

Cutting corners on these 4 decisions means **coming back later for a migration**. Spending 5 extra minutes when first creating a table is 100x cheaper than changing a column type on a live service.

Next up: **Normalization and Denormalization** — not the theory, but the practical judgment calls for when it's right to break normalization rules.
