---
title: "RDB Design Series Part 3: Constraints and Data Integrity — Preventing Bugs at the Schema Level"
description: "CHECK, UNIQUE, FK, DEFAULT, Generated Columns — constraints aren't 'annoying overhead,' they're 'defense code baked into the schema.' This guide provides practical criteria for DB vs app validation, whether to use FKs or not, and defensive schema design patterns."
pubDate: "2026-04-07T14:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Constraints", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbConstraintsIntegrityGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-normalization-guide), we covered how to split and group tables — the judgment calls behind normalization and denormalization. This post goes one level deeper — **"How do you prevent bad data from entering in the first place?"**

Many developers only validate data in **application code**. A `if (age < 0) throw ...` in the service layer. App-level validation is essential, of course. But **if you only rely on the app, it will eventually be bypassed.**

```
An admin runs INSERT directly in the DB → app validation bypassed
Another service writes to the same DB → app validation bypassed
A data migration script runs → app validation bypassed
An ORM bug inserts the wrong value → app validation bypassed
```

**Constraints are the last line of defense.** Even when the app makes mistakes, the DB catches them.

This post covers 5 types of constraints:

1. CHECK — Enforcing value ranges/conditions
2. UNIQUE — Preventing duplicates (partial/composite)
3. FK — Referential integrity and its trade-offs
4. DEFAULT / Generated Column — Auto-filling values
5. Defensive schema design — Using the schema to prevent invalid states

---

## 1. CHECK Constraints — "This Value Must Be Within This Range"

### 1.1 Basic Usage

```sql
-- Age must be non-negative
ALTER TABLE users ADD CONSTRAINT chk_users_age CHECK (age >= 0);

-- Price must be positive
ALTER TABLE products ADD CONSTRAINT chk_products_price CHECK (price > 0);

-- Status must be one of the allowed values
ALTER TABLE orders ADD CONSTRAINT chk_orders_status
    CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED'));

-- Start date must be before end date
ALTER TABLE events ADD CONSTRAINT chk_events_date_range
    CHECK (start_date <= end_date);
```

```sql
-- When CHECK is violated
INSERT INTO users (name, age) VALUES ('John', -5);
-- ❌ ERROR: Check constraint 'chk_users_age' is violated.

INSERT INTO orders (status) VALUES ('UNKNOWN');
-- ❌ ERROR: Check constraint 'chk_orders_status' is violated.
```

### 1.2 MySQL vs PostgreSQL Differences

| Feature | MySQL | PostgreSQL |
|---------|-------|------------|
| CHECK support since | **8.0.16** (2019) — earlier versions parsed but **ignored** it | Supported from the start |
| Subqueries | Not allowed | Not allowed (no SELECT inside CHECK) |
| Cross-table references | Not allowed | Not allowed (same-row columns only) |
| Functions | Non-deterministic restricted (`NOW()` not allowed) | Only IMMUTABLE functions |

Let's look at each item in more detail.

#### Subqueries Not Allowed

You cannot use a `SELECT` statement inside a CHECK constraint. Any kind of query — whether against another table or even the same table — is prohibited.

```sql
-- ❌ You'd want to do this, but it's not possible
ALTER TABLE orders ADD CONSTRAINT chk_valid_product
    CHECK (product_id IN (SELECT id FROM products));
--                        ^^^^^^^^^^^^^^^^^^^^^^^^ No SELECT inside CHECK!

-- ✅ Use a FK for this kind of validation instead
ALTER TABLE orders ADD CONSTRAINT fk_orders_product
    FOREIGN KEY (product_id) REFERENCES products(id);
```

CHECK is evaluated on every INSERT/UPDATE. If subqueries were allowed, each write would trigger queries against other tables, causing performance degradation and concurrency issues (lock contention). This is why the SQL standard prohibits it from the ground up.

#### Cross-Table References Not Allowed

CHECK can only reference **columns from the very row being inserted or updated**. It cannot reference other rows in the same table, nor columns from other tables.

```sql
-- ✅ Allowed: comparing columns within the same row
ALTER TABLE events ADD CONSTRAINT chk_date_range
    CHECK (end_date > start_date);
--       ^^^^^^^^     ^^^^^^^^^^ Both are columns of the same row — OK

-- ❌ Not allowed: referencing another table's columns
ALTER TABLE orders ADD CONSTRAINT chk_enough_stock
    CHECK (quantity <= (SELECT stock FROM products WHERE id = product_id));
--                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Another table!
```

Cross-table rules like "ensure order quantity doesn't exceed product stock" cannot be implemented with CHECK. These cases require a **trigger** or **application-level validation**.

#### Function Usage Restrictions

You can use functions inside CHECK, but **functions whose results change on every call** are not allowed.

