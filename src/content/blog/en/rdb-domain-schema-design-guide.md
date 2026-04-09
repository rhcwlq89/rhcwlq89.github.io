---
title: "RDB Design Series Part 5: Real-World Domain Schema Design — Orders, Permissions, and Design Reviews"
description: "Theory meets practice. Order/payment system with state machines and idempotency, RBAC permission table patterns, FCFS inventory schema retrospective, and a schema design review checklist — practical domain schema design you can use immediately."
pubDate: "2026-04-08T18:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Domain Modeling", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbDomainSchemaDesignGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-relationship-patterns-guide), we covered every relationship pattern: 1:1, 1:N, N:M, self-referencing, and polymorphic associations. The theory toolkit is complete.

The problem is: **"I understand the patterns, but how do I apply them to a real domain?"**

Even with solid knowledge of naming conventions, normalization, constraints, and relationship patterns, you can freeze when facing an actual business domain. "How do I store order status transitions?", "How do I guarantee payment idempotency at the schema level?", "How do I model a permission system in tables?" — these questions don't have answers in pattern theory alone.

This post designs schemas for 3 real-world domains:

1. **Order/Payment System** — State machines, idempotency, audit trails
2. **RBAC Permission System** — Role-based access control table design
3. **FCFS Inventory System** — Retrospective on the [FCFS series](/blog/en/fcfs-system-comparison-guide)

And finally, a **Schema Design Review Checklist** you can use when reviewing migration files in PRs.

---

## 1. Order/Payment System Schema Design

The core domain of e-commerce, and the area where schema design gets most complex. An order isn't simple CRUD — **status changes, payments are processed, refunds happen, and everything needs an audit trail**.

### 1.1 Overall ERD Structure

```
users ──1:N──→ orders ──1:N──→ order_items ──N:1──→ products
                  │
                  ├──1:N──→ payments
                  │
                  ├──1:N──→ order_status_histories
                  │
                  └──1:N──→ refunds
```

Let's design each table.

### 1.2 Orders Table — State Machine Design

The core of an order is its **status**. An order transitions through multiple states, and each state has defined valid transitions.

```
PENDING → PAID → PREPARING → SHIPPED → DELIVERED → COMPLETED
    │        │                                         │
    └→ CANCELLED  └→ REFUND_REQUESTED → REFUNDED      └→ REVIEWED
```

#### How to Store Status

```sql
CREATE TABLE orders (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    order_number    VARCHAR(30) NOT NULL,              -- externally visible order number
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    total_amount    DECIMAL(12, 2) NOT NULL,
    shipping_fee    DECIMAL(8, 2) NOT NULL DEFAULT 0,
    shipping_name   VARCHAR(100) NOT NULL,
    shipping_phone  VARCHAR(20) NOT NULL,
    shipping_addr   VARCHAR(500) NOT NULL,
    ordered_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at         TIMESTAMP,
    shipped_at      TIMESTAMP,
    delivered_at    TIMESTAMP,
    completed_at    TIMESTAMP,
    cancelled_at    TIMESTAMP,

    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT uq_orders_order_number UNIQUE (order_number),
    CONSTRAINT chk_orders_status CHECK (
        status IN ('PENDING', 'PAID', 'PREPARING', 'SHIPPED',
                   'DELIVERED', 'COMPLETED', 'CANCELLED',
                   'REFUND_REQUESTED', 'REFUNDED', 'REVIEWED')
    )
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_ordered_at ON orders(ordered_at);
```

**Design Points:**

**1) `order_number` vs `id`**

Never expose the auto-increment `id` in APIs or UIs. Use `order_number` (e.g., `ORD-20260408-00001`) instead:

- Exposing sequential IDs lets competitors estimate total order volume
- Sequential numbers make it easy to enumerate other users' orders (IDOR vulnerability)
- Business-facing numbers can encode useful context (date, channel, region)

```sql
-- ❌ Exposing internal id
GET /orders/42

-- ✅ Using order_number
GET /orders/ORD-20260408-00001
```

**2) Status Timestamps vs History Table**

We store `paid_at`, `shipped_at`, etc. directly on the orders table because:

- "When was this order paid?" is the most frequent query — it should be a direct read without JOINs
- Status timestamps are a **snapshot of the current state**
- Detailed history (who changed the status, when, and why) goes in a separate history table

