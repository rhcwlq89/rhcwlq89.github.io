---
title: "RDB Design Series Part 7: Anti-Patterns and Temporal Data Design — EAV, God Table, Temporal Table, Event Sourcing"
description: "Covers repeatedly failing schema design patterns. EAV, God Table, Polymorphic Association, Soft Delete traps, and then the patterns you should actively use — Temporal Tables, Slowly Changing Dimensions, and Event Sourcing basics. Knowing what NOT to do is a design skill."
pubDate: "2026-04-16T18:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Anti-pattern", "Temporal Data", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbAntipatternTemporalDesignGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-index-join-strategy-guide), we covered index design and JOIN strategies. At this point, you have the tools for "how to design well" — naming, normalization, constraints, relationship patterns, and indexes.

But knowing good design isn't enough. **Without the ability to recognize bad design**, you can't flag problems in code reviews, and you have no criteria for refactoring legacy schemas.

This post covers two things:

1. **Anti-patterns** — design patterns that repeatedly fail. We cover "why they're bad" and "what the alternatives are."
2. **Temporal data design** — patterns for expressing "when data is valid." Unlike anti-patterns, these are patterns you **should actively use.**

---

## 1. EAV (Entity-Attribute-Value) Anti-Pattern

### 1.1 What Is EAV?

A pattern that stores attributes as **rows** rather than columns.

```sql
-- Normal design
CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200),
    price DECIMAL(10,2),
    weight DECIMAL(8,2),
    color VARCHAR(50)
);

-- EAV design
CREATE TABLE product_attributes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,  -- 'color', 'weight', 'price', etc.
    attribute_value TEXT NOT NULL,          -- all values as strings
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

EAV data example:

| product_id | attribute_name | attribute_value |
|:---:|---|---|
| 1 | color | red |
| 1 | weight | 2.5 |
| 1 | price | 29900 |
| 2 | color | blue |
| 2 | size | XL |

### 1.2 Why Do People Choose EAV?

- "Each product has different attributes, so we can't fix the columns"
- "We don't want to ALTER TABLE every time a new attribute is added"
- "We need a flexible structure"

The reasons **sound** reasonable. But the cost is enormous.

### 1.3 Problems with EAV

**1) No type safety**

All values go into `TEXT`. `"abc"` in the `price` field? The DB can't prevent it. CHECK constraints can't be applied either.

**2) Constraints are impossible**

```sql
-- Possible in normal design
ALTER TABLE products ADD CONSTRAINT chk_price CHECK (price > 0);

-- In EAV? You'd need to apply it only where attribute_name = 'price'
-- Conditional CHECK like this is impossible in most DBs
```

NOT NULL, UNIQUE, FK — all column-level constraints become useless.

**3) Query hell**

Finding "red products weighing 2kg or more":

```sql
-- Normal design
SELECT * FROM products WHERE color = 'red' AND weight >= 2.0;

-- EAV
SELECT p.id
FROM products p
JOIN product_attributes a1 ON p.id = a1.product_id
    AND a1.attribute_name = 'color' AND a1.attribute_value = 'red'
JOIN product_attributes a2 ON p.id = a2.product_id
    AND a2.attribute_name = 'weight' AND CAST(a2.attribute_value AS DECIMAL) >= 2.0;
```

One JOIN per attribute. Five conditions = five JOINs. **Both performance and readability collapse.**

**4) Aggregation is painful**

```sql
-- Normal design: average price
SELECT AVG(price) FROM products;

-- EAV: CAST required, errors on bad data
SELECT AVG(CAST(attribute_value AS DECIMAL))
FROM product_attributes
WHERE attribute_name = 'price';
```

### 1.4 When EAV Is Acceptable

EAV is the **only option** in some cases:

- **Marketplaces with hundreds of attributes varying by product**: electronics have CPU/RAM/resolution, clothing has material/size/season — you can't make columns for all of them
- **User-defined fields**: SaaS where customers add their own fields
- **Configuration stores**: key-value is the natural shape

Even then, the principle is **core attributes as columns, variable attributes only in EAV.**

### 1.5 Alternative: JSON Columns

MySQL 5.7+ and PostgreSQL 9.4+ support JSON. You get EAV's flexibility in a single table.

```sql
CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    price DECIMAL(10,2) NOT NULL,          -- core attributes as columns
    attributes JSONB NOT NULL DEFAULT '{}'  -- variable attributes as JSON
);

