---
title: "RDB Design Series Part 2: Normalization and Denormalization — Not Theory, but Judgment Calls"
description: "Normalization isn't 'always required,' and denormalization isn't 'a compromise for performance.' Covers 1NF through 3NF with practical examples, then presents clear criteria for when breaking normalization is the right call — with MySQL/PostgreSQL differences."
pubDate: "2026-04-05T16:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Normalization", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbNormalizationGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-schema-basics-guide), we covered the fundamentals you need to decide before creating a table (naming, data types, PK, NULL). This post goes one level deeper — **"How should you split and group columns?"**

When you hear "normalization," textbooks come to mind. 1NF, 2NF, 3NF... exam-style terminology. But in practice, normalization is a tool for answering **"Does this column belong in this table?"**

The problem is, knowing normalization alone isn't enough. As the service grows, **the moment comes when a fully normalized structure kills performance**. That's when you need denormalization.

This post:
1. Covers 1NF through 3NF with practical examples
2. Briefly introduces BCNF
3. **Presents clear criteria for when to break normalization**
4. Covers MySQL/PostgreSQL differences

---

## 1. What Is Normalization?

One-line summary: **The process of splitting tables to eliminate data redundancy, so each fact is stored in exactly one place.**

Why is redundancy bad? An example makes it obvious.

### Before Normalization: A Table with Redundancy

```sql
CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY,
    customer_name VARCHAR(50),
    customer_email VARCHAR(320),
    customer_phone VARCHAR(20),
    product_name VARCHAR(100),
    product_price DECIMAL(15, 0),
    quantity INT,
    order_date TIMESTAMP
);
```

```
| order_id | customer_name | customer_email   | product_name | product_price | quantity |
|----------|--------------|------------------|-------------|--------------|---------|
| 1        | Alice Kim     | alice@email.com  | Keyboard     | 50000         | 1       |
| 2        | Alice Kim     | alice@email.com  | Mouse        | 30000         | 2       |
| 3        | Bob Lee       | bob@email.com    | Keyboard     | 50000         | 1       |
```

#### Three Problems (Anomalies)

| Anomaly | Scenario | Result |
|---------|----------|--------|
| **Insert** | Want to store a new customer who hasn't ordered yet | Can't — PK is order_id, so no order means no row |
| **Update** | Alice's email changes | Must update 2 rows. Miss one and data is inconsistent |
| **Delete** | Cancel Bob's order #3 | Bob's customer info is completely lost |

Normalization prevents these three anomalies.

---

## 2. Normalization Levels

### 2.1 First Normal Form (1NF) — Atomic Values

**Rule: Every column must hold a single value.**

```sql
-- 1NF violation: multiple values in one cell
| order_id | products           |
|----------|--------------------|
| 1        | Keyboard, Mouse    |
| 2        | Monitor            |

-- 1NF satisfied: separate rows
| order_id | product  |
|----------|----------|
| 1        | Keyboard |
| 1        | Mouse    |
| 2        | Monitor  |
```

#### Common 1NF Violations in Practice

```sql
-- Pattern 1: Comma-separated strings
tags VARCHAR(500)  -- value: "java,spring,docker"

-- Pattern 2: Numbered columns
phone1 VARCHAR(20),
phone2 VARCHAR(20),
phone3 VARCHAR(20)

-- Pattern 3: JSON arrays (MySQL 5.7+, PostgreSQL 9.4+)
tags JSON  -- value: ["java", "spring", "docker"]
```

