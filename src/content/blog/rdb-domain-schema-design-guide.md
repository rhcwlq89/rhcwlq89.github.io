---
title: "RDB 설계 시리즈 5편: 주문/결제 도메인 스키마 설계 — 실무 수준까지"
description: "이커머스 주문 도메인을 실무 수준으로 설계한다. 주문-배송-아이템 3단 계층, 상태 머신, 결제 멱등성, 복합 결제, 아이템 단위 환불, 취소 이력까지. 한 도메인을 끝까지 파고든다."
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

이 글은 이커머스의 **주문/결제 도메인 하나**에만 집중한다. 여러 도메인을 얕게 훑는 대신, 한 도메인을 실무에서 통하는 수준까지 파고든다.

교과서에서 보는 주문 스키마는 보통 이렇다:

```
orders ──1:N──→ order_items
```

하지만 실제 이커머스(쿠팡, 네이버, 11번가)에서 이 구조로는 턱없이 부족하다. 한 주문 안에 배송이 여러 건으로 나뉘고, 일부만 취소/환불되고, 결제도 카드 + 포인트 + 쿠폰으로 쪼개진다. 이런 현실을 스키마로 어떻게 표현할지가 이 글의 주제다.

다루는 내용:

1. **3단 계층** — `orders → order_deliveries → order_items`와 왜 배송 단위를 분리해야 하는가
2. **상태 머신** — 주문/배송/아이템 레벨 상태를 어떻게 분리할 것인가
3. **결제 멱등성과 복합 결제** — 카드 + 포인트 + 쿠폰을 하나의 주문에
4. **취소와 환불** — 취소 주체와 이력, 아이템 단위 환불
5. **스냅샷 패턴의 확장** — 상품뿐 아니라 배송지까지

권한 시스템(RBAC)과 선착순 재고 스키마 회고는 다음 편에서 별도로 다룬다. 한 번에 여러 도메인을 보여주는 것보다, 하나를 끝까지 파는 편이 실무 설계에 더 도움 된다고 판단했다.

---

## 1. 왜 3단 계층인가

### 1.1 교과서 구조의 한계

가장 흔한 주문 스키마는 2단 구조다:

```
orders (주문 전체)
  └── order_items (주문 항목)
```

이 구조로는 다음 상황을 표현할 수 없다:

- **부분 배송**: 한 주문에 상품 A는 오늘 도착, 상품 B는 내일 도착
- **같은 셀러 안의 배송 분리**: 냉장/상온 분리, 해외/국내 분리 등
- **부분 취소/환불**: 10개 중 3개만 반품
- **배송 상태와 주문 상태의 차이**: "주문은 결제 완료, 배송 1은 배송 중, 배송 2는 준비 중"

이 모든 걸 orders 테이블의 단일 `status` 컬럼으로는 담을 수 없다. 억지로 담으려고 하면 상태 값이 폭발하거나("PARTIALLY_SHIPPED_1_OF_3"), 상태가 실제 데이터와 어긋나기 시작한다.

### 1.2 3단 계층 구조

실무에서 가장 많이 쓰는 구조:

```
orders            ─── 주문 한 건 (결제 단위)
  └─ order_deliveries  ─── 배송 묶음 (물리적 박스 단위)
       └─ order_items    ─── 주문 항목 (상품 라인)
```

역할 분담:

| 레벨 | 책임 |
|------|------|
| **orders** | 결제, 전체 금액, 주문자, 배송지 스냅샷, 전체 상태 |
| **order_deliveries** | 배송 묶음, 송장번호, 배송 상태, 출고/배송 완료 시각 |
| **order_items** | 상품 라인, 상품/가격/옵션 스냅샷, 수량, 아이템 상태 |

"결제는 한 번, 배송은 여러 번, 아이템은 배송마다 여러 개"라는 현실을 그대로 반영한다.

### 1.3 ERD 전체 구조

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

테이블 하나씩 설계해보자.

---

## 2. orders — 주문 총괄과 배송지 스냅샷