```sql
-- ❌ MySQL: NOW() is non-deterministic — returns different results each time
ALTER TABLE events ADD CONSTRAINT chk_future_event
    CHECK (event_date > NOW());
-- Passes at INSERT time, but existing rows would violate the constraint as time passes
-- The DB doesn't allow constraints that can become invalid over time

-- ❌ PostgreSQL: non-IMMUTABLE functions are not allowed
-- NOW() is a STABLE function, so it cannot be used in CHECK

-- ✅ Allowed: deterministic/immutable functions like UPPER(), LENGTH()
ALTER TABLE users ADD CONSTRAINT chk_email_format
    CHECK (LENGTH(email) >= 5);
-- Same input always produces the same result — safe to use
```

The key takeaway is that a CHECK constraint is a tool for **determining "is this row's data valid?" on a per-row, deterministic basis**. Subqueries, cross-table references, and non-deterministic functions are all restricted because they violate this principle.

> ⚠️ **If you're on MySQL 8.0.15 or earlier, CHECK doesn't work.** The `ALTER TABLE` succeeds without error, but no validation actually happens. Always verify your MySQL version.

### 1.3 DB Validation vs App Validation — Where Should You Validate?

**Both. They serve different roles.**

| Aspect | App-level validation | DB CHECK constraint |
|--------|---------------------|-------------------|
| **Role** | User feedback (error messages, field highlights) | Last line of defense (data integrity) |
| **Bypass risk** | High (direct SQL, migrations, other services) | None (DB rejects it) |
| **Error messages** | User-friendly ("Age must be 0 or greater") | Technical (`Check constraint 'chk_users_age' is violated`) |
| **Complex rules** | Possible (cross-table, external API calls) | Not possible (same-row columns only) |
| **Performance impact** | None (validated before INSERT) | Minimal (evaluated per INSERT/UPDATE) |

```
App validation: "Show friendly errors to users"          → UX
DB CHECK:       "Block bad data regardless of entry path" → Integrity
```

#### Practical Rules

```
1. Simple value ranges, allow-lists → DB CHECK + app validation both
   e.g., age >= 0, status IN ('A', 'B', 'C'), price > 0

2. Complex business rules → App validation only
   e.g., "Must have stock to place order", "VIP-only discounts"

3. Cross-table rules → App validation + FK constraint
   e.g., "order.user_id must reference an existing user"
```

### 1.4 CHECK with ENUM Values vs Lookup Tables

In [Part 1](/blog/en/rdb-schema-basics-guide), we covered ENUM vs lookup tables. Here's how CHECK fits in:

| Approach | When adding values | Best when |
|----------|-------------------|-----------|
| **CHECK + VARCHAR** | `ALTER TABLE` (DDL change) | 3–5 values that rarely change |
| **Lookup table + FK** | `INSERT` one row (DML) | 5+ values, or values that may change |

If values are likely to change, a lookup table beats CHECK.

#### CHECK in Practice — The Honest Reality

CHECK constraints are great in theory, but **teams that actively use them are in the minority.** Here's why:

1. **MySQL's late support**: CHECK only became functional in MySQL 8.0.16 (2019). For decades before that, the MySQL ecosystem treated CHECK as "doesn't exist," and that inertia persists. Proposing to add CHECK constraints to an existing project often fails to gain team consensus.
2. **Poor ORM integration**: Most ORMs — Spring Data JPA, Django ORM, ActiveRecord — don't auto-generate CHECK constraints. You need to manage DDL manually or add them via migration tools (Flyway, Alembic, etc.), and this step is easy to skip.
3. **Unfriendly error messages**: When CHECK is violated, you get technical errors like `Check constraint 'chk_users_age' is violated`. These can't be shown to users, so you end up writing app-level validation anyway, leading to "why not just do everything in the app?"

**When you should use CHECK regardless**:

- **When direct SQL data modifications are frequent**: During operational `UPDATE` queries against production, app validation doesn't run. CHECK is the last line of defense.
- **When multiple services/batches write to the same table**: DB-level constraints are the most reliable way to ensure consistent validation across all entry points.
- **Domains where data integrity is a legal requirement** (finance, healthcare): "Bad data got in due to an app bug" is unacceptable — CHECK is mandatory.

> **Practical advice**: For new projects, add basic CHECKs like `price > 0`, `quantity >= 1`, `status IN (...)` from the start. Adding them later requires validating existing data first, which is far more cumbersome.

---

## 2. UNIQUE Constraints — "Only One of This Combination May Exist"

### 2.1 Single-Column UNIQUE

```sql
-- Email must be unique
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- Violation
INSERT INTO users (email) VALUES ('kim@email.com');
INSERT INTO users (email) VALUES ('kim@email.com');
-- ❌ ERROR: Duplicate entry 'kim@email.com' for key 'uq_users_email'
```

### 2.2 Composite UNIQUE

```sql
-- Same product can only appear once per order
ALTER TABLE order_items
    ADD CONSTRAINT uq_order_items_order_product
    UNIQUE (order_id, product_id);

-- user_id + provider must be unique (social login)
ALTER TABLE social_accounts
    ADD CONSTRAINT uq_social_provider
    UNIQUE (user_id, provider);
```

