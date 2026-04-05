---
title: "RDB Design Series Part 2: Normalization and Denormalization — Not Theory, but Judgment Calls"
description: "Normalization isn't 'always required,' and denormalization isn't 'a compromise for performance.' Using a single online store scenario, this guide explains 1NF through 3NF intuitively, then presents clear criteria for when breaking normalization is the right call — with MySQL/PostgreSQL differences."
pubDate: "2026-04-05T16:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Normalization", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbNormalizationGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-schema-basics-guide), we covered the fundamentals you need to decide before creating a table (naming, data types, PK, NULL). This post goes one level deeper — **"How should you split and group columns?"**

When you hear "normalization," textbooks come to mind. 1NF, 2NF, 3NF... But in practice, normalization boils down to one simple question: **"If I put this data here, will it cause problems later?"**

This guide explains normalization from start to finish using a single scenario: **an online store**. Minimal jargon, maximum intuition — you'll *feel* why splitting tables makes sense.

---

## 1. Why Split Tables at All?

### What if the entire store is one table?

Imagine a junior developer builds an online store with everything in one table.

```sql
CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY,
    customer_name VARCHAR(50),
    customer_email VARCHAR(320),
    product_name VARCHAR(100),
    product_price DECIMAL(15, 0),
    quantity INT,
    order_date TIMESTAMP
);
```

```
| order_id | customer_name | customer_email  | product_name | product_price | quantity |
|----------|--------------|-----------------|-------------|--------------|---------|
| 1        | Alice Kim     | alice@email.com | Keyboard     | 50,000        | 1       |
| 2        | Alice Kim     | alice@email.com | Mouse        | 30,000        | 2       |
| 3        | Bob Lee       | bob@email.com   | Keyboard     | 50,000        | 1       |
```

Data goes in fine. Queries work. But **once the service goes live, three kinds of pain emerge.**

### Pain 1: Updating the same data in multiple places

Alice changes her email.

```sql
UPDATE orders SET customer_email = 'new@email.com' WHERE customer_name = 'Alice Kim';
-- Must update 2 rows. If she has 10 orders, update 10. 100 orders, update 100.
-- Miss one? Alice now has two different emails in the system.
```

> **Analogy**: Your friend changes their phone number, but they're saved in your contacts 10 times. You have to update all 10. Miss one and you'll call the old number.

### Pain 2: Can't insert data that should exist

You want to register a new product "Monitor" — but nobody's ordered it yet.

```sql
INSERT INTO orders (product_name, product_price) VALUES ('Monitor', 500000);
-- Can't! order_id (PK) is required.
-- No order = no way to store product info.
```

> **Analogy**: A restaurant can't add a new dish to the menu until someone orders it. That makes no sense.

### Pain 3: Deleting data destroys unrelated info

Bob cancels his order.

```sql
DELETE FROM orders WHERE order_id = 3;
-- Bob's order is gone... but so is all evidence that Bob was ever a customer!
-- "Keyboard costs 50,000" — that product info is also gone.
```

> **Analogy**: Deleting a vacation photo from your album also deletes your friend's contact info because they were in the picture.

### Summary of the three pains

| Pain | Cause | Formal Name |
|------|-------|-------------|
| Must update same data in many rows | One fact duplicated across rows | Update Anomaly |
| Can't insert data that should exist | Unrelated data forced into one table | Insert Anomaly |
| Deleting data destroys other info | Unrelated data forced into one table | Delete Anomaly |

**Normalization is the process of eliminating these three pains.** The method is simple — split data that belongs together into separate tables.

---

## 2. Normalization Levels — Making the Store Progressively Cleaner

### 2.1 1NF — "One value per cell"

First Normal Form has one rule: **One cell, one value.**

```sql
-- One cell has multiple values
| order_id | products           |
|----------|--------------------|
| 1        | Keyboard, Mouse    |
| 2        | Monitor            |
```

