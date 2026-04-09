---
title: "RDB Design Series Part 5: Order/Payment Domain Schema — Production-Grade"
description: "Design the e-commerce order domain at production quality. 3-level hierarchy (order → delivery → item), state machines, payment idempotency, split payments, partial refunds, and cancellation audit trails. One domain, all the way down."
pubDate: "2026-04-08T18:00:00+09:00"
tags: ["Database", "RDB", "Schema Design", "Domain Modeling", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/RdbDomainSchemaDesignGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/rdb-relationship-patterns-guide), we covered every relationship pattern: 1:1, 1:N, N:M, self-referencing, and polymorphic associations. The theory toolkit is complete.

The problem is: **"I understand the patterns, but how do I apply them to a real domain?"**

This post focuses on a single domain — the e-commerce **order/payment** domain — and drills into it until the design is actually usable in production. Instead of skimming multiple domains, we push one domain all the way down.

The textbook order schema usually looks like this:

```
orders ──1:N──→ order_items
```

But in real e-commerce (Coupang, Naver, Amazon), this structure falls short badly. A single order splits into multiple deliveries, parts of it get cancelled or refunded, and the payment itself breaks down into card + points + coupon. How to express all of that in the schema is the subject of this post.

What we'll cover:

1. **3-level hierarchy** — `orders → order_deliveries → order_items` and why delivery needs its own level
2. **State machines** — separating order / delivery / item level states
3. **Payment idempotency and split payments** — card + points + coupon in one order
4. **Cancellations and refunds** — cancellation actors, audit trails, item-level refunds
5. **Snapshot pattern beyond products** — capturing shipping addresses too

Permission systems (RBAC) and the FCFS inventory schema retrospective will be covered in a separate post. Showing one domain in depth turns out to be more useful than sprinkling multiple domains thinly.

---

## 1. Why a 3-Level Hierarchy?

### 1.1 The Limits of the Textbook Structure

The most common order schema is two levels:

```
orders (the whole order)
  └── order_items (line items)
```

This structure cannot express the following situations:

- **Partial shipment**: item A ships today, item B ships tomorrow within the same order
- **Split delivery within the same seller**: cold-chain vs ambient, domestic vs international
- **Partial cancellation/refund**: return 3 of 10 items
- **Divergence between order and delivery status**: "order is paid, delivery 1 is in transit, delivery 2 is still being prepared"

None of this fits into a single `status` column on orders. Forcing it either explodes the state enum (`PARTIALLY_SHIPPED_1_OF_3`) or makes the status drift out of sync with the actual data.

### 1.2 The 3-Level Structure

What's used in practice:

```
orders            ─── one order (payment unit)
  └─ order_deliveries  ─── delivery group (physical box unit)
       └─ order_items    ─── line items (products)
```

Responsibilities:

| Level | Responsibility |
|-------|----------------|
| **orders** | Payment, total amount, customer info, shipping address snapshot, overall status |
| **order_deliveries** | Delivery group, tracking number, delivery status, ship/deliver timestamps |
| **order_items** | Line items, product/price/option snapshots, quantity, item status |

This mirrors the reality: "one payment, multiple shipments, multiple items per shipment."

### 1.3 Overall ERD

```
users
  └─1:N─→ orders
            ├─1:N─→ order_deliveries
            │          └─1:N─→ order_items ──N:1─→ products
            │
            ├─1:N─→ payments
            ├─1:N─→ order_status_histories
            ├─1:N─→ order_cancellations
            └─1:N─→ refunds
                     ├─1:N─→ refund_items ──N:1─→ order_items
                     └─1:N─→ refund_payments ──N:1─→ payments
```

Let's design each table.

---

## 2. orders — Order Header and Address Snapshot