Use composite UNIQUE when you need to ask: **"Should this combination exist only once from a business perspective?"**

### 2.3 Partial UNIQUE (Conditional Uniqueness)

"Email should be unique only among non-deleted users" — this comes up frequently in practice.

```sql
-- PostgreSQL: Partial index for conditional UNIQUE
CREATE UNIQUE INDEX uq_users_email_active
    ON users (email) WHERE deleted_at IS NULL;

-- Deleted users can have duplicate emails
-- Only active users enforce email uniqueness
```

MySQL doesn't support partial indexes. Workaround:

```sql
-- MySQL: Generated Column + UNIQUE workaround
ALTER TABLE users
    ADD COLUMN email_unique_key VARCHAR(320)
    GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN email ELSE NULL END
    ) STORED;

ALTER TABLE users ADD CONSTRAINT uq_users_email_active UNIQUE (email_unique_key);
-- NULL is allowed as duplicate in UNIQUE, so deleted users → NULL → duplicates OK
-- Active users → email value → no duplicates
```

> **The MySQL Generated Column + UNIQUE workaround is admittedly hacky.** But "prevent email duplicates among active users" is an extremely common requirement in soft-delete systems. PostgreSQL handles it cleanly with a single partial index.

### 2.4 UNIQUE and NULL

As covered in [Part 1](/blog/en/rdb-schema-basics-guide), NULL behavior with UNIQUE varies by database.

| DB | Allows multiple NULLs |
|----|:---:|
| MySQL | ✅ (multiple NULLs allowed) |
| PostgreSQL 14 and below | ✅ |
| PostgreSQL 15+ | Configurable (`NULLS NOT DISTINCT`) |
| SQL Server | ❌ (only one NULL) |

```sql
-- PostgreSQL 15+: Allow only one NULL
CREATE TABLE users (
    email VARCHAR(320),
    CONSTRAINT uq_users_email UNIQUE NULLS NOT DISTINCT (email)
);
```

### 2.5 UNIQUE Index vs UNIQUE Constraint

```sql
-- Method 1: As a constraint
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- Method 2: As a unique index
CREATE UNIQUE INDEX idx_users_email ON users (email);
```

Both create a unique index internally. The differences:

| Aspect | UNIQUE Constraint | UNIQUE Index |
|--------|:---:|:---:|
| Can be referenced by FK | ✅ | Depends on DB |
| `WHERE` condition (partial) | ❌ | ✅ (PostgreSQL) |
| Semantic clarity | "Business rule" | "Performance optimization" |

#### FK Reference — Behavior Varies by DB

The SQL standard specifies that a FK can only reference a PRIMARY KEY or a UNIQUE **constraint** — not a unique index. However, real-world database engines interpret this rule differently:

- **PostgreSQL / MySQL / SQL Server**: These engines allow FK references to unique indexes. Their stance is "if uniqueness is guaranteed, that's good enough," so whether the uniqueness comes from a constraint or an index doesn't matter — FK creation succeeds either way.
- **Oracle**: Strictly requires a UNIQUE **constraint** to be declared. If only a unique index exists, you'll get `ORA-02270: no matching unique or primary key for this column-list`.

The bottom line: if a column might be referenced by a FK from another table, declare it as a `CONSTRAINT` rather than a unique index for portability and clarity. This prevents unexpected errors if you ever migrate databases or need to support multiple DB engines.

#### Partial Uniqueness — The Biggest Practical Difference

A UNIQUE constraint enforces uniqueness across **all rows** in the table. There's no way to attach a condition like "only check uniqueness among active rows." A UNIQUE index, on the other hand, supports a `WHERE` clause to implement **partial uniqueness**. This is where the two approaches diverge most in practice.

```sql
-- UNIQUE constraint: enforces uniqueness across ALL rows in the table
-- No condition can be attached, so even deleted rows are checked
ALTER TABLE users ADD CONSTRAINT uq_email UNIQUE (email);

-- UNIQUE index + WHERE: only rows matching the condition are checked (PostgreSQL)
-- Only active rows (deleted_at IS NULL) are subject to the uniqueness check
CREATE UNIQUE INDEX idx_users_active_email
    ON users (email)
    WHERE deleted_at IS NULL;
```

The classic use case is the **soft delete pattern**. Many services don't physically delete user rows on account deactivation — instead, they record a `deleted_at` timestamp. Now consider what happens when a deactivated user tries to re-register with the same email:

- **With only a UNIQUE constraint**: The deactivated row with `email = 'user@example.com'` still exists in the table, so inserting a new row with the same email triggers a duplicate error (`duplicate key value violates unique constraint`). To work around this, you'd need to mangle the email on deactivation (e.g., `user@example.com_deleted_1712345678`) — but this corrupts the original data.
- **With a partial unique index**: Thanks to the `WHERE deleted_at IS NULL` condition, deactivated rows (`deleted_at IS NOT NULL`) are completely excluded from the uniqueness check. So a new row with the same email inserts successfully as long as there's no duplicate among active rows. No need to mangle email values, so data integrity is preserved.

