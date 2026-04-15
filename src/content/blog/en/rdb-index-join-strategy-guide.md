---
title: "RDB Design Series Part 6: Index Design and JOIN Strategy — All the Way to the Optimizer"
description: "Go beyond index basics into design-level thinking. Covering indexes, partial indexes, cardinality analysis, JOIN algorithms (Nested Loop, Hash, Merge), reading EXPLAIN ANALYZE, and the N+1 problem. Turn index creation into index design."
pubDate: "2026-04-15T18:00:00+09:00"
tags: ["Database", "RDB", "Index", "JOIN", "Query Optimization", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbIndexJoinStrategyGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-domain-schema-design-guide), we designed the order/payment domain at production quality. Table structures, relationships, constraints — the schema's "shape" is complete.

But does a well-designed schema automatically mean fast queries? **No.**

If table design is the blueprint, index design is the elevator placement. No matter how good the blueprint is, without elevators you're climbing 30 floors by stairs. But installing elevators everywhere explodes maintenance costs.

This post doesn't cover index "basics." We assume you already know what a B+Tree is and how to write CREATE INDEX. Instead, we focus on **design decisions**:

1. **What you need to know before designing indexes** — why B+Tree is the default, and when to use something else
2. **Design-level indexes** — covering indexes, partial indexes, expression indexes, cardinality analysis
3. **JOIN algorithms** — how Nested Loop, Hash Join, and Merge Join work and when each is chosen
4. **Reading EXPLAIN ANALYZE** — understanding the optimizer's decisions
5. **Practical patterns** — the N+1 problem, JOIN ordering, and large-scale tuning

---

## 1. What You Need to Know Before Designing Indexes

### 1.1 B+Tree — Why It's the Default

All major RDBMS — MySQL (InnoDB), PostgreSQL, SQL Server, and Oracle — use **B+Tree** as their default index structure. The reason is straightforward:

| Operation | B+Tree Complexity | Full Scan |
|-----------|-------------------|-----------|
| Equality (`=`) | O(log N) | O(N) |
| Range (`BETWEEN`, `>`, `<`) | O(log N + M) | O(N) |
| Sorting (`ORDER BY`) | Already sorted | O(N log N) |
| MIN/MAX | O(log N) | O(N) |

On a table with 1 million rows, an equality lookup takes about 20 page accesses (log2(1,000,000) ~ 20). A full scan reads thousands of pages.

**Key properties of B+Tree:**

- **Leaf nodes form a linked list**, making range scans efficient
- **Height stays at 3-4 levels**, so disk I/O is predictable
- **Maintains sorted order**, eliminating extra sort costs for ORDER BY

### 1.2 Alternatives to B+Tree

B+Tree isn't optimal for every situation. Different DBMS support different index types.

| Index Type | Supported By | Good For | Bad For |
|-----------|-------------|----------|---------|
| **Hash** | PG (explicit), MySQL (Memory engine) | Equality-only lookups | Range queries, sorting |
| **GIN** | PG | Arrays, JSONB, full-text search | Simple scalar values |
| **GiST** | PG | Geospatial data, range types | Equality-heavy workloads |
| **BRIN** | PG | Large tables where physical and logical order align | Random insertion patterns |

MySQL InnoDB effectively only uses B+Tree. PostgreSQL lets you choose different index types for different situations — this is one reason PG has an advantage in index design.

### 1.3 Clustered Index vs Heap Table

This is the biggest structural difference between MySQL (InnoDB) and PostgreSQL.

**MySQL InnoDB — Clustered Index:**

```
PK Index (Clustered)
+-- [PK=1] -> actual row data
+-- [PK=2] -> actual row data
+-- [PK=3] -> actual row data

Secondary Index
+-- [email='a@x.com'] -> PK=2
+-- [email='b@x.com'] -> PK=1
    |
    v
    Look up PK index again (bookmark lookup)
```

- Data is physically stored in PK order
- Secondary indexes store the PK value and require **one more PK index lookup** to reach the actual data
- Large PKs (e.g., UUIDs) inflate every secondary index

**PostgreSQL — Heap Table:**