This is the **intentional denormalization** discussed in [Part 2](/blog/en/rdb-normalization-guide). Instead of running `MAX(changed_at)` queries against the history table for every request, we store frequently accessed values directly on the order.

**3) Status CHECK Constraint**

The CHECK constraint on `status` prevents typos and invalid values at the database level. This is the practical application of "preventing bugs with schema" from [Part 3](/blog/en/rdb-constraints-integrity-guide).

> However, **state transition rules** (e.g., PENDING cannot jump directly to SHIPPED) are hard to express with CHECK. Those belong in application-level state machine logic.

### 1.3 Order Items Table — The Snapshot Pattern

```sql
CREATE TABLE order_items (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT NOT NULL,
    product_id      BIGINT NOT NULL,
    -- snapshot at order time
    product_name    VARCHAR(200) NOT NULL,     -- product name snapshot
    product_price   DECIMAL(10, 2) NOT NULL,   -- unit price snapshot
    quantity        INT NOT NULL,
    subtotal        DECIMAL(12, 2) NOT NULL,   -- product_price × quantity

    CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_order_items_subtotal CHECK (subtotal > 0)
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
```

**Why copy `product_name` and `product_price`?**

Product prices can change. But **an item already ordered must reflect the price at the time of purchase.** If a product was $100 when ordered and later increased to $120, the original order amount must not change.

This is the **snapshot pattern** from [Part 2](/blog/en/rdb-normalization-guide). From a normalization perspective it's redundancy, but from a business perspective it's mandatory.

```sql
-- ❌ This changes historical order amounts when product price changes
SELECT oi.quantity, p.price, oi.quantity * p.price AS total
FROM order_items oi
JOIN products p ON oi.product_id = p.id;

-- ✅ Calculated from order-time prices
SELECT quantity, product_price, subtotal
FROM order_items
WHERE order_id = 123;
```

### 1.4 Payments Table — Idempotency Design

Payments must be processed **exactly once**. Network timeouts cause retries, users double-click the pay button — if any of these result in duplicate charges, you have a serious problem.

```sql
CREATE TABLE payments (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT NOT NULL,
    idempotency_key     VARCHAR(64) NOT NULL,          -- idempotency key
    payment_method      VARCHAR(20) NOT NULL,           -- CARD, BANK_TRANSFER, KAKAO_PAY, ...
    amount              DECIMAL(12, 2) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    pg_transaction_id   VARCHAR(100),                   -- payment gateway transaction ID
    pg_response         JSON,                           -- raw PG response
    attempted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at        TIMESTAMP,
    failed_at           TIMESTAMP,
    failure_reason      VARCHAR(500),

    CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT uq_payments_idempotency UNIQUE (idempotency_key),
    CONSTRAINT chk_payments_status CHECK (
        status IN ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED')
    ),
    CONSTRAINT chk_payments_amount CHECK (amount > 0)
);

CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);
```

**How the idempotency key works:**

```
1st attempt: idempotency_key = 'pay_abc123' → INSERT succeeds → process payment
2nd attempt: idempotency_key = 'pay_abc123' → UNIQUE violation → return existing result
```

When the client retries with the same `idempotency_key`, the UNIQUE constraint prevents a duplicate INSERT, and the application returns the existing payment result. **Duplicate payments are structurally impossible at the schema level.**

Idempotency key generation strategies:

| Strategy | Example | Pros | Cons |
|----------|---------|------|------|
| **Client UUID** | `pay_550e8400-e29b-41d4-...` | Client-independent | Meaningless if client generates new key each time |
| **Order number + attempt** | `ORD-20260408-00001_attempt_1` | Intuitive, easy to debug | Attempt counter management needed |
| **Order ID + hash** | `order_123_sha256(...)` | Deterministic server-side generation | Hash collision (extremely rare) |

> In practice, **order-number-based** idempotency keys are most common. When debugging, you can immediately see which order and which attempt a payment belongs to.

**Why is payments 1:N with orders?**

A single order can have multiple payment attempts:

```
Attempt 1: Card limit exceeded → FAILED
Attempt 2: Different card → CONFIRMED
```

Or if split payments (card + points mix) are supported, multiple payment records per order are needed. That's why it's 1:N, not 1:1.

### 1.5 Order Status History Table