```sql
CREATE TABLE orders (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    order_number        VARCHAR(30) NOT NULL,           -- 외부 노출용 주문번호
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    -- 금액 (모두 원화 기준, 부가세 포함)
    items_amount        DECIMAL(12, 2) NOT NULL,        -- 상품 금액 합
    shipping_fee        DECIMAL(8, 2)  NOT NULL DEFAULT 0,
    discount_amount     DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12, 2) NOT NULL,        -- 최종 결제 금액

    -- 배송지 스냅샷 (주문 시점의 값으로 고정)
    recipient_name      VARCHAR(100) NOT NULL,
    recipient_phone     VARCHAR(20)  NOT NULL,
    shipping_zipcode    VARCHAR(10)  NOT NULL,
    shipping_address1   VARCHAR(200) NOT NULL,
    shipping_address2   VARCHAR(200),
    shipping_memo       VARCHAR(500),

    -- 상태별 타임스탬프 (반정규화: 자주 조회되는 값)
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

API와 UI에서는 `id`(auto increment)를 노출하지 않는다. 대신 `order_number`(예: `ORD-20260408-00001`)를 사용한다.

- ID를 노출하면 전체 주문 수를 추측할 수 있다 (경쟁사 분석에 악용)
- 연속된 숫자는 다른 사용자의 주문을 탐색하기 쉽다 (IDOR 취약점)
- 외부 노출용 번호는 비즈니스 규칙(날짜, 채널 구분 등)을 담을 수 있다

```sql
-- ❌ API 응답에 id 직접 노출
GET /orders/42

-- ✅ order_number로 식별
GET /orders/ORD-20260408-00001
```

### 2.2 배송지 스냅샷 — 왜 `user_addresses`를 참조하지 않는가

사용자의 주소록(`user_addresses` 테이블)을 FK로 참조하면 이런 버그가 생긴다:

```
1. 고객이 "서울시 강남구" 주소로 주문
2. 고객이 주소록에서 그 주소를 "부산시 해운대구"로 수정
3. 판매자가 주문을 보니 "부산시 해운대구"로 배송해야 한다고 나온다
4. 하지만 실제로는 강남구로 출고됨 → 분쟁
```

**주문 시점의 배송지는 그 시점의 값으로 고정**되어야 한다. [2편](/blog/rdb-normalization-guide)의 **스냅샷 패턴**이 상품 가격뿐 아니라 배송지에도 적용된다.

정규화 관점에서는 중복이지만, 비즈니스 관점에서는 필수다. 실무에서 이걸 놓치고 FK로 연결했다가 크게 당한다.

### 2.3 상태 머신 설계

2단 구조의 단순 상태:

```
PENDING → PAID → SHIPPED → DELIVERED → COMPLETED
```

3단 계층의 상태는 더 풍부하다:

```
PENDING ──→ PAID ──┬──→ SHIPPED ──→ DELIVERED ──→ COMPLETED
                   │
                   └──→ PARTIALLY_SHIPPED ──→ SHIPPED ──→ ...

(어느 단계에서든)
  ──→ PARTIALLY_CANCELLED / CANCELLED
  ──→ PARTIALLY_REFUNDED / REFUNDED