> Partial indexes are supported in **PostgreSQL**. MySQL does not support them, so to achieve a similar effect you'd need workarounds like adding an `is_active` column and creating a composite unique on `(email, is_active)`.

#### Semantic Difference — What the Schema Communicates

Functionally, both guarantee uniqueness. But they communicate different **intent** to anyone reading the schema:

- **CONSTRAINT**: Declares "this column's values must never be duplicated — it's a **business rule**." Appropriate for things like emails, order numbers, or tax IDs where the domain itself demands uniqueness. Another developer looking at the schema immediately understands "this is a business requirement."
- **INDEX**: Reads as "I'm indexing this column to **optimize query performance**." When someone sees a unique index, it's not immediately clear whether it exists for a business rule or purely for performance.

This distinction matters most six months later when a new team member reads the schema for the first time, or during code review. With a constraint, the question "can we drop this uniqueness?" is answered directly by the schema: "it's a business rule, so no." With only an index, making that judgment requires digging into documentation or commit history.

#### Practical Decision Guide

| Scenario | Choice | Reason |
|----------|--------|--------|
| Business uniqueness (email, SSN, etc.) | `UNIQUE CONSTRAINT` | Explicitly marks a business rule in the schema |
| Column will be referenced by FK | `UNIQUE CONSTRAINT` | Ensures DB portability (Oracle, etc.) |
| Soft delete + conditional uniqueness | `UNIQUE INDEX + WHERE` | Constraints cannot have WHERE conditions |
| Uniqueness with included columns | `UNIQUE INDEX` (with INCLUDE) | INCLUDE is an index-only feature |

**Practical rule**: If it's a business rule, use a constraint (`CONSTRAINT`). For conditional uniqueness or performance, use an index.

#### UNIQUE in Practice — The Most Widely Used Constraint

Unlike CHECK or FK, UNIQUE is **used in virtually 100% of production systems.** The reason is simple — without UNIQUE, you cannot fully prevent duplicate data at the app level alone.

```sql
-- App-level "email duplicate check" then INSERT flow:
-- 1. SELECT * FROM users WHERE email = 'a@b.com'  → not found
-- 2. INSERT INTO users (email) VALUES ('a@b.com')
-- But what if another request INSERTs the same email between 1 and 2? → Duplicate!
-- (Race Condition)
```

This **race condition** cannot be prevented by app-level validation alone. Another transaction can slip between the `SELECT` and `INSERT`. Only a DB UNIQUE constraint guarantees atomicity.

Common patterns in practice:
- **Email, login ID, phone number** → almost always UNIQUE
- **Order number, payment transaction ID** → UNIQUE is essential to prevent duplicate payments
- **API idempotency keys** → UNIQUE prevents duplicate request processing
- **Soft delete environments** → teams that know about partial unique indexes (`WHERE deleted_at IS NULL`) use them actively, while teams that don't often struggle with email-mangling workarounds

> **Practical advice**: If you ever think "this value shouldn't be duplicated," add a UNIQUE constraint without hesitation. No amount of app-level checks can withstand concurrency.

---

## 3. FK (Foreign Key) — The Double-Edged Sword of Referential Integrity

### 3.1 What FK Does

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- What FK guarantees:
-- 1. Any value in orders.user_id must exist in users.id
-- 2. Deleting a row from users is blocked if orders references it (default behavior)
```

```sql
-- Creating an order for a non-existent user
INSERT INTO orders (id, user_id) VALUES (1, 9999);
-- ❌ ERROR: foreign key constraint fails

-- Deleting a user who has orders
DELETE FROM users WHERE id = 1;
-- ❌ ERROR: Cannot delete or update a parent row
```

### 3.2 CASCADE Options

FK behavior is controlled by `ON DELETE` and `ON UPDATE`.

| Option | On parent delete | Best for |
|--------|-----------------|----------|
| `RESTRICT` (default) | Error — delete refused | Most cases (safe default) |
| `CASCADE` | Child rows deleted too | Parent-child sharing lifecycle (order → order items) |
| `SET NULL` | Child FK set to NULL | When child is meaningful without parent |
| `SET DEFAULT` | Child FK set to DEFAULT | Rarely used |
| `NO ACTION` | Nearly identical to RESTRICT | Validated at transaction end (PostgreSQL difference) |

```sql
-- CASCADE: Deleting an order also deletes its items
ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE;

-- SET NULL: Author leaves but posts remain
ALTER TABLE posts
    ADD CONSTRAINT fk_posts_author
    FOREIGN KEY (author_id) REFERENCES users(id)
    ON DELETE SET NULL;
