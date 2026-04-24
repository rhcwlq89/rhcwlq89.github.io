---
title: "RDB Design Series Part 8: Zero-Downtime Migration and Multi-Tenant Design — ALTER TABLE Traps, Expand-Contract, and Tenant Isolation Strategies"
description: "Changing schemas on a live service is as hard as designing them. ALTER TABLE lock traps, zero-downtime column changes with Expand-Contract, Flyway vs Liquibase, rollback strategies, and three multi-tenant schema strategies. The final part of the series."
pubDate: "2026-04-16T22:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Migration", "Multi-tenant", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbMigrationMultitenantGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-antipattern-temporal-design-guide), we covered anti-patterns and temporal data design. Through seven parts, we covered "how to design well and what to avoid."

But in reality, **no one creates a perfect schema from the start.** Requirements change, domains expand, and performance bottlenecks surface. Schemas will inevitably change.

The problem is that **changing schemas on a live service is dangerous.** A mistake can lock tables and freeze your service, leaving you in an unrecoverable state. "Designing well" is only half the battle — "changing designs safely" is equally important.

This post covers two areas:

1. **Schema migration** — ALTER TABLE traps, zero-downtime change patterns, migration tools, and rollback strategies
2. **Multi-tenant design** — schema strategies for isolating multiple customers' (tenants') data in a single system

---

## 1. ALTER TABLE Traps

### 1.1 Why Is ALTER TABLE Dangerous?

In development, ALTER TABLE finishes instantly. But on **production tables with tens of millions of rows**, it's a different story.

```sql
-- Development: 0.01 seconds
ALTER TABLE orders ADD COLUMN memo VARCHAR(500);

-- Production (orders: 50 million rows): minutes to tens of minutes
-- The table is locked during this time
```

The core problem is **locks.** While ALTER TABLE runs, other queries wait — effectively freezing your service.

### 1.2 MySQL's Online DDL

> **What is Online DDL?**
>
> "Online" here means **the service keeps serving traffic while the DDL is running.** Traditional (offline) DDL locks the entire table for the full duration of ALTER TABLE, blocking every read and write — which is why schema changes on large tables historically meant **scheduled maintenance windows.** Online DDL allows regular **DML (INSERT/UPDATE/DELETE/SELECT) to proceed concurrently** with the schema change, enabling zero-downtime modifications in production. Not every ALTER qualifies, though — whether an operation runs online depends on the combination of operation type, `ALGORITHM`, and `LOCK` options.

MySQL 5.6+ introduced Online DDL, allowing **some ALTER TABLE operations to run without locking the table.**

```sql
-- Control with ALGORITHM and LOCK options
ALTER TABLE orders ADD COLUMN memo VARCHAR(500),
    ALGORITHM=INPLACE, LOCK=NONE;
```

**ALGORITHM options:**

| ALGORITHM | Behavior | Characteristics |
|-----------|----------|----------------|
| **COPY** | Copies entire table to create a new one | Slow, requires 2x space. All DDL possible |
| **INPLACE** | Modifies the original table directly | Fast, but only some DDL operations |
| **INSTANT** | Only changes metadata (MySQL 8.0.12+) | Completes instantly. Very few DDL operations |

**LOCK options:**

| LOCK | DML Allowed | Description |
|------|-------------|-------------|
| **NONE** | ✅ Read/write both | Zero downtime. The goal of Online DDL |
| **SHARED** | ✅ Read only | Blocks writes |
| **EXCLUSIVE** | ❌ Blocks all | Effectively service outage |

**Operations supporting Online DDL (MySQL 8.0):**

| Operation | ALGORITHM | LOCK=NONE |
|-----------|-----------|-----------|
| Add column (at end) | INSTANT | ✅ |
| Drop column | INPLACE | ✅ |
| Rename column | INPLACE | ✅ |
| Extend VARCHAR length | INPLACE | ✅ |
| Add index | INPLACE | ✅ |
| Drop index | INPLACE | ✅ |
| Change column type | COPY | ❌ |
| Reorder columns | COPY | ❌ |
| Change PRIMARY KEY | COPY | ❌ |

> **Caution**: Even Online DDL **briefly acquires a metadata lock (MDL)** at start and end. If a long-running transaction holds a lock on the table, this MDL wait grows, causing subsequent queries to queue up. `LOCK=NONE` doesn't mean completely safe.

