---
title: "RDB Design Series Part 4: Relationship Design Patterns — 1:1, 1:N, N:M and Beyond"
description: "Stop designing table relationships by gut feeling. From 1:1 split criteria to 1:N vs N:M judgment, self-referencing trees, and polymorphic associations — every relationship design pattern you'll face in practice."
pubDate: "2026-04-08T14:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Relationships", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbRelationshipPatternsGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-constraints-integrity-guide), we covered how constraints act as the last line of defense against bad data. You now know how to create tables, choose data types, normalize schemas, and enforce integrity rules.

But there's a question constraints alone can't answer: **"How do you design the *relationships* between tables?"**

Every real application involves entities that connect to each other. Users place orders. Orders contain items. Items belong to categories. Categories have subcategories. Comments can be on posts, photos, or videos. Teams have members with different roles.

The relationships between these entities are where schema design gets interesting — and where mistakes are most expensive. A wrong relationship decision early on can mean painful migrations, N+1 query nightmares, or data integrity gaps that no amount of application code can fully patch.

This post covers the relationship patterns you'll encounter in practice:

1. **1:1, 1:N, N:M** — The fundamentals and when to use each
2. **Self-referencing relationships** — Trees, hierarchies, and recursive queries
3. **Polymorphic associations** — When one table needs to reference multiple parent types
4. **Junction table design** — Beyond the basics
5. **MySQL vs PostgreSQL differences** — Relationship-specific features

---

## 1. Relationship Basics — 1:1, 1:N, N:M

### 1.1 1:1 Relationships — When to Split Tables

A 1:1 relationship means each row in Table A corresponds to at most one row in Table B, and vice versa. The immediate question is: **"If it's 1:1, why not just put everything in one table?"**

**Usually, one table is the correct answer.** Splitting into two tables adds JOIN overhead and complexity. But there are specific cases where splitting is justified:

#### Case 1: Optional Data Separation

Not all users have detailed profiles. If only 10% of users fill out a profile, storing `bio`, `avatar_url`, `website`, `social_links` in the users table means 90% of rows carry NULL columns.

```sql
-- Main table: always populated
CREATE TABLE users (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    email      VARCHAR(320) NOT NULL UNIQUE,
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Optional profile: only exists when the user fills it out
CREATE TABLE user_profiles (
    user_id    BIGINT       PRIMARY KEY,
    bio        TEXT,
    avatar_url VARCHAR(500),
    website    VARCHAR(500),
    birth_date DATE,
    CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

The `user_profiles.user_id` is both the PK and the FK. Since a PK is inherently UNIQUE, this guarantees exactly one profile per user.

#### Case 2: Security Isolation

Sensitive data (SSN, payment info, health records) in a separate table with different access controls.

```sql
CREATE TABLE employees (
    id   BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    department_id BIGINT NOT NULL
);