```sql
CREATE TABLE order_status_histories (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT NOT NULL,
    from_status     VARCHAR(20),                        -- NULL for initial creation
    to_status       VARCHAR(20) NOT NULL,
    changed_by      VARCHAR(100) NOT NULL,              -- 'SYSTEM', 'ADMIN:kim', 'USER:123'
    reason          VARCHAR(500),                        -- change reason (refund reason, etc.)
    changed_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_history_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_history_order_id ON order_status_histories(order_id);
CREATE INDEX idx_order_history_changed_at ON order_status_histories(changed_at);
```

The history table is **essential for debugging and auditing**.

```sql
-- Full status change history for order #123
SELECT from_status, to_status, changed_by, reason, changed_at
FROM order_status_histories
WHERE order_id = 123
ORDER BY changed_at;
```

```
from_status | to_status        | changed_by  | reason              | changed_at
------------|------------------|-------------|---------------------|-------------------
NULL        | PENDING          | SYSTEM      | Order created       | 2026-04-08 10:00
PENDING     | PAID             | SYSTEM      | Payment confirmed   | 2026-04-08 10:01
PAID        | PREPARING        | ADMIN:kim   |                     | 2026-04-08 11:00
PREPARING   | SHIPPED          | ADMIN:kim   | Tracking: 123456    | 2026-04-08 15:00
```

`changed_by` is stored as a string because various actors can change status: automated systems, admins, users, batch scripts. Using FK would require a polymorphic relationship, so a simple string identifier is more practical.

### 1.6 Refunds Table

```sql
CREATE TABLE refunds (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT NOT NULL,
    payment_id      BIGINT NOT NULL,
    amount          DECIMAL(12, 2) NOT NULL,
    reason          VARCHAR(500) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    pg_refund_id    VARCHAR(100),                       -- PG refund ID
    requested_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at    TIMESTAMP,

    CONSTRAINT fk_refunds_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
    CONSTRAINT chk_refunds_status CHECK (
        status IN ('REQUESTED', 'PROCESSING', 'COMPLETED', 'REJECTED')
    ),
    CONSTRAINT chk_refunds_amount CHECK (amount > 0)
);

CREATE INDEX idx_refunds_order_id ON refunds(order_id);
CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
```

**Why separate refunds into their own table?**

- Partial refunds are possible — refund $30 of a $100 order
- Multiple refunds can occur per order — first partial refund, then additional refund
- Refunds have their own state machine (REQUESTED → PROCESSING → COMPLETED)
- Refunds have unique attributes like PG refund ID and processing timestamp

The sum of refund amounts must not exceed the original payment amount. This can't be expressed with a CHECK constraint (it requires referencing other rows), so it's validated at the application level.

### 1.7 Full ERD and Design Principles Summary

```sql
-- Structure overview
-- users(id) ←── orders(user_id)
--                  orders(id) ←── order_items(order_id)
--                  orders(id) ←── payments(order_id)
--                  orders(id) ←── order_status_histories(order_id)
--                  orders(id) ←── refunds(order_id)
--                  payments(id) ←── refunds(payment_id)
--                  products(id) ←── order_items(product_id)
```

| Design Principle | Application |
|-----------------|-------------|
| **Snapshot pattern** | order_items stores product name/price at order time |
| **Idempotency** | payments.idempotency_key with UNIQUE constraint |
| **State machine** | orders.status with CHECK constraint + app-level transition rules |
| **Audit trail** | order_status_histories for change tracking |
| **Denormalization** | orders stores paid_at, shipped_at directly |
| **External ID separation** | order_number (external) vs id (internal) |
| **1:N relationships** | One order can have multiple payment attempts and refunds |

---

## 2. RBAC Permission System Schema Design

RBAC (Role-Based Access Control) **manages permissions through roles**. Instead of assigning permissions directly to users, you assign roles to users and connect permissions to roles.

### 2.1 Why RBAC?

The evolution of permission management:

```
Level 0: Hardcoded
  if (user.email == "admin@company.com") { ... }
  → Code changes required for every user change 💀

Level 1: is_admin flag
  users table with is_admin BOOLEAN
  → Only 2 levels: admin vs regular user

Level 2: role column
  users table with role VARCHAR ('ADMIN', 'MANAGER', 'USER')
  → Roles are distinguished, but no fine-grained permissions
  → One user can't have multiple roles (violates 1NF from Part 1)

Level 3: RBAC
  users ←→ roles ←→ permissions
  → Flexible combination of roles and permissions
```

