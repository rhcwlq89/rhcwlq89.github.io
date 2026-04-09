---
title: "RDB 설계 시리즈 5편: 실무 도메인 스키마 설계 — 주문, 권한, 그리고 설계 리뷰"
description: "이론을 실전에 적용한다. 주문/결제 시스템의 상태 머신 + 멱등성 설계, RBAC 권한 테이블 패턴, 선착순 재고 테이블 설계 회고, 그리고 스키마 설계 리뷰 체크리스트까지 — 실무에서 바로 쓸 수 있는 도메인 스키마 설계를 다룬다."
pubDate: 2026-04-08T18:00:00+09:00
tags:
  - Database
  - RDB
  - Schema Design
  - Domain Modeling
  - MySQL
  - PostgreSQL
heroImage: "../../assets/RdbDomainSchemaDesignGuide.png"
---

## 서론

[이전 글](/blog/rdb-relationship-patterns-guide)에서 1:1, 1:N, N:M, 자기참조, 다형성 관계까지 — 관계 설계의 모든 패턴을 다뤘다. 이제 이론은 충분하다.

문제는 **"알겠는데 실무에서 어떻게 적용하지?"**다.

네이밍 규칙, 정규화, 제약조건, 관계 패턴을 다 알아도 실제 도메인 앞에 서면 막막하다. "주문 상태를 어디에 어떻게 저장하지?", "결제 멱등성을 스키마로 어떻게 보장하지?", "권한 체계를 테이블로 어떻게 풀지?" — 이런 질문은 패턴 지식만으로는 답이 안 나온다.

이 글에서는 3가지 실무 도메인을 스키마로 설계한다:

1. **주문/결제 시스템** — 상태 머신, 멱등성, 이력 추적
2. **RBAC 권한 시스템** — 역할 기반 접근 제어의 테이블 설계
3. **선착순 재고 시스템** — 기존 [FCFS 시리즈](/blog/fcfs-system-comparison-guide) 회고

그리고 마지막으로 **스키마 설계 리뷰 체크리스트**를 제시한다. PR 리뷰할 때 마이그레이션 파일 보면서 체크하면 된다.

---

## 1. 주문/결제 시스템 스키마 설계

이커머스의 핵심 도메인이자, 스키마 설계가 가장 복잡한 영역이다. 주문은 단순한 CRUD가 아니다 — **상태가 변하고, 결제가 연동되고, 환불이 발생하고, 이력을 추적**해야 한다.

### 1.1 ERD 전체 구조

```
users ──1:N──→ orders ──1:N──→ order_items ──N:1──→ products
                  │
                  ├──1:N──→ payments
                  │
                  ├──1:N──→ order_status_histories
                  │
                  └──1:N──→ refunds
```

테이블 하나씩 설계해보자.

### 1.2 주문 테이블 — 상태 머신 설계

주문의 핵심은 **상태(status)**다. 주문은 여러 상태를 거치며, 각 상태에서 허용되는 전이(transition)가 정해져 있다.

```
PENDING → PAID → PREPARING → SHIPPED → DELIVERED → COMPLETED
    │        │                                         │
    └→ CANCELLED  └→ REFUND_REQUESTED → REFUNDED      └→ REVIEWED
```

#### 상태를 어떻게 저장할 것인가?

```sql
CREATE TABLE orders (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    order_number    VARCHAR(30) NOT NULL,              -- 외부 노출용 주문번호
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

**설계 포인트:**

**1) `order_number` vs `id`**

API와 UI에서는 `id`(auto increment)를 노출하지 않는다. 대신 `order_number`(예: `ORD-20260408-00001`)를 사용한다. 이유:

- ID를 노출하면 전체 주문 수를 추측할 수 있다 (경쟁사 분석에 악용)
- 연속된 숫자는 다른 사용자의 주문을 탐색하기 쉽다 (IDOR 취약점)
- 외부 노출용 번호는 비즈니스 규칙(날짜 포함, 채널 구분 등)을 담을 수 있다

```sql
-- ❌ API 응답에 id 직접 노출
GET /orders/42