-- Separate table with restricted access
CREATE TABLE employee_sensitive (
    employee_id    BIGINT      PRIMARY KEY,
    ssn            VARCHAR(20) NOT NULL,
    salary         DECIMAL(12,2) NOT NULL,
    bank_account   VARCHAR(50) NOT NULL,
    CONSTRAINT fk_sensitive_employee
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Grant read access selectively
-- GRANT SELECT ON employee_sensitive TO payroll_role;
```

#### Case 3: Performance Separation

Frequently queried small columns separated from rarely accessed large data.

```sql
CREATE TABLE products (
    id    BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name  VARCHAR(200) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    stock INT          NOT NULL DEFAULT 0
);

-- Large, rarely accessed data
CREATE TABLE product_details (
    product_id      BIGINT PRIMARY KEY,
    description     TEXT,
    specifications  JSON,
    manual_pdf      MEDIUMBLOB,
    CONSTRAINT fk_detail_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
```

Listing pages query `products` (fast, narrow rows). Detail pages JOIN `product_details` only when needed.

#### Anti-Pattern: Meaningless 1:1 Splits

```sql
-- ❌ Don't do this
CREATE TABLE users (id BIGINT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE user_emails (user_id BIGINT PRIMARY KEY, email VARCHAR(320),
    FOREIGN KEY (user_id) REFERENCES users(id));

-- These belong in one table. Splitting because "we separate classes in OOP"
-- is not a valid database design reason.
```

**The OOP instinct to separate "concerns" into classes does not translate to tables.** JOINs have a real cost. Unless you have a concrete reason (optional data, security, performance), keep 1:1 data in one table.

#### 1:1 in Practice — The Honest Reality

Most production schemas have few genuine 1:1 splits. The cases where they appear:

- **User + profile**: The most common legitimate 1:1. Especially when profiles are optional or contain large text/media fields.
- **Sensitive data isolation**: Required by compliance (PCI-DSS for payment data, HIPAA for health records). Not optional — it's a legal requirement.
- **Legacy migrations**: You're adding new columns to a table you can't ALTER (billions of rows, no downtime). A 1:1 extension table is the pragmatic solution.

> **Rule of thumb**: Start with one table. Split into 1:1 only when you can articulate a specific problem the split solves.

---

### 1.2 1:N Relationships — The Most Common Relationship

1:N (one-to-many) is the bread and butter of relational modeling. One order has many items. One department has many employees. One post has many comments.

#### Basic Pattern

The FK column always lives in the **child** (the "many" side).

```sql
CREATE TABLE orders (
    id         BIGINT    PRIMARY KEY AUTO_INCREMENT,
    user_id    BIGINT    NOT NULL,
    status     VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ordered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE order_items (
    id         BIGINT        PRIMARY KEY AUTO_INCREMENT,
    order_id   BIGINT        NOT NULL,
    product_id BIGINT        NOT NULL,
    quantity   INT           NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_items_order   FOREIGN KEY (order_id)   REFERENCES orders(id),
    CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_items_order (order_id)
);
```

#### Design Points

**1. NOT NULL on FK columns**

Unless the relationship is truly optional ("a comment may or may not belong to a post" — unusual), the FK should be `NOT NULL`. An order item without an order is an orphan.

**2. Index on FK columns**

FKs are not automatically indexed in all databases. MySQL auto-creates an index on FK columns. PostgreSQL does not. **Always explicitly create an index on FK columns.**

```sql
-- PostgreSQL: FK does NOT auto-create index
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
```

Without this index, `DELETE FROM orders WHERE id = 100` triggers a sequential scan on `order_items` to check for referencing rows — potentially locking the entire table.

**3. ON DELETE strategy**

| Strategy | Behavior | Use when |
|----------|----------|----------|
| `RESTRICT` (default) | Block delete if children exist | Orders can't be deleted while items exist |
| `CASCADE` | Delete children automatically | Deleting an order deletes its items |
| `SET NULL` | Set FK to NULL | Deleting a department sets `employee.dept_id = NULL` |
| `SET DEFAULT` | Set FK to default value | Rarely used in practice |

```sql
-- CASCADE: order deletion cascades to items
CONSTRAINT fk_items_order FOREIGN KEY (order_id)
    REFERENCES orders(id) ON DELETE CASCADE

-- SET NULL: department deletion orphans employees
CONSTRAINT fk_emp_dept FOREIGN KEY (department_id)
    REFERENCES departments(id) ON DELETE SET NULL
```

#### When N Grows Unbounded

Some 1:N relationships have effectively unlimited N: audit logs, event streams, sensor readings. When the child table grows into billions of rows:

- **Partitioning**: Partition the child table by date/range. This is the first tool to reach for.
- **Archival strategy**: Move old records to cold storage (separate table, S3, etc.).
- **Consider whether this belongs in an RDB at all**: If the relationship is truly "append-only, query-by-time-range," a time-series database or data warehouse might be a better fit.

```sql
-- PostgreSQL: Range partitioning on order date
CREATE TABLE order_events (
    id         BIGINT       NOT NULL,
    order_id   BIGINT       NOT NULL,
    event_type VARCHAR(50)  NOT NULL,
    created_at TIMESTAMP    NOT NULL,
    payload    JSONB
) PARTITION BY RANGE (created_at);

CREATE TABLE order_events_2026_q1 PARTITION OF order_events
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE order_events_2026_q2 PARTITION OF order_events
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
```

#### 1:N in Practice

- **Index your FKs.** This is the #1 performance issue in 1:N relationships. The JOIN or DELETE that was "fine in dev" becomes a full table lock in production because the FK column was unindexed.
- **Default to RESTRICT for ON DELETE.** CASCADE sounds convenient, but accidentally cascading a delete through 5 levels of dependent tables is a production incident. Use CASCADE deliberately, not by default.
- **N+1 queries are a relationship problem, not a query problem.** If your ORM generates N+1 queries for a 1:N relationship, the fix is eager loading (JOIN fetch), not caching or pagination hacks.

---

### 1.3 N:M Relationships — When You Need a Junction Table

An RDB cannot express N:M (many-to-many) directly. A student can enroll in many courses. A course has many students. There's no single FK column that can express this.

The solution: a **junction table** (also called bridge table, pivot table, join table, or associative entity).

#### Basic Pattern

```sql
CREATE TABLE students (
    id   BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE courses (
    id   BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL,
    credits INT       NOT NULL
);

-- Junction table
CREATE TABLE enrollments (
    student_id  BIGINT NOT NULL,
    course_id   BIGINT NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    grade       VARCHAR(2),
    PRIMARY KEY (student_id, course_id),
    CONSTRAINT fk_enroll_student FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT fk_enroll_course  FOREIGN KEY (course_id)  REFERENCES courses(id)
);
```

#### Adding Columns to Junction Tables

In practice, junction tables almost always carry additional data beyond the two FKs. The `enrollments` table above has `enrolled_at` and `grade`. This is the norm, not the exception.

Common junction table columns:

| Column | Purpose | Example |
|--------|---------|---------|
| `created_at` | When the relationship was established | Enrollment date |
| `role` | What role in the relationship | `OWNER`, `EDITOR`, `VIEWER` |
| `status` | Relationship state | `ACTIVE`, `SUSPENDED`, `COMPLETED` |
| `sort_order` | Display ordering | Playlist track order |
| `metadata` | Extra info (JSON) | Permission details |

#### PK Strategy: Composite PK vs Surrogate PK

**Option 1: Composite PK** — `PRIMARY KEY (student_id, course_id)`

```sql
CREATE TABLE enrollments (
    student_id  BIGINT NOT NULL,
    course_id   BIGINT NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, course_id),
    CONSTRAINT fk_enroll_student FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT fk_enroll_course  FOREIGN KEY (course_id)  REFERENCES courses(id)
);
```

Pros:
- Inherently prevents duplicate relationships (same student + course can't appear twice)
- No wasted column — the PK *is* the business key
- Efficient for lookups by `(student_id, course_id)`

Cons:
- Harder to reference from other tables (child tables need composite FK)
- Some ORMs handle composite PKs poorly

**Option 2: Surrogate PK** — `id` column + UNIQUE constraint

```sql
CREATE TABLE enrollments (
    id          BIGINT    PRIMARY KEY AUTO_INCREMENT,
    student_id  BIGINT    NOT NULL,
    course_id   BIGINT    NOT NULL,
    enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_enrollment UNIQUE (student_id, course_id),
    CONSTRAINT fk_enroll_student FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT fk_enroll_course  FOREIGN KEY (course_id)  REFERENCES courses(id)
);
```

Pros:
- Simple single-column PK — easy to reference from other tables
- ORM-friendly
- Works as a stable identifier if the junction table grows into its own entity

Cons:
- Requires a separate UNIQUE constraint to prevent duplicates (easy to forget!)
- Extra column and index

**Practical recommendation**: If the junction table is just connecting two entities with minimal extra data, use a composite PK. If it's growing into its own entity (with its own children, status lifecycle, etc.), use a surrogate PK.

#### When the Junction Table Becomes Its Own Entity

This happens more often than you'd expect. `enrollments` starts as a simple junction table, then gains:
- `grade`, `attendance_count`, `completion_date` — now it's a "student course record"
- Other tables reference it: `enrollment_payments`, `enrollment_certificates`

At this point, it's no longer a junction table — it's a first-class entity that happens to connect two other entities. Give it a surrogate PK and treat it accordingly.

#### N:M in Practice

- **The junction table always needs UNIQUE or composite PK.** Without it, the same student can enroll in the same course 5 times — a data bug that's hard to detect and harder to fix.
- **Index both FK columns.** Queries go both directions: "which courses does student X take?" and "which students are in course Y?" Both need an index.
- **Name junction tables meaningfully.** `student_course` is a lazy name. `enrollments` conveys the business concept. If the junction table represents a real domain concept, name it that way.

---

### 1.4 Relationship Decision Flowchart

When deciding the relationship type between two entities, walk through this:

```
Q1: Can entity A have multiple Bs?
│
├─ NO ──→ Q2: Can entity B have multiple As?
│         │
│         ├─ NO ──→ 1:1 Relationship
│         │         → Consider if it should be one table
│         │         → Split only with a specific reason
│         │
│         └─ YES ─→ 1:N (B is parent, A is child)
│                   → FK in A referencing B
│
└─ YES ─→ Q2: Can entity B have multiple As?
          │
          ├─ NO ──→ 1:N (A is parent, B is child)
          │         → FK in B referencing A
          │
          └─ YES ─→ N:M Relationship
                    → Junction table required
                    → Composite PK or surrogate PK + UNIQUE
```

When in doubt, **start with the simpler relationship and upgrade later**. Going from 1:N to N:M (adding a junction table) is a well-understood migration. Going from a denormalized mess to a clean N:M is much harder.

---

## 2. Self-Referencing Relationships

A self-referencing relationship is when a table has a FK that points back to itself. This is the standard approach for modeling **hierarchies**: categories, organizational charts, comment threads, folder structures.

### 2.1 Basic Pattern — parent_id

The simplest approach: add a `parent_id` column that references the same table's PK.

```sql
-- Category hierarchy
CREATE TABLE categories (
    id        BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name      VARCHAR(100) NOT NULL,
    parent_id BIGINT       NULL,
    CONSTRAINT fk_category_parent
        FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_category_parent (parent_id)
);

INSERT INTO categories (id, name, parent_id) VALUES
(1, 'Electronics', NULL),       -- root
(2, 'Computers',   1),          -- child of Electronics
(3, 'Laptops',     2),          -- child of Computers
(4, 'Desktops',    2),          -- child of Computers
(5, 'Phones',      1),          -- child of Electronics
(6, 'Smartphones', 5);          -- child of Phones
```

```
Electronics (1)
├── Computers (2)
│   ├── Laptops (3)
│   └── Desktops (4)
└── Phones (5)
    └── Smartphones (6)
```

#### Organizational Chart

```sql
CREATE TABLE employees (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(100) NOT NULL,
    title      VARCHAR(100) NOT NULL,
    manager_id BIGINT       NULL,
    CONSTRAINT fk_employee_manager
        FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL,
    INDEX idx_employee_manager (manager_id)
);
```

**Pros**: Intuitive, easy to implement, minimal storage overhead.
**Cons**: Querying the full tree (all descendants of a node) requires recursive queries. Getting the depth of a node requires traversal. Moves (reparenting a subtree) are simple — just update `parent_id`.

---

### 2.2 Recursive Queries — WITH RECURSIVE (CTE)

MySQL 8.0+ and PostgreSQL both support recursive CTEs, making tree traversal possible in a single query.

#### Find All Descendants of a Node

```sql
-- All subcategories under "Electronics" (id=1)
WITH RECURSIVE category_tree AS (
    -- Base case: the starting node
    SELECT id, name, parent_id, 0 AS depth
    FROM categories
    WHERE id = 1

    UNION ALL

    -- Recursive case: children of nodes already in the result
    SELECT c.id, c.name, c.parent_id, ct.depth + 1
    FROM categories c
    INNER JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT id, name, parent_id, depth
FROM category_tree
ORDER BY depth, name;
```

Result:

```
id | name         | parent_id | depth
---+--------------+-----------+------
 1 | Electronics  | NULL      | 0
 2 | Computers    | 1         | 1
 5 | Phones       | 1         | 1
 4 | Desktops     | 2         | 2
 3 | Laptops      | 2         | 2
 6 | Smartphones  | 5         | 2
```

#### Find All Ancestors of a Node (Path to Root)

```sql
-- Ancestors of "Laptops" (id=3) → Computers → Electronics
WITH RECURSIVE ancestors AS (
    SELECT id, name, parent_id, 0 AS depth
    FROM categories
    WHERE id = 3

    UNION ALL

    SELECT c.id, c.name, c.parent_id, a.depth + 1
    FROM categories c
    INNER JOIN ancestors a ON c.id = a.parent_id
)
SELECT id, name, depth
FROM ancestors
ORDER BY depth DESC;
```

Result:

```
id | name        | depth
---+-------------+------
 1 | Electronics | 2
 2 | Computers   | 1
 3 | Laptops     | 0
```

#### Build a Full Path String

```sql
-- Build breadcrumb: "Electronics > Computers > Laptops"
WITH RECURSIVE path_cte AS (
    SELECT id, name, parent_id, CAST(name AS CHAR(500)) AS path
    FROM categories
    WHERE parent_id IS NULL

    UNION ALL

    SELECT c.id, c.name, c.parent_id,
           CONCAT(p.path, ' > ', c.name)
    FROM categories c
    INNER JOIN path_cte p ON c.parent_id = p.id
)
SELECT id, name, path FROM path_cte ORDER BY path;
```

#### Performance Considerations

- Recursive CTEs are **not free**. For a tree with 10 nodes, no problem. For a tree with 100,000 nodes, the recursive CTE will generate a large intermediate result set.
- **Add a depth limit** to prevent infinite loops (caused by circular references — they can happen with bad data):

```sql
WITH RECURSIVE tree AS (
    SELECT id, name, parent_id, 0 AS depth FROM categories WHERE id = 1
    UNION ALL
    SELECT c.id, c.name, c.parent_id, t.depth + 1
    FROM categories c
    INNER JOIN tree t ON c.parent_id = t.id
    WHERE t.depth < 20  -- Safety limit
)
SELECT * FROM tree;
```

- If you frequently need "all descendants" queries on large trees, consider one of the alternative patterns below.

---

### 2.3 Alternative Patterns

When `parent_id` + recursive CTE isn't performant enough, these patterns trade write complexity for read performance.

#### Materialized Path

Store the full path from root to the current node as a string.

```sql
CREATE TABLE categories (
    id        BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name      VARCHAR(100) NOT NULL,
    path      VARCHAR(500) NOT NULL,  -- e.g., '/1/2/3/'
    depth     INT          NOT NULL DEFAULT 0,
    INDEX idx_category_path (path)
);

INSERT INTO categories (id, name, path, depth) VALUES
(1, 'Electronics',  '/1/',       0),
(2, 'Computers',    '/1/2/',     1),
(3, 'Laptops',      '/1/2/3/',   2),
(4, 'Desktops',     '/1/2/4/',   2),
(5, 'Phones',       '/1/5/',     1),
(6, 'Smartphones',  '/1/5/6/',   2);
```

```sql
-- Find all descendants of Electronics (id=1)
SELECT * FROM categories WHERE path LIKE '/1/%';

-- Find all ancestors of Laptops — parse the path in app code
-- Path '/1/2/3/' → ancestor ids are 1, 2
SELECT * FROM categories WHERE id IN (1, 2);

-- Find depth
SELECT depth FROM categories WHERE id = 3;  -- 2
```

**Pros**: All descendants in a single `LIKE` query — no recursion. Depth is stored explicitly.
**Cons**: Moving a subtree requires updating the `path` of all descendants. Path string has a length limit. No referential integrity on the path itself.

#### Closure Table

A separate table that stores **every** ancestor-descendant pair with the distance between them.

```sql
CREATE TABLE categories (
    id   BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE category_closure (
    ancestor_id   BIGINT NOT NULL,
    descendant_id BIGINT NOT NULL,
    depth         INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (ancestor_id, descendant_id),
    CONSTRAINT fk_closure_ancestor
        FOREIGN KEY (ancestor_id)   REFERENCES categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_closure_descendant
        FOREIGN KEY (descendant_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_closure_descendant (descendant_id)
);

-- For the tree: Electronics → Computers → Laptops
-- Closure table stores ALL pairs:
INSERT INTO category_closure (ancestor_id, descendant_id, depth) VALUES
(1, 1, 0),  -- Electronics is its own ancestor (depth 0)
(2, 2, 0),  -- Computers is its own ancestor
(3, 3, 0),  -- Laptops is its own ancestor
(1, 2, 1),  -- Electronics → Computers (depth 1)
(1, 3, 2),  -- Electronics → Laptops (depth 2)
(2, 3, 1);  -- Computers → Laptops (depth 1)
```

```sql
-- All descendants of Electronics (id=1)
SELECT c.* FROM categories c
JOIN category_closure cc ON c.id = cc.descendant_id
WHERE cc.ancestor_id = 1 AND cc.depth > 0;

-- All ancestors of Laptops (id=3)
SELECT c.* FROM categories c
JOIN category_closure cc ON c.id = cc.ancestor_id
WHERE cc.descendant_id = 3 AND cc.depth > 0;

-- Direct children only (depth = 1)
SELECT c.* FROM categories c
JOIN category_closure cc ON c.id = cc.descendant_id
WHERE cc.ancestor_id = 1 AND cc.depth = 1;
```

**Pros**: All ancestor/descendant queries are simple JOINs — no recursion, very fast reads. Supports depth filtering.
**Cons**: Write cost is high. Inserting a node at depth D requires D+1 rows in the closure table. Moving a subtree requires deleting and re-inserting many rows.

#### Nested Set

Each node stores a `left` and `right` number. A node's descendants are all nodes where `left` is between the parent's `left` and `right`.

```sql
CREATE TABLE categories (
    id    BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name  VARCHAR(100) NOT NULL,
    lft   INT          NOT NULL,  -- "left" is a reserved word
    rgt   INT          NOT NULL,  -- "right" is a reserved word
    INDEX idx_category_lft_rgt (lft, rgt)
);

-- Electronics (1,12)
--   Computers (2,7)
--     Laptops (3,4)
--     Desktops (5,6)
--   Phones (8,11)
--     Smartphones (9,10)

INSERT INTO categories (id, name, lft, rgt) VALUES
(1, 'Electronics',  1,  12),
(2, 'Computers',    2,   7),
(3, 'Laptops',      3,   4),
(4, 'Desktops',     5,   6),
(5, 'Phones',       8,  11),
(6, 'Smartphones',  9,  10);
```

```sql
-- All descendants of Electronics
SELECT * FROM categories WHERE lft > 1 AND rgt < 12;

-- Count of descendants
SELECT (rgt - lft - 1) / 2 AS descendant_count
FROM categories WHERE id = 1;  -- (12 - 1 - 1) / 2 = 5
```

**Pros**: Extremely fast reads — descendants, ancestor count, and subtree queries are all simple range queries.
**Cons**: Inserting or moving a node requires renumbering `lft`/`rgt` for potentially the entire tree. This makes writes extremely expensive and prone to contention.

#### Pattern Comparison

| Feature | parent_id + CTE | Materialized Path | Closure Table | Nested Set |
|---------|:-:|:-:|:-:|:-:|
| **Read all descendants** | Recursive query | `LIKE '/1/%'` | Simple JOIN | Range query |
| **Read ancestors** | Recursive query | Parse path string | Simple JOIN | Range query |
| **Insert node** | 1 INSERT | 1 INSERT (build path) | D+1 INSERTs | Renumber many rows |
| **Move subtree** | 1 UPDATE | Update all descendants' paths | Delete + re-insert | Renumber many rows |
| **Read performance** | Moderate | Good | Excellent | Excellent |
| **Write performance** | Excellent | Good | Moderate | Poor |
| **Implementation complexity** | Low | Low | Moderate | High |
| **Referential integrity** | FK enforced | None (string path) | FK enforced | None (numbers) |

---

### 2.4 Comment Systems — A Classic Self-Reference Use Case

Comment systems are perhaps the most common place developers encounter self-referencing design decisions.

#### Single-Depth Comments (Flat + Reply-to)

Most services (YouTube, Instagram) only support 1 level of nesting: top-level comments and replies.

```sql
CREATE TABLE comments (
    id         BIGINT    PRIMARY KEY AUTO_INCREMENT,
    post_id    BIGINT    NOT NULL,
    user_id    BIGINT    NOT NULL,
    parent_id  BIGINT    NULL,  -- NULL = top-level, non-NULL = reply
    content    TEXT      NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comment_post   FOREIGN KEY (post_id)   REFERENCES posts(id),
    CONSTRAINT fk_comment_user   FOREIGN KEY (user_id)   REFERENCES users(id),
    CONSTRAINT fk_comment_parent FOREIGN KEY (parent_id) REFERENCES comments(id),
    INDEX idx_comment_post (post_id),
    INDEX idx_comment_parent (parent_id)
);
```

For single-depth, you only need to check: is `parent_id` NULL (top-level) or non-NULL (reply)? No recursion needed.

```sql
-- Fetch all comments for a post, grouped by thread
SELECT
    c.id, c.content, c.parent_id, c.created_at, u.name AS author
FROM comments c
JOIN users u ON c.user_id = u.id
WHERE c.post_id = 42
ORDER BY
    COALESCE(c.parent_id, c.id),  -- Group by thread (top-level id)
    c.parent_id IS NOT NULL,       -- Top-level first
    c.created_at;                  -- Then replies in chronological order
```

#### Infinite-Depth Nested Comments (Reddit-Style)

If you truly need unlimited nesting (Reddit, Hacker News), `parent_id` alone works but requires recursive queries for display.

**Practical recommendation**: Most services actually need 2-3 levels of depth at most. If you cap the depth, the simple `parent_id` + `depth` column approach works perfectly:

```sql
CREATE TABLE comments (
    id         BIGINT    PRIMARY KEY AUTO_INCREMENT,
    post_id    BIGINT    NOT NULL,
    user_id    BIGINT    NOT NULL,
    parent_id  BIGINT    NULL,
    depth      INT       NOT NULL DEFAULT 0,
    content    TEXT      NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_comment_depth CHECK (depth <= 3),  -- Cap at 3 levels
    CONSTRAINT fk_comment_parent FOREIGN KEY (parent_id) REFERENCES comments(id),
    INDEX idx_comment_post (post_id)
);
```

If infinite depth is truly required, **Materialized Path is the most practical choice**: it doesn't require recursive queries for display, it's simple to implement, and the read pattern (fetch all comments for a post, sort by path) is straightforward.

```sql
CREATE TABLE comments (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    post_id    BIGINT       NOT NULL,
    user_id    BIGINT       NOT NULL,
    path       VARCHAR(500) NOT NULL,  -- e.g., '/1/5/12/'
    depth      INT          NOT NULL DEFAULT 0,
    content    TEXT         NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_comment_post_path (post_id, path)
);

-- Display comments in threaded order
SELECT * FROM comments WHERE post_id = 42 ORDER BY path;
```

---

### 2.5 Self-References in Practice

| Pattern | Adoption | Reality |
|---------|:---:|--------|
| **parent_id + app-level recursion** | ★★★★★ | Default choice for everyone. Simple, well-understood |
| **parent_id + CTE** | ★★★★☆ | Standard for MySQL 8.0+ / PostgreSQL. But many teams still do recursion in app code |
| **Materialized Path** | ★★★☆☆ | Common for comment systems and breadcrumb-heavy UIs. Easy to implement, easy to query |
| **Closure Table** | ★★☆☆☆ | Used by teams that need fast descendant queries AND have manageable tree sizes |
| **Nested Set** | ★☆☆☆☆ | Rarely used in modern systems. Write penalty is too severe for most use cases |

> **Practical advice**: Start with `parent_id`. Add `WITH RECURSIVE` when you need tree queries. If recursive CTEs are too slow for your scale, migrate to Materialized Path or Closure Table. Skip Nested Set unless you have a read-heavy, nearly-static tree.

---

## 3. Polymorphic Associations

**Problem**: "One table needs to reference multiple types of parents."

Example: Your system has posts, photos, and videos. All of them can have comments. Do you create `post_comments`, `photo_comments`, and `video_comments`? Or is there a better way?

This is the **polymorphic association** problem. There are four common patterns, each with different trade-offs.

---

### 3.1 Pattern 1: STI (Single Table Inheritance)

Put all types in one table with a `type` discriminator column.

```sql
-- All content types in one table
CREATE TABLE contents (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    type        VARCHAR(20)  NOT NULL,  -- 'POST', 'PHOTO', 'VIDEO'
    title       VARCHAR(200),           -- used by POST
    body        TEXT,                    -- used by POST
    image_url   VARCHAR(500),           -- used by PHOTO
    video_url   VARCHAR(500),           -- used by VIDEO, PHOTO (thumbnail)
    duration    INT,                    -- used by VIDEO (seconds)
    resolution  VARCHAR(20),            -- used by PHOTO, VIDEO
    user_id     BIGINT       NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_content_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_content_type (type)
);

-- Comments reference contents — one table, one FK
CREATE TABLE comments (
    id         BIGINT    PRIMARY KEY AUTO_INCREMENT,
    content_id BIGINT    NOT NULL,
    user_id    BIGINT    NOT NULL,
    body       TEXT      NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comment_content FOREIGN KEY (content_id) REFERENCES contents(id),
    CONSTRAINT fk_comment_user    FOREIGN KEY (user_id)    REFERENCES users(id)
);
```

**Pros**:
- No JOINs needed — all data in one table
- Comments have a straightforward FK
- Simple queries: `SELECT * FROM contents WHERE type = 'POST'`

**Cons**:
- Many NULL columns — posts don't have `video_url`, videos don't have `body`
- Hard to enforce per-type constraints (e.g., "PHOTOs must have `image_url`") — CHECK constraints become complex
- Table grows wider as you add more types
- Wasted storage for NULLs (though modern engines handle this efficiently)

```sql
-- Per-type constraint attempt (gets messy fast)
ALTER TABLE contents ADD CONSTRAINT chk_post_fields
    CHECK (type != 'POST' OR (title IS NOT NULL AND body IS NOT NULL));
ALTER TABLE contents ADD CONSTRAINT chk_photo_fields
    CHECK (type != 'PHOTO' OR image_url IS NOT NULL);
ALTER TABLE contents ADD CONSTRAINT chk_video_fields
    CHECK (type != 'VIDEO' OR (video_url IS NOT NULL AND duration IS NOT NULL));
```

**Best when**: Types share most columns and differ only in a few. The number of types is small (2-5) and unlikely to grow rapidly.

---

### 3.2 Pattern 2: Separate Tables (Class Table Inheritance / Concrete Table Inheritance)

#### Class Table Inheritance (CTI)

Common columns in a parent table, type-specific columns in child tables.

```sql
-- Shared columns
CREATE TABLE contents (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    type       VARCHAR(20)  NOT NULL,
    user_id    BIGINT       NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_content_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_content_type (type)
);

-- Post-specific
CREATE TABLE posts (
    content_id BIGINT       PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    body       TEXT         NOT NULL,
    CONSTRAINT fk_post_content FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);

-- Photo-specific
CREATE TABLE photos (
    content_id  BIGINT       PRIMARY KEY,
    image_url   VARCHAR(500) NOT NULL,
    resolution  VARCHAR(20),
    CONSTRAINT fk_photo_content FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);

-- Video-specific
CREATE TABLE videos (
    content_id  BIGINT       PRIMARY KEY,
    video_url   VARCHAR(500) NOT NULL,
    duration    INT          NOT NULL,
    resolution  VARCHAR(20),
    CONSTRAINT fk_video_content FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);

-- Comments reference the parent table — clean FK
CREATE TABLE comments (
    id         BIGINT    PRIMARY KEY AUTO_INCREMENT,
    content_id BIGINT    NOT NULL,
    user_id    BIGINT    NOT NULL,
    body       TEXT      NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comment_content FOREIGN KEY (content_id) REFERENCES contents(id),
    CONSTRAINT fk_comment_user    FOREIGN KEY (user_id)    REFERENCES users(id)
);
```

**Pros**:
- Clean schema — no NULL columns, each table has exactly the columns it needs
- Per-type constraints are straightforward (`NOT NULL` on type-specific required columns)
- Comments FK works perfectly — points to the `contents` parent table
- Adding a new type = adding a new child table (no schema change to existing tables)

**Cons**:
- Querying a post with its common data requires a JOIN: `SELECT * FROM contents c JOIN posts p ON c.id = p.content_id`
- Inserting a post requires two INSERTs (parent + child)
- Slightly more complex than STI

#### Concrete Table Inheritance

Each type gets its own complete table with all columns duplicated.

```sql
CREATE TABLE posts (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    title      VARCHAR(200) NOT NULL,
    body       TEXT         NOT NULL,
    user_id    BIGINT       NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE photos (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    image_url  VARCHAR(500) NOT NULL,
    resolution VARCHAR(20),
    user_id    BIGINT       NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

This avoids the JOIN overhead but makes the polymorphic association problem worse — comments can't FK to a single parent table. You'd need separate comment tables or the polymorphic FK pattern.

**Best when**: Types share very few columns and are queried independently. Avoid if you need a unified "all content" view.

---

### 3.3 Pattern 3: JSON Columns

Store type-specific attributes in a JSON column.

```sql
CREATE TABLE contents (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    type       VARCHAR(20)  NOT NULL,
    user_id    BIGINT       NOT NULL,
    attributes JSON         NOT NULL,  -- type-specific data
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_content_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_content_type (type)
);

-- Post
INSERT INTO contents (type, user_id, attributes) VALUES
('POST', 1, '{"title": "Hello World", "body": "This is my first post"}');

-- Photo
INSERT INTO contents (type, user_id, attributes) VALUES
('PHOTO', 1, '{"image_url": "/img/sunset.jpg", "resolution": "4032x3024"}');

-- Video
INSERT INTO contents (type, user_id, attributes) VALUES
('VIDEO', 1, '{"video_url": "/vid/demo.mp4", "duration": 120, "resolution": "1920x1080"}');
```

#### MySQL JSON vs PostgreSQL JSONB

| Feature | MySQL JSON | PostgreSQL JSONB |
|---------|------------|------------------|
| **Storage** | Text-like (validated JSON) | Binary format (parsed on write) |
| **Indexing** | Multi-valued index (8.0.17+) | GIN index on any key/path |
| **Querying** | `JSON_EXTRACT(attr, '$.title')` or `attr->'$.title'` | `attributes->>'title'` or `attributes @> '{"type":"POST"}'` |
| **Partial update** | `JSON_SET()` (rewrites entire value) | `jsonb_set()` (true partial update) |
| **Validation** | JSON Schema via CHECK (manual) | JSON Schema via CHECK (manual) |
| **Performance** | Slower for complex queries | Faster (binary format + GIN indexes) |

```sql
-- PostgreSQL: JSONB indexing
CREATE INDEX idx_content_attributes ON contents USING GIN (attributes);

-- Query by JSON field
SELECT * FROM contents
WHERE type = 'POST' AND attributes->>'title' LIKE '%Hello%';

-- MySQL: JSON extraction
SELECT * FROM contents
WHERE type = 'POST' AND JSON_EXTRACT(attributes, '$.title') LIKE '%Hello%';
```

**Pros**:
- Extremely flexible — add new attributes without schema changes
- No NULL columns for type-specific fields
- Works well for truly variable/optional metadata

**Cons**:
- DB cannot enforce constraints inside JSON (e.g., "title must be non-empty for posts")
- JOIN on JSON fields is expensive
- JSON values are harder to aggregate, sort, and index compared to proper columns
- Schema validation moves entirely to the application

**Best when**: Type-specific attributes are highly variable, frequently changing, or truly optional metadata. Not recommended for core business fields that need constraints and indexing.

---

### 3.4 Pattern 4: Polymorphic FK (commentable_type + commentable_id)

This is the pattern popularized by Rails (ActiveRecord) and Laravel (Eloquent):

```sql
CREATE TABLE comments (
    id               BIGINT       PRIMARY KEY AUTO_INCREMENT,
    commentable_type VARCHAR(50)  NOT NULL,  -- 'Post', 'Photo', 'Video'
    commentable_id   BIGINT       NOT NULL,  -- FK to the referenced table
    user_id          BIGINT       NOT NULL,
    body             TEXT         NOT NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_commentable (commentable_type, commentable_id)
);

-- Comment on a post
INSERT INTO comments (commentable_type, commentable_id, user_id, body)
VALUES ('Post', 42, 1, 'Great post!');

-- Comment on a photo
INSERT INTO comments (commentable_type, commentable_id, user_id, body)
VALUES ('Photo', 7, 1, 'Beautiful shot!');
```

**Pros**:
- Very flexible — any new entity type can have comments without schema changes
- Single comments table for all types
- Framework support makes it effortless in Rails/Laravel

**Cons**:
- **No FK constraint possible.** `commentable_id` can't reference multiple tables. The DB has zero knowledge that `commentable_id = 42` with `commentable_type = 'Post'` should reference `posts.id = 42`. **Referential integrity is entirely the application's responsibility.**
- Orphaned records are inevitable — delete a post, and its comments remain (unless the app explicitly handles this).
- `JOIN` queries require conditional logic:

```sql
-- Fetching comment with its parent — awkward
SELECT c.*,
    CASE c.commentable_type
        WHEN 'Post'  THEN p.title
        WHEN 'Photo' THEN ph.image_url
        WHEN 'Video' THEN v.video_url
    END AS parent_info
FROM comments c
LEFT JOIN posts p   ON c.commentable_type = 'Post'  AND c.commentable_id = p.id
LEFT JOIN photos ph ON c.commentable_type = 'Photo' AND c.commentable_id = ph.id
LEFT JOIN videos v  ON c.commentable_type = 'Video' AND c.commentable_id = v.id;
```

#### A Critical Perspective

The polymorphic FK pattern is popular because ORMs make it easy. But from a database design perspective, it's a compromise:

```
FK constraint: ❌ Cannot be enforced
Referential integrity: App-level only
Orphan prevention: App-level only
Query optimization: Harder (conditional JOINs)
DB documentation: Type column is a "stringly typed" reference
```

**This doesn't mean you should never use it.** But you should understand the trade-off: you're sacrificing DB-level integrity for application-level convenience. If referential integrity matters (and it usually does), consider Class Table Inheritance instead.

---

### 3.5 Pattern Comparison + Practical Decision Guide

| Feature | STI | CTI (Class Table) | JSON Column | Polymorphic FK |
|---------|:---:|:---:|:---:|:---:|
| **FK integrity** | Yes | Yes | Yes | **No** |
| **Per-type constraints** | Hard (CHECK) | Easy (NOT NULL) | **No** | N/A |
| **NULL columns** | Many | None | None | None |
| **Query simplicity** | No JOINs | 1 JOIN | No JOINs | Conditional JOINs |
| **Adding new types** | Add columns | Add table | No schema change | No schema change |
| **ORM support** | Excellent | Good | Good | Excellent (Rails/Laravel) |
| **Recommended when** | Few types, similar columns | Many types, different columns | Variable metadata | Rapid prototyping, framework-driven |

#### Decision Flowchart

```
Q1: Do you need DB-level FK integrity for the polymorphic reference?
│
├─ YES ──→ Q2: Do types share most columns?
│          │
│          ├─ YES ──→ STI (Single Table)
│          └─ NO  ──→ CTI (Class Table Inheritance)
│
└─ NO ───→ Q3: Are type-specific attributes highly variable?
           │
           ├─ YES ──→ JSON Column
           └─ NO  ──→ Polymorphic FK (with app-level integrity)
```

#### Polymorphic Associations in Practice

| Pattern | Adoption | Reality |
|---------|:---:|--------|
| **STI** | ★★★★☆ | Default in many ORMs (JPA `@Inheritance(SINGLE_TABLE)`). Simple and practical for 2-4 types |
| **CTI** | ★★★☆☆ | Used by teams that value clean schemas. More effort but better long-term maintainability |
| **JSON Column** | ★★★☆☆ | Growing rapidly with PostgreSQL JSONB adoption. Popular for configuration/metadata columns |
| **Polymorphic FK** | ★★★★☆ | Ubiquitous in Rails/Laravel ecosystems. Works fine with proper app-level discipline |

> **Practical advice**: If you're building from scratch with no framework constraints, CTI gives the cleanest long-term result. If you're in a Rails/Laravel project, polymorphic FK is the path of least resistance — just be aware of what you're giving up at the DB level.

---

## 4. Junction Table Design — Deep Dive

Junction tables deserve more attention than they usually get. They're not just "the table in the middle" — they often become critical parts of the schema.

### 4.1 Basic Junction Table

The minimal junction table connects two entities with a composite PK:

```sql
CREATE TABLE article_tags (
    article_id BIGINT NOT NULL,
    tag_id     BIGINT NOT NULL,
    PRIMARY KEY (article_id, tag_id),
    CONSTRAINT fk_at_article FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    CONSTRAINT fk_at_tag     FOREIGN KEY (tag_id)     REFERENCES tags(id)     ON DELETE CASCADE
);
```

This is sufficient when the relationship itself carries no additional meaning — you only need to know that article X has tag Y.

---

### 4.2 Adding Meaning to Junction Tables

In practice, relationships carry metadata. Track when, how, and in what capacity the relationship was established.

```sql
-- Team membership with roles and timestamps
CREATE TABLE team_members (
    id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
    team_id    BIGINT       NOT NULL,
    user_id    BIGINT       NOT NULL,
    role       VARCHAR(20)  NOT NULL DEFAULT 'MEMBER',
    joined_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    invited_by BIGINT       NULL,
    CONSTRAINT uq_team_member UNIQUE (team_id, user_id),
    CONSTRAINT fk_tm_team    FOREIGN KEY (team_id)    REFERENCES teams(id) ON DELETE CASCADE,
    CONSTRAINT fk_tm_user    FOREIGN KEY (user_id)    REFERENCES users(id),
    CONSTRAINT fk_tm_inviter FOREIGN KEY (invited_by) REFERENCES users(id),
    CONSTRAINT chk_tm_role   CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'))
);
```

Notice: this table has a surrogate PK (`id`) because it has grown beyond a simple junction — it has its own attributes, constraints, and even an FK (`invited_by`) that other logic may reference.

#### When to Add a Surrogate PK

Switch from composite PK to surrogate PK when:

1. **Other tables need to FK to this junction table** — composite FKs are unwieldy
2. **The junction table has its own lifecycle** — status changes, soft deletes, audit trails
3. **You need a stable URL-friendly identifier** — `/memberships/123` is cleaner than `/teams/5/users/8`
4. **Your ORM struggles with composite PKs** — pragmatic, even if theoretically unnecessary

---

### 4.3 Ternary Relationships

Sometimes a relationship involves three (or more) entities simultaneously. A project member has a user, a project, AND a role — where the role is an entity, not just a string.

```sql
CREATE TABLE roles (
    id   BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50)  NOT NULL UNIQUE  -- 'Developer', 'Designer', 'PM', etc.
);

CREATE TABLE project_members (
    id         BIGINT    PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT    NOT NULL,
    user_id    BIGINT    NOT NULL,
    role_id    BIGINT    NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_project_user_role UNIQUE (project_id, user_id, role_id),
    CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id),
    CONSTRAINT fk_pm_role    FOREIGN KEY (role_id)    REFERENCES roles(id)
);
```

The UNIQUE constraint here depends on business rules:
- `UNIQUE (project_id, user_id)` — a user can have only ONE role per project
- `UNIQUE (project_id, user_id, role_id)` — a user can have MULTIPLE roles per project, but no duplicates

Another example: a scheduling system where a doctor, patient, and time slot form a ternary relationship.

```sql
CREATE TABLE appointments (
    id         BIGINT    PRIMARY KEY AUTO_INCREMENT,
    doctor_id  BIGINT    NOT NULL,
    patient_id BIGINT    NOT NULL,
    slot_id    BIGINT    NOT NULL,
    status     VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    notes      TEXT,
    CONSTRAINT uq_slot_doctor  UNIQUE (slot_id, doctor_id),   -- one doctor per slot
    CONSTRAINT uq_slot_patient UNIQUE (slot_id, patient_id),  -- one patient per slot
    CONSTRAINT fk_appt_doctor  FOREIGN KEY (doctor_id)  REFERENCES doctors(id),
    CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
    CONSTRAINT fk_appt_slot    FOREIGN KEY (slot_id)    REFERENCES time_slots(id)
);
```

---

### 4.4 Junction Tables in Practice

| Aspect | Reality |
|--------|--------|
| **Starting simple** | Most teams start with a composite-PK junction table and add columns as requirements emerge. This is fine — migration from composite PK to surrogate PK is straightforward. |
| **Naming** | `user_roles`, `article_tags`, `team_members` — name it after the domain concept. Avoid generic `x_y_mapping` names. |
| **Indexes** | Always index both FK columns. The composite PK or UNIQUE covers queries in one direction, but you need an explicit index for the reverse direction. |
| **Soft delete** | If the junction table supports soft delete (`deleted_at`), the UNIQUE constraint must account for it — otherwise you can't re-establish a deleted relationship. Use partial UNIQUE (PostgreSQL) or generated column workaround (MySQL). |
| **Audit trail** | For important relationships (team membership, role assignments), consider adding `created_by`, `updated_at` columns. Or use a separate audit log table. |

> **Practical advice**: Don't over-design junction tables upfront. Start with the composite PK pattern, add columns as real requirements appear, and switch to a surrogate PK when the table outgrows its "junction" identity.

---

## 5. MySQL vs PostgreSQL — Relationship Design Differences

| Feature | MySQL | PostgreSQL |
|---------|-------|------------|
| **WITH RECURSIVE** | 8.0+ (2018) | Supported since 8.4 (2005) |
| **JSON support** | JSON type (5.7+), multi-valued index (8.0.17+) | JSONB with GIN index, `@>`, `?` operators — significantly richer |
| **Table inheritance** | Not supported | `INHERITS` keyword — real table inheritance |
| **EXCLUDE constraints** | Not supported | Range/overlap prevention (covered in [Part 3](/blog/en/rdb-constraints-integrity-guide)) |
| **Partial indexes** | Not supported | `CREATE INDEX ... WHERE condition` — crucial for soft-delete scenarios |
| **Array columns** | Not supported | `INT[]`, `TEXT[]` with GIN index — can replace simple junction tables |
| **FK on partitioned tables** | Not supported | Supported (12+) |
| **DEFERRABLE FK** | Not supported | `INITIALLY DEFERRED` — check FK at commit, not at each statement |

### Notable Differences for Relationship Design

#### PostgreSQL Table Inheritance

PostgreSQL has a built-in `INHERITS` feature:

```sql
-- PostgreSQL only
CREATE TABLE contents (
    id         SERIAL PRIMARY KEY,
    user_id    INT    NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE posts (
    title VARCHAR(200) NOT NULL,
    body  TEXT NOT NULL
) INHERITS (contents);

CREATE TABLE photos (
    image_url  VARCHAR(500) NOT NULL,
    resolution VARCHAR(20)
) INHERITS (contents);

-- Query all content types at once
SELECT * FROM contents;  -- Includes rows from posts AND photos

-- Query only posts
SELECT * FROM ONLY posts;
```

However, PostgreSQL's `INHERITS` has significant limitations:
- **Indexes and constraints are not inherited** — you must create them on each child table
- **UNIQUE and FK constraints don't span parent + children** — a UNIQUE on `contents.id` doesn't prevent duplicates across `posts` and `photos`
- **Most ORMs don't support it** — JPA, Django ORM, ActiveRecord all ignore INHERITS

For these reasons, `INHERITS` is rarely used in production. CTI with explicit tables and FKs is more reliable.

#### PostgreSQL Arrays as Simple Junction Table Replacement

```sql
-- PostgreSQL: Array column instead of junction table
CREATE TABLE articles (
    id      SERIAL       PRIMARY KEY,
    title   VARCHAR(200) NOT NULL,
    tag_ids INT[]        NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_articles_tags ON articles USING GIN (tag_ids);

-- Query articles with tag id 5
SELECT * FROM articles WHERE tag_ids @> ARRAY[5];

-- Add a tag
UPDATE articles SET tag_ids = array_append(tag_ids, 8) WHERE id = 1;
```

**When this works**: small, fixed-size collections of IDs where you rarely need to JOIN to the related table. Tag IDs where you just need containment checks.

**When this doesn't work**: when you need FK integrity, when you need to query from the other direction ("which articles have this tag?"), when the array can grow unbounded, or when you need additional relationship metadata.

#### DEFERRABLE FK — Why It Matters for Relationships

```sql
-- PostgreSQL: Deferred FK checking
CREATE TABLE nodes (
    id        INT PRIMARY KEY,
    next_id   INT,
    CONSTRAINT fk_next FOREIGN KEY (next_id) REFERENCES nodes(id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Circular reference: node 1 → node 2 → node 1
BEGIN;
INSERT INTO nodes (id, next_id) VALUES (1, 2);  -- node 2 doesn't exist yet — OK (deferred)
INSERT INTO nodes (id, next_id) VALUES (2, 1);  -- node 1 exists — OK
COMMIT;  -- FK constraints checked here — both are valid
```

Without `DEFERRABLE`, the first INSERT would fail because `next_id = 2` doesn't exist yet. MySQL doesn't support this — you'd need to INSERT with NULL and UPDATE afterwards.

---

## Summary

| Topic | Key Principle |
|-------|--------------|
| **1:1** | Default to one table. Split only for optional data, security isolation, or performance separation |
| **1:N** | FK in the child table, always indexed. Default to RESTRICT on delete. Watch for unbounded N |
| **N:M** | Junction table with composite PK or surrogate PK + UNIQUE. Name it after the domain concept |
| **Self-reference** | Start with parent_id + CTE. Graduate to Materialized Path or Closure Table if reads are slow |
| **Polymorphic** | CTI for integrity, STI for simplicity, Polymorphic FK for framework convenience, JSON for flexibility |
| **Junction tables** | Start simple, add columns as needed, switch to surrogate PK when it becomes its own entity |
| **MySQL vs PostgreSQL** | PostgreSQL has richer relationship features (JSONB, arrays, DEFERRABLE FK, partial indexes, INHERITS) |

**Relationships are where schema design gets real.** Tables and constraints are building blocks — relationships define how they connect into a coherent system. The patterns in this post aren't theoretical exercises. They're the exact decisions you'll face when modeling users, orders, comments, permissions, categories, and every other domain entity in your next project.

### Real-World Adoption — At a Glance

| Pattern | Adoption | Reality |
|---------|:---:|--------|
| **1:N with FK** | ★★★★★ | The fundamental relationship. Used by every relational schema in existence |
| **N:M junction table** | ★★★★★ | Unavoidable for many-to-many. Every non-trivial app has at least one |
| **parent_id self-reference** | ★★★★☆ | Default for hierarchies. Combined with CTE in modern systems |
| **STI** | ★★★★☆ | Popular due to ORM support and simplicity |
| **Polymorphic FK** | ★★★★☆ | Framework-driven adoption. Works fine with discipline, risky without it |
| **CTI** | ★★★☆☆ | Cleaner than STI but more effort. Chosen by teams that prioritize schema integrity |
| **Materialized Path** | ★★★☆☆ | Go-to for comment systems and category trees beyond simple parent_id |
| **Closure Table** | ★★☆☆☆ | Niche but powerful. Worth knowing even if you don't use it often |
| **JSON Column** | ★★★☆☆ | Rising with JSONB. Good for metadata, dangerous for core business data |
| **1:1 split** | ★★☆☆☆ | Rare in practice. Most 1:1 relationships should be one table |
| **Nested Set** | ★☆☆☆☆ | Historical pattern, largely replaced by CTE and Materialized Path |

**"Which pattern should I use?" — A pragmatic answer**:

```
[Start here]   1:N with indexed FK + parent_id for trees
[Add when needed] N:M junction tables + STI for polymorphism
[When scale demands] Materialized Path + JSONB metadata
[Rarely needed] Closure Table, Nested Set, CTI, INHERITS
```

The best relationship design is the one your team can understand, maintain, and evolve. Start simple, add complexity only when concrete problems demand it, and always keep referential integrity as close to the database level as possible.

Next up: **Part 5 — Real-World Domain Schema Design** — applying everything from Parts 1-4 to model actual business domains: e-commerce, social media, booking systems, and more.