### 1.3 PostgreSQL's Lock Levels

PostgreSQL handles DDL differently from MySQL. The key concept is **Lock Level.**

| Operation | Lock Level | Blocks DML? |
|-----------|-----------|-------------|
| Add column (NULL allowed, no DEFAULT) | ACCESS EXCLUSIVE (brief) | ⚠️ Very brief |
| Add column (with DEFAULT, PG 11+) | ACCESS EXCLUSIVE (brief) | ⚠️ Very brief |
| Add column (with DEFAULT, PG 10-) | ACCESS EXCLUSIVE (full) | ❌ Full rewrite |
| Drop column | ACCESS EXCLUSIVE (brief) | ⚠️ Very brief |
| Change column type | ACCESS EXCLUSIVE (full) | ❌ Full rewrite |
| Add NOT NULL | ACCESS EXCLUSIVE | ❌ Full scan |
| Create index | SHARE (blocks writes) | ⚠️ Read only |
| Create index (CONCURRENTLY) | SHARE UPDATE EXCLUSIVE | ✅ Read/write OK |

**PostgreSQL's strength**: `CREATE INDEX CONCURRENTLY`

```sql
-- Normal index creation: blocks writes
CREATE INDEX idx_orders_user ON orders (user_id);

-- CONCURRENTLY: allows both reads and writes
CREATE INDEX CONCURRENTLY idx_orders_user ON orders (user_id);
-- Takes longer, but zero service impact
```

> **PG 11+ key improvement**: Adding columns with DEFAULT values became possible **without table rewrite.** On PG 10 and earlier, this operation rewrote the entire table — devastating on large tables.

### 1.4 pt-online-schema-change and gh-ost

When MySQL requires COPY ALGORITHM (e.g., changing column types), Online DDL isn't available. **External tools** fill this gap.

**pt-online-schema-change (Percona Toolkit)**

```bash
pt-online-schema-change \
    --alter "MODIFY COLUMN price DECIMAL(12,2)" \
    D=mydb,t=products \
    --execute
```

How it works:
1. Create an empty table with the new structure (`_products_new`)
2. Install triggers on the original table (replicate INSERT/UPDATE/DELETE to the new table)
3. Copy existing data in chunks
4. Swap tables with `RENAME TABLE` (atomic)
5. Remove triggers and old table

**gh-ost (GitHub)**

```bash
gh-ost \
    --alter "MODIFY COLUMN price DECIMAL(12,2)" \
    --database=mydb --table=products \
    --execute
```

gh-ost reads the **binary log (binlog)** instead of using triggers to apply changes to the new table. No trigger overhead, and it supports pause/resume.

| Comparison | pt-online-schema-change | gh-ost |
|------------|------------------------|--------|
| Change tracking | Triggers | Binary log |
| Source table overhead | ⚠️ Trigger overhead | ✅ Minimal |
| Pause/resume | ❌ | ✅ |
| FK support | ⚠️ Limited | ❌ |
| Setup complexity | ✅ Simple | ⚠️ Requires binlog config |

---

## 2. Expand-Contract Pattern

The **safest strategy** for avoiding ALTER TABLE traps is the Expand-Contract pattern. As the name suggests — "expand then contract" — it changes schemas in three phases.

### 2.1 Three-Phase Flow

```
Phase 1: Expand
├── Add new column/table (keep existing structure)
└── Application starts writing to both

Phase 2: Migrate
├── Copy existing data to new structure
└── Start reading from new structure

Phase 3: Contract
├── Remove old column/table
└── Cleanup complete
```

The key insight is that **deployments are separated between phases.** You don't change everything at once, so if problems arise, you can roll back just that phase.

### 2.2 Example: Renaming a Column

Rename `users.name` → `users.full_name`.

**Wrong approach:**

```sql
-- Not possible without service disruption
ALTER TABLE users RENAME COLUMN name TO full_name;
-- → If the application still references 'name', immediate errors
```

**Expand-Contract approach:**

```sql
-- Phase 1: Expand
ALTER TABLE users ADD COLUMN full_name VARCHAR(100);
-- Deploy 1: Write to both columns
-- On INSERT/UPDATE, write values to both name and full_name
```