```
Index (any index)
+-- [email='a@x.com'] -> ctid (0,2)
+-- [email='b@x.com'] -> ctid (0,1)
    |
    v
    Direct heap lookup

Heap Table
+-- (0,1) -> actual row data
+-- (0,2) -> actual row data
+-- (0,3) -> actual row data
```

- Indexes point directly to the row's physical location (ctid)
- PK size doesn't affect other indexes
- However, MVCC means **multiple versions of the same row** can exist in the heap, requiring VACUUM to clean up

**Design implications:**

| Aspect | MySQL (InnoDB) | PostgreSQL |
|--------|---------------|------------|
| PK size | Keep small (copied into every secondary index) | Relatively free |
| Sequential PK inserts | Important (prevents page splits) | Less critical |
| UUID PKs | Performance concerns | Relatively fine |
| Secondary index lookup | Bookmark lookup cost | Single heap access |

### 1.4 Think Before You Index

Indexes are **not free.** They speed up reads at the cost of writes.

```
INSERT 1 row -> 1 table write + N indexes x 1 write each
UPDATE 1 row -> (if indexed column changes) index delete + insert
DELETE 1 row -> 1 table write + N indexes x 1 delete mark each
```

A table with 5 indexes turns every INSERT into 6x the write I/O. If you keep adding indexes because "it's slow," reads get faster but writes slow down, and eventually overall performance degrades.

**Index design principles:**

1. **Start with columns in WHERE, JOIN, and ORDER BY** clauses
2. **Prioritize high-cardinality columns** (more on this next)
3. **Consider the write/read ratio.** 5 indexes on a log table with 90% writes is excessive
4. **One composite index beats multiple single-column indexes** — less disk space and maintenance
5. **Drop unused indexes.** They consume space and slow writes for nothing

---

## 2. Design-Level Indexes — Beyond the Basics

### 2.1 Cardinality Analysis

**Cardinality** = the number of distinct values in a column.

```sql
-- Check cardinality
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

- `email`: Cardinality 1M — **high** — index is very effective (one value locates one row)
- `status`: Cardinality 5 — **low** — standalone index is weak (one value matches 200K rows)
- `gender`: Cardinality 3 — **very low** — standalone index is pointless

**Are low-cardinality columns useless for indexes?**

Alone, yes. But as the **leading column of a composite index**, they can be effective:

```sql
-- Standalone status index: scans 200K rows -> inefficient
SELECT * FROM orders WHERE status = 'PENDING';

-- Composite index (status, created_at): only PENDING in a date range -> efficient
CREATE INDEX idx_orders_status_created ON orders (status, created_at);
SELECT * FROM orders
WHERE status = 'PENDING'
  AND created_at >= '2026-04-01';
```

**Selectivity** = 1 / cardinality. Higher selectivity (smaller value) means the index filters better.

### 2.2 Composite Index Column Order

In composite indexes, **column order determines performance.** B+Tree sorts left to right.

```sql
CREATE INDEX idx_example ON orders (status, customer_id, created_at);
```

Which queries can use this index:

```sql
-- All 3 leading columns -> full index utilization
WHERE status = 'PAID' AND customer_id = 123 AND created_at > '2026-01-01'

-- First 2 columns -> partial index utilization
WHERE status = 'PAID' AND customer_id = 123

-- First column only -> partial index utilization
WHERE status = 'PAID'

-- Skips leading column -> index unusable (or inefficient scan)
WHERE customer_id = 123 AND created_at > '2026-01-01'

-- Third column only -> index unusable
WHERE created_at > '2026-01-01'
```

**How to decide column order:**

1. **Equality conditions (`=`) go first**
2. Among equality conditions, **higher cardinality goes first**
3. **Range conditions (`>`, `<`, `BETWEEN`) go last** — columns after a range condition can't use the index

```sql
-- Good order: equality(high cardinality) -> equality(low cardinality) -> range
CREATE INDEX idx_good ON orders (customer_id, status, created_at);

-- Bad order: range first makes subsequent columns unable to use the index
CREATE INDEX idx_bad ON orders (created_at, customer_id, status);
```

### 2.3 Covering Indexes

When all columns a query needs are **contained in the index**, the database can return results **without touching the table (heap) at all.** This is called a **covering index** or **Index-Only Scan**.

```sql
-- Index: (customer_id, status, created_at)
-- This query can be answered from the index alone (covering)
SELECT status, created_at
FROM orders
WHERE customer_id = 123;