"I want to cancel just the Keyboard from order 1" — you'd have to parse and split the cell. Indexes can't help either.

```sql
-- Split into rows: problem solved
| order_id | product  |
|----------|----------|
| 1        | Keyboard |
| 1        | Mouse    |
| 2        | Monitor  |
```

> **Analogy**: In a spreadsheet, putting "Seoul, Busan, Daegu" in one cell makes filtering impossible. One row per value = you can sort, search, and filter.

#### Common 1NF Violations in Practice

| Pattern | Example | Why It's a Problem |
|---------|---------|-------------------|
| **Comma-separated** | `tags = "java,spring,docker"` | `LIKE '%spring%'` also matches "springframework". Can't index |
| **Numbered columns** | `phone1`, `phone2`, `phone3` | Need a 4th? `ALTER TABLE`. Empty columns wasted |
| **JSON arrays** | `tags = ["java", "spring"]` | MySQL: limited indexing. Hard to sort/aggregate |

The fix is always the same — **separate table.**

> **JSON can be an exception**: PostgreSQL's `JSONB` + GIN indexes search well. Ask: "Do I need to search or aggregate this data?" If no, JSON is fine. If yes, separate table.

### 2.2 2NF — "Depends on the whole key, not part of it"

Look at this 1NF-compliant order items table:

```sql
CREATE TABLE order_items (
    order_id BIGINT,
    product_id BIGINT,
    product_name VARCHAR(100),     -- Does this belong here?
    product_price DECIMAL(15, 0),  -- And this?
    quantity INT,
    PRIMARY KEY (order_id, product_id)
);
```

Ask: **"What do I need to know the product name?"**

- `quantity` → Need **both** `order_id` and `product_id`. "How many of product A in order 1?" ✅
- `product_name` → Only need `product_id`. The order number is irrelevant. ❌

Product name is about the product itself, not the order. But since it's in the order table, **if the same product is ordered 100 times, the name is duplicated 100 times**.

```sql
-- Product info goes in a products table
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

> **Analogy**: A class roster listing student names with each assignment submitted: "Alice — HW1, Alice — HW2, Alice — HW3"... Alice's name repeats endlessly. Separate the student list from the submissions, and the name appears just once.

> **Practical tip**: Most teams use single-column `BIGINT AUTO_INCREMENT` PKs, so 2NF violations are rare. Watch for them only in **junction tables (N:M relationships)** with composite keys.

### 2.3 3NF — "Only values determined directly by the PK"

With 2NF satisfied, look at an employees table:

```sql
CREATE TABLE employees (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50),
    department_id INT,
    department_name VARCHAR(50)   -- Does this belong here?
);
```

```
| id | name    | department_id | department_name |
|----|---------|:---:|------------|
| 1  | Alice   | 10  | Engineering |
| 2  | Bob     | 10  | Engineering |
| 3  | Charlie | 20  | Marketing   |
```

Ask: **"What do I need to know the department name?"**

- Employee ID → Department ID → Department name. **The department name is determined by the department, not the employee.**
- But it's in the employee table, so if Engineering has 100 people, "Engineering" is stored 100 times.

Engineering gets renamed to "Product Engineering"?

```sql
UPDATE employees SET department_name = 'Product Engineering' WHERE department_id = 10;
-- Must update 100 rows. Miss one?
-- Some department_id = 10 employees say "Engineering", others say "Product Engineering".
```

```sql
-- Department info goes in a departments table
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
-- Rename department = update 1 row in departments. Done.
```

> **Analogy**: Think of zip codes and addresses. If zip code "10001" gets redistricted, you update one row in the zip code table — not every customer's address individually.

#### The Key 3NF Test

**"If this column's value changes, do I need to update multiple rows?"** — If yes, it's likely a 3NF violation.

| Violation | What triggers multi-row updates? | Fix |
|-----------|-------------------------------|-----|
| `orders.customer_name` | Customer name change | Separate customers table |
| `products.category_name` | Category rename | Separate categories table |
| `employees.department_name` | Department rename | Separate departments table |

### 2.4 BCNF (Boyce-Codd Normal Form) — A Special Case of 3NF

Rare in practice, but worth a brief mention.

Sometimes 3NF is satisfied but problems remain: **a non-PK column determines another column.**

```
Example: University course system
- Each professor teaches only one course
- Students take multiple courses