```sql
CREATE TABLE orders (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    order_number        VARCHAR(30) NOT NULL,           -- externally exposed identifier
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    -- Amounts (all tax-included)
    items_amount        DECIMAL(12, 2) NOT NULL,        -- sum of line items
    shipping_fee        DECIMAL(8, 2)  NOT NULL DEFAULT 0,
    discount_amount     DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12, 2) NOT NULL,        -- final amount paid

    -- Shipping address snapshot (frozen at order time)
    recipient_name      VARCHAR(100) NOT NULL,
    recipient_phone     VARCHAR(20)  NOT NULL,
    shipping_zipcode    VARCHAR(10)  NOT NULL,
    shipping_address1   VARCHAR(200) NOT NULL,
    shipping_address2   VARCHAR(200),
    shipping_memo       VARCHAR(500),

    -- Status timestamps (denormalized for frequent reads)
    ordered_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at             TIMESTAMP,
    completed_at        TIMESTAMP,
    cancelled_at        TIMESTAMP,

    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT uq_orders_order_number UNIQUE (order_number),
    CONSTRAINT chk_orders_status CHECK (
        status IN ('PENDING', 'PAID',
                   'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'COMPLETED',
                   'PARTIALLY_CANCELLED', 'CANCELLED',
                   'PARTIALLY_REFUNDED', 'REFUNDED')
    ),
    CONSTRAINT chk_orders_total_amount CHECK (total_amount >= 0)
);

CREATE INDEX idx_orders_user_id    ON orders(user_id);
CREATE INDEX idx_orders_status     ON orders(status);
CREATE INDEX idx_orders_ordered_at ON orders(ordered_at);
```

### 2.1 `order_number` vs `id`

Never expose the auto-increment `id` in APIs or the UI. Use `order_number` instead (e.g., `ORD-20260408-00001`).

- Exposing `id` leaks total order volume (competitive intelligence)
- Sequential numbers make it easy to probe other users' orders (IDOR)
- External numbers can embed business rules (date, channel, etc.)

```sql
-- ❌ Exposes internal id
GET /orders/42

-- ✅ Identified by order_number
GET /orders/ORD-20260408-00001
```

### 2.2 Address Snapshot — Why Not Reference `user_addresses`?

If you FK-reference a user's address book (`user_addresses`), this bug is waiting for you:

```
1. Customer orders with "Seoul, Gangnam" as the shipping address
2. Customer later edits that entry in their address book to "Busan, Haeundae"
3. The seller now sees "Busan, Haeundae" on an order that already shipped to Gangnam
4. Dispute.
```

**The shipping address at order time must be frozen at that moment.** The [snapshot pattern from Part 2](/blog/en/rdb-normalization-guide) applies not just to product prices but to shipping addresses too.

It's redundant from a normalization standpoint, but essential from a business standpoint. This is one of those mistakes that hurt when you catch it in production.

### 2.3 State Machine Design

Simple 2-level status:

```
PENDING → PAID → SHIPPED → DELIVERED → COMPLETED
```

3-level hierarchy status is richer:

```
PENDING ──→ PAID ──┬──→ SHIPPED ──→ DELIVERED ──→ COMPLETED
                   │
                   └──→ PARTIALLY_SHIPPED ──→ SHIPPED ──→ ...

(at any stage)
  ──→ PARTIALLY_CANCELLED / CANCELLED
  ──→ PARTIALLY_REFUNDED / REFUNDED
```

Order status is fundamentally **an aggregate of delivery statuses**:

- All deliveries `READY` → order is `PAID`
- Some deliveries `SHIPPED` → order is `PARTIALLY_SHIPPED`
- All deliveries `SHIPPED` → order is `SHIPPED`
- All deliveries `DELIVERED` → order is `DELIVERED`

This aggregation is **computed at application level**, or the order status is **synced whenever a delivery status changes**. CHECK constraints only enforce the allowed set of values — they can't enforce the aggregate consistency. That's an application-layer (or trigger) concern.

### 2.4 Status Timestamps — Why Store Them on orders?

`paid_at` and `cancelled_at` sit on the orders table directly because:

- "When was this order paid?" is the most frequent query → must be readable without joining
- Status timestamps are **snapshots of the current state**
- Detailed history (who changed what, when, why) lives in `order_status_histories`

This is **intentional denormalization** from [Part 2](/blog/en/rdb-normalization-guide).

Notice `shipped_at` and `delivered_at` are **not** on orders. When there are multiple deliveries, "the order's shipment time" becomes ambiguous (first? last?). So those live on `order_deliveries`.

---

## 3. order_deliveries — Delivery Group (The Key Addition)

This is the most important new concept in this post.