### 2.2 Basic RBAC Table Design

```sql
-- Roles
CREATE TABLE roles (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    description VARCHAR(200),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_roles_name UNIQUE (name)
);

-- Permissions
CREATE TABLE permissions (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    resource    VARCHAR(50) NOT NULL,              -- 'order', 'product', 'user', ...
    action      VARCHAR(20) NOT NULL,              -- 'read', 'create', 'update', 'delete'
    description VARCHAR(200),

    CONSTRAINT uq_permissions_resource_action UNIQUE (resource, action)
);

-- Roles ↔ Permissions (N:M)
CREATE TABLE role_permissions (
    role_id       BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id),

    CONSTRAINT fk_rp_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_rp_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);

-- Users ↔ Roles (N:M)
CREATE TABLE user_roles (
    user_id     BIGINT NOT NULL,
    role_id     BIGINT NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by BIGINT,                            -- who granted this role
    PRIMARY KEY (user_id, role_id),

    CONSTRAINT fk_ur_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_ur_role
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_ur_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);
```

Structure:

```
users ──N:M──→ roles ──N:M──→ permissions
         │                        │
    user_roles              role_permissions
```

This is the practical application of **N:M Junction Tables** from [Part 4](/blog/en/rdb-relationship-patterns-guide). Both `user_roles` and `role_permissions` are junction tables.

### 2.3 Sample Data

```sql
-- Create roles
INSERT INTO roles (id, name, description) VALUES
    (1, 'SUPER_ADMIN',   'Full access'),
    (2, 'ORDER_MANAGER', 'Order management'),
    (3, 'PRODUCT_EDITOR','Product editing'),
    (4, 'VIEWER',        'Read-only access');

-- Create permissions
INSERT INTO permissions (id, resource, action) VALUES
    (1, 'order',   'read'),
    (2, 'order',   'create'),
    (3, 'order',   'update'),
    (4, 'order',   'delete'),
    (5, 'product', 'read'),
    (6, 'product', 'create'),
    (7, 'product', 'update'),
    (8, 'product', 'delete'),
    (9, 'user',    'read'),
    (10, 'user',   'create'),
    (11, 'user',   'update'),
    (12, 'user',   'delete');

-- Assign permissions to roles
-- SUPER_ADMIN: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- ORDER_MANAGER: all order + read product/user
INSERT INTO role_permissions (role_id, permission_id) VALUES
    (2, 1), (2, 2), (2, 3), (2, 4),   -- order: *
    (2, 5),                             -- product: read
    (2, 9);                             -- user: read

-- PRODUCT_EDITOR: all product + read order
INSERT INTO role_permissions (role_id, permission_id) VALUES
    (3, 5), (3, 6), (3, 7), (3, 8),   -- product: *
    (3, 1);                             -- order: read

-- VIEWER: read only
INSERT INTO role_permissions (role_id, permission_id) VALUES
    (4, 1), (4, 5), (4, 9);            -- order/product/user: read
```

### 2.4 Permission Check Queries

```sql
-- Get all permissions for user #42
SELECT DISTINCT p.resource, p.action
FROM user_roles ur
INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
INNER JOIN permissions p ON rp.permission_id = p.id
WHERE ur.user_id = 42;

-- Check if user #42 has 'order:update' permission
SELECT EXISTS(
    SELECT 1
    FROM user_roles ur
    INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
    INNER JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = 42
      AND p.resource = 'order'
      AND p.action = 'update'
) AS has_permission;
```

That's 3 JOINs. Running this query on every API request will cause performance issues. In practice, **caching is essential**:

```
Request → Check cache for permissions → If miss, query DB → Store in cache
Role change → Invalidate that user's cache
```

Caching permission lists in Redis under keys like `user:{userId}:permissions` is standard practice.

### 2.5 Extension: Role Hierarchy

Sometimes roles need parent-child relationships. "SUPER_ADMIN automatically includes all ORDER_MANAGER permissions."

```sql
-- Self-referencing for role hierarchy
ALTER TABLE roles ADD COLUMN parent_role_id BIGINT;
ALTER TABLE roles ADD CONSTRAINT fk_roles_parent
    FOREIGN KEY (parent_role_id) REFERENCES roles(id);
```

