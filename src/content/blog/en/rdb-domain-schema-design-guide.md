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

This is fine for a simple shop. But once you need multiple deliveries within one order, partial cancellations and refunds, or split payments (card + points + coupon), this structure starts feeling cramped. Companies extend it in different ways depending on their scale and fulfillment complexity. This post maps out those options and then picks one (a 3-level structure with a delivery group layer) to design the order domain in depth.

What we'll cover:

1. **Order structure options** — 2-level, 3-level, sibling — when to use which, and the terminology mess around "order detail"
2. **State machines** — separating order / delivery / item level states
3. **Payment idempotency and split payments** — card + points + coupon in one order
4. **Cancellations and refunds** — cancellation actors, audit trails, item-level refunds
5. **Snapshot pattern beyond products** — capturing shipping addresses too

Permission systems (RBAC) and the FCFS inventory schema retrospective will be covered in a separate post. Showing one domain in depth turns out to be more useful than sprinkling multiple domains thinly.

---

## 1. How to Structure the Order Aggregate

### 1.1 Where 2 Levels Run Out

The most common order schema is two levels:

```
orders (the whole order)
  └── order_items (line items)
```

A small shop can run on this forever — single seller, simple fulfillment, no need to split anything. But once the following situations appear, two levels start falling short:

- **Partial shipment**: item A ships today, item B ships tomorrow within the same order
- **Split delivery within the same seller**: cold-chain vs ambient, domestic vs international
- **Partial cancellation/refund**: return 3 of 10 items
- **Divergence between order and delivery status**: "order is paid, delivery 1 is in transit, delivery 2 is still being prepared"

None of this fits into a single `status` column on orders. Forcing it either explodes the state enum (`PARTIALLY_SHIPPED_1_OF_3`) or makes the status drift out of sync with the actual data.

### 1.2 The Three Real-World Options

There isn't a single "correct" alternative. In practice there are three approaches.

**A. 2 levels + per-item external identifiers**

```
orders ──1:N──→ order_items
                (each item has its own externally exposed ID, separate from the order number)
```

The table structure is still 2 levels, but each item gets its **own externally exposed identifier** so customer support, returns, and settlement can operate per-item. The structure stays simple while operations become item-granular. **Limitation**: it's awkward to store delivery-level info (tracking number, delivery status) — you either duplicate it on each item or add a parallel `shipments` table.

