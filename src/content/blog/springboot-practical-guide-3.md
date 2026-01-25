---
title: "스프링부트 실무 가이드 3편: 이벤트 드리븐 아키텍처"
description: "Kafka와 Outbox 패턴으로 신뢰성 있는 이벤트 시스템 구축하기"
pubDate: 2026-01-25
tags: ["Spring Boot", "Kafka", "Event-Driven", "Backend", "실무가이드"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [2편: 캐싱 전략](/blog/springboot-practical-guide-2) | **3편: 이벤트 드리븐** | [4편: Resilience 패턴](/blog/springboot-practical-guide-4) |

---

## TL;DR (핵심 요약)

```
이벤트 드리븐 = 비동기 + 느슨한 결합 + 확장성
Outbox 패턴 = DB 트랜잭션 + 이벤트 저장 → 별도 발행 (At-least-once)
Consumer = 멱등성 필수 (중복 처리 대비)
```

| 패턴 | 목적 | 핵심 |
|------|------|------|
| **이벤트 드리븐** | 서비스 간 느슨한 결합 | Producer → Queue → Consumer |
| **Outbox 패턴** | 이벤트 발행 신뢰성 | DB와 이벤트를 같은 트랜잭션에 저장 |
| **멱등성** | 중복 메시지 처리 | 같은 메시지 N번 처리해도 결과 동일 |

---

## 1. 이벤트 드리븐 아키텍처

### 1.1 전통적인 동기 방식의 한계

```
주문 서비스가 모든 후속 작업을 직접 호출:

[OrderService]
     │
     ├──▶ [InventoryService].decreaseStock()    (50ms)
     ├──▶ [PaymentService].processPayment()     (200ms)
     ├──▶ [EmailService].sendConfirmation()     (500ms)
     ├──▶ [NotificationService].sendPush()      (300ms)
     └──▶ [AnalyticsService].recordOrder()      (100ms)

총 응답 시간: 1,150ms
```

**문제점:**

| 문제 | 설명 |
|------|------|
| **강한 결합** | OrderService가 5개 서비스에 의존 |
| **긴 응답 시간** | 모든 작업이 끝나야 응답 |
| **장애 전파** | EmailService 장애 → 주문 실패 |
| **확장 어려움** | 새 기능 추가 시 OrderService 수정 필요 |

### 1.2 이벤트 드리븐 방식

**"무슨 일이 일어났다"를 알리고, 관심 있는 서비스가 반응**

```
[OrderService]
     │
     └──▶ "주문이 생성되었다" (이벤트 발행)
              │
              ├──▶ [InventoryService] "재고 차감할게"
              ├──▶ [PaymentService] "결제 처리할게"
              ├──▶ [EmailService] "이메일 보낼게"
              ├──▶ [NotificationService] "푸시 보낼게"
              └──▶ [AnalyticsService] "기록할게"

OrderService 응답 시간: 50ms (이벤트 발행만)
나머지는 비동기로 각자 처리
```

### 1.3 핵심 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                    이벤트 드리븐 아키텍처                         │
│                                                                  │
│   ┌───────────┐         ┌───────────┐         ┌───────────┐    │
│   │ Producer  │ ──────▶ │  Message  │ ──────▶ │ Consumer  │    │
│   │ (발행자)   │  Event  │   Queue   │  Event  │ (소비자)   │    │
│   └───────────┘         │  (브로커)  │         └───────────┘    │
│                         └───────────┘                           │
│        │                      │                      │          │
│   "일이 일어났다"         메시지 저장/전달        "내가 처리할게"   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 이벤트 설계

### 2.1 좋은 이벤트의 특징

**1. 과거형으로 명명 (이미 일어난 사실)**
```
좋음: OrderCreated, PaymentCompleted, ItemShipped
나쁨: CreateOrder, ProcessPayment, ShipItem
```

**2. 불변성 (Immutable)**
```kotlin
// 이벤트는 발생한 사실이므로 변경 불가
data class OrderCreatedEvent(
    val orderId: Long,
    val buyerId: Long,
    val totalAmount: BigDecimal,
    val occurredAt: LocalDateTime = LocalDateTime.now()
)
```

**3. 자기 완결성 (Self-contained)**
```kotlin
// 나쁨: Consumer가 추가 조회 필요
data class OrderCreatedEvent(
    val orderId: Long  // 이것만으론 정보 부족
)

// 좋음: 필요한 정보 포함
data class OrderCreatedEvent(
    val orderId: Long,
    val orderNumber: String,
    val buyerId: Long,
    val buyerEmail: String,
    val items: List<OrderItemDto>,
    val totalAmount: BigDecimal
)
```

---

## 3. 이벤트 발행의 신뢰성 문제

### 3.1 이중 쓰기 문제 (Dual Write Problem)

```kotlin
@Transactional
fun createOrder(request: CreateOrderRequest) {
    // 1. DB에 주문 저장
    val order = orderRepository.save(Order(...))

    // 2. 메시지 큐에 이벤트 발행
    messageQueue.send(OrderCreatedEvent(order.id))  // ← 문제!
}
```

**왜 문제인가?**

```
DB와 메시지 큐는 별개의 시스템 (서로 다른 트랜잭션)

Case 1: DB 커밋 성공, 메시지 발행 실패
┌─────────┐     ┌─────────┐
│   DB    │     │  Queue  │
│ ✅ 저장  │     │ ❌ 실패  │
└─────────┘     └─────────┘
→ 주문은 있는데 이벤트 없음

Case 2: 메시지 발행 후 DB 롤백
┌─────────┐     ┌─────────┐
│   DB    │     │  Queue  │
│ ❌ 롤백  │     │ ✅ 발행  │
└─────────┘     └─────────┘
→ 주문은 없는데 이벤트 있음
```

### 3.2 해결책: Outbox 패턴

**핵심 아이디어**: 이벤트를 메시지 큐 대신 **같은 DB에 저장**

```
┌─────────────────────────────────────────────────────────────────┐
│                   하나의 DB 트랜잭션                              │
│                                                                  │
│   ┌─────────────────┐     ┌─────────────────┐                   │
│   │   orders 테이블  │     │ outbox_events   │                   │
│   │                 │     │     테이블       │                   │
│   │  INSERT 주문    │     │  INSERT 이벤트  │                   │
│   └─────────────────┘     └─────────────────┘                   │
│                                                                  │
│            둘 다 성공하거나 둘 다 실패 (원자성)                    │
└─────────────────────────────────────────────────────────────────┘
                                    │
                            (별도 프로세스)
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Message Queue     │
                         │   (Kafka 등)        │
                         └─────────────────────┘
```

---

## 4. Outbox 패턴 구현

### 4.1 Outbox 테이블

```sql
CREATE TABLE outbox_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,   -- "Order"
    aggregate_id VARCHAR(100) NOT NULL,     -- "123"
    event_type VARCHAR(100) NOT NULL,       -- "OrderCreated"
    payload TEXT NOT NULL,                  -- JSON 데이터
    status VARCHAR(20) DEFAULT 'PENDING',   -- PENDING/PROCESSED/FAILED
    created_at DATETIME DEFAULT NOW(),
    processed_at DATETIME,
    retry_count INT DEFAULT 0
);
```

### 4.2 트랜잭션 내에서 이벤트 저장

```kotlin
@Transactional
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // 1. 주문 저장 (같은 트랜잭션)
    val savedOrder = orderJpaRepository.save(order)

    // 2. Outbox에 이벤트 저장 (같은 트랜잭션)
    outboxEventService.saveEvent(
        aggregateType = "Order",
        aggregateId = savedOrder.id.toString(),
        eventType = "OrderCreated",
        payload = mapOf(
            "orderId" to savedOrder.id,
            "buyerId" to buyerId,
            "totalAmount" to savedOrder.totalAmount
        )
    )
    // 커밋 시 둘 다 저장되거나 둘 다 롤백

    return OrderResponse.from(savedOrder)
}
```

### 4.3 별도 프로세스가 메시지 큐로 발행

```kotlin
@Scheduled(fixedDelay = 1000)  // 1초마다
@Transactional
fun publishPendingEvents() {
    // 1. PENDING 이벤트 조회
    val events = outboxJpaRepository.findByStatus(PENDING)

    events.forEach { event ->
        try {
            // 2. 메시지 큐로 발행
            kafkaTemplate.send(topic, event.aggregateId, event.payload)

            // 3. 상태 변경
            event.markAsProcessed()
        } catch (e: Exception) {
            event.markAsFailed(e.message)
        }
    }
}
```

---

## 5. 중복 발행과 멱등성

### 5.1 중복 발행이 발생하는 케이스

Outbox 패턴은 **At-least-once**를 보장하므로 중복 발행이 발생할 수 있습니다.

**Case: Kafka 발행 성공, DB 업데이트 전 장애**

```
OutboxPublisher 실행 흐름:

1. PENDING 이벤트 조회          ✅
2. Kafka로 발행                 ✅ (메시지 전송됨)
3. status = PROCESSED 업데이트  ❌ (서버 크래시!)

재시작 후:
- DB에는 여전히 status = PENDING
- OutboxPublisher가 같은 이벤트를 다시 발행
- Consumer는 같은 메시지를 2번 받음
```

### 5.2 Consumer에서 멱등성 보장 (권장)

```kotlin
@Component
class OrderEventConsumer(
    private val processedEventRepository: ProcessedEventRepository,
    private val emailService: EmailService
) {
    @KafkaListener(topics = ["marketplace.order.created"])
    fun handleOrderCreated(payload: Map<String, Any>, ack: Acknowledgment) {
        val eventId = payload["eventId"] as String

        // 1. 이미 처리한 이벤트인지 확인
        if (processedEventRepository.existsById(eventId)) {
            log.info("이미 처리된 이벤트, 스킵: $eventId")
            ack.acknowledge()
            return
        }

        // 2. 비즈니스 로직 처리
        emailService.sendOrderConfirmation(payload)

        // 3. 처리 완료 기록
        processedEventRepository.save(ProcessedEvent(eventId))

        ack.acknowledge()
    }
}
```

### 5.3 멱등성 설계 원칙

| 원칙 | 설명 | 예시 |
|------|------|------|
| **고유 식별자** | 모든 이벤트에 unique ID 포함 | `eventId: UUID` |
| **처리 기록** | 처리한 이벤트 ID 저장 | `processed_events` 테이블 |
| **비즈니스 키** | 자연 키로 중복 체크 | `orderId + emailType` |
| **결과 동일성** | N번 실행해도 결과 같음 | `UPDATE ... SET status = 'SENT'` |

```
멱등한 연산 예시:

✅ 멱등: UPDATE status = 'SENT' WHERE id = 123
         (여러 번 실행해도 결과 동일)

❌ 비멱등: INSERT INTO emails (order_id, ...)
          (여러 번 실행하면 중복 데이터)

❌ 비멱등: UPDATE point = point + 100
          (여러 번 실행하면 계속 증가)

✅ 멱등: UPDATE point = 1100 WHERE id = 123 AND point = 1000
         (조건부 업데이트로 멱등성 확보)
```

---

## 6. Kafka 기본 개념

### 6.1 Kafka 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kafka Cluster                             │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Topic: marketplace.order.created            │   │
│   │                                                          │   │
│   │   Partition 0: [msg0] [msg3] [msg6] ───▶ offset         │   │
│   │   Partition 1: [msg1] [msg4] [msg7] ───▶ offset         │   │
│   │   Partition 2: [msg2] [msg5] [msg8] ───▶ offset         │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 핵심 용어

| 용어 | 설명 |
|------|------|
| **Topic** | 메시지 카테고리 (테이블과 유사) |
| **Partition** | 토픽을 나눈 단위 (병렬 처리용) |
| **Offset** | 파티션 내 메시지 위치 |
| **Consumer Group** | 함께 메시지를 소비하는 Consumer 집합 |

### 6.2 파티션과 병렬 처리

```
Topic: orders (3 partitions)

[Producer]
    │
    ├── key=order-123 ──▶ Partition 0
    ├── key=order-456 ──▶ Partition 1
    └── key=order-789 ──▶ Partition 2

[Consumer Group: email-service]
    │
    ├── Consumer 1 ◀── Partition 0
    ├── Consumer 2 ◀── Partition 1
    └── Consumer 3 ◀── Partition 2

→ 3개의 Consumer가 병렬로 처리
→ 같은 key(orderId)는 같은 파티션 → 순서 보장
```

### 6.3 Consumer Group

```
같은 메시지를 다른 용도로 처리:

Topic: marketplace.order.created
              │
              ├──▶ Consumer Group: email-service
              │         └── 주문 확인 이메일 발송
              │
              ├──▶ Consumer Group: notification-service
              │         └── 푸시 알림 발송
              │
              └──▶ Consumer Group: analytics-service
                        └── 주문 통계 집계

각 그룹은 모든 메시지를 받음 (독립적 처리)
```

### 6.4 메시지 보존 (Retention)

**Kafka의 특징: 소비해도 메시지를 삭제하지 않음**

```
전통적인 메시지 큐:
Queue: [msg1] [msg2] [msg3]
             ↓
       Consumer가 msg1 소비
             ↓
Queue: [msg2] [msg3]  ← msg1 삭제됨

Kafka:
Topic: [msg1] [msg2] [msg3]
             ↓
       Consumer가 msg1 소비
             ↓
Topic: [msg1] [msg2] [msg3]  ← 그대로!
        ↑
   Consumer의 offset만 이동 (0 → 1)
```

**왜 삭제하지 않는가?**

| 이유 | 설명 |
|------|------|
| **다중 Consumer Group** | 각 그룹이 독립적으로 같은 메시지 소비 |
| **재처리 (Replay)** | offset을 되돌려 과거 메시지 재처리 가능 |
| **장애 복구** | Consumer 재시작 시 놓친 메시지 처리 |
| **감사 로그** | 과거 이벤트 추적 가능 |

---

## 7. FAQ (자주 묻는 질문)

### Q1. Outbox 패턴 없이 Spring Event만 사용하면 안 되나요?

**A**: `@TransactionalEventListener`로 DB 커밋 후 이벤트를 발행할 수 있지만, **발행 실패 시 복구가 어렵습니다**.

```kotlin
// Spring Event 방식 - 복구 어려움
@TransactionalEventListener(phase = AFTER_COMMIT)
fun handleOrderCreated(event: OrderCreatedEvent) {
    kafkaTemplate.send(...)  // 실패하면 메시지 유실!
}

// Outbox 방식 - 복구 가능
// DB에 저장되어 있으므로 재시도 가능
```

### Q2. Kafka가 없으면 Outbox 패턴을 못 쓰나요?

**A**: 아니요. 단순히 **폴링 방식**으로도 활용할 수 있습니다.

```kotlin
// 주기적으로 Outbox 테이블을 조회해서 처리
@Scheduled(fixedDelay = 1000)
fun processOutboxEvents() {
    val events = outboxRepository.findPending()
    events.forEach { event ->
        when (event.eventType) {
            "OrderCreated" -> emailService.sendOrderConfirmation(event)
            // ...
        }
        event.markAsProcessed()
    }
}
```

### Q3. Consumer가 메시지 처리 중 죽으면 어떻게 되나요?

**A**: Kafka는 Consumer가 `acknowledge`하기 전까지 메시지를 다시 전달합니다.

```kotlin
@KafkaListener(topics = ["orders"])
fun handleOrder(payload: String, ack: Acknowledgment) {
    processOrder(payload)  // 여기서 죽으면?
    ack.acknowledge()      // 이 줄이 실행 안 됨 → 재전달
}
```

### Q4. 메시지 순서가 중요하면 어떻게 하나요?

**A**: 같은 **key**를 사용하면 같은 **파티션**으로 전송되어 순서가 보장됩니다.

```kotlin
// orderId를 key로 사용 → 같은 주문의 이벤트는 순서대로
kafkaTemplate.send("orders", orderId.toString(), payload)
```

---

## 8. 요약

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ✅ 이벤트 드리븐 = 비동기 + 느슨한 결합 + 확장성            │
│                                                             │
│  ✅ Outbox 패턴 = DB와 이벤트를 같은 트랜잭션에 저장         │
│     → 별도 프로세스가 Kafka로 발행                          │
│                                                             │
│  ✅ At-least-once 보장 → Consumer에서 멱등성 필수           │
│                                                             │
│  ✅ Kafka 특징:                                             │
│     - 파티션으로 병렬 처리                                  │
│     - Consumer Group으로 다중 구독                          │
│     - 메시지 보존 (재처리 가능)                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

> **다음 편**: [스프링부트 실무 가이드 4편: Resilience 패턴](/blog/springboot-practical-guide-4)