-- ✅ order_number로 식별
GET /orders/ORD-20260408-00001
```

**2) 상태별 타임스탬프 vs 이력 테이블**

`paid_at`, `shipped_at` 같은 컬럼을 주문 테이블에 직접 넣은 이유:

- "이 주문은 언제 결제됐는가?"는 가장 빈번한 조회이므로 JOIN 없이 바로 읽을 수 있어야 한다
- 상태별 타임스탬프는 **현재 상태의 스냅샷**이다
- 상세한 이력(누가, 언제, 왜 상태를 변경했는지)은 별도의 이력 테이블에 저장한다

이것은 [2편](/blog/rdb-normalization-guide)에서 다룬 **의도적 반정규화**다. 이력 테이블에서 매번 MAX(changed_at) 같은 쿼리를 날리는 대신, 자주 쓰는 값을 주문 테이블에 직접 저장한다.

**3) 상태 CHECK 제약**

`status` 컬럼에 CHECK 제약을 건다. 오타나 잘못된 값이 들어오는 걸 DB 레벨에서 막는다. [3편](/blog/rdb-constraints-integrity-guide)에서 다룬 "스키마로 버그를 막는 법"의 실전 적용이다.

> 다만 **상태 전이 규칙**(예: PENDING에서 SHIPPED로 직접 전이 불가)은 CHECK로 표현하기 어렵다. 이건 앱 레벨에서 상태 머신으로 구현한다.

### 1.3 주문 항목 테이블 — 스냅샷 패턴

```sql
CREATE TABLE order_items (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT NOT NULL,
    product_id      BIGINT NOT NULL,
    -- 주문 시점의 스냅샷
    product_name    VARCHAR(200) NOT NULL,     -- 상품명 스냅샷
    product_price   DECIMAL(10, 2) NOT NULL,   -- 단가 스냅샷
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

**왜 `product_name`, `product_price`를 복사하는가?**

상품 테이블의 가격은 바뀔 수 있다. 하지만 **이미 주문된 항목의 가격은 주문 시점의 가격이어야 한다.** "지난달에 10,000원에 주문했는데 이번 달에 상품이 12,000원으로 올랐다"고 해서 과거 주문의 금액이 바뀌면 안 된다.

이것이 [2편](/blog/rdb-normalization-guide)에서 다룬 **스냅샷 패턴**이다. 정규화 관점에서는 중복이지만, 비즈니스적으로는 필수다.

```sql
-- ❌ 이렇게 하면 상품 가격이 바뀔 때 과거 주문 금액도 바뀐다
SELECT oi.quantity, p.price, oi.quantity * p.price AS total
FROM order_items oi
JOIN products p ON oi.product_id = p.id;

-- ✅ 주문 시점의 가격으로 계산
SELECT quantity, product_price, subtotal
FROM order_items
WHERE order_id = 123;
```

### 1.4 결제 테이블 — 멱등성 설계

결제는 "딱 한 번만" 처리되어야 한다. 네트워크 타임아웃으로 재시도가 오거나, 사용자가 결제 버튼을 두 번 누르거나 — 이런 상황에서 이중 결제가 발생하면 큰 문제가 된다.

```sql
CREATE TABLE payments (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT NOT NULL,
    idempotency_key     VARCHAR(64) NOT NULL,          -- 멱등성 키
    payment_method      VARCHAR(20) NOT NULL,           -- CARD, BANK_TRANSFER, KAKAO_PAY, ...
    amount              DECIMAL(12, 2) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    pg_transaction_id   VARCHAR(100),                   -- PG사 거래 ID
    pg_response         JSON,                           -- PG사 원본 응답
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

**멱등성 키(idempotency_key)의 역할:**

```
1차 시도: idempotency_key = 'pay_abc123' → INSERT 성공 → 결제 진행
2차 시도: idempotency_key = 'pay_abc123' → UNIQUE 위반 → 기존 결과 반환
```

클라이언트가 같은 `idempotency_key`로 재요청하면 UNIQUE 제약이 중복 INSERT를 막고, 앱에서는 기존 결제 결과를 반환한다. **스키마 레벨에서 이중 결제를 원천 차단**하는 것이다.

멱등성 키 생성 전략:

| 전략 | 예시 | 장점 | 단점 |
|------|------|------|------|
| **클라이언트 UUID** | `pay_550e8400-e29b-41d4-a716-446655440000` | 클라이언트 독립적 | 클라이언트가 매번 새 키를 생성하면 의미 없음 |
| **주문번호 + 시도번호** | `ORD-20260408-00001_attempt_1` | 직관적, 디버깅 쉬움 | 시도번호 관리 필요 |
| **주문ID + 해시** | `order_123_sha256(...)` | 서버에서 결정적 생성 | 해시 충돌 가능성 (극히 낮음) |

> 실무에서는 **주문번호 기반** 멱등성 키가 가장 많이 쓰인다. 디버깅할 때 "이 결제가 어떤 주문의 몇 번째 시도인지"를 바로 알 수 있기 때문이다.

**왜 payments는 orders와 1:N인가?**

주문 하나에 결제가 여러 번 시도될 수 있다:

```
1차 시도: 카드 한도 초과 → FAILED
2차 시도: 다른 카드로 → CONFIRMED
```

또는 부분 결제 (카드 + 포인트 혼합)를 지원하려면 한 주문에 여러 결제 레코드가 필요하다. 그래서 1:1이 아니라 1:N이다.

### 1.5 주문 상태 이력 테이블

```sql
CREATE TABLE order_status_histories (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT NOT NULL,
    from_status     VARCHAR(20),                        -- NULL이면 최초 생성
    to_status       VARCHAR(20) NOT NULL,
    changed_by      VARCHAR(100) NOT NULL,              -- 'SYSTEM', 'ADMIN:kim', 'USER:123'
    reason          VARCHAR(500),                        -- 변경 사유 (환불 사유 등)
    changed_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_history_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_history_order_id ON order_status_histories(order_id);
CREATE INDEX idx_order_history_changed_at ON order_status_histories(changed_at);
```

이력 테이블은 **디버깅과 감사(audit)의 핵심**이다.

```sql
-- 주문 #123의 전체 상태 변경 이력
SELECT from_status, to_status, changed_by, reason, changed_at
FROM order_status_histories
WHERE order_id = 123
ORDER BY changed_at;
```

```
from_status | to_status        | changed_by  | reason           | changed_at
------------|------------------|-------------|------------------|-------------------
NULL        | PENDING          | SYSTEM      | 주문 생성         | 2026-04-08 10:00
PENDING     | PAID             | SYSTEM      | 결제 확인         | 2026-04-08 10:01
PAID        | PREPARING        | ADMIN:kim   |                  | 2026-04-08 11:00
PREPARING   | SHIPPED          | ADMIN:kim   | 송장번호: 123456  | 2026-04-08 15:00
```

`changed_by`를 문자열로 저장하는 이유: 시스템 자동 처리, 관리자, 사용자, 배치 스크립트 등 다양한 주체가 상태를 변경할 수 있다. FK로 연결하면 다형성 관계가 필요해지므로, 간단하게 문자열로 식별한다.

### 1.6 환불 테이블

```sql
CREATE TABLE refunds (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT NOT NULL,
    payment_id      BIGINT NOT NULL,
    amount          DECIMAL(12, 2) NOT NULL,
    reason          VARCHAR(500) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    pg_refund_id    VARCHAR(100),                       -- PG사 환불 ID
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

**왜 환불을 별도 테이블로 분리하는가?**

- 부분 환불이 가능하다 — 10만원 주문 중 3만원만 환불
- 한 주문에 여러 번 환불이 발생할 수 있다 — 1차 부분 환불 후 추가 환불
- 환불 자체에 상태 머신이 있다 (REQUESTED → PROCESSING → COMPLETED)
- PG사 환불 ID, 처리 시각 등 환불 고유의 속성이 있다

환불 금액의 합이 원 결제 금액을 초과하면 안 된다. 이건 DB CHECK로 표현하기 어렵고(다른 행 참조가 필요), 앱 레벨에서 검증한다.

### 1.7 전체 ERD와 설계 원칙 정리

```sql
-- 전체 구조 요약
-- users(id) ←── orders(user_id)
--                  orders(id) ←── order_items(order_id)
--                  orders(id) ←── payments(order_id)
--                  orders(id) ←── order_status_histories(order_id)
--                  orders(id) ←── refunds(order_id)
--                  payments(id) ←── refunds(payment_id)
--                  products(id) ←── order_items(product_id)
```

| 설계 원칙 | 적용 |
|-----------|------|
| **스냅샷 패턴** | order_items에 주문 시점의 상품명/가격 복사 |
| **멱등성** | payments.idempotency_key의 UNIQUE 제약 |
| **상태 머신** | orders.status의 CHECK 제약 + 앱 레벨 전이 규칙 |
| **이력 추적** | order_status_histories로 감사 로그 |
| **반정규화** | orders에 paid_at, shipped_at 등 직접 저장 |
| **외부 ID 분리** | order_number (외부) vs id (내부) |
| **1:N 관계** | 한 주문에 여러 결제 시도, 여러 환불 가능 |

---

## 2. RBAC 권한 시스템 스키마 설계

RBAC(Role-Based Access Control)는 **역할(Role)을 통해 권한(Permission)을 관리**하는 패턴이다. 사용자에게 직접 권한을 부여하는 대신, 역할을 부여하고 역할에 권한을 연결한다.

### 2.1 왜 RBAC인가?

권한 관리 방식의 진화:

```
Level 0: 하드코딩
  if (user.email == "admin@company.com") { ... }
  → 사용자 추가/변경 시 코드 수정 필요 💀

Level 1: is_admin 플래그
  users 테이블에 is_admin BOOLEAN
  → 관리자 / 일반 사용자 2단계만 가능

Level 2: role 컬럼
  users 테이블에 role VARCHAR ('ADMIN', 'MANAGER', 'USER')
  → 역할은 구분되지만, 세부 권한 제어 불가
  → 한 사용자에 여러 역할 불가 (1편의 1NF 위반)

Level 3: RBAC
  users ←→ roles ←→ permissions
  → 역할과 권한을 유연하게 조합 가능
```

### 2.2 기본 RBAC 테이블 설계

```sql
-- 역할
CREATE TABLE roles (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    description VARCHAR(200),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_roles_name UNIQUE (name)
);

-- 권한
CREATE TABLE permissions (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    resource    VARCHAR(50) NOT NULL,              -- 'order', 'product', 'user', ...
    action      VARCHAR(20) NOT NULL,              -- 'read', 'create', 'update', 'delete'
    description VARCHAR(200),

    CONSTRAINT uq_permissions_resource_action UNIQUE (resource, action)
);

-- 역할 ↔ 권한 (N:M)
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

-- 사용자 ↔ 역할 (N:M)
CREATE TABLE user_roles (
    user_id     BIGINT NOT NULL,
    role_id     BIGINT NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by BIGINT,                            -- 누가 부여했는지
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

구조:

```
users ──N:M──→ roles ──N:M──→ permissions
         │                        │
    user_roles              role_permissions
```

이것이 [4편](/blog/rdb-relationship-patterns-guide)에서 다룬 **N:M Junction Table**의 실전 적용이다. `user_roles`와 `role_permissions` 모두 Junction Table이다.

### 2.3 데이터 예시

```sql
-- 역할 생성
INSERT INTO roles (id, name, description) VALUES
    (1, 'SUPER_ADMIN',   '모든 권한'),
    (2, 'ORDER_MANAGER', '주문 관리자'),
    (3, 'PRODUCT_EDITOR','상품 편집자'),
    (4, 'VIEWER',        '조회만 가능');

-- 권한 생성
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

-- 역할에 권한 할당
-- SUPER_ADMIN: 모든 권한
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- ORDER_MANAGER: 주문 전체 + 상품/사용자 조회
INSERT INTO role_permissions (role_id, permission_id) VALUES
    (2, 1), (2, 2), (2, 3), (2, 4),   -- order: *
    (2, 5),                             -- product: read
    (2, 9);                             -- user: read

-- PRODUCT_EDITOR: 상품 전체 + 주문 조회
INSERT INTO role_permissions (role_id, permission_id) VALUES
    (3, 5), (3, 6), (3, 7), (3, 8),   -- product: *
    (3, 1);                             -- order: read

-- VIEWER: 조회만
INSERT INTO role_permissions (role_id, permission_id) VALUES
    (4, 1), (4, 5), (4, 9);            -- order/product/user: read
```

### 2.4 권한 확인 쿼리

```sql
-- 사용자 #42의 모든 권한 조회
SELECT DISTINCT p.resource, p.action
FROM user_roles ur
INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
INNER JOIN permissions p ON rp.permission_id = p.id
WHERE ur.user_id = 42;

-- 사용자 #42가 'order:update' 권한이 있는지 확인
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

JOIN이 3개나 필요하다. 매 API 요청마다 이 쿼리를 실행하면 성능 문제가 생긴다. 실무에서는 **캐시**가 필수다:

```
요청 → 캐시에 권한 있는지 확인 → 없으면 DB 조회 → 캐시에 저장
역할 변경 시 → 해당 사용자의 캐시 무효화
```

Redis에 `user:{userId}:permissions` 같은 키로 권한 목록을 캐시하는 게 일반적이다.

### 2.5 확장: 계층형 역할 (Role Hierarchy)

역할에 상하 관계가 필요한 경우가 있다. "SUPER_ADMIN은 ORDER_MANAGER의 모든 권한을 자동으로 포함한다"는 식이다.

```sql
-- 역할 계층을 위한 자기참조
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

이것이 [4편](/blog/rdb-relationship-patterns-guide)에서 다룬 **자기참조 패턴**의 실전 적용이다. 권한 확인 시 재귀 CTE로 상위 역할의 권한까지 포함해야 한다.

```sql
-- 사용자의 역할 + 그 역할의 모든 상위 역할
WITH RECURSIVE role_hierarchy AS (
    -- 직접 부여된 역할
    SELECT r.id, r.name, r.parent_role_id
    FROM user_roles ur
    INNER JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = 42

    UNION ALL

    -- 하위 역할이 포함하는 상위 역할 (역방향)
    SELECT r.id, r.name, r.parent_role_id
    FROM roles r
    INNER JOIN role_hierarchy rh ON r.id = rh.parent_role_id
)
SELECT DISTINCT p.resource, p.action
FROM role_hierarchy rh
INNER JOIN role_permissions rp ON rh.id = rp.role_id
INNER JOIN permissions p ON rp.permission_id = p.id;
```

> **하지만 역할 계층은 복잡성 대비 이점이 크지 않은 경우가 많다.** 역할이 10개 미만이면 계층 없이 각 역할에 필요한 권한을 직접 할당하는 것이 더 명확하다. 계층을 도입하면 "이 역할이 실제로 어떤 권한을 가지는지"를 파악하기 어려워진다. 역할이 수십 개로 늘어나고, 권한 조합이 복잡해질 때만 계층을 고려하자.

### 2.6 확장: 리소스 레벨 권한

"이 사용자는 product:update 권한이 있지만, 자신이 만든 상품만 수정 가능" — 이런 세분화가 필요한 경우.

```sql
CREATE TABLE user_permissions_override (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    permission_id   BIGINT NOT NULL,
    resource_id     BIGINT,                            -- 특정 리소스 ID (NULL이면 전체)
    granted         BOOLEAN NOT NULL DEFAULT TRUE,      -- TRUE: 허용, FALSE: 거부
    expires_at      TIMESTAMP,                          -- 임시 권한인 경우

    CONSTRAINT fk_upo_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_upo_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT uq_upo UNIQUE (user_id, permission_id, resource_id)
);
```

이건 RBAC를 넘어서 **ABAC(Attribute-Based Access Control)**에 가까워진다. 대부분의 서비스에서는 필요하지 않고, 기본 RBAC만으로 충분하다. SaaS 플랫폼이나 엔터프라이즈 시스템에서 요구될 수 있다.

### 2.7 실무에서의 RBAC

```
서비스 규모            → 권장 방식
─────────────────────────────────────────
MVP / 소규모 서비스    → users.role VARCHAR 컬럼 하나로 충분
중규모 서비스          → 기본 RBAC (users ↔ roles ↔ permissions)
대규모 SaaS           → RBAC + 리소스 레벨 권한 + 캐시
엔터프라이즈           → RBAC + 계층 + ABAC + 감사 로그
```

처음부터 완전한 RBAC를 구축하면 과잉 설계(over-engineering)다. `users.role` 컬럼으로 시작해서, 역할이 3개를 넘거나 세부 권한이 필요해질 때 RBAC 테이블로 전환해도 늦지 않다.

---

## 3. 선착순 재고 시스템 — 설계 회고

기존 [FCFS(선착순) 시리즈](/blog/fcfs-system-comparison-guide)에서 DB 락, Redis, 큐, 토큰 방식으로 선착순 시스템을 구현했다. 여기서는 **스키마 설계 관점**에서 회고한다.

### 3.1 기본 재고 테이블

[DB 락 편](/blog/fcfs-db-lock-implementation)에서 사용한 스키마:

```sql
CREATE TABLE products (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    stock_quantity  INT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'ON_SALE',

    CONSTRAINT chk_products_stock CHECK (stock_quantity >= 0)
);
```

이 설계의 문제점을 지금 시점에서 되돌아본다.

### 3.2 문제 1: stock_quantity에 CHECK 제약이 없었다면?

```sql
-- CHECK 없이 stock_quantity만 있는 경우
-- 앱에서 if (stock < quantity) 체크를 하지만...
-- 동시성 상황에서 race condition이 발생하면:
UPDATE products SET stock_quantity = stock_quantity - 1
WHERE id = 1;
-- stock_quantity가 0에서 -1이 될 수 있다!
```

`CHECK (stock_quantity >= 0)` 제약이 **최후의 방어선** 역할을 한다. [3편](/blog/rdb-constraints-integrity-guide)에서 다룬 "스키마로 잘못된 상태를 방지"의 대표적 사례다.

`SELECT FOR UPDATE`와 앱 레벨 검증이 정상 작동한다면 CHECK에 걸릴 일은 없다. 하지만 "없어도 되는 안전장치"가 아니라 "있어야 하는 안전장치"다. 버그가 없을 때는 의미 없어 보이지만, 버그가 있을 때 비로소 가치를 발휘한다.

### 3.3 문제 2: 재고 변동 이력이 없다

stock_quantity를 직접 UPDATE하면 "누가 언제 얼마나 차감/복원했는지" 알 수 없다. 숫자만 남고 맥락이 사라진다.

```sql
-- 재고 변동 이력 테이블 추가
CREATE TABLE stock_movements (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id      BIGINT NOT NULL,
    type            VARCHAR(20) NOT NULL,              -- 'PURCHASE', 'CANCEL', 'REFUND', 'ADJUSTMENT'
    quantity_change  INT NOT NULL,                      -- 양수: 증가, 음수: 감소
    quantity_after   INT NOT NULL,                      -- 변동 후 재고
    reference_type   VARCHAR(20),                       -- 'ORDER', 'REFUND', 'ADMIN'
    reference_id     BIGINT,                            -- 관련 주문/환불 ID
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_stock_movements_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT chk_stock_movements_quantity_after CHECK (quantity_after >= 0)
);

CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);
```

```sql
-- 상품 #1의 재고 변동 이력
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

이력 테이블이 있으면:
- **디버깅**: "재고가 왜 맞지 않지?" → 이력을 추적해서 원인 파악
- **감사**: "누가 재고를 수동으로 조정했는가?" → reference_type = 'ADMIN'인 행 조회
- **복원**: 잘못된 차감을 정확하게 되돌릴 수 있다

### 3.4 문제 3: 예약 재고(reserved stock) 개념이 없었다

실제 이커머스에서는 "결제 대기 중인 주문"이 재고를 잡아두어야 한다. 결제가 완료되기 전에 다른 사용자가 그 재고를 가져가면 안 된다.

```sql
-- 개선된 재고 테이블
CREATE TABLE product_stocks (
    product_id      BIGINT PRIMARY KEY,
    total_quantity  INT NOT NULL DEFAULT 0,            -- 전체 재고
    reserved_quantity INT NOT NULL DEFAULT 0,          -- 예약된 재고 (결제 대기 중)
    -- available = total_quantity - reserved_quantity   (앱에서 계산)

    CONSTRAINT fk_product_stocks_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT chk_total_quantity CHECK (total_quantity >= 0),
    CONSTRAINT chk_reserved_quantity CHECK (reserved_quantity >= 0),
    CONSTRAINT chk_reserved_not_exceed CHECK (reserved_quantity <= total_quantity)
);
```

재고 차감 플로우:

```
1. 주문 생성 → reserved_quantity += 1 (예약)
2. 결제 완료 → reserved_quantity -= 1, total_quantity -= 1 (확정)
3. 결제 실패/타임아웃 → reserved_quantity -= 1 (예약 해제)
```

```sql
-- 주문 생성 시: 예약
UPDATE product_stocks
SET reserved_quantity = reserved_quantity + 1
WHERE product_id = 1
  AND (total_quantity - reserved_quantity) >= 1;
-- affected rows = 0이면 재고 부족

-- 결제 완료 시: 확정
UPDATE product_stocks
SET total_quantity = total_quantity - 1,
    reserved_quantity = reserved_quantity - 1
WHERE product_id = 1;

-- 결제 실패 시: 예약 해제
UPDATE product_stocks
SET reserved_quantity = reserved_quantity - 1
WHERE product_id = 1;
```

`CHECK (reserved_quantity <= total_quantity)` 제약이 "예약된 재고가 전체 재고를 초과하는" 비정상 상태를 방지한다.

> FCFS 시리즈에서는 단순화를 위해 `stock_quantity` 하나로 처리했지만, 실무 이커머스에서는 reserved stock 패턴이 거의 필수다. 결제 대기 시간(보통 15~30분) 동안 재고를 잡아두지 않으면, 결제 완료 시점에 재고가 없는 상황이 빈번하게 발생한다.

### 3.5 회고 정리

| 항목 | FCFS 시리즈 | 개선 |
|------|------------|------|
| **재고 컬럼** | stock_quantity 하나 | total_quantity + reserved_quantity 분리 |
| **음수 방지** | 앱 레벨 if 체크 | CHECK (>= 0) 제약 추가 |
| **변동 이력** | 없음 | stock_movements 이력 테이블 |
| **스냅샷** | 없음 | order_items에 가격/상품명 스냅샷 |
| **멱등성** | 없음 | idempotency_key UNIQUE 제약 |

FCFS 시리즈의 목적은 **동시성 제어 기법 비교**였기 때문에 스키마는 의도적으로 단순화했다. 하지만 프로덕션에 적용할 때는 위 개선 사항을 반영해야 한다.

---

## 4. 스키마 설계 리뷰 체크리스트

PR에 마이그레이션 파일이 올라왔을 때, 이 체크리스트로 리뷰하면 된다.

### 4.1 네이밍 ([1편](/blog/rdb-schema-basics-guide) 참고)

- [ ] 테이블명이 snake_case + 복수형인가?
- [ ] 컬럼명이 snake_case이고 의미가 명확한가?
- [ ] boolean 컬럼에 `is_`, `has_` 접두사가 있는가?
- [ ] FK 컬럼이 `참조테이블_id` 형식인가? (예: `user_id`, `order_id`)

### 4.2 데이터 타입 ([1편](/blog/rdb-schema-basics-guide) 참고)

- [ ] VARCHAR 길이에 근거가 있는가? (무조건 255가 아닌지)
- [ ] 금액에 DECIMAL을 사용했는가? (FLOAT/DOUBLE이 아닌지)
- [ ] PK가 BIGINT인가? (INT의 21억 한계를 고려했는가)
- [ ] TIMESTAMP vs DATETIME 선택에 근거가 있는가?

### 4.3 정규화/반정규화 ([2편](/blog/rdb-normalization-guide) 참고)

- [ ] 같은 데이터가 여러 곳에 저장되는 경우, 의도적인 반정규화인가 실수인가?
- [ ] 반정규화라면 동기화 전략이 있는가? (트리거? 앱 로직?)
- [ ] 스냅샷 패턴이 필요한 곳에 적용되었는가? (주문 시점의 가격 등)

### 4.4 제약조건 ([3편](/blog/rdb-constraints-integrity-guide) 참고)

- [ ] NOT NULL이어야 하는 컬럼이 NOT NULL로 선언되었는가?
- [ ] 비즈니스 규칙을 CHECK로 표현할 수 있는 부분이 있는가?
- [ ] UNIQUE 제약이 필요한 곳에 빠짐없이 걸려 있는가?
- [ ] FK가 필요한 곳에 걸려 있는가? (또는 의도적으로 생략한 이유가 있는가?)
- [ ] ON DELETE 전략이 적절한가? (CASCADE vs RESTRICT vs SET NULL)

### 4.5 관계 설계 ([4편](/blog/rdb-relationship-patterns-guide) 참고)

- [ ] 1:1 분리가 정말 필요한가? 한 테이블로 충분하지 않은가?
- [ ] N:M 관계의 Junction Table에 양방향 인덱스가 있는가?
- [ ] 자기참조가 있다면 깊이 제한을 고려했는가?
- [ ] 다형성 관계의 패턴 선택에 근거가 있는가?

### 4.6 인덱스

- [ ] FK 컬럼에 인덱스가 있는가? (PostgreSQL은 자동 생성하지 않음!)
- [ ] WHERE, ORDER BY, JOIN에 자주 쓰이는 컬럼에 인덱스가 있는가?
- [ ] 불필요한 인덱스는 없는가? (쓰기 성능에 영향)

### 4.7 운영 안전성

- [ ] 기존 데이터가 있는 테이블에 NOT NULL 컬럼을 추가하는 경우, DEFAULT가 있는가?
- [ ] 대용량 테이블에 ALTER TABLE이 안전한가? (테이블 락 고려)
- [ ] 롤백 가능한 구조인가? (컬럼 추가는 쉽지만 삭제는 위험)

### 4.8 체크리스트 활용법

이 체크리스트를 한 번에 다 적용하려고 하지 말자. **현재 프로젝트에서 가장 문제가 되는 2~3개**부터 시작하면 된다.

```
"우리 팀은 FK 인덱스를 자주 빼먹는다"     → 4.6 집중
"NOT NULL을 안 걸어서 NULL 버그가 많다"   → 4.4 집중
"반정규화 기준이 없어서 매번 논쟁한다"     → 4.3 집중
```

체크리스트는 **규칙이 아니라 대화의 시작점**이다. "이거 왜 이렇게 했어?"라는 질문의 근거가 되어야 하고, "이유가 있어서 이렇게 했어"라는 답이 있다면 체크리스트를 무시해도 된다.

---

## 정리

| 도메인 | 핵심 설계 포인트 |
|--------|-----------------|
| **주문/결제** | 상태 머신(CHECK), 멱등성(idempotency_key UNIQUE), 스냅샷 패턴, 이력 추적 |
| **RBAC 권한** | N:M Junction Table 2개 (user↔role, role↔permission), 캐시 필수 |
| **선착순 재고** | CHECK(>=0), 예약 재고 분리(total/reserved), 변동 이력 테이블 |
| **설계 리뷰** | 체크리스트는 대화의 시작점. 2~3개부터 집중 |

이 글에서 다룬 패턴들은 전부 1~4편의 이론을 실제 도메인에 적용한 것이다:

```
1편 네이밍/타입 → order_number VARCHAR(30), amount DECIMAL(12,2)
2편 정규화     → 스냅샷 패턴 (order_items에 가격 복사)
3편 제약조건   → CHECK (stock >= 0), UNIQUE (idempotency_key)
4편 관계 패턴  → N:M Junction Table (RBAC), 자기참조 (역할 계층)
```

**"이론을 아는 것"과 "실무에 적용하는 것"은 다른 능력이다.** 하지만 이론 없이 실무 설계를 하면 매번 같은 실수를 반복한다. 이 글이 그 간극을 조금이나마 좁혀줬기를 바란다.

다음 편에서는 **인덱스 설계 심화** — 부분 인덱스, Expression 인덱스, 커버링 인덱스, JOIN 전략과 인덱스의 관계를 다룬다.