-- Data examples
INSERT INTO products (id, name, price, attributes) VALUES
(1, 'Laptop', 1290000, '{"cpu": "M3", "ram": "16GB", "screen": "14inch"}'),
(2, 'T-Shirt', 29900, '{"size": "XL", "material": "cotton", "season": "summer"}');

-- Query: JSON index (PostgreSQL)
CREATE INDEX idx_products_cpu ON products USING GIN (attributes);
SELECT * FROM products WHERE attributes @> '{"cpu": "M3"}';
```

| Comparison | EAV | JSON Column |
|------------|-----|-------------|
| Flexibility | ✅ High | ✅ High |
| Query complexity | ❌ JOIN hell | ✅ Single table |
| Indexing | ❌ Difficult | ✅ GIN / virtual columns |
| Type validation | ❌ Impossible | ⚠️ App-level validation needed |
| DB compatibility | ✅ Anywhere | ⚠️ Full support only MySQL/PG |

> **Recommendation**: Core attributes as regular columns + variable attributes as JSON. EAV is a last resort.

---

## 2. God Table Anti-Pattern

### 2.1 What Is a God Table?

A pattern that crams **all domains' data** into a single table. Also called a "universal table."

```sql
-- Typical God Table
CREATE TABLE entities (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    type VARCHAR(50) NOT NULL,         -- 'user', 'product', 'order', 'review'
    name VARCHAR(200),
    email VARCHAR(200),                -- only used for users
    price DECIMAL(10,2),               -- only used for products
    quantity INT,                       -- only used for orders
    rating INT,                         -- only used for reviews
    parent_id BIGINT,                  -- self-reference (connects anything)
    data1 TEXT,                         -- generic field 1
    data2 TEXT,                         -- generic field 2
    data3 TEXT,                         -- generic field 3
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 Symptoms

Signs you have a God Table:

- A `type` or `category` column distinguishes row types
- More than half the columns are **NULL in most rows**
- Generic columns like `data1`, `data2`, `extra_info` exist
- The table is named something abstract like `entities`, `items`, `objects`, `records`
- New features add columns to this table

### 2.3 Problems

**1) NULL hell**

For `type = 'user'` rows, `price`, `quantity`, `rating` are all NULL. A table where 70% is NULL is painful to read and maintain.

**2) Constraints are powerless**

```sql
-- "Product price must be greater than 0"?
-- You want it only when type = 'product'...
ALTER TABLE entities ADD CONSTRAINT chk_price CHECK (price > 0);
-- → type = 'user' rows have NULL price — is that OK?

-- "User email must be UNIQUE"?
-- UNIQUE only for type = 'user' rows — not directly possible in most DBs
```

PostgreSQL partial indexes can work around this, but the need for workarounds is itself a signal of bad design.

**3) Performance degradation**

All domains' data in one table means:

- Table size is abnormally large
- Indexes can't be optimized per domain
- `WHERE type = 'user'` must be appended to every query

### 2.4 Solution: Split by Domain

```sql
-- Instead of a God Table
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

Domain-specific tables allow **proper NOT NULL, CHECK, UNIQUE, FK** constraints. Constraints are documentation — see [Part 3](/blog/en/rdb-constraints-integrity-guide).

---

## 3. Polymorphic Association Anti-Pattern

### 3.1 What Is Polymorphic Association?

Representing "comments can belong to posts, products, or reviews" in a single table.

```sql
-- Polymorphic Association
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    commentable_type VARCHAR(50) NOT NULL,  -- 'Post', 'Product', 'Review'
    commentable_id BIGINT NOT NULL,         -- PK of that type
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Rails' `belongs_to :commentable, polymorphic: true` is the classic example. It's convenient in ORMs, but **problematic at the DB level.**

### 3.2 Problems

**1) No FK possible**

```sql
-- The DB doesn't know if commentable_id refers to posts.id or products.id
-- This FK can't be created
ALTER TABLE comments
    ADD FOREIGN KEY (commentable_id) REFERENCES ???(id);
```

The reference target changes based on `commentable_type`, so **the DB can't guarantee referential integrity.** Delete a post and orphan comments remain.

**2) Conditional JOINs**

```sql
-- Joining comments with their source
SELECT c.*, p.title
FROM comments c
LEFT JOIN posts p ON c.commentable_type = 'Post' AND c.commentable_id = p.id
LEFT JOIN products pr ON c.commentable_type = 'Product' AND c.commentable_id = pr.id
LEFT JOIN reviews r ON c.commentable_type = 'Review' AND c.commentable_id = r.id;
```