-- This query cannot be covered (total_amount is not in the index)
SELECT status, created_at, total_amount
FROM orders
WHERE customer_id = 123;
```

**MySQL's approach (no INCLUDE):**

MySQL doesn't have PostgreSQL's `INCLUDE` syntax. To achieve covering, you add columns at the end of the index:

```sql
-- MySQL: add columns for covering
CREATE INDEX idx_covering ON orders (customer_id, status, created_at, total_amount);
```

The downside is that these extra columns also participate in the sort key, increasing index size and insert/update costs.

**PostgreSQL's INCLUDE:**

```sql
-- PG: INCLUDE adds non-sort columns to the index
CREATE INDEX idx_covering ON orders (customer_id)
    INCLUDE (status, created_at, total_amount);
```

`INCLUDE` columns are **only used for returning results, not for search.** You get covering without polluting the index tree's sort key.

**How to verify in EXPLAIN:**

```sql
-- MySQL: "Using index" in the Extra column
EXPLAIN SELECT status FROM orders WHERE customer_id = 123;
-- -> Extra: Using index

-- PostgreSQL: "Index Only Scan" node
EXPLAIN SELECT status FROM orders WHERE customer_id = 123;
-- -> Index Only Scan using idx_covering on orders
```

### 2.4 Partial Indexes (PostgreSQL)

**Index only the rows that match a condition**, not all rows. PostgreSQL only.

```sql
-- Full index: all 1M rows indexed
CREATE INDEX idx_orders_status ON orders (status);

-- Partial index: only pending orders (if 5% of total, 95% index size reduction)
CREATE INDEX idx_orders_pending ON orders (created_at)
    WHERE status = 'PENDING';
```

**When to use:**

- **Only certain states are queried frequently**: `WHERE status = 'PENDING'`, `WHERE deleted_at IS NULL`
- **Soft-delete pattern**: keep only non-deleted rows in the index
- **Hot/cold data separation**: index only the last 30 days

```sql
-- Soft delete: index only active users
CREATE INDEX idx_active_users_email ON users (email)
    WHERE deleted_at IS NULL;

-- UNIQUE constraint + partial index: prevent duplicate emails among active users only
CREATE UNIQUE INDEX idx_unique_active_email ON users (email)
    WHERE deleted_at IS NULL;
```

That last example is powerful — deleted users can reuse the same email, while active users maintain uniqueness. This pattern is **impossible in MySQL.**

**MySQL workaround:**

MySQL has no partial indexes. To approximate:

1. **Generated Column + index**: materialize the condition into a column and index it
2. **Application-level management**: always include the condition in queries

```sql
-- MySQL: approximate partial index with a Generated Column
ALTER TABLE orders ADD COLUMN is_pending TINYINT
    GENERATED ALWAYS AS (IF(status = 'PENDING', 1, NULL)) STORED;

CREATE INDEX idx_pending ON orders (is_pending, created_at);
```

### 2.5 Expression Indexes (Function-Based Indexes)

Index the **result of an expression**, not the raw column value.

```sql
-- PostgreSQL
CREATE INDEX idx_users_lower_email ON users (LOWER(email));

-- MySQL 8.0+
CREATE INDEX idx_users_lower_email ON users ((LOWER(email)));
-- MySQL requires double parentheses
```

**Without it:**

```sql
-- No expression index
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';
-- -> Even with an index on email, LOWER() prevents index usage (Full Scan)

-- With expression index
-- -> Index Scan on idx_users_lower_email
```

**Common patterns:**

```sql
-- Date-based queries (extract date part)
-- PostgreSQL
CREATE INDEX idx_orders_date ON orders (DATE(created_at));
-- MySQL
CREATE INDEX idx_orders_date ON orders ((DATE(created_at)));

-- JSON field index (PostgreSQL)
CREATE INDEX idx_metadata_type ON events ((metadata->>'type'));

-- JSON field index (MySQL 8.0+)
-- Must go through a Generated Column
ALTER TABLE events ADD COLUMN event_type VARCHAR(50)
    GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.type'))) STORED;