| student_id | course    | professor  |
|:---:|-----------|------------|
| 1          | DB Design | Prof. Kim  |
| 1          | Networks  | Prof. Lee  |
| 2          | DB Design | Prof. Kim  |

PK: (student_id, course)
Problem: professor -> course (knowing the professor determines the course)
         but professor is not a candidate key!

-> Need a separate professor-course table.
```

> **In practice, 3NF is sufficient.** BCNF only matters in domains with complex composite keys (academic systems, reservation systems).

---

## 3. Normalization Summary — At a Glance

| Normal Form | One-Line Summary | How Often Violated |
|-------------|-----------------|:---:|
| **1NF** | One value per cell | Frequently (comma strings, JSON arrays) |
| **2NF** | No partial key dependencies | Rare (auto-satisfied with single PK) |
| **3NF** | No non-PK column determining another | **Most commonly violated** |
| **BCNF** | Every determinant is a candidate key | Almost never encountered |

**The one normalization question**: "If this column changes, do I need to update multiple rows?" → **If yes, split the table.**

---

## 4. Denormalization — When It's OK to Break the Rules

Normalization optimizes for **data integrity**. Denormalization optimizes for **read performance**. They're a trade-off.

### 4.1 Signals That Denormalization May Be Needed

```
"This query has 5 JOINs and runs on every page load?"
"The sales stats API takes 3 seconds and users are complaining"
"The same JOIN pattern is repeated in 10 different places"
```

> **Denormalization is a last resort.** Try these first — only denormalize when everything else fails:
> 1. Add/optimize indexes
> 2. Refactor queries
> 3. Caching (Redis, application cache)
> 4. Read replicas
> 5. Materialized Views (PostgreSQL)
> 6. **Still slow?** → Now consider denormalization

### 4.2 Denormalization Patterns — Online Store Examples

#### Pattern 1: Pre-calculate and Store

The order list API needs to show order totals.

```sql
-- Normalized: calculate every time
SELECT o.id, SUM(oi.price * oi.quantity) AS total
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;
-- With 1M orders? JOIN + SUM every time is slow.

-- Denormalized: pre-store the total
ALTER TABLE orders ADD COLUMN total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0;
```

**Trade-off**: Reads are fast, but you must recalculate and update the total whenever order items change.

```sql
-- MySQL: auto-sync with trigger
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