Each new type adds another LEFT JOIN.

**3) Poor index efficiency**

Even with a `(commentable_type, commentable_id)` composite index, `commentable_type` has extremely low cardinality, reducing effectiveness.

### 3.3 Alternative 1: Per-Type FK Columns (Exclusive Belongs-To)

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
    -- Exactly one must be NOT NULL
    CONSTRAINT chk_one_parent CHECK (
        (post_id IS NOT NULL)::INT +
        (product_id IS NOT NULL)::INT +
        (review_id IS NOT NULL)::INT = 1
    )
);
```

FKs guarantee referential integrity. The downside: more types = more NULL columns.

> In MySQL, use `(post_id IS NOT NULL) + (product_id IS NOT NULL) + (review_id IS NOT NULL) = 1` instead of `::INT` casting. CHECK constraints are supported in MySQL 8.0.16+.

### 3.4 Alternative 2: Per-Type Junction Tables

```sql
-- Comment body
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Junction tables
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

New types just add new tables, and FKs are always precise. More tables is the trade-off, but **data integrity is guaranteed.**

### 3.5 Alternative 3: Shared Parent Table (Inheritance)

```sql
-- Common parent
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

-- Comments reference the parent
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    commentable_item_id BIGINT NOT NULL REFERENCES commentable_items(id),
    body TEXT NOT NULL
);
```

FK targets `commentable_items`, ensuring referential integrity. The downside: you must INSERT into the parent table first.

### 3.6 Which Alternative to Choose?

| Scenario | Recommendation |
|----------|---------------|
| 2-3 types, fixed | Alternative 1 (Exclusive FK) — simple, clear constraints |
| 4+ types or likely to grow | Alternative 2 (Junction tables) — good extensibility |
| Types share many common attributes | Alternative 3 (Shared parent) — natural inheritance |
| ORM compatibility is the top priority | Keep Polymorphic + app-level validation — understand the trade-off |

---

## 4. The Soft Delete Trap

### 4.1 What Is Soft Delete?

Instead of actually deleting a row, you record the deletion time in a `deleted_at` column.

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL,
    name VARCHAR(100) NOT NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL  -- NULL = active, has value = deleted
);

-- "Delete"
UPDATE users SET deleted_at = NOW() WHERE id = 1;

-- Always filter on queries
SELECT * FROM users WHERE deleted_at IS NULL;
```

### 4.2 Why People Use It

- "I want to recover if something is accidentally deleted"
- "I need audit logs"
- "FK references prevent physical deletion"
- "I want to analyze deleted data too"

The reasons are valid. But **the problems Soft Delete creates are equally serious.**

### 4.3 Problems

**1) Every query needs a WHERE clause**

```sql
-- Active users
SELECT * FROM users WHERE deleted_at IS NULL;

-- Active users' orders
SELECT o.* FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.deleted_at IS NULL AND o.deleted_at IS NULL;

-- Miss it anywhere and deleted data leaks through
```

Ten tables means `deleted_at IS NULL` on every JOIN. **One omission = a bug.**

**2) UNIQUE constraints break**

```sql
-- Email is UNIQUE, but what about deleted users?
-- 1. user@test.com account deleted (deleted_at = '2026-01-01')
-- 2. New user tries to register with user@test.com
-- → UNIQUE violation! The deleted row is still in the index
```

Partial indexes work around this (PostgreSQL), but MySQL has no clean solution:

```sql
-- PostgreSQL: UNIQUE only on active rows
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE deleted_at IS NULL;

-- MySQL workaround: include deleted_at in UNIQUE (imperfect)
CREATE UNIQUE INDEX uq_users_email ON users (email, deleted_at);
-- → Two deletions of the same email? Different deleted_at values, so OK...
-- but doesn't prevent active row duplicates
```

**3) Index inefficiency**

Active data is 5% of the table, but indexes cover 100%. Deleted rows accumulate over time, bloating indexes.

### 4.4 Alternatives

**Alternative 1: Archive Table**

```sql
-- Active table
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

-- Archive table (same structure + deletion metadata)
CREATE TABLE users_archive (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL,
    name VARCHAR(100) NOT NULL,
    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_by VARCHAR(100)  -- who deleted it
);