CREATE INDEX idx_event_type ON events (event_type);
```

### 2.6 Index Maintenance and Monitoring

What happens after creating an index matters more than the creation itself. **Find and remove unused indexes.**

**PostgreSQL — index usage statistics:**

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

This shows **indexes that have never been used**, sorted by size. If `idx_scan = 0` and the size is large, it's a deletion candidate.

**MySQL — index usage statistics:**

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

> **Caution**: Statistics reset on server restart. Accumulate at least a month of production data before making decisions.

**Finding duplicate indexes:**

```sql
-- MySQL: (a, b) and (a) are duplicates — (a, b) covers standalone (a) lookups
-- Find these patterns and remove the standalone index
```

```sql
-- PostgreSQL: check for duplicate/similar indexes
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

## 3. JOIN Algorithms — How the Optimizer Chooses

When you write `JOIN` in SQL, the DBMS optimizer decides **which algorithm to use.** The same query may use different algorithms depending on data size, index availability, and statistics. Understanding this lets you explain "why is this query slow."

### 3.1 Nested Loop Join (NLJ)

The most intuitive algorithm. **For each row in the outer (driving) table, search the inner table.**

```
Pseudocode:
for each row in outer_table:        -- outer loop
    for each row in inner_table:    -- inner loop
        if join_condition matches:
            emit row
```

**Time complexity:**

- No index: O(N x M) — worst case
- Index on inner table: O(N x log M) — fast

```sql
-- If orders.customer_id has an index, NLJ is efficient here
SELECT c.name, o.order_number
FROM customers c                    -- outer: 1,000 rows
JOIN orders o ON o.customer_id = c.id;  -- inner: index lookup per customer
```

**When NLJ is chosen:**

- Outer table is **small** and inner table has an **index**
- Joining **small numbers of rows** (most OLTP queries)
- MySQL InnoDB's **default join algorithm** — MySQL only supported NLJ before 8.0.18

### 3.2 Hash Join

**Build a hash table from one table**, then scan the other table and probe the hash table for matches.

```
Pseudocode:
-- Build phase
hash_table = {}
for each row in smaller_table:
    hash_table[join_key] = row

-- Probe phase
for each row in larger_table:
    if join_key in hash_table:
        emit row
```

**Time complexity:** O(N + M) — fast even without indexes.

**When Hash Join is chosen:**

- **Large datasets without indexes**
- **Equality joins (`=`) only** — cannot handle range joins (`>`, `<`)
- Build table must **fit in memory** for optimal performance (spills to disk otherwise)

**DBMS support:**

| DBMS | Hash Join Support |
|------|------------------|
| PostgreSQL | Always supported |
| MySQL | 8.0.18+ (automatically chosen for equality joins without indexes) |

```sql
-- MySQL 8.0.18+: Hash Join kicks in here
-- when neither table has an index on the join key
SELECT *
FROM large_table_a a
JOIN large_table_b b ON a.some_key = b.some_key;
```

### 3.3 Merge Join (Sort-Merge Join)

**Sort both tables by the join key, then scan both simultaneously, merging matches.**