```sql
-- Phase 2: Migrate
UPDATE users SET full_name = name WHERE full_name IS NULL;
-- For large tables, run in batches
-- Deploy 2: Start reading from full_name, keep writing to name
```

```sql
-- Phase 3: Contract
-- Deploy 3: After removing all name references
ALTER TABLE users DROP COLUMN name;
```

This requires three deployments. Tedious, but **at each phase the service stays up and rollback is possible.**

### 2.3 Example: Changing Column Type

Change `orders.amount` from `INT` → `DECIMAL(12,2)`.

Direct type change requires COPY ALGORITHM in MySQL and ACCESS EXCLUSIVE LOCK in PostgreSQL. Both are dangerous on large tables.

```sql
-- Phase 1: Expand — add new column
ALTER TABLE orders ADD COLUMN amount_new DECIMAL(12,2);
-- Deploy: write to both
-- amount_new = CAST(amount AS DECIMAL(12,2))

-- Phase 2: Migrate — backfill existing data
-- Batch processing (10,000 rows at a time)
UPDATE orders SET amount_new = amount WHERE amount_new IS NULL LIMIT 10000;
-- Repeat with sleep between batches to spread load

-- Phase 3: Contract — remove old column
ALTER TABLE orders DROP COLUMN amount;
ALTER TABLE orders RENAME COLUMN amount_new TO amount;
```

### 2.4 Example: Splitting a Table

Splitting a God Table into domain-specific tables can also be done safely with Expand-Contract.

```sql
-- Phase 1: Expand — create new table
CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id),
    bio TEXT,
    avatar_url VARCHAR(500),
    website VARCHAR(300)
);
-- Deploy: write to both (users table + user_profiles table)

-- Phase 2: Migrate — move existing data
INSERT INTO user_profiles (user_id, bio, avatar_url, website)
SELECT id, bio, avatar_url, website FROM users
WHERE bio IS NOT NULL OR avatar_url IS NOT NULL;
-- Deploy: start reading from user_profiles

-- Phase 3: Contract — remove old columns
ALTER TABLE users DROP COLUMN bio;
ALTER TABLE users DROP COLUMN avatar_url;
ALTER TABLE users DROP COLUMN website;
```

### 2.5 The Cost of Expand-Contract

Expand-Contract is safe but **not free:**

- **More deployments**: 2-3 deploys per change
- **Transitional code**: Dual-write code is temporarily needed
- **Data synchronization**: Must keep both sides in sync during migration
- **Schedule pressure**: The temptation of "just ALTER TABLE and it takes 5 minutes"

> **Rule of thumb**: Use Expand-Contract when the table has 1M+ rows or the service can't tolerate downtime. For small tables or services with maintenance windows, direct ALTER TABLE is fine.

---

## 3. Migration Tools

Running schema changes as "manual SQL execution" is risky. You lose track of what's been applied, and schemas diverge across environments (dev/staging/production). **Version-controlled migration tools** are essential.

### 3.1 Why They're Needed

```
Problem scenario:
1. Developer A runs ALTER TABLE directly on production DB
2. Developer B, unaware, writes a migration adding the same column
3. Succeeds on staging, "column already exists" error on production
4. Dev DB, staging DB, and production DB all have different schemas
```

What migration tools solve:
- **Change tracking**: Records which SQL was applied and when
- **Environment consistency**: Same migrations run in the same order everywhere
- **Team collaboration**: Migration files committed to Git, code-reviewable
- **Automation**: Auto-execute during CI/CD pipeline deployments

### 3.2 Flyway

Flyway is a **convention-based** migration tool. Put version numbers in SQL file names and they run in order.

**File structure:**

```
db/migration/
├── V1__create_users.sql
├── V2__create_orders.sql
├── V3__add_email_to_users.sql
└── V4__create_order_items.sql
```

**Migration file example (V3__add_email_to_users.sql):**

```sql
ALTER TABLE users ADD COLUMN email VARCHAR(200);
CREATE UNIQUE INDEX uq_users_email ON users (email);
```

**History table (flyway_schema_history):**