-- "Delete" = move
BEGIN;
INSERT INTO users_archive SELECT *, NOW(), 'admin' FROM users WHERE id = 1;
DELETE FROM users WHERE id = 1;
COMMIT;
```

The active table stays clean. No UNIQUE issues, no WHERE clauses needed.

**Alternative 2: Status Column + Partial Index**

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(200) NOT NULL,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'))
);

-- UNIQUE only for active users (PostgreSQL)
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE status = 'ACTIVE';
```

More **explicit** than `deleted_at`. Can express intermediate states like "suspended" or "deactivated" — not just deleted.

| Comparison | Soft Delete (deleted_at) | Archive Table | Status Column |
|------------|------------------------|---------------|---------------|
| Query complexity | ❌ Always add WHERE | ✅ Not needed | ⚠️ WHERE needed but explicit |
| UNIQUE | ❌ Broken | ✅ No issues | ⚠️ Partial index needed |
| Recovery ease | ✅ One UPDATE | ⚠️ INSERT + DELETE | ✅ One UPDATE |
| Audit trail | ⚠️ Only timestamp | ✅ Detailed in separate table | ⚠️ Change history needs separate table |

---

## 5. Temporal Data Design

From here on, these aren't anti-patterns — they're patterns you **should actively use.**

### 5.1 Problem: What Happens When You Only Store "Now"

```sql
-- What happens when a product price changes?
UPDATE products SET price = 39900 WHERE id = 1;
-- → The previous price (29900) is gone forever

-- Need to show "the price at the time of purchase" on last month's order?
-- → Impossible. No price history exists.
```

In [Part 5](/blog/en/rdb-domain-schema-design-guide), we covered the **snapshot pattern** for storing prices at order time. Temporal Data is a more **general approach** — embedding data validity periods directly into the schema.

### 5.2 Validity Period Pattern (valid_from / valid_to)

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

**Current price query:**

```sql
SELECT price FROM product_prices
WHERE product_id = 1 AND NOW() BETWEEN valid_from AND valid_to;
```

**Point-in-time price query:**

```sql
-- Price as of February 1, 2026
SELECT price FROM product_prices
WHERE product_id = 1 AND '2026-02-01' BETWEEN valid_from AND valid_to;
```

### 5.3 Preventing Overlaps

Overlapping validity periods mean "two current prices" — a data integrity problem that must be prevented at the DB level.

**PostgreSQL: Range Types + EXCLUDE Constraints**

PostgreSQL can prevent overlaps **at the DB level** using range types and EXCLUDE constraints:

```sql
CREATE TABLE product_prices (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id BIGINT NOT NULL REFERENCES products(id),
    price DECIMAL(10,2) NOT NULL,
    valid_during TSTZRANGE NOT NULL,
    -- Error if periods overlap for the same product_id
    CONSTRAINT no_overlap EXCLUDE USING GIST (
        product_id WITH =,
        valid_during WITH &&
    )
);

-- Usage
INSERT INTO product_prices (product_id, price, valid_during) VALUES
(1, 29900, '[2026-01-01, 2026-03-15)'),
(1, 34900, '[2026-03-15, 2026-04-01)'),
(1, 39900, '[2026-04-01,)');  -- no upper bound = currently valid

-- Overlapping period insert → error
INSERT INTO product_prices (product_id, price, valid_during) VALUES
(1, 25000, '[2026-02-01, 2026-05-01)');
-- ERROR: conflicting key value violates exclusion constraint "no_overlap"
```

> `[` means inclusive (>=), `)` means exclusive (<). `[2026-01-01, 2026-03-15)` means from January 1st to before March 15th.

**MySQL: Triggers or App-Level Validation**

MySQL lacks Range Types, so use `valid_from` / `valid_to` columns and handle overlap prevention in triggers or application code.

```sql
-- Check for overlap before insert (app level)
SELECT COUNT(*) FROM product_prices
WHERE product_id = 1
AND valid_from < '2026-05-01'  -- new row's valid_to
AND valid_to > '2026-02-01';   -- new row's valid_from
-- COUNT > 0 means overlap → reject insert
```

### 5.4 Index Strategy

```sql
-- MySQL: valid_from, valid_to column approach
CREATE INDEX idx_prices_lookup
ON product_prices (product_id, valid_from, valid_to);

-- PostgreSQL: GiST index (when using Range Types)
CREATE INDEX idx_prices_lookup
ON product_prices USING GIST (product_id, valid_during);
```