```
Pseudocode:
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

**Time complexity:**

- With sorting needed: O(N log N + M log M)
- Already sorted (e.g., by index): O(N + M) — potentially the fastest

**When Merge Join is chosen:**

- **Both tables are already sorted** by the join key (index guarantees sort order)
- Mainly used in PostgreSQL; MySQL does not support Merge Join
- Can outperform Hash Join for **large data + range joins**

### 3.4 Algorithm Selection Summary

| Situation | Best Algorithm | Why |
|-----------|---------------|-----|
| Small join + index exists | Nested Loop | Index lookup is O(log M), total cost low |
| Large join + no index + equality | Hash Join | O(N+M), no index needed |
| Large join + already sorted | Merge Join | No sort cost, O(N+M) |
| Large join + no index + range | Merge Join (with sort) | Hash can't do range joins |

**What MySQL users need to know:**

MySQL doesn't support Merge Join. So:
- Index exists -> NLJ
- No index + equality join -> Hash Join (8.0.18+)
- No index + range join -> NLJ (Full Scan) -> **slow. Create an index.**

---

## 4. EXPLAIN ANALYZE — Reading the Optimizer's Decisions

After creating indexes and writing JOINs, **verify how they actually execute.** Guessing "this should use the index" is dangerous — the optimizer decides based on statistics and may disagree with your intuition.

### 4.1 MySQL's EXPLAIN

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

**Key columns:**

| Column | Meaning | Good Values | Bad Values |
|--------|---------|-------------|------------|
| `type` | Access method | `const`, `eq_ref`, `ref`, `range` | `ALL` (Full Scan) |
| `key` | Index used | An index name | NULL (no index) |
| `rows` | Estimated rows scanned | Smaller is better | Close to total rows is bad |
| `Extra` | Additional info | `Using index` (covering) | `Using filesort`, `Using temporary` |

**`type` values ranked by performance (best to worst):**

```
system > const > eq_ref > ref > range > index > ALL
```

- `const`: PK/UNIQUE lookup returning 1 row
- `eq_ref`: JOIN matching exactly 1 row via PK/UNIQUE
- `ref`: Non-unique index matching multiple rows
- `range`: Index range scan
- `index`: Full index scan (reads entire index)
- `ALL`: Full table scan — **almost always a problem**

### 4.2 PostgreSQL's EXPLAIN ANALYZE

PostgreSQL's `EXPLAIN ANALYZE` **actually executes the query** and reports timing for each node.

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

**How to read it:**

1. **Start from the innermost (most indented) node** — execution flows inside-out
2. `cost=start..end`: The optimizer's **estimated cost** (relative units, not absolute)
3. `actual time=start..end`: **Real elapsed time** (ms)
4. `rows=`: Estimated vs actual row count — **large discrepancies signal stale statistics**
5. `Buffers: shared hit=`: Pages read from buffer cache (I/O cost indicator)
6. `loops=`: How many times this node executed — actual time x loops is the true time

**Reading the example above:**

- The optimizer chose **Nested Loop**
- Outer table: index scan on `orders` extracted 3,487 rows
- Inner table: for each row, PK lookup on `customers` returning 1 row (3,487 iterations)
- Total execution time: 13.456ms — reasonable

### 4.3 When Estimated vs Actual Rows Diverge

```
->  Index Scan using idx_status on orders
      (cost=0.42..567.89 rows=100 ...) (actual ... rows=50000 loops=1)
```

Estimated 100, actual 50,000 — **500x off.** The optimizer likely chose a suboptimal execution plan.

**Causes and fixes:**

| Cause | Fix |
|-------|-----|
| Stale statistics | `ANALYZE orders;` (PG) / `ANALYZE TABLE orders;` (MySQL) |
| Skewed data distribution | PG: `ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;` then ANALYZE |
| Correlated columns | PG 14+: `CREATE STATISTICS` for extended statistics |

### 4.4 When an Index Exists But Isn't Used

Sometimes the optimizer ignores your index. You need to understand why before you can fix it.

**1. Column wrapped in a function/expression:**

```sql
-- Index not used
WHERE YEAR(created_at) = 2026
WHERE amount + 100 > 500

-- Rewrite to enable index usage
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'
WHERE amount > 400
```

**2. Implicit type conversion:**

```sql
-- phone_number is VARCHAR but compared as a number
-- MySQL internally CASTs, preventing index usage
WHERE phone_number = 01012345678

-- Compare as string
WHERE phone_number = '01012345678'
```

**3. Optimizer decides Full Scan is faster:**

When more than ~30% of the table needs to be read, **Sequential Scan is faster than an index.** Indexes use random I/O; full scans use sequential I/O.

```sql
-- If status = 'ACTIVE' matches 80% of rows,
-- the optimizer ignores the index and chooses Full Scan — this is correct
SELECT * FROM users WHERE status = 'ACTIVE';
```

Forcing the index with hints (`FORCE INDEX`, `SET enable_seqscan = off`) will **make it slower.** Trust the optimizer — it's usually right.

---

## 5. Practical Patterns

### 5.1 N+1 Problem and Indexes

The N+1 problem originates at the application level, and **indexes don't solve it.** The core issue is query count, not query speed.

```sql
-- 1 query: get orders (1 round trip)
SELECT * FROM orders WHERE customer_id = 123;
-- -> returns 100 rows