| installed_rank | version | description | script | checksum | installed_on | success |
|:---:|---|---|---|---|---|:---:|
| 1 | 1 | create users | V1__create_users.sql | -12345 | 2026-01-01 | true |
| 2 | 2 | create orders | V2__create_orders.sql | -67890 | 2026-01-15 | true |
| 3 | 3 | add email to users | V3__add_email... | -11111 | 2026-02-01 | true |

**Core rules:**
- Applied migration files **must never be modified** (checksum verification)
- Version numbers must be sequential
- Rollback requires manually writing `undo` migrations (automatable with Flyway Teams paid tier)

### 3.3 Liquibase

Liquibase is **changeset-based.** You can choose XML, YAML, JSON, or SQL, and it provides DB-agnostic abstractions.

**File example (YAML):**

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

**Key features:**
- `rollback` blocks can be defined directly in changesets
- DB abstraction — same changeset works on both MySQL and PostgreSQL
- `context` and `label` for conditional execution per environment

### 3.4 Comparison

| Comparison | Flyway | Liquibase |
|------------|--------|-----------|
| Migration format | SQL files (+ Java) | XML / YAML / JSON / SQL |
| Rollback | ⚠️ Manual (paid automation) | ✅ Definable in changeset |
| DB abstraction | ❌ Write DB-specific SQL | ✅ DB-agnostic changesets |
| Learning curve | ✅ Very low | ⚠️ Medium (XML/YAML syntax) |
| Spring Boot integration | ✅ Built-in support | ✅ Built-in support |
| Diff capability | ❌ | ✅ Schema comparison between DBs |
| Team size | Small to medium | Medium to large |

### 3.5 Selection Criteria

- **Choose Flyway when**: You prefer writing SQL directly, have a single DB environment, and a small team
- **Choose Liquibase when**: You have multi-DB environments, need rollback automation, or need changeset management for large teams

> **Practical tip**: In Spring Boot projects, Flyway is overwhelmingly more common. Simple setup — just add SQL files. If you're unsure which to pick, start with Flyway.

---

## 4. Rollback Strategy

### 4.1 Why DDL Rollback Is Hard

Normal code deployments can be rolled back to the previous version. But **schema changes are much harder to roll back.**

```
Deploy v2.0: ALTER TABLE orders ADD COLUMN memo VARCHAR(500);
  → Data starts accumulating in the memo column

To roll back: ALTER TABLE orders DROP COLUMN memo;
  → All data in memo is permanently lost
  → Code referencing memo may already exist
```

More severe case:

```
Deploy v2.0: ALTER TABLE users MODIFY COLUMN name VARCHAR(100) → VARCHAR(50);
  → If data longer than 50 chars exists, rolling back (back to 100)
    doesn't recover truncated data
```

### 4.2 Forward-Only Migration

**Instead of rolling back, "move forward with a new migration."** Most mature teams use this approach.

```
When a problem occurs:
✗ Roll back V3
✓ Write V4 that fixes V3's problem
```

```sql
-- V3: Accidentally added column without NOT NULL
ALTER TABLE orders ADD COLUMN status VARCHAR(20);

-- V4: Fix V3 (forward, not rollback)
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'PENDING';
UPDATE orders SET status = 'PENDING' WHERE status IS NULL;
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;
```

**Why Forward-Only is safer:**
- Rollback scripts are often untested (run for the first time during an incident)
- Rollbacks risk data loss
- Forward migrations can go through code review and testing

### 4.3 Designing for Rollback Capability

Forward-Only is the principle, but you can **design for rollback scenarios** just in case.

**1) Always add columns as NULL-allowed**

```sql
-- ✅ Safe: add as NULL-allowed
ALTER TABLE orders ADD COLUMN memo VARCHAR(500) NULL;
-- If rollback is needed, DROP COLUMN has minimal data loss impact since it was NULL

-- ❌ Risky: add as NOT NULL + DEFAULT
ALTER TABLE orders ADD COLUMN memo VARCHAR(500) NOT NULL DEFAULT '';
-- On rollback, '' values are already populated and indistinguishable from meaningful data
```

**2) Always use Expand-Contract**

Each phase is independent, so you can return to the previous state from any phase.

**3) Schema snapshot before changes**

```bash
# MySQL
mysqldump --no-data mydb > schema_before_v3.sql

# PostgreSQL
pg_dump --schema-only mydb > schema_before_v3.sql
```

If problems arise, compare against the snapshot to identify differences.