If you frequently query only currently valid rows, consider a partial index:

```sql
-- PostgreSQL: index only currently valid rows
CREATE INDEX idx_prices_current
ON product_prices (product_id)
WHERE upper(valid_during) IS NULL OR upper(valid_during) > NOW();
```

### 5.5 Real-World Use Cases for Temporal Data

| Domain | Temporal Data | Why It's Needed |
|--------|--------------|----------------|
| **Pricing** | Product price change history | Verify "price at time of purchase" on past orders |
| **Org charts** | Department assignment history | "Was this person on this team at this point last year?" |
| **Insurance/Contracts** | Terms version validity periods | Apply the terms that were active at contract signing |
| **Exchange rates** | Daily rates | Calculate converted amounts for specific dates |
| **Permissions** | Role grant/revoke history | "Did they have this permission at that time?" for audits |

---

## 6. Slowly Changing Dimension (SCD)

SCD originated in data warehousing, but it's **also useful in OLTP for managing master data changes.**

### 6.1 Type 1: Overwrite

Discard the old value and **replace with the latest.**

```sql
-- When a customer's address changes
UPDATE customers SET address = 'New Address' WHERE id = 1;
```

- **Pros**: Simple. Always current data.
- **Cons**: No history. Can't determine "previous address."
- **Good for**: Typo corrections, attributes where history doesn't matter

### 6.2 Type 2: Add New Row (Validity Period)

Close the existing row and **insert a new one.** Same as the Temporal Data pattern above.

```sql
-- Close existing row
UPDATE customers
SET valid_to = NOW(), is_current = FALSE
WHERE id = 1 AND is_current = TRUE;

-- Insert new row
INSERT INTO customers (id, name, address, valid_from, valid_to, is_current)
VALUES (1, 'John', 'New Address', NOW(), '9999-12-31', TRUE);
```

- **Pros**: Complete history preservation. Point-in-time queries possible.
- **Cons**: Rows keep growing. Current row queries need `is_current = TRUE` filter.
- **Good for**: Prices, terms, org charts — data where history matters

### 6.3 Type 3: Previous/Current Columns

Add `previous_` columns to preserve **only the most recent prior value.**

```sql
CREATE TABLE customers (
    id BIGINT PRIMARY KEY,
    address VARCHAR(200) NOT NULL,
    previous_address VARCHAR(200),           -- previous address
    address_changed_at TIMESTAMP             -- last change timestamp
);
```

- **Pros**: Simple. Preserves prior value without extra rows.
- **Cons**: Only preserves **one prior value.** Anything before that is lost.
- **Good for**: "Only need the previous value" cases (rare in practice)

### 6.4 Which Type to Choose?

| Requirement | Recommendation |
|-------------|---------------|
| No history needed, always latest | Type 1 (Overwrite) |
| Full change history required | Type 2 (Validity period) |
| Only need one previous value | Type 3 (Previous/current columns) |
| Very high change frequency | Type 1 + separate history table |

> In practice, **Type 1 + separate audit table** is the most common combination. The main table always holds the current state, and change history accumulates in a `_history` table.

---

## 7. Event Sourcing Schema

### 7.1 Traditional CRUD vs Event Sourcing

**CRUD**: Directly modify current state.

```sql
-- Change balance
UPDATE accounts SET balance = balance - 10000 WHERE id = 1;
-- → Previous balance is gone
```

**Event Sourcing**: Don't modify state directly. Instead, record **events (facts that happened)** in order. Current state is derived by replaying events in sequence.

```sql
-- Store events
INSERT INTO account_events (account_id, event_type, amount, created_at) VALUES
(1, 'DEPOSIT',    100000, '2026-01-01 10:00:00'),
(1, 'WITHDRAW',    30000, '2026-01-15 14:00:00'),
(1, 'WITHDRAW',    10000, '2026-02-01 09:00:00');

-- Current balance = replay events
-- 100000 - 30000 - 10000 = 60000
```

### 7.2 Event Table Design

```sql
CREATE TABLE events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    aggregate_type VARCHAR(50) NOT NULL,   -- 'Account', 'Order', etc.
    aggregate_id BIGINT NOT NULL,          -- ID of the entity
    event_type VARCHAR(100) NOT NULL,      -- 'DEPOSIT', 'WITHDRAW', 'ORDER_PLACED'
    event_data JSON NOT NULL,              -- event detail data
    version INT NOT NULL,                  -- optimistic concurrency control
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (aggregate_type, aggregate_id, version)  -- prevent duplicate versions
);
```