```
SUPER_ADMIN (parent: NULL)
  ├── ORDER_MANAGER (parent: SUPER_ADMIN)
  └── PRODUCT_EDITOR (parent: SUPER_ADMIN)
        └── VIEWER (parent: PRODUCT_EDITOR)
```

This is the **self-referencing pattern** from [Part 4](/blog/en/rdb-relationship-patterns-guide) in practice. Permission checks need recursive CTEs to include parent role permissions.

```sql
-- User's roles + all ancestor roles
WITH RECURSIVE role_hierarchy AS (
    -- Directly assigned roles
    SELECT r.id, r.name, r.parent_role_id
    FROM user_roles ur
    INNER JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = 42

    UNION ALL

    -- Parent roles (upward traversal)
    SELECT r.id, r.name, r.parent_role_id
    FROM roles r
    INNER JOIN role_hierarchy rh ON r.id = rh.parent_role_id
)
SELECT DISTINCT p.resource, p.action
FROM role_hierarchy rh
INNER JOIN role_permissions rp ON rh.id = rp.role_id
INNER JOIN permissions p ON rp.permission_id = p.id;
```

> **Role hierarchies often add more complexity than value.** If you have fewer than 10 roles, directly assigning permissions to each role is clearer. Hierarchies make it harder to answer "what permissions does this role actually have?" Only consider hierarchies when roles grow to dozens and permission combinations become unwieldy.

### 2.6 Extension: Resource-Level Permissions

"This user has product:update permission, but only for products they created" — when you need this level of granularity:

```sql
CREATE TABLE user_permissions_override (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    permission_id   BIGINT NOT NULL,
    resource_id     BIGINT,                            -- specific resource ID (NULL = all)
    granted         BOOLEAN NOT NULL DEFAULT TRUE,      -- TRUE: allow, FALSE: deny
    expires_at      TIMESTAMP,                          -- for temporary permissions

    CONSTRAINT fk_upo_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_upo_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT uq_upo UNIQUE (user_id, permission_id, resource_id)
);
```

This approaches **ABAC (Attribute-Based Access Control)** territory. Most services don't need this — basic RBAC is sufficient. SaaS platforms or enterprise systems may require it.

### 2.7 RBAC in Practice

```
Service Scale              → Recommended Approach
──────────────────────────────────────────────────
MVP / Small service        → users.role VARCHAR column is enough
Medium service             → Basic RBAC (users ↔ roles ↔ permissions)
Large SaaS                 → RBAC + resource-level permissions + cache
Enterprise                 → RBAC + hierarchy + ABAC + audit logs
```

Building full RBAC from day one is over-engineering. Start with a `users.role` column, then migrate to RBAC tables when roles exceed 3 or fine-grained permissions become necessary.

---

## 3. FCFS Inventory System — Design Retrospective

In the [FCFS (First-Come-First-Served) series](/blog/en/fcfs-system-comparison-guide), we implemented FCFS systems using DB locks, Redis, queues, and tokens. Here we retrospect from a **schema design perspective**.

### 3.1 Basic Inventory Table

The schema from the [DB Lock post](/blog/en/fcfs-db-lock-implementation):

```sql
CREATE TABLE products (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    stock_quantity  INT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'ON_SALE',

    CONSTRAINT chk_products_stock CHECK (stock_quantity >= 0)
);
```

Let's examine the shortcomings of this design with fresh eyes.

### 3.2 Issue 1: What If There's No CHECK Constraint on stock_quantity?

```sql
-- Without CHECK, only app-level validation exists
-- Under concurrency, race conditions can occur:
UPDATE products SET stock_quantity = stock_quantity - 1
WHERE id = 1;
-- stock_quantity can go from 0 to -1!
```

The `CHECK (stock_quantity >= 0)` constraint serves as the **last line of defense**. This is a textbook example of "preventing invalid state with schema" from [Part 3](/blog/en/rdb-constraints-integrity-guide).

If `SELECT FOR UPDATE` and app-level validation work correctly, the CHECK will never trigger. But it's not a "safety net we can skip" — it's a "safety net we must have." It seems pointless when there are no bugs, but proves invaluable when bugs exist.

### 3.3 Issue 2: No Stock Movement History

Directly updating stock_quantity leaves no trace of "who changed what, when, and by how much." The number remains but the context disappears.