```sql
CREATE TABLE order_deliveries (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    delivery_number     VARCHAR(30) NOT NULL,           -- external identifier (e.g., ORD-20260408-00001-D1)
    sequence            SMALLINT    NOT NULL,           -- delivery order within the parent order
    status              VARCHAR(20) NOT NULL DEFAULT 'READY',

    -- Shipping metadata
    carrier             VARCHAR(50),                    -- CJ, DHL, USPS, ...
    tracking_number     VARCHAR(50),

    -- Delivery-level timestamps
    ready_at            TIMESTAMP,
    shipped_at          TIMESTAMP,
    delivered_at        TIMESTAMP,

    CONSTRAINT fk_deliveries_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT uq_deliveries_delivery_number UNIQUE (delivery_number),
    CONSTRAINT uq_deliveries_order_sequence  UNIQUE (order_id, sequence),
    CONSTRAINT chk_deliveries_status CHECK (
        status IN ('READY', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')
    )
);

CREATE INDEX idx_deliveries_order_id ON order_deliveries(order_id);
CREATE INDEX idx_deliveries_status   ON order_deliveries(status);
CREATE INDEX idx_deliveries_tracking ON order_deliveries(tracking_number);
```

### 3.1 Why Split Out Delivery

**Tracking numbers belong to deliveries, not orders.** A single order can carry multiple tracking numbers:

```
Order ORD-20260408-00001 (cold chain + ambient)
  ├─ Delivery 1 (D1): cold items A, B    → tracking CJ-1234
  └─ Delivery 2 (D2): ambient items C, D → tracking CJ-5678
```

- Put tracking on orders → you can't represent multiple tracking numbers
- Put tracking on order_items → you can't represent "A and B are in the same box" (same tracking duplicated on two rows)

**A delivery corresponds to a physical box**, so it belongs in its own entity.

### 3.2 Delivery State Machine

```
READY ──→ SHIPPED ──→ IN_TRANSIT ──→ DELIVERED
  │
  └──→ CANCELLED
```

- `READY`: paid, being prepared for shipment
- `SHIPPED`: handed off to the carrier, tracking number assigned
- `IN_TRANSIT`: in transit (only meaningful if you integrate with carrier webhooks)
- `DELIVERED`: received
- `CANCELLED`: the delivery group is cancelled before shipment

`IN_TRANSIT` only matters when you have carrier webhooks. Without them, you jump straight from `SHIPPED` to `DELIVERED`.

### 3.3 `delivery_number` — Another External ID?

Yes. For customer support, "the second delivery of order ORD-20260408-00001" is less clear than "delivery `ORD-20260408-00001-D2`".

You could identify deliveries by `(order_number, sequence)`, but a single-column identifier is easier for lookups, logs, and URLs. Saving a few bytes of storage at the cost of query complexity is a bad trade.

---

## 4. order_items — Snapshots and Item Status

```sql
CREATE TABLE order_items (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT NOT NULL,                -- denormalized for direct lookup
    order_delivery_id   BIGINT NOT NULL,
    product_id          BIGINT NOT NULL,

    -- Snapshot at order time
    product_name        VARCHAR(200)  NOT NULL,
    product_option      VARCHAR(200),                   -- "color: black, size: M"
    unit_price          DECIMAL(10, 2) NOT NULL,
    quantity            INT            NOT NULL,
    subtotal            DECIMAL(12, 2) NOT NULL,        -- unit_price * quantity

    -- Item-level status and aggregates
    status              VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
    cancelled_quantity  INT NOT NULL DEFAULT 0,
    refunded_quantity   INT NOT NULL DEFAULT 0,

    CONSTRAINT fk_items_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_delivery
        FOREIGN KEY (order_delivery_id) REFERENCES order_deliveries(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT chk_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_items_subtotal CHECK (subtotal > 0),
    CONSTRAINT chk_items_status CHECK (
        status IN ('ORDERED', 'PARTIALLY_CANCELLED', 'CANCELLED',
                   'PARTIALLY_REFUNDED', 'REFUNDED')
    ),
    CONSTRAINT chk_items_cancelled_quantity CHECK (
        cancelled_quantity >= 0 AND cancelled_quantity <= quantity
    ),
    CONSTRAINT chk_items_refunded_quantity CHECK (
        refunded_quantity >= 0 AND refunded_quantity <= quantity
    ),
    CONSTRAINT chk_items_total_removed CHECK (
        cancelled_quantity + refunded_quantity <= quantity
    )
);

CREATE INDEX idx_items_order_id    ON order_items(order_id);
CREATE INDEX idx_items_delivery_id ON order_items(order_delivery_id);
CREATE INDEX idx_items_product_id  ON order_items(product_id);
```