```

> ⚠️ **CASCADE is convenient but dangerous.** A single `DELETE FROM users WHERE id = 1` could wipe out that user's orders, reviews, and comments. **In services using soft delete, CASCADE is almost never needed** — because you don't actually delete anything.

#### RESTRICT vs NO ACTION — The Subtle Difference

| Behavior | RESTRICT | NO ACTION |
|----------|----------|-----------|
| MySQL | Immediate check | Same as RESTRICT |
| PostgreSQL | Immediate check | **Checked at transaction end** |

In PostgreSQL, `NO ACTION` + `DEFERRABLE` allows flexible ordering within a transaction:

```sql
-- PostgreSQL: When you need flexible insertion order
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    DEFERRABLE INITIALLY DEFERRED;

-- Insert in any order within a transaction
BEGIN;
INSERT INTO orders (id, user_id) VALUES (1, 100);  -- user 100 doesn't exist yet, but OK
INSERT INTO users (id, name) VALUES (100, 'John');   -- created here
COMMIT;  -- FK validated at this point → passes!
```

### 3.3 Should You Use FKs or Not?

This is one of the most debated topics in practice.

#### When FKs are beneficial

```
✅ Domains where data integrity is critical (finance, healthcare, payments)
✅ Single DB, monolithic architecture
✅ Tables with stable reference relationships (users → orders)
✅ Teams with many junior developers (prevents mistakes)
```

#### When skipping FKs makes sense

```
⚠️ MSA with separate DBs per service (cross-DB FK is impossible)
⚠️ Tables with heavy INSERT/UPDATE traffic (FK validation = lookup on parent table every time)
⚠️ Frequent data migrations/ETL (FK enforces insertion order)
⚠️ Partitioned tables (MySQL doesn't allow FK on partitioned tables)
```

#### Performance Impact of FKs

With FKs, every INSERT/UPDATE triggers a lookup on the parent table's index to verify referential integrity.

```
[INSERT flow with FK]
1. Attempt INSERT into order_items
2. Look up orders PK index to verify order_id exists ← additional lookup
3. Look up products PK index to verify product_id exists ← additional lookup
4. Validation passes → execute INSERT

[Without FK]
1. Execute INSERT into order_items → done
```

| Scenario | FK performance impact |
|----------|:---:|
| Single-row INSERT | Negligible |
| Bulk INSERT (tens of thousands+) | **Noticeable** — longer transactions |
| Very large parent table | Index lookup cost increases |
| Thousands of writes per second | FK validation can become a bottleneck |

```sql
-- MySQL: Temporarily disable FK checks during bulk load
SET FOREIGN_KEY_CHECKS = 0;
LOAD DATA INFILE '/data/order_items.csv' INTO TABLE order_items ...;
SET FOREIGN_KEY_CHECKS = 1;
-- ⚠️ Must re-enable! And verify data consistency separately.
```

#### Maintaining Integrity Without FKs

Not using FKs doesn't mean "anything goes."

```
1. Application-level validation
   - Check parent existence before INSERT in the service layer
   - Pros: Flexible, custom error messages
   - Cons: Bypassable via direct SQL, migrations

2. Consistency verification batches
   - Periodically run queries to find orphaned data
   - Integrate with monitoring + alerts

3. CDC/event-based validation
   - When a parent is deleted, handle child data via events
```

```sql
-- Orphan detection query
SELECT oi.id, oi.order_id
FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id
WHERE o.id IS NULL;
-- If results appear → integrity is broken → alert!
```

#### Practical Decision Framework

```
Default choice           → Use FK (integrity is the baseline)
High-write environment   → Benchmark first (compare with/without FK)
MSA + separate DBs      → FK impossible → app validation + consistency batch
Partitioning (MySQL)    → FK impossible → app validation + consistency batch
```

> **Key takeaway**: Dropping FKs isn't "giving up on integrity" — it's **"moving the integrity responsibility from DB to app."** Only drop them when you're ready to bear that responsibility.

#### FK in Practice — The Most Divisive Constraint

FK is the constraint where **adoption varies most dramatically by team and architecture.**

**Environments that actively use FK**:
- Monolithic architecture + single DB (traditional web services)
- Domains where data consistency is a legal requirement (finance, healthcare, payments)
- Organizations with DBAs — DBAs generally advocate strongly for FKs

**Environments that don't (or can't) use FK**:
- MSA with per-service databases — physically impossible to create cross-DB FKs
- High-traffic services — FKs are often removed for write performance. Many large-scale internet companies' guidelines actually recommend against FKs
- Sharded DB environments — cross-shard FKs are impossible

**A pragmatic compromise**:
- Early-stage startups or small services → use FKs. Debugging data consistency issues costs far more than FK's performance overhead.
- When the service grows and FK becomes a bottleneck → benchmark and remove then. "Remove later" is much easier than "add later."
- If you remove FKs → you must build orphan data detection batches and monitoring alongside. Without FK and without monitoring, data silently rots.

> **Practical advice**: The answer to "should we use FKs?" is almost always **"yes, start with them."** If your scale is large enough for FK to cause performance problems, your team will likely be experienced enough to make this call on their own by then.

---

## 4. DEFAULT and Generated Columns — Auto-Filling Values

### 4.1 DEFAULT — Automatic Values for Omitted Fields

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Omitting status, retry_count, created_at applies DEFAULTs
INSERT INTO orders (id) VALUES (1);
-- status = 'PENDING', retry_count = 0, created_at = now
```

#### MySQL vs PostgreSQL DEFAULT Differences

| Feature | MySQL | PostgreSQL |
|---------|-------|------------|
| Function DEFAULT | Limited (`CURRENT_TIMESTAMP` is typical) | Almost any function |
| `ON UPDATE CURRENT_TIMESTAMP` | Supported (MySQL-specific) | Not supported → use trigger or app |
| Expression DEFAULT | MySQL 8.0.13+ (limited) | Freely available |

```sql
-- MySQL: Auto-update updated_at
CREATE TABLE orders (
    ...
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- PostgreSQL: Handle via trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4.2 Generated Columns — Auto-Computed from Other Columns

We briefly introduced these in [Part 2](/blog/en/rdb-normalization-guide)'s denormalization section. Here's a deeper look.

```sql
-- Auto-calculate order item subtotal
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    unit_price DECIMAL(15, 0) NOT NULL,
    quantity INT NOT NULL,
    subtotal DECIMAL(15, 0) GENERATED ALWAYS AS (unit_price * quantity) STORED
);