**B. 3 levels — an intermediate grouping layer (this post's choice)**

```
orders ──1:N──→ order_groups ──1:N──→ order_items
                (per-seller or per-delivery grouping)
```

Common in marketplace platforms and shops that need seller- or delivery-level grouping. The meaning of the middle layer differs: it can be a **"seller group"** (marketplace) or a **"delivery group"** (single seller splitting cold-chain vs ambient). This post assumes a single-seller shop, so the middle layer is a **"delivery group"** and we call it `order_deliveries`.

**C. Sibling aggregates + junction (large fulfillment style)**

```
orders ──1:N──→ order_items              ← purchase contract (fixed at checkout)
       └─1:N──→ shipments ──1:N──→ shipment_items ──N:1─→ order_items
                                          ← fulfillment (created later by the warehouse)
```

Orders (purchase contract) and shipments (fulfillment) are separate aggregates. This naturally supports **split shipments** (one line shipped across multiple deliveries), deferred delivery planning (the warehouse decides how to pack later), and warehouse reassignment. **Limitation**: more tables, heavier invariants, and unavoidable discussion of DDD aggregate boundaries.

### 1.3 When to Use Which

| Company type | Recommended structure |
|--------------|----------------------|
| Small shop (single seller, simple fulfillment) | A — 2 levels |
| Mid-size single-seller shop (split delivery, partial cancel/refund) | B — 3 levels |
| Marketplace (must group by seller) | B — 3 levels (middle layer = seller group) |
| Large fulfillment (multi-warehouse, split shipments) | C — sibling + junction |
| Traditional SI / ERP (finance, B2B back office) | A or a C-variant |

You cannot claim "most companies use structure X." It depends on scale and fulfillment complexity. Using C for a small shop is over-engineering; using A for a large marketplace is underbuilt.

### 1.4 A Note on the "Order Detail" Terminology

In Korean e-commerce practice, **"order detail" (주문상세)** means different things in different companies, so it's worth being careful when reading references:

| Context | What "order detail" means | Actual structure |
|---------|---------------------------|-------------------|
| Traditional SI / ERP systems | The DTL in `ORDER_MST + ORDER_DTL` — literally order_items | 2 levels (A) |
| Shops using per-item external IDs | Each item's external identifier (distinct from the order number) | 2 levels + external ID (A) |
| Marketplaces / open marketplaces | Per-delivery, per-product, or per-seller grouping | Effectively 3 levels (B) |
| B2B enterprise | Billing / contract header information | Sibling (variant of C) |

A phrase like "order → order detail → order item" usually refers to B's 3-level grouping, while "order → order detail" alone is often A's MST-DTL naming convention. Western systems usually avoid the ambiguity by calling the middle layer "shipment", "fulfillment", or "package group".

### 1.5 The Structure This Post Uses

This post uses **B (3 levels)**. Reasons:

1. Single-seller shops with split deliveries are the most common shape in mid-size e-commerce
2. It expresses partial shipment, cancellation, and refund more naturally than 2 levels
3. Going all the way to C (sibling + junction) forces a discussion of aggregate boundaries that would take this post outside the RDB series' scope

If another pattern fits your situation better, adapt the design below. The middle layer's name also varies with context — `order_groups`, `order_shipments`, `order_details` are all reasonable depending on what the layer represents. This post focuses on **delivery splitting**, so the middle layer is named `order_deliveries`.

Responsibilities:

| Level | Responsibility |
|-------|----------------|
| **orders** | Payment, total amount, customer info, shipping address snapshot, overall status |
| **order_deliveries** | Delivery group, tracking number, delivery status, ship/deliver timestamps |
| **order_items** | Line items, product/price/option snapshots, quantity, item status |

The underlying assumption: "one payment, multiple shipments, multiple items per shipment."

### 1.6 Overall ERD

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
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,            -- internal PK (never exposed)
    user_id                 BIGINT NOT NULL,                              -- the customer (users FK)
    order_number            VARCHAR(30) NOT NULL,                         -- externally exposed identifier (e.g., ORD-20260408-00001)
    status                  VARCHAR(20) NOT NULL DEFAULT 'PENDING',       -- order-level status (aggregated from delivery statuses)

    -- Amounts (all tax-included)
    items_amount            DECIMAL(12, 2) NOT NULL,                      -- sum of line items before discount
    shipping_fee            DECIMAL(8, 2)  NOT NULL DEFAULT 0,            -- shipping cost
    discount_amount         DECIMAL(10, 2) NOT NULL DEFAULT 0,            -- total of coupons/discounts
    total_amount            DECIMAL(12, 2) NOT NULL,                      -- final amount paid (items - discount + shipping)

    -- Shipping address snapshot (frozen at order time)
    recipient_name          VARCHAR(100) NOT NULL,                        -- recipient name
    recipient_phone         VARCHAR(20)  NOT NULL,                        -- recipient phone
    shipping_zipcode        VARCHAR(10)  NOT NULL,                        -- postal code
    shipping_address        VARCHAR(200) NOT NULL,                        -- main address (street/road)
    shipping_address_detail VARCHAR(200),                                 -- detail (unit number, floor, etc.)
    shipping_memo           VARCHAR(500),                                 -- delivery instructions

    -- Status timestamps (denormalized for frequent reads)
    ordered_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- order creation time
    paid_at                 TIMESTAMP,                                    -- payment confirmation time
    completed_at            TIMESTAMP,                                    -- purchase confirmation time
    cancelled_at            TIMESTAMP,                                    -- cancellation time (whole-order cancel)

    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT uq_orders_order_number UNIQUE (order_number),
    CONSTRAINT chk_orders_status CHECK (
        status IN ('PENDING', 'PAID',
                   'PARTIALLY_SHIPPED', 'SHIPPED',
                   'PARTIALLY_DELIVERED', 'DELIVERED', 'COMPLETED',
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

### 2.2 `order_number` Generation Strategies

`order_number` is generated at the application level. Common approaches:

| Strategy | Example | Characteristics |
|----------|---------|-----------------|
| Date + Sequence | `ORD-20260408-00001` | Human-readable, daily reset possible. Requires concurrency control |
| UUID v4 | `550e8400-e29b-41d4-a716-446655440000` | No collisions, great for distributed systems. Poor readability, index-unfriendly |
| UUID v7 | `019654ab-3c4d-7def-8000-abcdef123456` | Time-sortable, fixes UUID v4's index issues |
| Snowflake ID | `176432987654321` | Time + machine + sequence combo, distributed + sortable. Requires implementation or library |
| Prefix + nanoid | `ORD_V1rRnXbaFN` | Short, URL-safe, prefix identifies domain. Collision probability must be managed |

**Practical advice**: For small-to-medium e-commerce, **date + sequence** is the easiest for CS and log tracing. For distributed or microservice architectures, **UUID v7** or **Snowflake** is a better fit. Regardless of the approach, always enforce a `UNIQUE` constraint.

### 2.3 Address Snapshot — Why Not Reference `user_addresses`?

If you FK-reference a user's address book (`user_addresses`), this bug is waiting for you:

```
1. Customer orders with "Seoul, Gangnam" as the shipping address
2. Customer later edits that entry in their address book to "Busan, Haeundae"
3. The seller now sees "Busan, Haeundae" on an order that already shipped to Gangnam
4. Dispute.
```

**The shipping address at order time must be frozen at that moment.** The [snapshot pattern from Part 2](/blog/en/rdb-normalization-guide) applies not just to product prices but to shipping addresses too.

It's redundant from a normalization standpoint, but essential from a business standpoint. This is one of those mistakes that hurt when you catch it in production.

### 2.4 State Machine Design

Simple 2-level status:

```
PENDING → PAID → SHIPPED → DELIVERED → COMPLETED
```

3-level hierarchy status is richer:

```
PENDING ──→ PAID ──→ (PARTIALLY_)SHIPPED ──→ (PARTIALLY_)DELIVERED ──→ COMPLETED

(at any stage)
  ──→ PARTIALLY_CANCELLED / CANCELLED
  ──→ PARTIALLY_REFUNDED / REFUNDED
```

Order status is fundamentally **an aggregate of delivery statuses**:

| Delivery-level combination | Order-level status |
|----------------------------|--------------------|
| All deliveries `READY` | `PAID` |
| Some `SHIPPED`, rest `READY` | `PARTIALLY_SHIPPED` |
| All deliveries at `SHIPPED` or later (none `DELIVERED` yet) | `SHIPPED` |
| Some `DELIVERED`, the rest still in transit | `PARTIALLY_DELIVERED` |
| All deliveries `DELIVERED` | `DELIVERED` |
| Customer confirmed the purchase | `COMPLETED` |

Why `PARTIALLY_DELIVERED` is necessary: "one delivery arrived yesterday, the other arrives tomorrow" is an extremely common situation. If you collapse this into `SHIPPED`, you can't show "partially delivered" in the customer UI, and the status of an already-received item can't be distinguished from one that's still in transit when handling returns.

This aggregation is **computed at application level**, or the order status is **synced whenever a delivery status changes**. CHECK constraints only enforce the allowed set of values — they can't enforce the aggregate consistency. That's an application-layer (or trigger) concern.

### 2.5 Status Timestamps — Why Store Them on orders?

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
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,              -- internal PK
    order_id            BIGINT      NOT NULL,                           -- parent order (orders FK)
    delivery_number     VARCHAR(30) NOT NULL,                           -- external identifier (e.g., ORD-20260408-00001-D1)
    sequence            SMALLINT    NOT NULL,                           -- delivery order within the parent order
    status              VARCHAR(20) NOT NULL DEFAULT 'READY',           -- delivery status (READY → SHIPPED → DELIVERED)

    -- Shipping metadata (NULL until shipment)
    carrier             VARCHAR(50),                                    -- carrier name
    tracking_number     VARCHAR(50),                                    -- tracking number

    -- Delivery-level timestamps
    ready_at            TIMESTAMP,                                      -- ready-to-ship time
    shipped_at          TIMESTAMP,                                      -- handed to the carrier
    delivered_at        TIMESTAMP,                                      -- received by the customer

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

### 3.4 `delivery_number` Generation Strategies

`delivery_number` is typically derived from the `order_number` with a delivery suffix. The link to the parent order should be immediately visible for efficient CS handling.

| Strategy | Example | Characteristics |
|----------|---------|-----------------|
| Order number + suffix | `ORD-20260408-00001-D1` | Traceable from order number alone. Most practical |
| Independent sequence | `DLV-20260408-00001` | Numbered independently. Useful when logistics is a separate system |
| Order number + sequence column | `order_number` + `sequence = 1` | No extra column, identified by combination. Inconvenient for lookups/logs without a single identifier |

**Practical advice**: For most e-commerce stores, <strong>order number + suffix</strong> is the most convenient. CS agents can pinpoint a delivery from the order number alone, and it's intuitive for customers too. If logistics runs on a separate system, use an independent sequence but store the order number as a reference column.

---

## 4. order_items — Snapshots and Item Status

```sql
CREATE TABLE order_items (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,              -- internal PK
    order_id            BIGINT NOT NULL,                                -- parent order (denormalized for direct lookup)
    order_delivery_id   BIGINT NOT NULL,                                -- owning delivery group
    product_id          BIGINT NOT NULL,                                -- product reference (products FK)

    -- Snapshot at order time (frozen even if products changes later)
    product_name        VARCHAR(200)  NOT NULL,                         -- product name snapshot
    product_option      VARCHAR(200),                                   -- selected options (e.g., "color: black, size: M")
    unit_price          DECIMAL(10, 2) NOT NULL,                        -- price per unit at order time
    quantity            INT            NOT NULL,                        -- quantity ordered
    subtotal            DECIMAL(12, 2) NOT NULL,                        -- subtotal (unit_price * quantity)

    -- Item-level status and cancel/refund aggregates (denormalized)
    status              VARCHAR(20) NOT NULL DEFAULT 'ORDERED',         -- item status (reflects cancel/refund)
    cancelled_quantity  INT NOT NULL DEFAULT 0,                         -- cumulative cancelled quantity (pre-shipment)
    refunded_quantity   INT NOT NULL DEFAULT 0,                         -- cumulative refunded quantity (post-shipment returns)

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
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,              -- internal PK
    order_id            BIGINT      NOT NULL,                           -- parent order
    idempotency_key     VARCHAR(64) NOT NULL,                           -- idempotency key (prevents double charges)

    payment_method      VARCHAR(20)    NOT NULL,                        -- payment method (CARD, POINT, COUPON, etc.)
    amount              DECIMAL(12, 2) NOT NULL,                        -- amount for this payment row
    status              VARCHAR(20)    NOT NULL DEFAULT 'PENDING',      -- payment status (PENDING → CONFIRMED / FAILED)

    -- PSP details (NULL for internal assets like POINT/COUPON)
    pg_provider         VARCHAR(30),                                    -- PSP identifier
    pg_transaction_id   VARCHAR(100),                                   -- PSP transaction id
    pg_response         JSON,                                           -- raw PSP response (for debugging/audit)

    attempted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- payment attempt time
    confirmed_at        TIMESTAMP,                                      -- authorization time
    failed_at           TIMESTAMP,                                      -- failure time
    failure_reason      VARCHAR(500),                                   -- failure reason (keep for CS, do not delete)

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
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,                  -- internal PK
    entity_type     VARCHAR(20) NOT NULL,                               -- target type ('ORDER' or 'DELIVERY')
    entity_id       BIGINT      NOT NULL,                               -- target id (orders.id or order_deliveries.id, depending on type)
    from_status     VARCHAR(20),                                        -- previous status (NULL for initial creation)
    to_status       VARCHAR(20) NOT NULL,                               -- new status
    changed_by      VARCHAR(100) NOT NULL,                              -- actor (e.g., 'SYSTEM', 'ADMIN:kim', 'USER:123', 'WEBHOOK:...')
    reason          VARCHAR(500),                                       -- optional free-form reason
    changed_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,       -- change time

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
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,              -- internal PK
    order_id            BIGINT      NOT NULL,                           -- parent order
    order_delivery_id   BIGINT,                                         -- set for delivery-level cancel, NULL for whole-order

    -- Who and why
    cancelled_by_type   VARCHAR(20) NOT NULL,                           -- actor type (CUSTOMER, SELLER, ADMIN, SYSTEM)
    cancelled_by_id     VARCHAR(100),                                   -- actor id (user_id/admin_id; NULL for SYSTEM)
    reason_code         VARCHAR(50) NOT NULL,                           -- cancel reason code (enum, for aggregation)
    reason_detail       VARCHAR(1000),                                  -- free-form detail (for CS)

    -- Link to refund (when cancellation triggers an immediate refund)
    refund_id           BIGINT,                                         -- linked refund (NULL if none)

    cancelled_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- cancellation time

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
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,              -- internal PK
    order_id            BIGINT      NOT NULL,                           -- parent order
    refund_number       VARCHAR(30) NOT NULL,                           -- external identifier (e.g., REF-20260408-00001)
    amount              DECIMAL(12, 2) NOT NULL,                        -- total for this refund (must match sum of refund_items)
    status              VARCHAR(20)    NOT NULL DEFAULT 'REQUESTED',    -- refund status (REQUESTED → APPROVED → COMPLETED)
    reason_code         VARCHAR(50)    NOT NULL,                        -- refund reason code (enum)
    reason_detail       VARCHAR(1000),                                  -- free-form reason detail
    requested_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP, -- refund request time
    processed_at        TIMESTAMP,                                      -- refund completion time

    CONSTRAINT fk_refunds_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT uq_refunds_refund_number UNIQUE (refund_number),
    CONSTRAINT chk_refunds_status CHECK (
        status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED')
    ),
    CONSTRAINT chk_refunds_amount CHECK (amount > 0)
);

-- Refund items (which line items, how many)
CREATE TABLE refund_items (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,                  -- internal PK
    refund_id       BIGINT NOT NULL,                                    -- parent refund
    order_item_id   BIGINT NOT NULL,                                    -- the order item being refunded
    quantity        INT            NOT NULL,                            -- units refunded in this refund
    amount          DECIMAL(12, 2) NOT NULL,                            -- refund amount for this item

    CONSTRAINT fk_refund_items_refund
        FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE CASCADE,
    CONSTRAINT fk_refund_items_order_item
        FOREIGN KEY (order_item_id) REFERENCES order_items(id),
    CONSTRAINT chk_refund_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_refund_items_amount   CHECK (amount > 0)
);

-- Refund payment distribution (for split payments)
CREATE TABLE refund_payments (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,                  -- internal PK
    refund_id       BIGINT NOT NULL,                                    -- parent refund
    payment_id      BIGINT NOT NULL,                                    -- original payment to refund back to
    amount          DECIMAL(12, 2) NOT NULL,                            -- amount returned to this payment method
    pg_refund_id    VARCHAR(100),                                       -- PSP refund id (NULL for internal assets)
    status          VARCHAR(20)    NOT NULL DEFAULT 'PENDING',          -- PSP refund-call status (PENDING → COMPLETED / FAILED)

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
| **Structure choice** | Pick 2-level / 3-level / sibling based on context. This post uses 3 levels (orders → order_deliveries → order_items) |
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

- [ ] Is the chosen order structure (2-level / 3-level / sibling) justified?
- [ ] Are the boundaries between order (purchase contract) and fulfillment (delivery) clear?
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