### 4.1 Why Store Both `order_id` and `order_delivery_id`?

Technically, `order_delivery_id` alone is enough — you could always trace back through `order_deliveries.order_id`. But we duplicate `order_id` because:

```sql
-- Without order_id — join through delivery
SELECT oi.*
FROM order_items oi
JOIN order_deliveries od ON oi.order_delivery_id = od.id
WHERE od.order_id = 42;

-- With order_id — one index lookup
SELECT * FROM order_items WHERE order_id = 42;
```

"All items for this order" is the most frequent query in the domain. One less JOIN and a direct index hit make this optimization worthwhile.

The cost: **the denormalization can drift.** If `order_items.order_id` and `order_deliveries.order_id` disagree, you have a bug. The simplest defense is **set both at INSERT time in application code and disallow updates**. Stronger: enforce it with a trigger.

This trade-off shows up constantly in practice — "duplicate a derivable column to simplify reads?" There's no universal answer. Weigh **read frequency against write complexity**.

### 4.2 Product and Option Snapshots

Product prices change. Product names change. Option combinations (S/M/L, colors) get added or removed.

**The price, name, and option at order time must stay frozen at that moment.** This is the snapshot pattern from [Part 2](/blog/en/rdb-normalization-guide).

```sql
-- ❌ Uses current price (past orders' amounts drift)
SELECT oi.quantity * p.price
FROM order_items oi JOIN products p ON oi.product_id = p.id;

-- ✅ Uses the snapshotted price
SELECT subtotal FROM order_items WHERE order_id = 42;
```

`product_option` is usually better as a flat string than JSON. Order history is "data humans read", and "color: black, size: M" is easier for CS, settlement, and Excel exports than a nested JSON blob.

### 4.3 Item-Level Cancelled/Refunded Quantities

`cancelled_quantity` and `refunded_quantity` live directly on the item because:

```
Item A, quantity 10
  ├─ 3 cancelled (before shipment) → cancelled_quantity = 3
  ├─ 2 refunded (after return)     → refunded_quantity  = 2
  └─ 5 still valid                 → 10 - 3 - 2
```

You can compute "still valid quantity" instantly, without joining. The detailed history (which refund took how many) lives in `refund_items`. Here we keep **just the aggregates, denormalized**.

Enforce `cancelled_quantity + refunded_quantity <= quantity` with a CHECK. It's your last line of defense against application bugs corrupting item state. Multi-column CHECKs on the same row are supported by both MySQL 8.0 and PostgreSQL.

---

## 5. payments — Idempotency and Split Payments

A payment must happen **exactly once**. Network retries, double-clicks on the pay button — any of these can cause a duplicate charge, and duplicates are disasters.

```sql
CREATE TABLE payments (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    idempotency_key     VARCHAR(64) NOT NULL,

    payment_method      VARCHAR(20)    NOT NULL,        -- CARD, POINT, COUPON, KAKAO_PAY, ...
    amount              DECIMAL(12, 2) NOT NULL,
    status              VARCHAR(20)    NOT NULL DEFAULT 'PENDING',

    -- PSP details (NULL for POINT/COUPON)
    pg_provider         VARCHAR(30),
    pg_transaction_id   VARCHAR(100),
    pg_response         JSON,

    attempted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at        TIMESTAMP,
    failed_at           TIMESTAMP,
    failure_reason      VARCHAR(500),

    CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT uq_payments_idempotency UNIQUE (idempotency_key),
    CONSTRAINT chk_payments_status CHECK (
        status IN ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED')
    ),
    CONSTRAINT chk_payments_method CHECK (
        payment_method IN ('CARD', 'POINT', 'COUPON', 'BANK_TRANSFER',
                           'KAKAO_PAY', 'NAVER_PAY', 'TOSS')
    ),
    CONSTRAINT chk_payments_amount CHECK (amount > 0)
);

CREATE INDEX idx_payments_order_id       ON payments(order_id);
CREATE INDEX idx_payments_status         ON payments(status);
CREATE INDEX idx_payments_pg_transaction ON payments(pg_transaction_id);
```

### 5.1 The Role of the Idempotency Key

```
Attempt 1: idempotency_key = 'pay_abc123' → INSERT ok  → process payment
Attempt 2: idempotency_key = 'pay_abc123' → UNIQUE fail → return existing result
```