-- N queries: get items for each order (100 round trips)
SELECT * FROM order_items WHERE order_id = ?;
SELECT * FROM order_items WHERE order_id = ?;
... (100 times)
```

Even with an index on `order_items.order_id`, each query is fast. But **100 network round trips** is the problem. Even at 1ms per query, that's 100ms + network latency.

**Fix: use a JOIN to fetch everything in one query:**

```sql
-- 1 query solves everything
SELECT o.*, oi.*
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 123;
```

With an index on `order_items.order_id`, NLJ works efficiently here. **Indexes don't solve N+1, but they make the JOIN efficient.**

**With ORMs:**

```java
// N+1 (Lazy Loading)
List<Order> orders = orderRepository.findByCustomerId(123);
for (Order order : orders) {
    order.getItems().size();  // triggers a query per order
}

// JOIN Fetch (1 query)
@Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.customerId = :id")
List<Order> findWithItemsByCustomerId(@Param("id") Long id);
```

### 5.2 JOIN Order and Performance

The order of `FROM a JOIN b JOIN c` in SQL doesn't determine actual execution order. The optimizer uses statistics to **determine the optimal order automatically.**

But with many tables, even the optimizer has limits.

**MySQL:**

```sql
-- MySQL can't explore all orderings when many tables are joined
-- optimizer_search_depth limits exploration (default: 62)
-- 10 tables = 10! = 3,628,800 permutations

-- Force order with hints
SELECT /*+ JOIN_ORDER(small_table, medium_table, large_table) */ *
FROM large_table
JOIN medium_table ON ...
JOIN small_table ON ...;
```

**PostgreSQL:**

```sql
-- PG switches to Genetic Query Optimizer (GEQO) when
-- table count exceeds geqo_threshold (default 12)
-- GEQO may not find the optimal plan

-- If statistics are accurate, the optimizer usually picks the right order
-- Only intervene when there's a proven problem
```

**Practical principles:**

1. **Small tables (result sets) should be the driving table** — the optimizer usually handles this, but stale statistics can lead to wrong choices
2. **Ensure indexes exist on join keys** — this is the most important thing
3. **Remove unnecessary joins** — don't habitually JOIN tables you don't use

### 5.3 Large-Scale JOIN Tuning

Strategies for joining millions to tens of millions of rows.

**1. Filter before joining:**

```sql
-- Full join then filter
SELECT o.*, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-04-01'
  AND c.country = 'KR';