-- subtotal cannot be manually inserted/updated. The DB manages it.
INSERT INTO order_items (id, order_id, product_id, unit_price, quantity)
VALUES (1, 100, 200, 50000, 3);
-- subtotal = 150000 (automatic)
```

#### VIRTUAL vs STORED

| Type | Stored | Indexable | Performance |
|------|:---:|:---:|------|
| **VIRTUAL** | ❌ (computed on read) | MySQL: secondary indexes only | Saves storage, CPU on read |
| **STORED** | ✅ (persisted to disk) | All indexes | CPU on write, fast reads |

| DB | VIRTUAL | STORED |
|----|:---:|:---:|
| MySQL | ✅ | ✅ |
| PostgreSQL | ❌ (planned for 17) | ✅ |

```sql
-- MySQL: VIRTUAL (saves disk, computed on read)
ALTER TABLE order_items
    ADD COLUMN subtotal DECIMAL(15, 0)
    GENERATED ALWAYS AS (unit_price * quantity) VIRTUAL;

-- MySQL: STORED (persisted, indexable)
ALTER TABLE order_items
    ADD COLUMN subtotal DECIMAL(15, 0)
    GENERATED ALWAYS AS (unit_price * quantity) STORED;

-- PostgreSQL: STORED only
ALTER TABLE order_items
    ADD COLUMN subtotal DECIMAL(15, 0)
    GENERATED ALWAYS AS (unit_price * quantity) STORED;
```

#### When to Use Generated Columns

| Situation | Generated Column | Compute in app |
|-----------|:---:|:---:|
| Combining columns from the same table | ✅ | |
| Referencing values from other tables | | ✅ |
| Indexed computed values | ✅ (STORED) | |
| Simple display-only computations | ✅ (VIRTUAL, MySQL) | |
| Complex business logic | | ✅ |

**The biggest advantage of Generated Columns**: zero synchronization worries. When `unit_price` or `quantity` changes, `subtotal` updates automatically. Unlike denormalization, "forgetting to update" is impossible.

#### DEFAULT and Generated Columns in Practice

**DEFAULT is used in virtually every project.** Patterns like `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `status VARCHAR DEFAULT 'PENDING'`, `retry_count INT DEFAULT 0` are de facto standards. ORMs support DEFAULT well, and developers accept them without resistance. Not using DEFAULT is stranger than using it.

**Generated Columns still have low awareness.** Many developers don't know they exist, and even those who do may hesitate for reasons like:

- **ORM compatibility concerns**: Worries about JPA's `@Column` and Generated Columns working together. In practice, just setting `insertable = false, updatable = false` works fine, but it feels unfamiliar at first.
- **PostgreSQL's lack of VIRTUAL**: MySQL offers VIRTUAL for disk savings, but PostgreSQL only supports STORED (VIRTUAL planned for 17). Some teams are uncomfortable with the additional disk usage.
- **"We can compute it in the app"**: True, but when multiple services read the same table, every service must implement identical computation logic. Generated Columns let the DB guarantee consistency.

**Particularly useful real-world cases**:
- `subtotal = unit_price * quantity` — auto-computed order line subtotals
- `full_name = first_name || ' ' || last_name` — auto-generated full name for search
- `is_expired = (expire_date < CURRENT_DATE)` — auto expiry flag (MySQL VIRTUAL = zero disk space)
- Soft delete `active_email` trick (MySQL workaround for partial uniqueness)

> **Practical advice**: Always use DEFAULT. For Generated Columns, consider them whenever you have "a frequently queried value derived from columns in the same table." Especially if you're considering denormalization, check first whether a Generated Column can achieve the same effect without triggers or app logic.

---

## 5. Defensive Schema Design — Using the Schema to Prevent Invalid States