**Core principles:**

- Events are **immutable.** INSERT only — no UPDATE or DELETE.
- `version` controls **ordering and concurrency.** Concurrent writes to the same aggregate fail on version conflict.
- `event_data` is JSON, allowing different structures per event type.

### 7.3 Snapshot Optimization

With tens of thousands of events, replaying from the beginning every time is inefficient. Store **snapshots** periodically.

```sql
CREATE TABLE snapshots (
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    version INT NOT NULL,              -- version at snapshot time
    state JSON NOT NULL,               -- complete state at that point
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (aggregate_type, aggregate_id)
);
```

**State retrieval flow:**

```
1. Load snapshot → state at version 50 (balance: 500000)
2. Query events → replay only versions 51 through current
3. Derive final state
```

Without snapshots, you replay from event #1. With snapshots, you only replay **the delta.**

### 7.4 Event Sourcing Trade-offs

| Aspect | CRUD | Event Sourcing |
|--------|------|---------------|
| Current state query | ✅ One SELECT | ⚠️ Replay needed (mitigated by snapshots) |
| History tracking | ❌ Separate audit table needed | ✅ Events ARE the history |
| Debugging | ⚠️ "How did it get to this state?" | ✅ Read events in order |
| Complexity | ✅ Simple | ❌ High (event design, replay logic, snapshots) |
| Storage | ✅ Current state only | ❌ All events accumulate |
| Queries | ✅ Standard SQL | ❌ Aggregation difficult (may need CQRS) |

### 7.5 When Event Sourcing Fits

- **Finance**: Every transaction is auditable. Must prove "why this balance."
- **Logistics**: Shipment status tracking. Events themselves are business data.
- **Collaboration tools**: Document edit history. Undo functionality.

**When it doesn't fit:**

- Services that are mostly simple CRUD
- Domains with no history tracking requirements
- Teams with no event sourcing experience (steep learning curve)

> **Practical recommendation**: Most services are fine with CRUD + audit table. Only consider event sourcing when **history IS the business logic.** Adopting it because "it looks cool" just explodes complexity.

---

## 8. Design Review Checklist

### 8.1 Anti-Pattern Check

- [ ] **Using EAV?** Are core attributes in columns and only variable attributes in JSON?
- [ ] **God Table present?** If a table uses a `type` column to distinguish row types, consider splitting
- [ ] **Polymorphic Association?** If `_type` + `_id` combinations exist without FK, review alternatives
- [ ] **Soft Delete burdening every query?** Consider archive table or status column transition

### 8.2 Temporal Data Check

- [ ] **UPDATing data that needs history?** Apply validity period pattern for prices, terms, permissions
- [ ] **Overlap prevented at DB level?** PostgreSQL: EXCLUDE constraint, MySQL: app-level validation
- [ ] **SCD type chosen deliberately?** Type 1 + audit table is appropriate for most cases

### 8.3 Event Sourcing Check

- [ ] **Is event sourcing truly needed?** First verify CRUD + audit table isn't sufficient
- [ ] **Snapshot strategy in place?** Have you considered replay performance when events reach tens of thousands?
- [ ] **Event schema versioning plan?** How will you maintain backward compatibility when event structures change?

---

## Summary

Core takeaways from this post:

1. **EAV looks flexible but sacrifices type safety, constraints, and query performance.** The alternative: core attributes as columns, variable attributes as JSON.
2. **God Tables neutralize all domain constraints.** Splitting by domain is the only solution.
3. **Polymorphic Association is a reference without FK.** Exclusive FK, junction tables, or shared parent tables can restore data integrity.
4. **Soft Delete looks simple but breaks UNIQUE constraints, causes query omissions, and creates index bloat.** Archive tables or status columns are cleaner.
5. **Temporal data design (valid_from/valid_to) adds a time axis to your data.** PostgreSQL's Range Types + EXCLUDE constraints are the most powerful tool.
6. **Event sourcing is powerful but complex.** Most services are fine with CRUD + audit tables — only consider it when history IS the business logic.

**"Knowing good design" and "recognizing bad design" are different skills.** You need the eyes to spot anti-patterns to catch problems in code reviews and see the path forward for legacy improvement. Hopefully this post helped develop that vision.

Next up: **RBAC permission system schema design** — role/permission tables, caching strategy, role hierarchies, and resource-level permissions.