If a client retries with the same key, the UNIQUE constraint blocks the duplicate INSERT, and the application returns the existing payment result. **Double payment is prevented at the schema level** — the safest place for this kind of invariant.

Key generation strategies:

| Strategy | Example | Pros | Cons |
|----------|---------|------|------|
| Client UUID | `pay_550e8400-e29b-...` | Client-independent | Worthless if client regenerates every retry |
| Order number + method + attempt | `ORD-...-CARD-1` | Easy to debug | Must track attempt counter |
| Order ID + hash | `order_123_sha256(...)` | Deterministic server-side | Theoretical collision (vanishingly small) |

In practice, **order-number-based keys are the most common**. They let you read "which payment attempt of which order, via which method" directly from the key.

### 5.2 Split Payments — Why 1:N?

A single order often uses multiple payment methods:

```
Total: $100
  ├─ payments[1]: POINT   $10
  ├─ payments[2]: COUPON  $5
  └─ payments[3]: CARD    $85
                  ────
                  $100 = orders.total_amount
```

Modeling points and coupons as "payment methods" gives you:

- Natural tracking of "refund points as points" when refunds happen
- Accounting can separate "cash payments" from "point payments"
- PSP payments and internal asset deductions live in one consistent table

**Invariant:** `SUM(payments.amount WHERE order_id = X AND status = 'CONFIRMED') == orders.total_amount`. This spans multiple rows, so CHECK can't enforce it. Validate in application code or a trigger.

### 5.3 Retries Are Also 1:N

Even without split payments, payments is 1:N:

```
Attempt 1: card limit exceeded → FAILED
Attempt 2: different card      → CONFIRMED
```

Keep failed attempts. Don't delete them. The reason is **customer support**. "Why did my payment fail the first time?" can't be answered if you've deleted the failure record.

---

## 6. order_status_histories — Which Levels to Track?

Order-level, delivery-level, item-level status — where do we log history?

```sql
CREATE TABLE order_status_histories (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,           -- 'ORDER' or 'DELIVERY'
    entity_id       BIGINT      NOT NULL,
    from_status     VARCHAR(20),                    -- NULL for initial creation
    to_status       VARCHAR(20) NOT NULL,
    changed_by      VARCHAR(100) NOT NULL,          -- 'SYSTEM', 'ADMIN:kim', 'USER:123', 'WEBHOOK:CJ'
    reason          VARCHAR(500),
    changed_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_order_history_entity_type CHECK (
        entity_type IN ('ORDER', 'DELIVERY')
    )
);

CREATE INDEX idx_order_history_entity     ON order_status_histories(entity_type, entity_id);
CREATE INDEX idx_order_history_changed_at ON order_status_histories(changed_at);
```

### 6.1 Recommended: Order + Delivery Level Only

- **Order level** (PENDING → PAID → ...): the customer journey
- **Delivery level** (READY → SHIPPED → DELIVERED): physical fulfillment
- **Item level**: not recommended. Cancellation/refund history already lives in `order_cancellations` and `refund_items`, so logging item status here is redundant

Over-tracking bloats the history table and makes debugging harder (which table do I look at?). **Only log at levels where the history is meaningful.**

### 6.2 `entity_type + entity_id` Is Polymorphic

This is the **polymorphic association** pattern from [Part 4](/blog/en/rdb-relationship-patterns-guide). You lose FK enforcement, but for history tables — where "many types, same shape" is the norm — it's an acceptable trade-off.

If that offends you, split into `order_status_histories` and `delivery_status_histories`. Pick based on query patterns:

- "I want to see the whole history of one order in one query" → one table is easier
- "I mostly query delivery history separately" → separate tables are cleaner

### 6.3 Types of `changed_by`

- `SYSTEM`: automatic processing (payment webhooks, timeouts, etc.)
- `ADMIN:kim`: manual admin intervention
- `USER:123`: customer action (cancellation request, etc.)
- `WEBHOOK:CJ`: external system (carrier delivery confirmation)

`changed_by` isn't an FK because the actor isn't always a user — it can be the system, an admin, or an external webhook. A string is the **practical** choice.

---

## 7. order_cancellations — Cancellation Audit

You could squeeze cancellation into `order_status_histories`, but it deserves its own table. Cancellation centers on **reason** and **actor**, and for partial cancellations also **which delivery/item** was cancelled.