```sql
-- Add stock movement history table
CREATE TABLE stock_movements (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id      BIGINT NOT NULL,
    type            VARCHAR(20) NOT NULL,              -- 'PURCHASE', 'CANCEL', 'REFUND', 'ADJUSTMENT'
    quantity_change  INT NOT NULL,                      -- positive: increase, negative: decrease
    quantity_after   INT NOT NULL,                      -- stock after change
    reference_type   VARCHAR(20),                       -- 'ORDER', 'REFUND', 'ADMIN'
    reference_id     BIGINT,                            -- related order/refund ID
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_stock_movements_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT chk_stock_movements_quantity_after CHECK (quantity_after >= 0)
);

CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);
```

```sql
-- Stock movement history for product #1
SELECT type, quantity_change, quantity_after, reference_type, reference_id, created_at
FROM stock_movements
WHERE product_id = 1
ORDER BY created_at;
```

```
type        | quantity_change | quantity_after | reference_type | reference_id | created_at
------------|---------------|----------------|---------------|-------------|-------------------
ADJUSTMENT  | 100           | 100            | ADMIN          | NULL        | 2026-04-01 10:00
PURCHASE    | -1            | 99             | ORDER          | 1001        | 2026-04-08 10:01
PURCHASE    | -1            | 98             | ORDER          | 1002        | 2026-04-08 10:02
CANCEL      | 1             | 99             | ORDER          | 1001        | 2026-04-08 11:00
```

With a history table:
- **Debugging**: "Why doesn't the stock count match?" → trace history to find the cause
- **Auditing**: "Who manually adjusted stock?" → query rows where reference_type = 'ADMIN'
- **Recovery**: Precisely reverse incorrect deductions

### 3.4 Issue 3: No Reserved Stock Concept

In real e-commerce, orders awaiting payment need to "hold" inventory. Other users shouldn't be able to claim that stock before payment completes.

```sql
-- Improved stock table
CREATE TABLE product_stocks (
    product_id      BIGINT PRIMARY KEY,
    total_quantity  INT NOT NULL DEFAULT 0,            -- total stock
    reserved_quantity INT NOT NULL DEFAULT 0,          -- reserved stock (payment pending)
    -- available = total_quantity - reserved_quantity   (calculated in app)

    CONSTRAINT fk_product_stocks_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT chk_total_quantity CHECK (total_quantity >= 0),
    CONSTRAINT chk_reserved_quantity CHECK (reserved_quantity >= 0),
    CONSTRAINT chk_reserved_not_exceed CHECK (reserved_quantity <= total_quantity)
);
```

Stock deduction flow:

```
1. Order created → reserved_quantity += 1 (reserve)
2. Payment confirmed → reserved_quantity -= 1, total_quantity -= 1 (commit)
3. Payment failed/timeout → reserved_quantity -= 1 (release)
```

```sql
-- On order creation: reserve
UPDATE product_stocks
SET reserved_quantity = reserved_quantity + 1
WHERE product_id = 1
  AND (total_quantity - reserved_quantity) >= 1;
-- affected rows = 0 means out of stock

-- On payment confirmation: commit
UPDATE product_stocks
SET total_quantity = total_quantity - 1,
    reserved_quantity = reserved_quantity - 1
WHERE product_id = 1;

-- On payment failure: release
UPDATE product_stocks
SET reserved_quantity = reserved_quantity - 1
WHERE product_id = 1;
```

The `CHECK (reserved_quantity <= total_quantity)` constraint prevents the abnormal state of reserved stock exceeding total stock.

> The FCFS series used a single `stock_quantity` for simplicity, but in production e-commerce, the reserved stock pattern is nearly mandatory. Without holding inventory during the payment window (typically 15-30 minutes), stock-outs at payment confirmation time become frequent.

### 3.5 Retrospective Summary

| Aspect | FCFS Series | Improvement |
|--------|------------|-------------|
| **Stock columns** | Single stock_quantity | Split into total_quantity + reserved_quantity |
| **Negative prevention** | App-level if check | CHECK (>= 0) constraint |
| **Movement history** | None | stock_movements history table |
| **Snapshots** | None | order_items with price/name snapshots |
| **Idempotency** | None | idempotency_key UNIQUE constraint |

The FCFS series focused on **comparing concurrency control techniques**, so schemas were intentionally simplified. For production deployment, these improvements should be incorporated.

---

## 4. Schema Design Review Checklist