"We can validate in code, right?" is true, but **if the schema itself doesn't allow invalid states**, you eliminate bugs at the source.

### 5.1 Enforce State Transitions via Schema

```sql
-- ❌ Bad design: Contradictory states are possible
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    is_paid BOOLEAN NOT NULL DEFAULT FALSE,
    is_shipped BOOLEAN NOT NULL DEFAULT FALSE,
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE
);

-- This data can exist:
-- is_paid = TRUE, is_shipped = TRUE, is_cancelled = TRUE
-- Paid, shipped, AND cancelled? What does that even mean?
```

```sql
-- ✅ Good design: Single status column
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT chk_orders_status
        CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'))
);

-- Status is always exactly one value. Contradictions impossible.
```

> Using multiple boolean flags for state management creates **2^n possible combinations**. With 3 flags, that's 8 combinations. With 4, it's 16. Only 4–5 are typically valid. The rest are all bugs. **A single status column is definitively better.**

### 5.2 Protecting Active Data in Soft Delete

```sql
-- Email should be unique only among active users
-- PostgreSQL
CREATE UNIQUE INDEX uq_users_email_active
    ON users (email) WHERE deleted_at IS NULL;

-- MySQL (Generated Column workaround)
ALTER TABLE users
    ADD COLUMN active_email VARCHAR(320)
    GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN email ELSE NULL END
    ) STORED;

ALTER TABLE users ADD CONSTRAINT uq_users_active_email UNIQUE (active_email);
```

### 5.3 Preventing Overlapping Ranges

When event validity periods must not overlap:

```sql
-- PostgreSQL: EXCLUDE constraint (prevents range overlaps)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE promotions (
    id BIGINT PRIMARY KEY,
    product_id BIGINT NOT NULL,
    discount_rate DECIMAL(5, 2) NOT NULL,
    valid_during TSTZRANGE NOT NULL,
    CONSTRAINT no_overlapping_promotions
        EXCLUDE USING GIST (product_id WITH =, valid_during WITH &&)
);

-- Inserting overlapping promotions for the same product fails
INSERT INTO promotions VALUES (1, 100, 10.00, '[2026-04-01, 2026-04-30]');
INSERT INTO promotions VALUES (2, 100, 20.00, '[2026-04-15, 2026-05-15]');
-- ❌ ERROR: conflicting key value violates exclusion constraint
```

> MySQL doesn't have EXCLUDE constraints. You'll need app-level validation or triggers for this.

### 5.4 Protecting Numeric Ranges via Schema

```sql
-- Discount rate must be 0–100%
ALTER TABLE promotions
    ADD CONSTRAINT chk_discount_rate
    CHECK (discount_rate >= 0 AND discount_rate <= 100);

-- Stock cannot be negative
ALTER TABLE products
    ADD CONSTRAINT chk_stock_non_negative
    CHECK (stock >= 0);

-- Order quantity must be at least 1
ALTER TABLE order_items
    ADD CONSTRAINT chk_quantity_positive
    CHECK (quantity >= 1);
```

Without these CHECKs, data like **150% discount, -3 stock, quantity 0** can slip in. The app catches it, sure — but when someone modifies data via direct SQL, app validation is powerless.

### 5.5 Using NOT NULL to Prevent "Empty" States

```sql
-- ❌ Nullable: An order with NULL amount? NULL customer?
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT,         -- NULL means we don't know whose order
    total_amount DECIMAL,   -- NULL means we don't know the amount
    status VARCHAR(20)      -- NULL means we don't know the status
);

-- ✅ NOT NULL enforced: Orders must have these values
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Principle**: When creating a column, always ask "Can a row exist without this value?" If the answer is "no," use `NOT NULL`.

#### Defensive Schema in Practice — The Gap Between Ideal and Reality

Defensive schema design falls into the "nice to know, but few teams actually apply it" category in practice.

**What gets adopted easily**:
- `NOT NULL` — the most basic defense, and ORMs make it easy with `nullable = false`. The most widely and easily applied defensive pattern in practice.
- `status VARCHAR + CHECK` — using a status column instead of boolean flags is standard in experienced teams. Though teams split on whether to add CHECK or validate only in the app.
- Basic CHECKs like `price > 0`, `quantity >= 1` — nearly mandatory in finance/payment domains.

**What rarely gets adopted**:
- `EXCLUDE` constraints (range overlap prevention) — PostgreSQL-only, requires the `btree_gist` extension, and most developers don't know it exists. Incredibly powerful if you know it, but in practice, most teams handle this at the app level or with triggers.
- Complex CHECKs (multi-column validation) — when business logic changes frequently, CHECK requires `ALTER TABLE` too, which adds burden. Rules that change often are more practical to handle in the app.

**The key is to decide based on "what happens if we don't do this"**:
- Without NOT NULL → NULLs sneak in and create NullPointerException landmines across the app → **must use**
- Without stock CHECK → negative inventory breaks billing → in finance/e-commerce, **must use**
- Without EXCLUDE → promotion period overlaps → adopt if business impact is high, otherwise handle in app

> **Practical advice**: NOT NULL is baseline, simple CHECKs like `price > 0` should be added wherever possible, and advanced features like EXCLUDE should be introduced when you're convinced "without this, production incidents will happen."

---

## 6. Constraint Naming Conventions

If you don't name constraints, the DB auto-generates names. The problem is auto-names like `SYS_C007234` are meaningless — when an error occurs, you can't tell which constraint was violated.

| Constraint | Naming Pattern | Example |
|-----------|---------------|---------|
| PRIMARY KEY | `pk_table` | `pk_orders` |
| FOREIGN KEY | `fk_child_parent` | `fk_orders_users` |
| UNIQUE | `uq_table_column` | `uq_users_email` |
| CHECK | `chk_table_description` | `chk_orders_status` |
| DEFAULT | Usually unnamed | — |

```sql
-- ❌ Without a name
ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);
-- Error: Cannot delete or update a parent row: a foreign key constraint fails
-- (`mydb`.`orders`, CONSTRAINT `orders_ibfk_1`, ...)  ← What is this?