```

주문 상태는 근본적으로 **"배송 상태의 집계"**다:

- 모든 배송이 `READY` → 주문은 `PAID`
- 일부 배송이 `SHIPPED` → 주문은 `PARTIALLY_SHIPPED`
- 모든 배송이 `SHIPPED` → 주문은 `SHIPPED`
- 모든 배송이 `DELIVERED` → 주문은 `DELIVERED`

이 집계는 **앱 레벨에서 계산**하거나, 배송 상태가 바뀔 때마다 **주문 상태를 동기화**한다. CHECK 제약은 허용되는 값의 집합만 보장할 뿐, 집계의 일관성까지 책임지지는 않는다. 일관성은 앱 로직(또는 트리거)의 책임이다.

### 2.4 상태별 타임스탬프 — 왜 orders에 직접?

`paid_at`, `cancelled_at`을 주문 테이블에 직접 넣은 이유:

- "이 주문은 언제 결제됐는가?"는 가장 빈번한 조회 → JOIN 없이 읽을 수 있어야 한다
- 상태별 타임스탬프는 **현재 상태의 스냅샷**이다
- 상세한 이력(누가, 언제, 왜 바꿨는지)은 `order_status_histories`에 저장한다

이것은 [2편](/blog/rdb-normalization-guide)의 **의도적 반정규화**다.

참고로 `shipped_at`, `delivered_at`은 주문 레벨에 두지 **않았다**. 배송이 여러 건이면 주문 레벨의 "배송 시각"이 애매해진다(첫 배송? 마지막 배송?). 그래서 `order_deliveries`에 둔다.

---

## 3. order_deliveries — 배송 묶음 (핵심 추가)

이 글에서 가장 중요한 추가 개념이다.

```sql
CREATE TABLE order_deliveries (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    delivery_number     VARCHAR(30) NOT NULL,           -- 외부 식별자 (예: ORD-20260408-00001-D1)
    sequence            SMALLINT    NOT NULL,           -- 주문 내 배송 순번 (1, 2, 3...)
    status              VARCHAR(20) NOT NULL DEFAULT 'READY',

    -- 배송 정보
    carrier             VARCHAR(50),                    -- 택배사 (CJ, 한진, 우체국, ...)
    tracking_number     VARCHAR(50),                    -- 송장번호

    -- 배송 단위 타임스탬프
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

### 3.1 왜 배송을 분리하는가

**송장번호는 배송 단위다.** 한 주문에 여러 송장이 붙을 수 있다:

```
주문 ORD-20260408-00001 (냉장 + 상온)
  ├─ 배송 1 (D1): 냉장 상품 A, B    → 송장 CJ-1234
  └─ 배송 2 (D2): 상온 상품 C, D    → 송장 CJ-5678
```

- 송장번호를 orders에 두면 → "여러 송장"을 표현할 수 없다
- 송장번호를 order_items에 두면 → "A와 B가 같은 박스"라는 사실을 표현할 수 없다 (같은 송장번호가 두 행에 중복 저장)

**배송 단위가 곧 물리적 박스 단위**이기 때문에 별도 엔티티로 분리하는 게 자연스럽다.

### 3.2 배송 상태 머신

```
READY ──→ SHIPPED ──→ IN_TRANSIT ──→ DELIVERED
  │
  └──→ CANCELLED
```

- `READY`: 결제 완료, 배송 준비 중 (아직 미출고)
- `SHIPPED`: 출고 완료, 송장 등록됨
- `IN_TRANSIT`: 배송 중 (택배사 시스템 연동 시)
- `DELIVERED`: 수령 완료
- `CANCELLED`: 출고 전 배송 단위 취소

`IN_TRANSIT`은 택배사 Webhook을 받을 수 있을 때만 의미가 있다. 연동이 없으면 `SHIPPED`에서 바로 `DELIVERED`로 넘어간다.

### 3.3 delivery_number — 또 하나의 외부 ID?

배송 단위에도 외부 노출용 식별자를 만든다. CS에서 "주문번호 ORD-20260408-00001의 두 번째 배송에 대해 문의드립니다"보다 "배송번호 `ORD-20260408-00001-D2`"가 훨씬 명확하다.

`(order_number, sequence)` 조합만으로 UNIQUE가 되긴 하지만, 단일 컬럼 식별자가 조회/로그/URL 설계에서 훨씬 쉽다. 저장 공간 몇 바이트 아끼려다 조회 복잡도가 올라가는 건 손해다.

---

## 4. order_items — 스냅샷과 아이템 상태

```sql
CREATE TABLE order_items (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT NOT NULL,                -- 조회 편의상 중복 저장
    order_delivery_id   BIGINT NOT NULL,
    product_id          BIGINT NOT NULL,

    -- 주문 시점 스냅샷
    product_name        VARCHAR(200)  NOT NULL,
    product_option      VARCHAR(200),                   -- "색상: 블랙, 사이즈: M"
    unit_price          DECIMAL(10, 2) NOT NULL,
    quantity            INT            NOT NULL,
    subtotal            DECIMAL(12, 2) NOT NULL,        -- unit_price * quantity

    -- 아이템 단위 상태와 집계
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

### 4.1 `order_id`와 `order_delivery_id`를 둘 다?

엄밀히 말하면 `order_delivery_id`만 있어도 `order_deliveries.order_id`로 역추적할 수 있다. 그럼에도 `order_id`를 중복 저장한 이유:

```sql
-- order_id 없이 delivery 경유
SELECT oi.*
FROM order_items oi
JOIN order_deliveries od ON oi.order_delivery_id = od.id
WHERE od.order_id = 42;

-- order_id가 있으면
SELECT * FROM order_items WHERE order_id = 42;
```

JOIN 한 번이 줄고 인덱스가 직접 먹는다. "주문 전체 상품 조회"가 가장 빈번한 쿼리이므로 이 최적화는 값어치가 있다.

대가: **반정규화가 깨질 위험**이다. `order_items.order_id`와 `order_deliveries.order_id`가 달라지는 경우. 가장 단순한 방어는 **INSERT 시 앱 레벨에서 함께 세팅하고 이후 변경을 금지**하는 것이다. 더 강하게 가려면 트리거로 동기화를 강제할 수도 있다.

이 트레이드오프는 실무에서 자주 나온다 — "역추적 가능한 컬럼을 중복 저장해서 조회를 단순화할 것인가". 정답은 없고, **조회 빈도와 쓰기 복잡도를 저울질**해서 결정한다.

### 4.2 상품/옵션 스냅샷

상품 테이블의 가격은 바뀐다. 상품명도 바뀐다. 옵션 조합(S/M/L, 색상)도 사라지거나 추가된다.

**주문 시점의 가격/상품명/옵션은 그 시점의 값으로 고정**되어야 한다. [2편](/blog/rdb-normalization-guide)에서 다룬 스냅샷 패턴이다.

```sql
-- ❌ 현재 가격으로 계산 (과거 주문 금액이 바뀜)
SELECT oi.quantity * p.price
FROM order_items oi JOIN products p ON oi.product_id = p.id;

-- ✅ 주문 시점 가격으로 계산
SELECT subtotal FROM order_items WHERE order_id = 42;
```

`product_option`은 한 컬럼으로 납작하게 저장하는 편이 보통은 낫다. 주문 이력은 "사람이 읽는 기록"의 성격이 강하기 때문이다. JSON이 유연하지만, "색상: 블랙, 사이즈: M"처럼 사람이 바로 읽을 수 있는 문자열이 CS/정산/엑셀 추출에 편하다.

### 4.3 아이템 단위 취소/환불 수량

`cancelled_quantity`와 `refunded_quantity`를 아이템에 직접 둔 이유:

```
상품 A 10개 구매
  ├─ 3개 취소 (배송 전)   → cancelled_quantity = 3
  ├─ 2개 환불 (반품)     → refunded_quantity  = 2
  └─ 5개는 유효 (10 - 3 - 2)
```

"이 아이템에서 유효한 수량"을 JOIN 없이 즉시 계산할 수 있다. 상세 이력(어느 환불 건으로 몇 개가 빠졌는지)은 `refund_items`에 있다. 여기서는 **집계 값만 반정규화**한다.

CHECK 제약으로 `cancelled_quantity + refunded_quantity <= quantity`를 강제하는 걸 권장한다. 앱 버그가 아이템 상태를 이상하게 만드는 걸 마지막 선에서 막는다. 같은 행의 여러 컬럼을 비교하는 CHECK는 MySQL 8.0과 PostgreSQL 모두 지원한다.

---

## 5. payments — 멱등성과 복합 결제

결제는 "딱 한 번만" 처리되어야 한다. 네트워크 타임아웃으로 재시도가 오거나, 사용자가 결제 버튼을 두 번 누르거나 — 이중 결제가 발생하면 큰 사고다.

```sql
CREATE TABLE payments (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    idempotency_key     VARCHAR(64) NOT NULL,

    payment_method      VARCHAR(20)    NOT NULL,        -- CARD, POINT, COUPON, KAKAO_PAY, ...
    amount              DECIMAL(12, 2) NOT NULL,
    status              VARCHAR(20)    NOT NULL DEFAULT 'PENDING',

    -- PG사 연동 정보 (POINT/COUPON이면 NULL)
    pg_provider         VARCHAR(30),                    -- TOSS, KAKAO, NICE, ...
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

### 5.1 멱등성 키의 역할

```
1차 시도: idempotency_key = 'pay_abc123' → INSERT 성공 → 결제 진행
2차 시도: idempotency_key = 'pay_abc123' → UNIQUE 위반 → 기존 결과 반환
```

클라이언트가 같은 키로 재요청하면 UNIQUE 제약이 중복 INSERT를 막고, 앱에서는 기존 결제 결과를 반환한다. **스키마 레벨에서 이중 결제를 원천 차단**하는 것이다.

멱등성 키 생성 전략:

| 전략 | 예시 | 장점 | 단점 |
|------|------|------|------|
| 클라이언트 UUID | `pay_550e8400-e29b-...` | 클라이언트 독립적 | 매번 새 키 생성하면 의미 없음 |
| 주문번호 + 수단 + 시도 | `ORD-...-CARD-1` | 디버깅 쉬움 | 시도번호 관리 필요 |
| 주문ID + 해시 | `order_123_sha256(...)` | 서버에서 결정적 | 해시 충돌 가능성 (극히 낮음) |

실무에서는 **주문번호 기반**이 가장 많이 쓰인다. "이 결제가 어떤 주문의 어떤 수단, 몇 번째 시도인지"를 바로 읽을 수 있기 때문이다.

### 5.2 복합 결제 — 왜 1:N인가

한 주문에 여러 결제 수단이 섞이는 경우가 실무에서 매우 흔하다:

```
주문 총액: 100,000원
  ├─ payments[1]: POINT     10,000원
  ├─ payments[2]: COUPON     5,000원
  └─ payments[3]: CARD      85,000원
                  ─────────
                  합계 100,000원 = orders.total_amount
```

포인트와 쿠폰도 "결제 수단"으로 모델링한다. 이렇게 하면:

- 환불 시 "포인트로 낸 건 포인트로 돌려준다"가 자연스럽게 추적된다
- 회계 기준으로 "현금 결제 vs 포인트 결제" 구분이 가능하다
- PG사 결제와 자사 자산 차감을 같은 테이블로 일관 관리한다

**제약**: `SUM(payments.amount WHERE order_id = X AND status = 'CONFIRMED') == orders.total_amount`. 이건 여러 행 합계라 CHECK로 표현 못 한다. 앱 레벨 또는 트리거에서 검증한다.

### 5.3 재시도 기록도 1:N

복합 결제가 아니어도 payments는 1:N이다:

```
1차 시도: 카드 한도 초과 → FAILED
2차 시도: 다른 카드로 → CONFIRMED
```

실패한 시도를 지우지 않고 남긴다. 이유는 **CS 대응**이다. "왜 결제가 한 번 실패했다가 됐느냐"는 문의가 오면 실패 사유까지 보여줘야 한다. 실패 이력을 삭제하면 이 대응이 불가능하다.

---

## 6. order_status_histories — 어느 레벨에서 추적하나

주문 레벨 상태, 배송 레벨 상태, 아이템 레벨 상태 — 어디까지 이력을 남길까?

```sql
CREATE TABLE order_status_histories (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    entity_type     VARCHAR(20) NOT NULL,           -- 'ORDER', 'DELIVERY'
    entity_id       BIGINT      NOT NULL,
    from_status     VARCHAR(20),                    -- NULL이면 최초 생성
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

### 6.1 권장: 주문 + 배송 레벨만

- **주문 레벨** (PENDING → PAID → ...): 고객 여정의 큰 단계
- **배송 레벨** (READY → SHIPPED → DELIVERED): 물류 추적
- **아이템 레벨**: 권장하지 않음. 취소/환불 이력은 이미 `order_cancellations`와 `refund_items`가 들고 있으므로 중복이다

너무 많은 레벨에 이력을 남기면 이력 테이블이 빠르게 비대해지고, 디버깅할 때 "어느 테이블을 봐야 하는지" 헷갈린다. **의미 있는 단위에서만 이력을 남기는 게 핵심**이다.

### 6.2 `entity_type + entity_id`는 다형성이다

[4편](/blog/rdb-relationship-patterns-guide)에서 다룬 **다형성 관계**의 예다. FK로 강제할 수 없는 게 단점이지만, 이력처럼 "여러 타입을 같은 구조로 저장"할 때는 허용할 만하다.

싫다면 `order_status_histories` + `delivery_status_histories`로 테이블을 분리하는 방법도 있다. 판단 기준:

- "특정 주문의 전체 이력을 한 방에 보고 싶다" → 한 테이블이 편하다
- "배송 이력만 따로 집계/조회가 많다" → 분리가 낫다

### 6.3 `changed_by`의 유형

- `SYSTEM`: 자동 처리 (결제 완료 webhook, 타임아웃 취소 등)
- `ADMIN:kim`: 관리자 수동 개입
- `USER:123`: 고객이 직접 (취소 요청 등)
- `WEBHOOK:CJ`: 외부 시스템 (택배사 배송 완료 콜백)

`changed_by`를 FK로 묶지 않는 이유: 주체가 users뿐만이 아니라 시스템/외부/관리자 등 여러 종류기 때문이다. 문자열로 두는 게 **실용적**이다.

---

## 7. order_cancellations — 취소 이력

취소를 `order_status_histories`에 녹일 수도 있지만, 별도 테이블로 뺀다. 이유: 취소는 **사유**와 **주체**가 핵심이고, 부분 취소면 **대상 배송/아이템**까지 기록해야 하기 때문이다.

```sql
CREATE TABLE order_cancellations (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    order_delivery_id   BIGINT,                         -- NULL이면 주문 전체 취소

    -- 누가, 왜
    cancelled_by_type   VARCHAR(20) NOT NULL,           -- CUSTOMER, SELLER, ADMIN, SYSTEM
    cancelled_by_id     VARCHAR(100),                   -- user_id/admin_id, NULL if SYSTEM
    reason_code         VARCHAR(50) NOT NULL,           -- 'CUSTOMER_CHANGED_MIND', 'OUT_OF_STOCK', ...
    reason_detail       VARCHAR(1000),

    -- 환불과의 연결 (취소 시 즉시 환불되는 경우)
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

### 7.1 취소 주체별 분석 필요성

CS, 정산, 매출 분석에서 **취소 주체는 결정적으로 중요하다**:

| 주체 | 분석 관점 |
|------|----------|
| `CUSTOMER` | 반품률, 이탈 패턴 |
| `SELLER` | 품절률, 셀러 신뢰도 |
| `ADMIN` | 운영 개입, 이상 거래 차단 |
| `SYSTEM` | 결제 타임아웃, 재고 부족 자동 취소 |

이 구분 없이 "취소됨"으로만 기록하면 "셀러 품절로 인한 취소"가 "고객 변심"과 섞여서 셀러 품질 평가가 불가능해진다. 나중에 스키마를 바꾸는 건 쉽지 않으니 처음부터 넣는 게 낫다.

### 7.2 `reason_code` vs `reason_detail`

`reason_code`는 **고정된 enum**, `reason_detail`은 **자유 텍스트**다.

```
reason_code   = 'OUT_OF_STOCK'
reason_detail = '공급사 재고 소진, 4월 15일 이후 입고 예정'
```

코드는 집계/통계에, 텍스트는 CS 대응에 쓴다. 둘 다 필요하다. 둘 중 하나만 남기면 "코드만 있으면 상세 맥락이 없고, 텍스트만 있으면 집계가 안 된다".

---

## 8. refunds + refund_items — 아이템 단위 환불

환불이 왜 복잡한가:

- **부분 환불**: 10만원 중 3만원만 환불
- **아이템 단위 환불**: 어느 상품이 환불됐는지 추적
- **복합 결제 환불**: 카드로 결제한 건 카드로, 포인트는 포인트로 돌려줘야 함
- **다중 환불**: 1차 부분 환불 후 2차 추가 환불

이 네 가지를 전부 표현하려면 환불도 3개 테이블로 분해해야 한다.

```sql
-- 환불 한 건 (환불 요청 단위)
CREATE TABLE refunds (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT      NOT NULL,
    refund_number       VARCHAR(30) NOT NULL,           -- 외부 식별자
    amount              DECIMAL(12, 2) NOT NULL,        -- 이 환불 건 총액 (refund_items 합)
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

-- 환불 대상 아이템 (어느 상품을 몇 개 돌려받는가)
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

-- 환불 결제 수단별 분배 (복합 결제 대응)
CREATE TABLE refund_payments (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    refund_id       BIGINT NOT NULL,
    payment_id      BIGINT NOT NULL,                    -- 원 결제
    amount          DECIMAL(12, 2) NOT NULL,
    pg_refund_id    VARCHAR(100),                       -- PG사 환불 ID
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

### 8.1 전체 그림

```
orders (100,000원)
  ├─ order_items
  │    ├─ 상품 A × 5 × 10,000 = 50,000
  │    └─ 상품 B × 5 × 10,000 = 50,000
  │
  ├─ payments
  │    ├─ POINT 10,000 [CONFIRMED]
  │    └─ CARD  90,000 [CONFIRMED]
  │
  └─ refunds (고객이 상품 A 2개 반품, 총 20,000원 환불)
       ├─ refund_items
       │    └─ order_item_id=1 (A) × 2개 × 10,000 = 20,000
       │
       └─ refund_payments (10,000은 포인트, 10,000은 카드로 복구)
            ├─ payment_id=1 (POINT) 10,000
            └─ payment_id=2 (CARD)  10,000
```

1차 환불이 완료되면 `order_items.refunded_quantity`가 `0 → 2`로 업데이트된다. 이후 고객이 상품 B도 반품하면 새 refunds 행이 생기고, 해당 `order_items.refunded_quantity`가 또 올라간다.

### 8.2 "환불 금액의 합이 결제 금액을 초과하면 안 된다"

CHECK로 표현 못 한다(다른 행 참조 필요). 앱 레벨에서 다음을 검증한다:

```sql
-- 가능한 최대 환불 금액
SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM payments
     WHERE order_id = ? AND status = 'CONFIRMED')
  - (SELECT COALESCE(SUM(amount), 0) FROM refunds
     WHERE order_id = ? AND status IN ('APPROVED', 'PROCESSING', 'COMPLETED'))
    AS refundable_amount;
```

배타 락(`SELECT ... FOR UPDATE`)으로 orders 행을 잠그고 계산 후 INSERT하면 동시성도 안전하다. 이건 [FCFS 시리즈 4편](/blog/fcfs-db-lock-implementation)에서 다룬 비관적 락의 실전 응용이다.

### 8.3 아이템 단위 환불 vs 주문 단위 환불

더 단순한 대안은 "환불은 주문 단위 금액만 기록"이다. 하지만:

- 회계 기준으로 "어느 상품의 환불인지" 요구된다
- 셀러 정산에서 "어느 상품을 몇 개 돌려줬는지"가 필요하다
- 재고 복원을 아이템 단위로 해야 한다

이 중 하나라도 해당되면 **아이템 단위 환불**이 사실상 필수다. MVP 단계가 아니라면 처음부터 `refund_items`를 두는 게 낫다. 나중에 "주문 단위 환불에서 아이템 단위로" 데이터 마이그레이션하는 건 **주문 이력 전체를 복원해야 해서 매우 어렵다**. 초반 설계 시점에 결정해야 한다.

---

## 9. 설계 원칙 정리

| 원칙 | 적용 |
|------|------|
| **3단 계층** | orders → order_deliveries → order_items |
| **배송지 스냅샷** | orders에 수령인/주소 복사 (user_addresses 참조 X) |
| **상품/옵션 스냅샷** | order_items에 product_name/unit_price/product_option 복사 |
| **멱등성** | payments.idempotency_key UNIQUE 제약 |
| **상태 머신** | 주문/배송 레벨 각각 CHECK + 앱 레벨 전이 규칙 |
| **복합 결제** | payments 1:N (수단별 분리) + refund_payments로 환불 분배 |
| **부분 취소/환불** | order_items.cancelled_quantity / refunded_quantity + refund_items |
| **취소 이력 분리** | order_cancellations로 주체/사유 코드 기록 |
| **외부 ID 분리** | order_number / delivery_number / refund_number (내부 id 노출 금지) |
| **이력 추적** | order_status_histories (주문/배송 2 레벨만) |
| **조회 최적화 반정규화** | order_items.order_id 중복 저장, orders.paid_at 등 타임스탬프 |

이론과의 연결:

```
1편 네이밍/타입 → order_number VARCHAR(30), amount DECIMAL(12,2)
2편 정규화/스냅샷 → 상품 스냅샷 + 배송지 스냅샷 + 상태별 타임스탬프
3편 제약조건   → CHECK (cancelled + refunded <= quantity),
                 UNIQUE (idempotency_key, order_number)
4편 관계 패턴  → orders-deliveries-items 1:N 체인,
                 order_status_histories 다형성,
                 refund_items로 order_items N:M 확장
```

---

## 10. 스키마 설계 리뷰 체크리스트

PR에 마이그레이션 파일이 올라왔을 때 이 체크리스트로 리뷰하면 된다.

### 10.1 네이밍 ([1편](/blog/rdb-schema-basics-guide) 참고)

- [ ] 테이블명이 snake_case + 복수형인가?
- [ ] 컬럼명이 snake_case이고 의미가 명확한가?
- [ ] boolean 컬럼에 `is_`, `has_` 접두사가 있는가?
- [ ] FK 컬럼이 `참조테이블_id` 형식인가? (예: `user_id`, `order_id`)

### 10.2 데이터 타입 ([1편](/blog/rdb-schema-basics-guide) 참고)

- [ ] VARCHAR 길이에 근거가 있는가? (무조건 255가 아닌지)
- [ ] 금액에 DECIMAL을 사용했는가? (FLOAT/DOUBLE이 아닌지)
- [ ] PK가 BIGINT인가? (INT의 21억 한계를 고려했는가)
- [ ] TIMESTAMP vs DATETIME 선택에 근거가 있는가?

### 10.3 정규화/반정규화 ([2편](/blog/rdb-normalization-guide) 참고)

- [ ] 같은 데이터가 여러 곳에 저장되는 경우, 의도적 반정규화인가 실수인가?
- [ ] 반정규화된 값의 동기화 전략이 있는가?
- [ ] 스냅샷 패턴이 필요한 곳에 적용되었는가? (가격, 주소, 옵션)

### 10.4 제약조건 ([3편](/blog/rdb-constraints-integrity-guide) 참고)

- [ ] NOT NULL이어야 하는 컬럼이 NOT NULL로 선언되었는가?
- [ ] 비즈니스 규칙을 CHECK로 표현할 수 있는가? (`cancelled + refunded <= quantity` 등)
- [ ] UNIQUE 제약이 필요한 곳에 걸려 있는가? (order_number, idempotency_key)
- [ ] FK가 필요한 곳에 걸려 있는가?
- [ ] ON DELETE 전략이 적절한가?

### 10.5 관계 설계 ([4편](/blog/rdb-relationship-patterns-guide) 참고)

- [ ] 2단 구조로 충분한가, 아니면 중간 계층(배송 등)이 필요한가?
- [ ] 1:N 체인의 중간 테이블에 양방향 인덱스가 있는가?
- [ ] 다형성 관계의 패턴 선택에 근거가 있는가?

### 10.6 인덱스

- [ ] FK 컬럼에 인덱스가 있는가? (PostgreSQL은 자동 생성하지 않음)
- [ ] WHERE, ORDER BY, JOIN에 자주 쓰이는 컬럼에 인덱스가 있는가?
- [ ] 불필요한 인덱스는 없는가? (쓰기 성능에 영향)

### 10.7 주문 도메인 특화 체크

- [ ] 외부 노출용 식별자(`order_number` 등)와 내부 `id`가 분리되어 있는가?
- [ ] 스냅샷이 필요한 모든 곳(상품, 가격, 옵션, 배송지)에 적용되었는가?
- [ ] 결제 멱등성이 스키마 레벨에서 보장되는가?
- [ ] 부분 취소/환불이 표현 가능한가?
- [ ] 취소 주체(고객/셀러/관리자/시스템) 구분이 가능한가?
- [ ] 복합 결제(카드 + 포인트 + 쿠폰)가 표현 가능한가?
- [ ] 주문/배송/아이템 레벨 상태가 서로 정합적인가?

### 10.8 체크리스트 활용법

이 체크리스트를 한 번에 다 적용하려고 하지 말자. **현재 프로젝트에서 가장 문제가 되는 2~3개**부터 시작하면 된다.

```
"우리 팀은 FK 인덱스를 자주 빼먹는다"     → 10.6 집중
"NOT NULL을 안 걸어서 NULL 버그가 많다"   → 10.4 집중
"스냅샷 기준이 없어서 이력이 깨진다"       → 10.3 집중
```

체크리스트는 **규칙이 아니라 대화의 시작점**이다. "이거 왜 이렇게 했어?"라는 질문의 근거가 되어야 하고, "이유가 있어서 이렇게 했어"라는 답이 있다면 체크리스트를 무시해도 된다.

---

## 정리

이 글에서는 주문 도메인 하나만 끈질기게 팠다. 요점:

1. **3단 계층**(`orders → order_deliveries → order_items`)은 실무 이커머스의 기본 구조다. 부분 배송, 부분 취소, 부분 환불을 표현하려면 피할 수 없다.
2. **스냅샷 패턴**은 상품 가격에만 쓰는 게 아니다. 배송지, 옵션, 상태별 타임스탬프까지 확장된다.
3. **멱등성 키**는 이중 결제를 스키마 레벨에서 원천 차단하는 가장 중요한 장치다. UNIQUE 제약 하나로 앱 버그와 네트워크 재시도를 한 번에 막는다.
4. **복합 결제**(카드 + 포인트 + 쿠폰)는 payments를 1:N으로 모델링해서 자연스럽게 표현한다. 환불도 `refund_payments`로 결제 수단별 분배가 추적된다.
5. **취소와 환불의 이력**은 주체/사유 코드까지 남겨야 CS, 정산, 셀러 평가에 쓸 수 있다.

**"이론을 아는 것"과 "실무에 적용하는 것"은 다른 능력이다.** 주문 도메인 하나만 해도 테이블 8개, 제약 수십 개, 트레이드오프 여러 개가 나온다. 다른 도메인은 또 이만큼씩 있다. 이 글이 "실무 수준 설계의 무게"를 조금이라도 전달했기를 바란다.

다음 편에서는 **RBAC 권한 시스템 스키마 설계** — 역할/권한 테이블, 캐시 전략, 역할 계층과 리소스 레벨 권한까지 다룬다.