```sql
CREATE TABLE order_cancellations (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    order_delivery_id   BIGINT,                         -- NULL = whole order cancelled

    -- Who and why
    cancelled_by_type   VARCHAR(20) NOT NULL,           -- CUSTOMER, SELLER, ADMIN, SYSTEM
    cancelled_by_id     VARCHAR(100),                   -- user_id/admin_id, NULL if SYSTEM
    reason_code         VARCHAR(50) NOT NULL,           -- 'CUSTOMER_CHANGED_MIND', 'OUT_OF_STOCK', ...
    reason_detail       VARCHAR(1000),

    -- Link to refund (when cancellation triggers an immediate refund)
    refund_id           BIGINT,

    cancelled_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_cancellations_order
        FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT fk_cancellations_delivery
        FOREIGN KEY (order_delivery_id) REFERENCES order_deliveries(id),
    CONSTRAINT chk_cancellations_by_type CHECK (
        cancelled_by_type IN ('CUSTOMER', 'SELLER', 'ADMIN', 'SYSTEM')
    )
);

CREATE INDEX idx_cancellations_order_id    ON order_cancellations(order_id);
CREATE INDEX idx_cancellations_reason_code ON order_cancellations(reason_code);
```

### 7.1 Why Tracking the Actor Matters

For CS, settlement, and sales analytics, **the cancellation actor is decisive**:

| Actor | What it tells you |
|-------|-------------------|
| `CUSTOMER` | Return rate, churn patterns |
| `SELLER` | Stock-out rate, seller reliability |
| `ADMIN` | Operational interventions, fraud blocks |
| `SYSTEM` | Payment timeouts, automatic stock-out cancellations |

Without this split, "cancelled" becomes a black box. You can't separate "seller stock-out" from "customer changed mind", and seller quality metrics become impossible. Add this column from day one — retrofitting it is painful.

### 7.2 `reason_code` vs `reason_detail`

`reason_code` is a **fixed enum**; `reason_detail` is **free text**.

```
reason_code   = 'OUT_OF_STOCK'
reason_detail = 'Supplier out of stock, restocking after April 15'
```

Codes are for aggregation and reporting; text is for customer support. You need both. Having only the code loses context; having only text makes reporting impossible.

---

## 8. refunds + refund_items — Item-Level Refunds

Why are refunds complicated:

- **Partial refunds**: refund $30 out of a $100 order
- **Item-level refunds**: track which product was refunded
- **Split-payment refunds**: refund card money to the card, points to points
- **Multiple refunds**: a second refund after a first partial one

To express all four cleanly, refunds also decompose into three tables.

```sql
-- Refund request (one refund operation)
CREATE TABLE refunds (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    refund_number       VARCHAR(30) NOT NULL,           -- external identifier
    amount              DECIMAL(12, 2) NOT NULL,        -- sum over refund_items
    status              VARCHAR(20)    NOT NULL DEFAULT 'REQUESTED',
    reason_code         VARCHAR(50)    NOT NULL,
    reason_detail       VARCHAR(1000),
    requested_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at        TIMESTAMP,

    CONSTRAINT fk_refunds_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT uq_refunds_refund_number UNIQUE (refund_number),
    CONSTRAINT chk_refunds_status CHECK (
        status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED')
    ),
    CONSTRAINT chk_refunds_amount CHECK (amount > 0)
);

-- Refund items (which line items, how many)
CREATE TABLE refund_items (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    refund_id       BIGINT NOT NULL,
    order_item_id   BIGINT NOT NULL,
    quantity        INT            NOT NULL,
    amount          DECIMAL(12, 2) NOT NULL,

    CONSTRAINT fk_refund_items_refund
        FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE CASCADE,
    CONSTRAINT fk_refund_items_order_item
        FOREIGN KEY (order_item_id) REFERENCES order_items(id),
    CONSTRAINT chk_refund_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_refund_items_amount   CHECK (amount > 0)
);

-- Refund payment distribution (for split payments)
CREATE TABLE refund_payments (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    refund_id       BIGINT NOT NULL,
    payment_id      BIGINT NOT NULL,                    -- the original payment
    amount          DECIMAL(12, 2) NOT NULL,
    pg_refund_id    VARCHAR(100),                       -- PSP refund id
    status          VARCHAR(20)    NOT NULL DEFAULT 'PENDING',

    CONSTRAINT fk_refund_payments_refund
        FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE CASCADE,
    CONSTRAINT fk_refund_payments_payment
        FOREIGN KEY (payment_id) REFERENCES payments(id),
    CONSTRAINT chk_refund_payments_amount CHECK (amount > 0),
    CONSTRAINT chk_refund_payments_status CHECK (
        status IN ('PENDING', 'COMPLETED', 'FAILED')
    )
);

CREATE INDEX idx_refunds_order_id             ON refunds(order_id);
CREATE INDEX idx_refund_items_refund_id       ON refund_items(refund_id);
CREATE INDEX idx_refund_items_order_item_id   ON refund_items(order_item_id);
CREATE INDEX idx_refund_payments_refund_id    ON refund_payments(refund_id);
CREATE INDEX idx_refund_payments_payment_id   ON refund_payments(payment_id);
```