-- Filter first with subqueries (optimizer usually does this, but sometimes doesn't)
SELECT o.*, c.name
FROM (SELECT * FROM orders WHERE created_at >= '2026-04-01') o
JOIN (SELECT * FROM customers WHERE country = 'KR') c
  ON c.id = o.customer_id;
```

Modern optimizers usually perform **predicate pushdown** automatically. The two queries above typically produce identical execution plans. But complex queries can trip up the optimizer, so always verify with EXPLAIN.

**2. Batch processing:**

```sql
-- Instead of joining 100M rows at once, split by date range
-- In application code:
for each day in date_range:
    SELECT o.*, oi.*
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.created_at >= :day_start
      AND o.created_at < :day_end;
```

**3. Memory tuning (work_mem / join_buffer_size):**

```sql
-- PostgreSQL: memory for Hash Join
SET work_mem = '256MB';  -- session-level (default 4MB)
-- Caution: each query node can use this much, so don't over-allocate

-- MySQL: NLJ buffer size
SET join_buffer_size = 256 * 1024 * 1024;  -- 256MB (default 256KB)
-- Used by Block Nested Loop / Hash Join
```

### 5.4 FK Columns and Indexes

Recall the schemas from previous posts. Without indexes on FK columns, joins become Full Scans.

**MySQL (InnoDB):**

FK constraints **automatically create indexes.** No manual step needed.

**PostgreSQL:**

FK constraints **do not create indexes automatically.** You must create them yourself.

```sql
-- PostgreSQL: without FK indexes, two things go wrong:
-- 1. JOINs become slow (NLJ does full scan on inner table)
-- 2. DELETE/UPDATE on parent rows triggers full scan on child table
--    (to find child rows for ON DELETE CASCADE)

-- Must-have indexes
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_delivery_id ON order_items (order_delivery_id);
CREATE INDEX idx_payments_order_id ON payments (order_id);
CREATE INDEX idx_order_deliveries_order_id ON order_deliveries (order_id);
```

This is the **most common mistake PostgreSQL beginners make.** Build the habit of checking for FK indexes reflexively whenever a foreign key relationship exists.

---

## 6. MySQL vs PostgreSQL Optimizer Comparison

| Aspect | MySQL (InnoDB) | PostgreSQL |
|--------|---------------|------------|
| **Default JOIN algorithm** | NLJ (+ Hash Join from 8.0.18) | NLJ, Hash Join, Merge Join — all three |
| **Partial indexes** | Not supported (Generated Column workaround) | Supported via `WHERE` clause |
| **Expression indexes** | 8.0+ (double parentheses) | Supported |
| **INCLUDE indexes** | Not supported | Supported |
| **Parallel queries** | 8.0+, limited (COUNT, etc.) | 9.6+ Parallel Seq Scan, Hash Join, etc. |
| **EXPLAIN detail level** | Table-based, row-level | Tree-based, per-node timing/buffers |
| **Auto FK indexes** | Auto-created | Manual creation required |
| **Statistics collection** | Limited (histograms from 8.0) | Detailed (MCV, histograms, extended stats) |
| **Hint system** | Optimizer hints (comment syntax) | `SET` parameters + `pg_hint_plan` extension |

**In summary:**

- MySQL is **simple and predictable.** It's NLJ-centric, so "get your indexes right and most things are solved."
- PostgreSQL offers **diverse algorithms and index options** that shine in complex queries, but that means **more to understand.**

---

## 7. Index Design Checklist

A practical checklist for reviewing indexes during schema review. Use alongside the [design review checklist from Part 5](/blog/en/rdb-domain-schema-design-guide).

### 7.1 Basics

- [ ] **Do all FK columns have indexes?** (PostgreSQL doesn't auto-create them)
- [ ] **Do frequently queried WHERE columns have indexes?**
- [ ] **Do ORDER BY / GROUP BY columns match an index's sort order?**
- [ ] **Are UNIQUE indexes used where uniqueness is required?** (Regular index + application check is vulnerable to race conditions)

### 7.2 Design-Level

- [ ] **Does composite index column order match query patterns?** (equality -> range)
- [ ] **Are there duplicate indexes?** (`(a)` + `(a, b)` -> can remove `(a)`)
- [ ] **Are covering indexes applied where beneficial?** (frequent SELECTs with few columns)
- [ ] **Are there standalone indexes on extremely low-cardinality columns?** (boolean, status)
- [ ] **Are there unnecessary indexes on write-heavy tables?**

### 7.3 PostgreSQL-Specific

- [ ] **Can any full indexes be replaced with partial indexes?** (queries targeting specific states)
- [ ] **Can INCLUDE be used to achieve covering?**
- [ ] **Is VACUUM running properly?** (affects Index-Only Scan effectiveness)

### 7.4 Operations

- [ ] **Are unused indexes monitored and removed periodically?**
- [ ] **Is total index size disproportionate to table size?** (watch out when indexes are larger than the table)
- [ ] **Have you verified key queries with EXPLAIN ANALYZE?**

---

## Summary

The key takeaways from this post:

1. **Indexes trade write cost for read performance.** Don't pile them on blindly — analyze query patterns and read/write ratios to design deliberately.
2. **Cardinality and selectivity determine index effectiveness.** Even low-cardinality columns work as leading columns in composite indexes.
3. **Covering indexes, partial indexes, and expression indexes** are the tools that take you from "creating indexes" to "designing indexes." PostgreSQL's partial index + UNIQUE combo is a powerful pattern impossible in MySQL.
4. **The optimizer chooses JOIN algorithms.** NLJ works with indexes, Hash Join handles large equality joins, Merge Join suits sorted large datasets. MySQL's NLJ focus means higher index dependency.
5. **Building the EXPLAIN ANALYZE habit** is the single most important skill. When estimated and actual row counts diverge, update statistics. When an index isn't used, find out why.

**"Knowing how to create an index" and "knowing how to design an index" are different skills.** A single CREATE INDEX can change query performance by 1000x, and 5 poorly chosen indexes can halve write throughput. I hope this post helps develop that judgment.

Next up: **Anti-Patterns and Temporal Data Design** — EAV, God Table, Temporal Tables, and event sourcing schemas.