---

## 5. Multi-Tenant Design

### 5.1 What Is Multi-Tenancy?

An architecture that serves **multiple customers (tenants)** from a single application and infrastructure. It's the core design pattern of SaaS.

```
Single-tenant: Separate server + separate DB per customer
               → 100 customers = 100 servers

Multi-tenant:  One server + one (or few) DBs serving all customers
               → 100 customers, still 1-2 servers
```

The core challenge of multi-tenancy is **data isolation.** If Tenant A's data is exposed to Tenant B, it's a security incident that destroys service trust.

There are three strategies for implementing multi-tenancy at the schema level.

### 5.2 Strategy 1: Database-per-Tenant

Each tenant gets an **independent database.**

```
tenant_acme    → DB: acme_db
tenant_globex  → DB: globex_db
tenant_initech → DB: initech_db
```

```sql
-- On tenant onboarding
CREATE DATABASE acme_db;
-- Apply all migrations to acme_db
```

| Aspect | Assessment |
|--------|-----------|
| Data isolation | ✅ Complete isolation at DB level |
| Performance isolation | ✅ No cross-tenant impact |
| Migration | ❌ Must apply to each DB individually |
| Resource efficiency | ❌ Connection pool and memory per DB |
| Tenant limit | ⚠️ Realistic up to hundreds |
| Cross-tenant queries | ❌ Not possible (requires separate ETL) |

**Best for**: Large per-tenant data volumes, regulatory/compliance requirements mandating physical isolation (healthcare, finance, government).

### 5.3 Strategy 2: Schema-per-Tenant

Use **separate schemas (namespaces)** per tenant within a single DB. PostgreSQL's `schema` feature is ideal for this.

```sql
-- On tenant onboarding
CREATE SCHEMA tenant_acme;
CREATE SCHEMA tenant_globex;

-- Per-tenant tables
CREATE TABLE tenant_acme.orders (...);
CREATE TABLE tenant_globex.orders (...);

-- Switch via search_path at query time
SET search_path TO tenant_acme;
SELECT * FROM orders;  -- queries tenant_acme.orders
```

| Aspect | Assessment |
|--------|-----------|
| Data isolation | ✅ Schema-level isolation |
| Performance isolation | ⚠️ Same DB, shared I/O |
| Migration | ⚠️ Apply to each schema individually (automatable) |
| Resource efficiency | ⚠️ Catalog overhead with many schemas |
| Tenant limit | ⚠️ Thousands possible but performance degrades |
| Cross-tenant queries | ✅ Possible (same DB) |

> **MySQL note**: MySQL doesn't have PostgreSQL's `schema` concept. In MySQL, `CREATE SCHEMA` is a synonym for `CREATE DATABASE`. So this strategy in MySQL is effectively the same as Strategy 1 (DB-per-Tenant).

**Best for**: PostgreSQL environments with hundreds to thousands of tenants where per-tenant schema customization is needed.

### 5.4 Strategy 3: Shared Schema with tenant_id

All tenants **share the same tables**, distinguished by a `tenant_id` column.

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tenant_user (tenant_id, user_id)
);

-- Every query MUST include tenant_id filter
SELECT * FROM orders WHERE tenant_id = 42 AND user_id = 100;
```

| Aspect | Assessment |
|--------|-----------|
| Data isolation | ⚠️ App-level (data leaks if WHERE is missing) |
| Performance isolation | ❌ Large tenants affect overall performance |
| Migration | ✅ Run once, applies to all |
| Resource efficiency | ✅ Highest (shared tables/indexes) |
| Tenant limit | ✅ Tens of thousands+ |
| Cross-tenant queries | ✅ Easy |

**Preventing tenant_id omission:**

> <strong>What is RLS (Row-Level Security)?</strong> It's a PostgreSQL feature that controls access <strong>at the row level</strong> within a table. Traditional `GRANT` decides "can you access this table?"; RLS goes one level deeper and enforces "which rows in this table can you see?" at the DB level. Define conditions with `CREATE POLICY` and only rows matching those conditions appear in query results — even if the app forgets a `WHERE` clause, the DB filters automatically. This is especially powerful for multitenancy: it structurally prevents data leaks caused by missing `tenant_id`. Note that MySQL has no equivalent RLS, so views or ORM middleware are typically used to approximate it.

```sql
-- PostgreSQL: Row-Level Security (RLS)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant')::BIGINT);