-- ✅ With a name
ALTER TABLE orders ADD CONSTRAINT fk_orders_users
    FOREIGN KEY (user_id) REFERENCES users(id);
-- Error: ... CONSTRAINT `fk_orders_users` ...  ← Immediately clear
```

---

## 7. MySQL vs PostgreSQL — Constraint Feature Comparison

| Feature | MySQL | PostgreSQL |
|---------|-------|------------|
| **CHECK** | 8.0.16+ (ignored in earlier versions) | Supported from the start |
| **Partial indexes** | Not available | `CREATE INDEX ... WHERE condition` |
| **EXCLUDE constraints** | Not available | Range overlap prevention |
| **DEFERRABLE FK** | Not supported | Supported (`INITIALLY DEFERRED`) |
| **Generated Columns** | VIRTUAL + STORED | STORED only (VIRTUAL planned for 17) |
| **NULLS NOT DISTINCT** | Not supported | 15+ |
| **ON UPDATE CURRENT_TIMESTAMP** | Supported (MySQL-specific) | Not supported → trigger needed |
| **FK + Partitioning** | FK not allowed on partitioned tables | Supported (12+) |

> **PostgreSQL is clearly stronger on the constraints front.** Partial indexes, EXCLUDE constraints, DEFERRABLE FKs, NULLS NOT DISTINCT — many features MySQL lacks. If you're on MySQL, you'll need to compensate at the app level.

---

## Summary

| Topic | Key Principle |
|-------|--------------|
| **CHECK** | Enforce simple value ranges with DB CHECK. Double up with app validation. Verify MySQL 8.0.16+ |
| **UNIQUE** | Business uniqueness must be guaranteed at the DB level. Use partial UNIQUE for soft-delete environments |
| **FK** | Default is "use it." Not using it means moving integrity responsibility to the app — be prepared |
| **DEFAULT / Generated** | DEFAULTs for omitted values, Generated Columns for computed values. Zero sync worries |
| **Defensive design** | Status columns over boolean flags, NOT NULL by default, make invalid states unrepresentable |

**Constraints aren't overhead — they're "validation you don't have to code."** A single CHECK can replace 10 `if` statements. A single FK can replace an orphan-detection batch job. Spending 10 extra minutes upfront is 100x cheaper than cleaning up broken data integrity in production.

### Real-World Adoption — At a Glance

| Constraint | Adoption | Reality |
|-----------|:---:|--------|
| **NOT NULL** | ★★★★★ | Used by virtually every team. Not using it is the anomaly |
| **DEFAULT** | ★★★★★ | `created_at`, `status` defaults are de facto standard |
| **UNIQUE** | ★★★★☆ | Essential for core columns. The only way to prevent race condition duplicates |
| **FK** | ★★★☆☆ | Actively used in monolith/small-scale; often skipped in MSA/high-traffic |
| **CHECK** | ★★☆☆☆ | Low awareness due to MySQL's late support + ORM gaps. Active in finance/payments |
| **Generated Column** | ★★☆☆☆ | Many developers don't know it exists. Useful when known, but rare adoption |
| **EXCLUDE** | ★☆☆☆☆ | PostgreSQL-only + extremely low awareness. Only used by teams in the know |

**"Should I use all of them?" — A pragmatic answer**:

```
[Essential] NOT NULL + DEFAULT + UNIQUE   → Problems arise immediately without these
[Recommended] FK + basic CHECK (price > 0) → Noticeably safer with these
[Optional] Generated Column + EXCLUDE     → Powerful if you know them, but require team buy-in
```

Constraints are far easier to add at the beginning than later. Adding them later requires validating existing data first and migrating non-compliant records. **"Let's skip it for now and add later if needed" almost always means "never added."**

Next up: **Relationship Design Patterns** — decision criteria for 1:1 / 1:N / N:M, self-referencing, and polymorphic relationships.