| Pattern | Problem | Solution |
|---------|---------|----------|
| **Comma-separated** | Can't search properly (`WHERE tags LIKE '%spring%'` also matches "springframework"), can't index | Separate table |
| **Numbered columns** | Need a 4th phone? `ALTER TABLE`. Wasted empty columns | Separate table |
| **JSON array** | MySQL: limited indexing (needs Generated Column). Hard to sort/aggregate | Separate table (or leverage PG's GIN index) |

> **Is JSON a 1NF violation?** Strictly speaking, yes. But PostgreSQL's `JSONB` + GIN indexes provide good search performance, making it a pragmatic choice for **unstructured data or dynamic attributes**. Judge by "Do I need to search or aggregate this?" rather than "Must I always normalize."

### 2.2 Second Normal Form (2NF) — No Partial Dependencies

**Rule: Remove columns that depend on only part of the primary key.**

2NF only matters with **composite keys**. If you use a single PK (AUTO_INCREMENT), 2NF is automatically satisfied.

```sql
-- 2NF violation: composite key (order_id, product_id), but product_name depends only on product_id
CREATE TABLE order_items (
    order_id BIGINT,
    product_id BIGINT,
    product_name VARCHAR(100),    -- determined by product_id alone
    product_price DECIMAL(15, 0), -- determined by product_id alone
    quantity INT,
    PRIMARY KEY (order_id, product_id)
);
```

```
order_id + product_id -> quantity              (full key dependency OK)
product_id -> product_name, product_price      (partial key dependency NOT OK)
```

```sql
-- 2NF satisfied: extract partial dependencies
CREATE TABLE products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(15, 0) NOT NULL
);

CREATE TABLE order_items (
    order_id BIGINT,
    product_id BIGINT,
    quantity INT NOT NULL,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

> **In practice, you rarely think about 2NF explicitly.** Most teams use Surrogate Keys (BIGINT AUTO_INCREMENT), so composite keys are uncommon. But watch for it in **junction tables (N:M relationships)** where composite keys are used.

### 2.3 Third Normal Form (3NF) — No Transitive Dependencies

**Rule: Non-key columns must not depend on other non-key columns.**

Simply put: **"Every column should be determined directly by the PK, nothing else."**

```sql
-- 3NF violation: department_name depends on department_id (not on PK employee id)
CREATE TABLE employees (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    department_id INT NOT NULL,
    department_name VARCHAR(50)    -- determined by department_id
);
```

```
id -> name, department_id         (PK dependency OK)
department_id -> department_name  (transitive: id -> department_id -> department_name NOT OK)
```

```sql
-- 3NF satisfied
CREATE TABLE departments (
    id INT PRIMARY KEY,
    name VARCHAR(50) NOT NULL
);

CREATE TABLE employees (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    department_id INT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
);
```

#### Common 3NF Violations in Practice

| Violation | Example | Problem |
|-----------|---------|---------|
| Customer name in orders | `orders.customer_name` | Name change requires updating all orders |
| Category name in products | `products.category_name` | Category rename requires updating all products |
| Department address in employees | `employees.department_address` | Office relocation requires updating all employees |

> **3NF is the most frequently violated normal form in practice.** Copying values from other tables because "JOINs are annoying" or "for query performance" is a 3NF violation. Whether it's intentional denormalization or a mistake is covered later.

### 2.4 BCNF (Boyce-Codd Normal Form) — Stronger 3NF

Some schemas satisfy 3NF but violate BCNF. Rare in practice, but worth knowing.

**Rule: Every determinant must be a candidate key.**

```sql
-- University course system
-- Constraint: each professor teaches only one course
CREATE TABLE course_assignments (
    student_id BIGINT,
    course VARCHAR(50),
    professor VARCHAR(50),
    PRIMARY KEY (student_id, course)
);
```

```
student_id + course -> professor  (PK dependency OK, 3NF satisfied)
professor -> course               (professor determines course — but professor isn't a candidate key!)
-> BCNF violation
```

```sql
-- BCNF satisfied
CREATE TABLE professor_courses (
    professor VARCHAR(50) PRIMARY KEY,
    course VARCHAR(50) NOT NULL
);

CREATE TABLE enrollments (
    student_id BIGINT,
    professor VARCHAR(50),
    PRIMARY KEY (student_id, professor),
    FOREIGN KEY (professor) REFERENCES professor_courses(professor)
);
```

> **In practice, 3NF is sufficient.** BCNF only matters in domains with complex composite keys (academic systems, reservation systems, etc.).

---

## 3. Normalization Summary — At a Glance

| Normal Form | One-Line Summary | What It Removes | Practical Importance |
|-------------|-----------------|-----------------|:---:|
| **1NF** | One value per cell | Multi-values, repeating groups | High |
| **2NF** | No partial key dependencies | Partial dependencies | Medium (auto-satisfied with single PK) |
| **3NF** | No non-key to non-key dependencies | Transitive dependencies | **Very high** (most commonly violated) |
| **BCNF** | Every determinant is a candidate key | Non-candidate determinants | Low (only with complex composite keys) |

---

## 4. Denormalization — When to Break the Rules

A normalized schema is optimal for **data integrity**, but not always for **query performance**. Consciously choosing this trade-off is denormalization.

### 4.1 Signals That Denormalization May Be Needed

```
1. Queries with 5+ JOINs are running frequently
2. Aggregation/statistics queries are slow enough to impact UX
3. The same data is repeatedly JOINed from multiple tables
4. Index optimization and query tuning have already been exhausted
```

> **Important: Denormalization is a last resort.** Try adding indexes, optimizing queries, caching (Redis, etc.), and read replicas first. Only then consider denormalization.

### 4.2 Denormalization Patterns

#### Pattern 1: Derived Column

```sql
-- Normalized: calculate order total every time
SELECT o.id, SUM(oi.price * oi.quantity) AS total
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;

-- Denormalized: pre-store the total
ALTER TABLE orders ADD COLUMN total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0;

-- Update total on INSERT/UPDATE
UPDATE orders SET total_amount = (
    SELECT SUM(price * quantity) FROM order_items WHERE order_id = orders.id
) WHERE id = ?;
```

| Pros | Cons |
|------|------|
| No JOIN + SUM on read | Must update total when order items change |
| Can index total for sorting/filtering | Missed updates = data inconsistency |

#### MySQL vs PostgreSQL Implementation

```sql
-- MySQL: Generated Column (VIRTUAL isn't stored, STORED is)
-- Note: Generated Columns can only reference columns in the same table. No cross-table JOINs.
ALTER TABLE order_items
ADD COLUMN line_total DECIMAL(15, 0) GENERATED ALWAYS AS (price * quantity) STORED;

-- PostgreSQL: Generated Column (STORED only)
ALTER TABLE order_items
ADD COLUMN line_total DECIMAL(15, 0) GENERATED ALWAYS AS (price * quantity) STORED;

-- PostgreSQL: Materialized View (can JOIN other tables)
CREATE MATERIALIZED VIEW order_totals AS
SELECT order_id, SUM(price * quantity) AS total_amount
FROM order_items
GROUP BY order_id;

-- Refresh data
REFRESH MATERIALIZED VIEW CONCURRENTLY order_totals;
```

> **PostgreSQL's Materialized View** is a powerful alternative to denormalization. It caches aggregated results without adding redundant columns to tables. The `CONCURRENTLY` option allows reads during refresh. MySQL doesn't have this feature — you must manage summary tables manually.

#### Pattern 2: Summary Table

```sql
-- Problem: daily sales stats calculated from all orders every time
SELECT DATE(order_date) AS day, SUM(total_amount) AS daily_sales
FROM orders
WHERE order_date >= '2026-01-01'
GROUP BY DATE(order_date);
-- Slow when orders table has millions of rows

-- Solution: summary table
CREATE TABLE daily_sales_summary (
    sale_date DATE PRIMARY KEY,
    total_orders INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Update via batch or event
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders
WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON DUPLICATE KEY UPDATE  -- MySQL
    total_orders = VALUES(total_orders),
    total_amount = VALUES(total_amount),
    updated_at = CURRENT_TIMESTAMP;
```

```sql
-- PostgreSQL: ON CONFLICT syntax
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders
WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON CONFLICT (sale_date) DO UPDATE SET
    total_orders = EXCLUDED.total_orders,
    total_amount = EXCLUDED.total_amount,
    updated_at = CURRENT_TIMESTAMP;
```

#### Pattern 3: Redundant Column

```sql
-- Normalized: always JOIN to show customer name in order list
SELECT o.id, o.order_date, c.name AS customer_name
FROM orders o
JOIN customers c ON c.id = o.customer_id;

-- Denormalized: store customer name redundantly in orders
ALTER TABLE orders ADD COLUMN customer_name VARCHAR(50);
```

**This is the most dangerous form of denormalization.** If the customer name changes, you must update all rows in `orders`.

But there are legitimate cases:

```sql
-- Legitimate: preserving "shipping address at time of order"
ALTER TABLE orders ADD COLUMN shipping_address TEXT NOT NULL;
-- Even if the customer changes their address, shipped orders shouldn't change
-- This isn't denormalization — it's a "snapshot," a business requirement

-- Legitimate: preserving "product price at time of order"
ALTER TABLE order_items ADD COLUMN unit_price DECIMAL(15, 0) NOT NULL;
-- Even if the product price changes, past order amounts should remain the same
```

> **Distinguish "snapshots" from "denormalization."** Storing the price/address at order time is a business requirement, not redundancy for performance. This is **correct design**, not a normalization violation.

#### Pattern 4: Table Merging

```sql
-- Normalized: user and profile separated
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY,
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
-- Always requires JOIN

-- Denormalized: merged
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048)
);
```

| Merge Is Appropriate | Don't Merge |
|---------------------|-------------|
| 1:1 relationship, almost always queried together | One side is queried alone frequently (unnecessary data loading) |
| The separated table is very small | One side is very large (row size increase = worse buffer cache efficiency) |
| Only reason for separation was "it felt right" | Different access permissions (password table vs profile table) |

### 4.3 Denormalization Checklist

Before denormalizing, check these first:

```
[] Have you tried index optimization?
[] Have you refactored the query? (Remove unnecessary JOINs, convert subqueries to JOINs, etc.)
[] Have you considered a caching layer (Redis, application cache)?
[] Have you considered read replicas for load distribution?
[] Have you considered Materialized Views (PostgreSQL)?
```

**Only after exhausting all of the above**, consider denormalization.

#### Required Steps When Denormalizing

| Step | Why |
|------|-----|
| **Document the update logic** | Specify who, when, and how redundant data is refreshed |
| **Automate sync with triggers or events** | Manual updates will inevitably be missed |
| **Write inconsistency detection queries** | Periodically verify original vs redundant data matches |
| **Comment the reason** | `-- Denormalized: order list API response time improvement (2026-04-05)` |

```sql
-- MySQL: trigger to sync summary
DELIMITER //
CREATE TRIGGER trg_order_items_after_insert
AFTER INSERT ON order_items
FOR EACH ROW
BEGIN
    UPDATE orders
    SET total_amount = (
        SELECT SUM(price * quantity) FROM order_items WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
END //
DELIMITER ;
```

```sql
-- PostgreSQL: trigger function
CREATE OR REPLACE FUNCTION update_order_total()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET total_amount = (
        SELECT COALESCE(SUM(price * quantity), 0)
        FROM order_items
        WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_items_after_insert
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION update_order_total();
```

---

## 5. Normalization vs Denormalization — Decision Matrix

| Scenario | Keep Normalized | Consider Denormalization |
|----------|:---------:|:----------:|
| Data changes frequently | O | |
| Data integrity is critical (finance, healthcare) | O | |
| Table is small (under 100K rows) | O | |
| Reads vastly outnumber writes | | O |
| Aggregation/stats queries are frequent | | O |
| Queries with 5+ JOINs repeat often | | O |
| Indexes and caching are already maxed out | | O |

### OLTP vs OLAP

| Property | OLTP (Transaction Processing) | OLAP (Analytics Processing) |
|----------|:---:|:---:|
| Normalization level | High (3NF+) | Low (denormalized, star schema) |
| Optimized for | Write speed, data integrity | Read speed, aggregation performance |
| Examples | Orders, payments, registration | Sales dashboards, reports, BI |

> **Trying to do OLTP and OLAP in the same DB ruins both.** Running heavy aggregation on a normalized OLTP schema slows down the service; denormalizing for analytics complicates write logic. If you need analytical data, **separate it into a Data Warehouse or use Materialized Views**.

---

## 6. MySQL vs PostgreSQL — Normalization/Denormalization Differences

| Feature | MySQL | PostgreSQL | Value as Denormalization Alternative |
|---------|-------|------------|-------------------------------------|
| **Materialized View** | Not available (manual summary tables) | Available (`REFRESH CONCURRENTLY` supported) | In PG, check MV before denormalizing |
| **Generated Column** | `VIRTUAL` (not stored) + `STORED` | `STORED` only | Same-table calculations work in both |
| **JSON support** | `JSON` type, limited indexing (needs Generated Column + Index) | `JSONB` + GIN index (powerful) | PG handles semi-structured data efficiently without normalization |
| **Partial indexes** | Not available | `CREATE INDEX ... WHERE condition` | In PG, specific query patterns can be solved with indexes -> no denormalization needed |
| **UPSERT** | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` | Summary table refresh works in both |
| **Triggers** | `BEFORE/AFTER` + `FOR EACH ROW` | Same + `INSTEAD OF`, `FOR EACH STATEMENT` | PG triggers more flexible (statement-level for batch updates) |

> **Bottom line**: Thanks to Materialized Views, partial indexes, and JSONB, **PostgreSQL often requires less denormalization than MySQL.** Something denormalized for performance in MySQL may be solvable with MVs or partial indexes in PostgreSQL.

---

## Summary

| Key Point | Details |
|-----------|---------|
| **What is normalization?** | Eliminating data redundancy to prevent anomalies (insert/update/delete) |
| **3NF is the practical target** | 1NF (atomic values) -> 2NF (no partial deps) -> 3NF (no transitive deps) |
| **Denormalization is a last resort** | Try indexes, query optimization, caching, MVs first. Only then consider it |
| **Snapshots != Denormalization** | Storing price/address at order time is a business requirement, not redundancy |
| **MySQL vs PostgreSQL** | PG often needs less denormalization thanks to MVs, partial indexes, and JSONB |

Next up: **Constraints and Data Integrity** — CHECK, UNIQUE, FK trade-offs, and defensive schema design.