### 8.1 The Full Picture

```
orders ($100)
  ├─ order_items
  │    ├─ Product A × 5 × $10 = $50
  │    └─ Product B × 5 × $10 = $50
  │
  ├─ payments
  │    ├─ POINT $10 [CONFIRMED]
  │    └─ CARD  $90 [CONFIRMED]
  │
  └─ refunds (customer returns 2 units of A, refund total $20)
       ├─ refund_items
       │    └─ order_item_id=1 (A) × 2 × $10 = $20
       │
       └─ refund_payments ($10 to points, $10 to card)
            ├─ payment_id=1 (POINT) $10
            └─ payment_id=2 (CARD)  $10
```

When the first refund completes, `order_items.refunded_quantity` goes from `0 → 2`. If the customer later returns item B, a new refunds row is created and the corresponding `order_items.refunded_quantity` increments again.

### 8.2 "Refund Total Can't Exceed Paid Total"

Can't be expressed as CHECK (multi-row). Validate it in the application:

```sql
-- Maximum refundable amount
SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM payments
     WHERE order_id = ? AND status = 'CONFIRMED')
  - (SELECT COALESCE(SUM(amount), 0) FROM refunds
     WHERE order_id = ? AND status IN ('APPROVED', 'PROCESSING', 'COMPLETED'))
    AS refundable_amount;
```

Acquire an exclusive lock (`SELECT ... FOR UPDATE`) on the order row before computing and inserting, and concurrency is safe. This is a practical application of the pessimistic locking covered in the [FCFS Part 4](/blog/en/fcfs-db-lock-implementation).

### 8.3 Item-Level vs Order-Level Refunds

The simpler alternative is "record refunds only as an amount on the order". But:

- Accounting requires knowing "which product was refunded"
- Seller settlement needs "which product, how many units returned"
- Stock restoration is per-item

If any one of these applies, **item-level refunds are effectively mandatory**. Unless you're at MVP stage, put `refund_items` in from the start. Migrating from order-level to item-level refunds later is **extremely painful** because you'd need to reconstruct historical order context. Decide up front.

---

## 9. Design Principles Summary

| Principle | Where |
|-----------|-------|
| **3-level hierarchy** | orders → order_deliveries → order_items |
| **Address snapshot** | orders copies recipient/address (not an FK to user_addresses) |
| **Product/option snapshot** | order_items copies product_name / unit_price / product_option |
| **Idempotency** | payments.idempotency_key UNIQUE |
| **State machine** | CHECK at order + delivery level, transitions enforced in app |
| **Split payments** | payments 1:N (one row per method) + refund_payments for redistribution |
| **Partial cancel/refund** | order_items.cancelled_quantity / refunded_quantity + refund_items |
| **Cancellation audit** | order_cancellations records actor and reason code |
| **External IDs** | order_number / delivery_number / refund_number (never expose internal id) |
| **History tracking** | order_status_histories (order + delivery only) |
| **Read-optimization denormalization** | order_items.order_id duplicated, orders.paid_at timestamps |

Connection to the earlier posts:

```
Part 1 Naming/Types → order_number VARCHAR(30), amount DECIMAL(12,2)
Part 2 Normalization/Snapshots → product + address + status-timestamp snapshots
Part 3 Constraints → CHECK (cancelled + refunded <= quantity),
                     UNIQUE (idempotency_key, order_number)
Part 4 Relationships → orders-deliveries-items 1:N chain,
                       polymorphic order_status_histories,
                       refund_items as an N:M extension of order_items
```