-- Set tenant per connection in the application
SET app.current_tenant = '42';
SELECT * FROM orders;  -- automatically filters tenant_id = 42
```

With RLS, **the DB filters even if you forget the WHERE clause.** This structurally prevents data leaks from missing `tenant_id`.

```sql
-- MySQL: Views can approximate this but aren't as powerful as RLS
-- Typically enforce tenant_id at the app level via ORM/middleware

-- Spring Boot example (Hibernate Filter)
-- @FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = "long"))
-- @Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
```

**Best for**: Many tenants (thousands to tens of thousands), small or uniform data volumes, operational efficiency as top priority. Most SaaS products use this strategy.

### 5.5 Strategy Comparison Summary

| Criterion | DB-per-Tenant | Schema-per-Tenant | Shared Schema |
|-----------|:---:|:---:|:---:|
| Data isolation | ✅✅✅ | ✅✅ | ⚠️ |
| Performance isolation | ✅✅✅ | ⚠️ | ❌ |
| Operational complexity | ❌ High | ⚠️ Medium | ✅ Low |
| Migration difficulty | ❌ High | ⚠️ Medium | ✅ Low |
| Resource efficiency | ❌ Low | ⚠️ Medium | ✅ High |
| Max tenants | Hundreds | Thousands | Tens of thousands+ |
| Examples | Salesforce (Enterprise tier) | Notion, Citus | Slack, Shopify |

### 5.6 Hybrid Strategy

In practice, **mixing strategies is more common** than using a single one.

```
Free/Basic plan     → Shared Schema (tenant_id)
Enterprise plan     → Database-per-Tenant (meets regulatory requirements)
```

**Offering different isolation levels per tier** lets you satisfy both cost efficiency and isolation requirements simultaneously. Salesforce is the classic example of this strategy.

---

## 6. Design Review Checklist

### 6.1 Migration Check

- [ ] **Checked table size before ALTER TABLE?** For 1M+ rows, consider Online DDL / external tools / Expand-Contract
- [ ] **Specified ALGORITHM and LOCK options in MySQL?** COPY may be implicitly chosen
- [ ] **Used CONCURRENTLY for index creation in PostgreSQL?** Regular CREATE INDEX blocks writes
- [ ] **Using a migration tool?** Manual SQL execution causes schema drift across environments

### 6.2 Expand-Contract Check

- [ ] **Combining schema change + code change in one deployment?** They should be separated
- [ ] **Implemented dual-write during transition?** Writing only to the new column means data loss if you roll back to old code
- [ ] **Processing bulk data migration in batches?** A single UPDATE on the entire table causes locks and replication lag

### 6.3 Multi-Tenant Check

- [ ] **Structurally prevented tenant_id omission?** PostgreSQL RLS or ORM-level filters
- [ ] **Need performance isolation between tenants?** Check if large tenants' queries impact others
- [ ] **Migration strategy matches tenant count?** DB-per-Tenant with hundreds of DBs requires automation

---

## Summary

Core takeaways from this post:

1. **ALTER TABLE is dangerous in production.** Understand MySQL's Online DDL and PostgreSQL's lock levels. For large tables, use external tools like pt-online-schema-change or gh-ost.
2. **Expand-Contract is the core pattern for zero-downtime schema changes.** The three phases — expand, migrate, contract — keep the service running and allow rollback at each phase.
3. **Migration tools are essential.** Flyway is simple and SQL-based; Liquibase offers DB abstraction and rollback support. Manual SQL execution causes schema drift.
4. **Forward-Only is safer than rollback.** When problems arise, don't revert — fix forward with a new migration.
5. **Multi-tenancy is a trade-off between isolation and operational efficiency.** Choose from DB-per-Tenant (full isolation, high cost), Schema-per-Tenant (middle ground), or Shared Schema (low isolation, high efficiency) based on your service requirements.

**Across eight parts, we covered RDB schema design from fundamentals to operations.** From naming and data types, to normalization, constraints, relationship patterns, domain design, indexes and JOINs, anti-patterns, and finally migrations. Hopefully this series helped you move from "gut-feel design" to "evidence-based design."