Use this checklist when a PR includes migration files.

### 4.1 Naming ([Part 1](/blog/en/rdb-schema-basics-guide) Reference)

- [ ] Are table names snake_case and plural?
- [ ] Are column names snake_case with clear meaning?
- [ ] Do boolean columns have `is_` or `has_` prefix?
- [ ] Do FK columns follow `referenced_table_id` format? (e.g., `user_id`, `order_id`)

### 4.2 Data Types ([Part 1](/blog/en/rdb-schema-basics-guide) Reference)

- [ ] Are VARCHAR lengths justified? (not defaulting to 255)
- [ ] Is DECIMAL used for monetary amounts? (not FLOAT/DOUBLE)
- [ ] Is the PK BIGINT? (considering INT's 2.1 billion limit)
- [ ] Is the TIMESTAMP vs DATETIME choice justified?

### 4.3 Normalization/Denormalization ([Part 2](/blog/en/rdb-normalization-guide) Reference)

- [ ] Where the same data exists in multiple places, is it intentional denormalization or a mistake?
- [ ] If denormalized, is there a sync strategy? (trigger? application logic?)
- [ ] Is the snapshot pattern applied where needed? (order-time prices, etc.)

### 4.4 Constraints ([Part 3](/blog/en/rdb-constraints-integrity-guide) Reference)

- [ ] Are columns that should be NOT NULL declared as NOT NULL?
- [ ] Are there business rules that could be expressed as CHECK constraints?
- [ ] Are UNIQUE constraints present everywhere they're needed?
- [ ] Are FKs present where needed? (or is there a documented reason for omission?)
- [ ] Is the ON DELETE strategy appropriate? (CASCADE vs RESTRICT vs SET NULL)

### 4.5 Relationship Design ([Part 4](/blog/en/rdb-relationship-patterns-guide) Reference)

- [ ] Is the 1:1 split truly necessary? Would one table suffice?
- [ ] Do N:M junction tables have bidirectional indexes?
- [ ] For self-referencing tables, has depth limiting been considered?
- [ ] Is the polymorphic pattern choice justified?

### 4.6 Indexes

- [ ] Do FK columns have indexes? (PostgreSQL doesn't auto-create them!)
- [ ] Are frequently queried columns in WHERE, ORDER BY, JOIN indexed?
- [ ] Are there unnecessary indexes? (they impact write performance)

### 4.7 Operational Safety

- [ ] When adding a NOT NULL column to an existing table, is there a DEFAULT?
- [ ] Is the ALTER TABLE safe on large tables? (considering table locks)
- [ ] Is the migration reversible? (adding columns is easy, dropping is risky)

### 4.8 How to Use This Checklist

Don't try to apply every item at once. **Start with the 2-3 items that cause the most problems in your current project.**

```
"Our team keeps forgetting FK indexes"     → Focus on 4.6
"We get NULL bugs from missing NOT NULL"   → Focus on 4.4
"We argue about denormalization every time" → Focus on 4.3
```

The checklist is **a starting point for discussion, not a set of rules.** It should prompt "why did you do it this way?" — and if the answer is "there's a good reason," the checklist can be overridden.

---

## Summary

| Domain | Key Design Points |
|--------|------------------|
| **Order/Payment** | State machine (CHECK), idempotency (idempotency_key UNIQUE), snapshot pattern, audit trail |
| **RBAC Permissions** | Two N:M junction tables (user↔role, role↔permission), caching essential |
| **FCFS Inventory** | CHECK(>=0), reserved stock split (total/reserved), movement history table |
| **Design Review** | Checklist as conversation starter. Focus on 2-3 items first |

Every pattern in this post is a practical application of theory from Parts 1-4:

```
Part 1 Naming/Types → order_number VARCHAR(30), amount DECIMAL(12,2)
Part 2 Normalization → Snapshot pattern (price copies in order_items)
Part 3 Constraints   → CHECK (stock >= 0), UNIQUE (idempotency_key)
Part 4 Relationships → N:M Junction Tables (RBAC), self-reference (role hierarchy)
```

**"Knowing theory" and "applying it in practice" are different skills.** But practicing without theory means repeating the same mistakes. I hope this post bridges some of that gap.

Next up: **Part 6 — Advanced Index Design** — partial indexes, expression indexes, covering indexes, and the relationship between JOIN strategies and indexes.