-- PostgreSQL: trigger function
CREATE OR REPLACE FUNCTION update_order_total()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET total_amount = (
        SELECT COALESCE(SUM(price * quantity), 0)
        FROM order_items WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_items_after_insert
AFTER INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION update_order_total();
```

> **If you're on PostgreSQL, consider a Materialized View first.** It caches aggregated results without adding columns to your table.
> ```sql
> CREATE MATERIALIZED VIEW order_totals AS
> SELECT order_id, SUM(price * quantity) AS total_amount
> FROM order_items GROUP BY order_id;
>
> -- Refresh without blocking reads
> REFRESH MATERIALIZED VIEW CONCURRENTLY order_totals;
> ```
> MySQL doesn't have this feature — you must manage summary tables manually.

#### Pattern 2: Summary Table

The sales dashboard needs daily revenue.

```sql
-- Calculating from all orders every time is slow
SELECT DATE(order_date) AS day, COUNT(*), SUM(total_amount)
FROM orders WHERE order_date >= '2026-01-01'
GROUP BY DATE(order_date);

-- Summary table: pre-aggregated
CREATE TABLE daily_sales_summary (
    sale_date DATE PRIMARY KEY,
    total_orders INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

```sql
-- MySQL: UPSERT to refresh
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON DUPLICATE KEY UPDATE
    total_orders = VALUES(total_orders),
    total_amount = VALUES(total_amount),
    updated_at = CURRENT_TIMESTAMP;

-- PostgreSQL: ON CONFLICT to refresh
INSERT INTO daily_sales_summary (sale_date, total_orders, total_amount)
SELECT DATE(order_date), COUNT(*), SUM(total_amount)
FROM orders WHERE DATE(order_date) = CURRENT_DATE
GROUP BY DATE(order_date)
ON CONFLICT (sale_date) DO UPDATE SET
    total_orders = EXCLUDED.total_orders,
    total_amount = EXCLUDED.total_amount,
    updated_at = CURRENT_TIMESTAMP;
```

> **Analogy**: Instead of counting every book in the library daily, you keep a "today's checkout summary" board. Not real-time, but fast enough.

#### Pattern 3: Snapshots (This Isn't Actually Denormalization!)

```sql
-- Preserve the product price at the time of order
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    unit_price DECIMAL(15, 0) NOT NULL, -- price at order time
    quantity INT NOT NULL
);
```

The product price goes from $50 to $60. If a customer who paid $50 suddenly sees $60 on their receipt? **That's a lawsuit.**

| Type | Meaning | Example |
|------|---------|---------|
| **Snapshot** | Preserving a point-in-time value — a **business requirement** | Order-time price, shipping address, terms version |
| **Denormalization** | **Intentionally duplicating** data for read performance | Storing customer name in orders table |

**Snapshots are correct design.** Denormalization is a trade-off. Don't confuse them.

#### Pattern 4: Table Merging

```sql
-- 1:1 relationship, two tables
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id),
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048)
);
-- Almost always queried together -> JOIN every time

-- Merged into one
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    bio TEXT,
    avatar_url VARCHAR(2048)
);
```

| OK to Merge | Don't Merge |
|------------|-------------|
| 1:1, almost always queried together | One side queried alone frequently |
| Separated table is small | One side is very large (row size ↑ → cache efficiency ↓) |
| Split reason was "felt right" | Different access permissions (passwords vs profile) |

### 4.3 Pre-Denormalization Checklist

```
[] Index optimization attempted?
[] Queries refactored?
[] Caching layer (Redis, etc.) considered?
[] Read replicas considered?
[] Materialized Views (PostgreSQL) considered?

-> Tried everything and still slow -> Now consider denormalization
```

**If you denormalize, you must**:
- **Automate sync** with triggers or events (manual updates will be missed)
- Write **inconsistency detection queries** (periodically verify original vs duplicate)
- **Comment the reason** (`-- Denormalized: order list API 3s -> 0.2s improvement (2026-04)`)

---

## 5. Normalization vs Denormalization — Decision Guide

| Scenario | Keep Normalized | Consider Denormalization |
|----------|:---------:|:----------:|
| Data changes frequently | O | |
| Integrity is critical (finance, healthcare) | O | |
| Table is small (under 100K rows) | O | |
| Reads vastly outnumber writes | | O |
| Aggregation/stats queries are frequent | | O |
| 5+ JOIN queries repeat often | | O |
| Indexes and caching already maxed out | | O |

### OLTP vs OLAP — Why They Need Different Normalization Levels

Databases serve two fundamentally different purposes.

**OLTP (Online Transaction Processing)** — "The DB handling orders right now"

```
- Users place orders, make payments, cancel, and update shipping status
- Short transactions reading/writing 1-10 rows, hundreds to thousands per second
- Priority: "This order data must be correct" -> integrity first
- Higher normalization is better (no duplicates, always accurate)
```

**OLAP (Online Analytical Processing)** — "The DB showing yesterday's revenue"

```
- Admins view dashboards, analyze monthly trends, generate reports
- Heavy queries scanning millions to billions of rows for aggregation
- Priority: "Show results fast" -> read speed first
- Denormalization is better (fewer JOINs, pre-aggregated data)
```

| Property | OLTP (Orders, Payments) | OLAP (Dashboards, Reports) |
|----------|:---:|:---:|
| **Typical queries** | `INSERT`, `UPDATE`, `SELECT ... WHERE id = ?` | `SELECT SUM/AVG/COUNT ... GROUP BY ... date range` |
| **Data per query** | 1-10 rows | Tens of thousands to billions of rows |
| **Normalization level** | High (3NF) | Low (denormalized, star schema) |
| **Optimized for** | Write speed, integrity | Read speed, aggregation |
| **Real-world examples** | Service DB (MySQL, PostgreSQL) | DW, BI (BigQuery, Redshift, ClickHouse) |

#### Why You Shouldn't Do Both in the Same DB

```
Scenario: Running sales reports (OLAP) directly on the service DB (OLTP)

1. SELECT SUM(total_amount) FROM orders WHERE order_date >= '2026-01-01'
   -> Full-scans 1M rows, consuming table locks and IO

2. Meanwhile, user order INSERTs start queuing up
   -> "I can't place an order!" outage begins

3. The report query also slows down due to transaction isolation
   -> Both are slow. Nobody is happy.
```

#### How to Separate Them in Practice

```
[OLTP DB]  ->  Sync  ->  [OLAP DB / DW]
(Service)     (CDC, ETL)    (Analytics)

- CDC (Change Data Capture): Stream DB change logs to analytics DB in real-time
  e.g., Debezium, AWS DMS
- ETL (Extract-Transform-Load): Periodically extract, transform, and load data
  e.g., Airflow, dbt
- Simple cases: Materialized View (PostgreSQL) or Read Replica
```

> **Bottom line**: Keep your OLTP DB normalized. If you need analytics, separate it into a dedicated OLAP DB. **"Running report queries directly on the service DB"** is the classic mistake of mixing OLTP and OLAP.

---

## 6. MySQL vs PostgreSQL — Normalization/Denormalization Differences

| Feature | MySQL | PostgreSQL | Value as Denormalization Alternative |
|---------|-------|------------|-------------------------------------|
| **Materialized View** | Not available | Available (`REFRESH CONCURRENTLY`) | In PG, check MV before denormalizing |
| **Partial indexes** | Not available | `CREATE INDEX ... WHERE condition` | Specific queries solved by index -> no denormalization needed |
| **Generated Column** | `VIRTUAL` + `STORED` | `STORED` only | Same-table calculations work in both |
| **JSONB** | `JSON` (limited indexing) | `JSONB` + GIN (powerful) | PG handles semi-structured data without normalization |
| **UPSERT** | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` | Summary table refresh works in both |
| **Triggers** | `FOR EACH ROW` only | `FOR EACH ROW` + `FOR EACH STATEMENT` | PG triggers more flexible |

> **PostgreSQL often requires less denormalization than MySQL** thanks to Materialized Views, partial indexes, and JSONB. What you'd denormalize for performance in MySQL may be solvable with MVs or partial indexes in PostgreSQL.

---

## Summary

| Key Point | Details |
|-----------|---------|
| **Normalization = eliminate duplication** | "If this value changes, do I need to update multiple rows?" -> If yes, split the table |
| **3NF is the practical target** | 1NF (one per cell) -> 2NF (watch composite keys) -> 3NF (separate values determined by non-PK) |
| **Denormalization is a last resort** | Indexes -> query optimization -> caching -> MV -> still slow? -> denormalize |
| **Snapshots != Denormalization** | Storing order-time price/address is a business requirement, not duplication |
| **MySQL vs PG** | PG needs less denormalization thanks to MVs, partial indexes, JSONB |

Next up: **Constraints and Data Integrity** — CHECK, UNIQUE, FK trade-offs, and defensive schema design.