---

## 10. Schema Design Review Checklist

Use this when reviewing migration files in a PR.

### 10.1 Naming ([Part 1](/blog/en/rdb-schema-basics-guide))

- [ ] Tables named in snake_case plural?
- [ ] Columns in snake_case with clear meaning?
- [ ] Boolean columns prefixed with `is_` or `has_`?
- [ ] FK columns named `<table>_id` (e.g., `user_id`, `order_id`)?

### 10.2 Data Types ([Part 1](/blog/en/rdb-schema-basics-guide))

- [ ] VARCHAR lengths have a reason (not reflexively 255)?
- [ ] Money uses DECIMAL (not FLOAT/DOUBLE)?
- [ ] PKs are BIGINT (considering the 2.1B INT limit)?
- [ ] TIMESTAMP vs DATETIME chosen deliberately?

### 10.3 Normalization/Denormalization ([Part 2](/blog/en/rdb-normalization-guide))

- [ ] Is any duplicated data intentional denormalization or a mistake?
- [ ] Is there a sync strategy for denormalized values?
- [ ] Snapshots applied where needed (prices, addresses, options)?

### 10.4 Constraints ([Part 3](/blog/en/rdb-constraints-integrity-guide))

- [ ] Columns that should be NOT NULL actually declared NOT NULL?
- [ ] Business rules expressible via CHECK (e.g., `cancelled + refunded <= quantity`)?
- [ ] UNIQUE constraints where needed (order_number, idempotency_key)?
- [ ] FKs where they belong?
- [ ] ON DELETE strategy is appropriate?

### 10.5 Relationships ([Part 4](/blog/en/rdb-relationship-patterns-guide))

- [ ] Is a 2-level structure sufficient, or is an intermediate level (delivery etc.) needed?
- [ ] 1:N chain tables have indexes in both directions?
- [ ] Polymorphic associations justified?

### 10.6 Indexes

- [ ] FK columns indexed? (PostgreSQL does **not** auto-create these)
- [ ] Columns in WHERE/ORDER BY/JOIN indexed?
- [ ] Any unnecessary indexes hurting write performance?

### 10.7 Order-Domain-Specific

- [ ] External identifiers (`order_number`, etc.) separated from internal `id`?
- [ ] All necessary snapshots (product, price, option, shipping address) applied?
- [ ] Payment idempotency guaranteed at schema level?
- [ ] Can partial cancellations/refunds be represented?
- [ ] Cancellation actor (customer/seller/admin/system) distinguishable?
- [ ] Split payments (card + points + coupon) representable?
- [ ] Do order/delivery/item level statuses stay consistent?

### 10.8 How to Use the Checklist

Don't apply the whole thing at once. **Start with the 2–3 items that hurt most in your current project.**

```
"Our team keeps forgetting FK indexes"           → focus on 10.6
"NULL bugs because NOT NULL isn't enforced"      → focus on 10.4
"Snapshot rules aren't clear, history breaks"    → focus on 10.3
```

The checklist is **a starting point for conversation, not a ruleset**. It backs up questions like "why is this done this way?". If there's a good answer, ignoring the checklist is fine.

---

## Summary

This post drilled into a single domain — orders — as far as it goes. The key takeaways:

1. **The 3-level hierarchy** (`orders → order_deliveries → order_items`) is the baseline for real e-commerce. Without it, partial shipment, partial cancellation, and partial refund are impossible to express.
2. **The snapshot pattern** isn't just for product prices. It extends to shipping addresses, options, and status timestamps.
3. **The idempotency key** is the single most important tool for preventing double charges. One UNIQUE constraint blocks both application bugs and network retries.
4. **Split payments** (card + points + coupon) fit naturally into a 1:N payments table, and `refund_payments` tracks refund redistribution back to the original methods.
5. **Cancellation and refund history** must record actor and reason code to be useful for CS, settlement, and seller quality analysis.

**"Knowing the theory" and "applying it in production" are different skills.** Even a single domain yields eight tables, dozens of constraints, and a handful of real trade-offs. Each additional domain brings roughly the same weight. Hopefully this post conveys at least some of that weight.

Next up: **RBAC permission system schema design** — role/permission tables, caching strategy, role hierarchies, and resource-level permissions.
