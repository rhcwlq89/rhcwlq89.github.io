---
title: "스프링부트 실무 가이드 7편: 로깅 전략과 실무"
description: "SLF4J, Logback, Log4j2 비교부터 구조화된 로그, MDC, 중앙 집중식 로그 관리까지"
pubDate: 2026-02-03T10:00:00
tags: ["Spring Boot", "Logging", "Logback", "ELK", "Loki", "Backend", "실무가이드"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [6편: 모니터링](/blog/springboot-practical-guide-6) | **7편: 로깅** | - |

---

## 서론

6편에서 옵저버빌리티의 3가지 축(Metrics, Logs, Traces) 중 Metrics를 다뤘다. 이번 편에서는 **Logs**를 집중적으로 다룬다.

로그는 단순히 `System.out.println()`의 대체가 아니다. 잘 설계된 로그 시스템은 **장애 원인 파악 시간을 몇 시간에서 몇 분으로 단축**시킨다.

**7편에서 다루는 내용:**
- 스프링 로그 기술 스택 비교 (SLF4J, Logback, Log4j2)
- 로그 레벨 가이드
- Logback 설정 실무
- 구조화된 로그 (JSON 포맷)
- MDC를 활용한 요청 추적
- 중앙 집중식 로그 관리 (ELK, Loki)
- 실무 유의사항

### 목차

- [로그가 왜 중요한가?](#1-로그가-왜-중요한가)
- [기술 스택 선정 가이드](#2-기술-스택-선정-가이드)
- [로그 레벨 가이드](#3-로그-레벨-가이드)
- [Logback 설정](#4-logback-설정)
- [구조화된 로그 (JSON)](#5-구조화된-로그-json)
- [MDC를 활용한 요청 추적](#6-mdc를-활용한-요청-추적)
- [중앙 집중식 로그 관리](#7-중앙-집중식-로그-관리)
- [실무 유의사항](#8-실무-유의사항)
- [면접 대비 Q&A](#9-면접-대비-qa)
- [정리](#10-정리)

---

## 1. 로그가 왜 중요한가?

### 1.1 로그 없이 장애 대응하기

```
장애 발생 시나리오:
"결제 API에서 간헐적으로 500 에러 발생"

로그 없이:
├── "어떤 요청에서 에러가 났지?"
├── "어떤 파라미터로 호출했지?"
├── "DB 쿼리가 문제인가? 외부 API인가?"
├── "재현이 안 되는데..."
└── 원인 파악 불가

로그 있으면:
├── ERROR PaymentService - Payment failed for orderId=12345
├── ERROR External PG API timeout after 5000ms
├── DEBUG Request: POST /api/payments, userId=678, amount=50000
└── 5분 만에 원인 파악: PG사 API 지연
```

### 1.2 좋은 로그 vs 나쁜 로그

```kotlin
// ❌ 나쁜 로그
logger.info("에러 발생")
logger.error("실패함")
logger.debug(user.toString())  // 민감정보 노출 위험

// ✓ 좋은 로그
logger.info("주문 생성 완료: orderId={}, userId={}, amount={}", orderId, userId, amount)
logger.error("결제 처리 실패: orderId={}, errorCode={}, message={}", orderId, e.code, e.message, e)
logger.debug("상품 조회 요청: productId={}", productId)
```

좋은 로그의 특징:
- **누가**: userId, sessionId
- **무엇을**: 어떤 작업
- **어떻게**: 파라미터, 결과값
- **왜**: 에러 원인 (예외 포함)

---

## 2. 기술 스택 선정 가이드

### 2.1 스프링 로깅 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                   Application Code                       │
│                                                         │
│              logger.info("Hello World")                 │
│                         │                               │
│                         ▼                               │
│              ┌─────────────────┐                        │
│              │     SLF4J       │  ← 로깅 추상화 (Facade)│
│              │  (Simple Logging│                        │
│              │   Facade 4 Java)│                        │
│              └────────┬────────┘                        │
│                       │                                 │
│         ┌─────────────┼─────────────┐                  │
│         ▼             ▼             ▼                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│   │ Logback  │  │  Log4j2  │  │ JUL      │            │
│   │ (기본)    │  │          │  │(java.util│            │
│   │          │  │          │  │ .logging)│            │
│   └──────────┘  └──────────┘  └──────────┘            │
│                                                         │
│                    실제 로깅 구현체                      │
└─────────────────────────────────────────────────────────┘
```

**SLF4J**는 로깅의 인터페이스(추상화)이고, **Logback/Log4j2**는 실제 구현체다.

### 2.2 기술 스택 비교

| 구분 | Logback | Log4j2 |
|------|---------|--------|
| **Spring Boot 기본** | O (기본 내장) | X (별도 설정 필요) |
| **성능** | 좋음 | 더 좋음 (Async Logger) |
| **설정 파일** | logback-spring.xml | log4j2-spring.xml |
| **개발사** | SLF4J 개발자 (Ceki) | Apache |
| **JSON 로깅** | 추가 라이브러리 필요 | 기본 지원 |
| **비동기 로깅** | AsyncAppender | 기본 지원 (LMAX Disruptor) |

### 2.3 선택 가이드

```
┌─────────────────────────────────────────────────────────┐
│                    기술 스택 선택                        │
│                                                         │
│  Q1. 특별한 요구사항이 있는가?                          │
│      │                                                  │
│      ├── 초고성능 필요 (수십만 TPS) → Log4j2            │
│      ├── 기본 설정으로 충분 → Logback (기본)            │
│      └── JSON 로깅 필수 → 둘 다 가능                    │
│                                                         │
│  권장: 대부분의 경우 Logback (Spring Boot 기본)          │
│       - 별도 설정 없이 바로 사용                        │
│       - Spring Profile 연동 기본 지원                   │
│       - 충분한 성능                                     │
└─────────────────────────────────────────────────────────┘
```

> **TPS (Transactions Per Second)란?**
> 시스템이 1초 동안 처리할 수 있는 트랜잭션(요청) 수를 의미한다.
> 서버 성능을 측정하는 핵심 지표로, 값이 높을수록 더 많은 요청을 처리할 수 있다.
> - 소규모 서비스: 수백~수천 TPS
> - 중규모 서비스: 수천~수만 TPS
> - 대규모 서비스: 수십만 TPS 이상

### 2.4 중앙 집중식 로그 관리 비교

| 구분 | ELK Stack | Loki + Grafana |
|------|-----------|----------------|
| **구성** | Elasticsearch + Logstash + Kibana | Loki + Promtail + Grafana |
| **인덱싱** | 전문 검색 (Full-text) | 라벨 기반 (메타데이터만) |
| **리소스** | 높음 (ES가 무거움) | 낮음 |
| **검색 속도** | 빠름 (인덱스 활용) | 라벨 검색 빠름, 본문 검색 느림 |
| **복잡도** | 높음 | 낮음 |

### 2.5 전문 검색 vs 라벨 기반 인덱싱

**전문 검색 인덱싱 (ELK - Elasticsearch)**

```
로그 원본:
{"timestamp":"2024-01-15T10:30:45Z","level":"ERROR","message":"Payment failed for user 12345","traceId":"abc123"}

Elasticsearch 인덱싱:
┌─────────────────────────────────────────────────────────┐
│  역인덱스 (Inverted Index) 생성                         │
│                                                         │
│  "payment" → [doc1, doc15, doc203, ...]                │
│  "failed"  → [doc1, doc42, doc89, ...]                 │
│  "user"    → [doc1, doc2, doc3, ...]                   │
│  "12345"   → [doc1, doc156, ...]                       │
│  "error"   → [doc1, doc5, doc10, ...]                  │
│                                                         │
│  모든 단어가 인덱싱됨 → 어떤 단어로도 검색 가능         │
└─────────────────────────────────────────────────────────┘

검색 예시:
- "Payment failed" 포함된 모든 로그 → 즉시 반환
- "NullPointerException" 포함된 로그 → 즉시 반환
- message에 "timeout" AND level="ERROR" → 즉시 반환
```

**라벨 기반 인덱싱 (Loki)**

```
로그 원본:
{"timestamp":"2024-01-15T10:30:45Z","level":"ERROR","message":"Payment failed for user 12345","traceId":"abc123"}

Loki 인덱싱:
┌─────────────────────────────────────────────────────────┐
│  라벨(메타데이터)만 인덱싱                              │
│                                                         │
│  {app="payment-service", level="ERROR", env="prod"}    │
│       ↓                                                 │
│  이 라벨 조합에 해당하는 로그 청크 위치만 저장          │
│                                                         │
│  로그 본문("Payment failed for user 12345")은           │
│  압축만 하고 인덱싱하지 않음                            │
└─────────────────────────────────────────────────────────┘

검색 예시:
- {app="payment-service", level="ERROR"} → 빠름 (인덱스 사용)
- {app="payment-service"} |= "Payment failed" → 느림 (전체 스캔)
- "NullPointerException" 포함된 로그 → 느림 (전체 스캔)
```

**검색 성능 비교**

| 검색 유형 | ELK | Loki |
|----------|-----|------|
| 라벨/필드 검색 (`level=ERROR`) | 빠름 | 빠름 |
| 특정 ID 검색 (`traceId=abc123`) | 빠름 | 빠름 (traceId가 라벨인 경우) |
| 본문 키워드 검색 (`"NullPointer"`) | **빠름** | 느림 (전체 스캔) |
| 정규식 검색 (`message =~ "timeout.*"`) | **빠름** | 느림 |
| 복잡한 집계 (에러율 통계) | **빠름** | 제한적 |

**실무 시나리오별 적합도**

```
시나리오 1: "traceId=abc123인 요청의 모든 로그"
├── ELK: 빠름 ✓
└── Loki: 빠름 ✓ (traceId를 라벨로 설정한 경우)

시나리오 2: "오늘 발생한 NullPointerException 모두 찾기"
├── ELK: 빠름 ✓ (역인덱스로 즉시 검색)
└── Loki: 느림 ✗ (오늘 로그 전체 스캔 필요)

시나리오 3: "최근 1시간 에러 로그 중 'timeout' 포함된 것"
├── ELK: 빠름 ✓
└── Loki: 보통 (1시간치만 스캔)

시나리오 4: "지난 30일간 API별 에러율 통계"
├── ELK: 빠름 ✓ (집계 쿼리 강력)
└── Loki: 느림/불가 ✗
```

**결론:**

```
ELK 선택:
- 로그 본문 검색이 빈번함
- "어떤 에러가 발생했는지 모르지만 찾아야 함"
- 복잡한 통계/분석 필요

Loki 선택:
- 대부분 traceId, userId 등 특정 ID로 검색
- "이 요청의 로그를 보여줘" 수준의 검색
- 비용 최적화 우선
```

### 2.6 비용 비교 가이드

**왜 비용 차이가 나는가?**

```
ELK Stack:
- Elasticsearch가 모든 로그 내용을 인덱싱
- 인덱스 저장에 원본 데이터의 1.5~2배 스토리지 필요
- 인덱싱/검색을 위한 높은 CPU/메모리 요구
- 최소 권장: 16GB RAM, 4 Core (단일 노드)

Loki:
- 로그 본문은 인덱싱하지 않고 압축 저장만
- 라벨(메타데이터)만 인덱싱
- 스토리지 사용량 ELK 대비 10~20% 수준
- 최소 권장: 4GB RAM, 2 Core
```

**규모별 비용 비교 (AWS 기준 월 예상 비용)**

| 로그 볼륨 | ELK (Self-hosted) | Loki (Self-hosted) | 비고 |
|----------|-------------------|-------------------|------|
| **10GB/일** | $150~250 | $50~80 | 소규모, Loki 권장 |
| **50GB/일** | $400~600 | $100~150 | 중규모, Loki 권장 |
| **200GB/일** | $1,500~2,500 | $300~500 | 대규모, 요구사항에 따라 선택 |
| **1TB/일** | $5,000+ | $1,000~2,000 | 복잡한 검색 필요시 ELK |

> **참고:** 관리형 서비스(AWS OpenSearch, Grafana Cloud) 사용 시 비용이 2~5배 증가하지만 운영 부담이 줄어든다.

**선택 가이드**

```
Loki를 선택해야 할 때:
├── 일일 로그 볼륨 100GB 이하
├── "traceId=xxx인 로그 보여줘" 수준의 검색이면 충분
├── 이미 Grafana를 사용 중 (모니터링 통합)
├── 비용 최적화가 중요
└── 운영 인력이 적음

ELK를 선택해야 할 때:
├── 로그 본문 전문 검색 필수 ("NullPointerException" 포함된 모든 로그)
├── 복잡한 집계/분석 필요 (에러 패턴 분석, 통계)
├── 일일 로그 볼륨 수백 GB 이상 + 빠른 검색 필요
├── 보안/컴플라이언스 요구사항 (감사 로그 분석)
└── 전담 운영 인력 있음
```

**실무 팁: 하이브리드 접근**

```
비용과 기능 모두 잡기:
┌─────────────────────────────────────────────────────────┐
│  모든 로그 → Loki (저비용 장기 보관)                    │
│      │                                                  │
│      └── ERROR 로그만 → ELK (상세 분석)                 │
│                                                         │
│  효과:                                                  │
│  - 전체 비용 70% 절감                                   │
│  - 에러 분석 시에만 ELK 사용                            │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 로그 레벨 가이드

### 3.1 로그 레벨 정의

```
┌─────────────────────────────────────────────────────────┐
│  레벨      │  용도                     │  운영 환경    │
├─────────────────────────────────────────────────────────┤
│  ERROR     │  즉시 대응 필요한 에러     │  O           │
│  WARN      │  주의 필요, 잠재적 문제    │  O           │
│  INFO      │  주요 비즈니스 이벤트      │  O           │
│  DEBUG     │  상세 디버깅 정보          │  X (개발만)   │
│  TRACE     │  매우 상세한 정보          │  X           │
└─────────────────────────────────────────────────────────┘
```

### 3.2 레벨별 사용 예시

```kotlin
@Service
class OrderService(
    private val orderRepository: OrderRepository,
    private val paymentClient: PaymentClient
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun createOrder(request: CreateOrderRequest): Order {
        // DEBUG: 메서드 진입, 상세 파라미터
        logger.debug("주문 생성 시작: request={}", request)

        // INFO: 주요 비즈니스 이벤트
        logger.info("주문 생성 요청: userId={}, productId={}, quantity={}",
            request.userId, request.productId, request.quantity)

        try {
            val order = Order.create(request)
            orderRepository.save(order)

            // INFO: 성공 결과
            logger.info("주문 생성 완료: orderId={}, userId={}", order.id, request.userId)
            return order

        } catch (e: InsufficientStockException) {
            // WARN: 예상 가능한 비즈니스 예외
            logger.warn("재고 부족으로 주문 실패: productId={}, requested={}, available={}",
                request.productId, request.quantity, e.availableStock)
            throw e

        } catch (e: Exception) {
            // ERROR: 예상치 못한 시스템 에러
            logger.error("주문 생성 중 오류 발생: userId={}, productId={}",
                request.userId, request.productId, e)
            throw e
        }
    }
}
```

### 3.3 로그 레벨 체크, 해야 하나?

위 예시에서 `logger.isDebugEnabled()` 같은 레벨 체크가 없다. 이유가 있다.

**SLF4J 파라미터화 로깅의 동작 방식**

```kotlin
// 이렇게 작성하면
logger.debug("주문 생성 시작: request={}", request)

// SLF4J 내부에서 이렇게 처리됨
if (logger.isDebugEnabled()) {
    String message = "주문 생성 시작: request=" + request.toString()
    // 실제 로그 출력
}
```

플레이스홀더(`{}`)를 사용하면 **로그 레벨이 비활성화된 경우 문자열 연결 자체가 발생하지 않는다.**

**레벨 체크가 필요 없는 경우 (대부분)**

```kotlin
// ✓ 플레이스홀더 사용 - 레벨 체크 불필요
logger.debug("userId={}, orderId={}", userId, orderId)
logger.debug("request={}", request)  // toString()도 레벨 활성화 시에만 호출

// 이유: DEBUG가 OFF면 파라미터 평가 자체를 하지 않음
```

**레벨 체크가 필요한 경우 (비용이 큰 연산)**

```kotlin
// ❌ 비용이 큰 연산은 레벨 체크 필요
logger.debug("결과: {}", expensiveCalculation())  // 항상 호출됨!

// ✓ 레벨 체크로 불필요한 연산 방지
if (logger.isDebugEnabled) {
    logger.debug("결과: {}", expensiveCalculation())
}

// ✓ Kotlin에서는 람다로 해결 (kotlin-logging 라이브러리)
// implementation("io.github.microutils:kotlin-logging:3.0.5")
logger.debug { "결과: ${expensiveCalculation()}" }  // DEBUG가 OFF면 람다 실행 안 함
```

**정리: 언제 레벨 체크를 하는가?**

| 상황 | 레벨 체크 | 이유 |
|------|----------|------|
| 단순 변수 출력 | 불필요 | 플레이스홀더가 처리 |
| 객체 toString() | 불필요 | 레벨 활성화 시에만 호출 |
| **메서드 호출** | **필요** | 메서드는 항상 실행됨 |
| **복잡한 연산** | **필요** | 연산 비용 발생 |
| **컬렉션 순회** | **필요** | 순회 비용 발생 |

```kotlin
// 실무 예시
class OrderService {
    fun processOrder(order: Order) {
        // ✓ 단순 변수 - 체크 불필요
        logger.debug("주문 처리 시작: orderId={}", order.id)

        // ✓ 객체 - 체크 불필요 (toString은 레벨 활성화 시에만)
        logger.debug("주문 상세: {}", order)

        // ⚠️ 메서드 호출 - 체크 필요
        if (logger.isDebugEnabled) {
            logger.debug("재고 현황: {}", inventoryService.getStockSummary())
        }

        // ⚠️ 컬렉션 변환 - 체크 필요
        if (logger.isDebugEnabled) {
            val itemNames = order.items.map { it.name }.joinToString()
            logger.debug("주문 상품: {}", itemNames)
        }
    }
}
```

### 3.4 로그 레벨 선택 기준

```
ERROR 사용:
- 즉시 대응이 필요한 상황
- 서비스 기능이 동작하지 않음
- 예: DB 연결 실패, 필수 외부 API 오류

WARN 사용:
- 지금은 괜찮지만 주의가 필요
- 예상 가능한 비즈니스 예외
- 예: 재고 부족, 잘못된 입력, 재시도 발생

INFO 사용:
- 운영에 필요한 정보
- 주요 비즈니스 이벤트
- 예: 주문 생성, 결제 완료, 사용자 가입

DEBUG 사용:
- 개발/디버깅 시에만 필요
- 메서드 진입/종료, 상세 파라미터
- 운영 환경에서는 OFF

TRACE 사용:
- 매우 상세한 추적
- 루프 내부, 변수 값 변화
- 거의 사용하지 않음
```

### 3.5 환경별 로그 레벨 설정

```yaml
# application.yml - 공통 설정
logging:
  level:
    root: INFO
    com.example.marketplace: INFO

---
# application-local.yml - 로컬 개발
spring:
  config:
    activate:
      on-profile: local
logging:
  level:
    com.example.marketplace: DEBUG
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql: TRACE

---
# application-prod.yml - 운영
spring:
  config:
    activate:
      on-profile: prod
logging:
  level:
    root: WARN
    com.example.marketplace: INFO
```

---

## 4. Logback 설정

### 4.1 기본 설정 파일

Spring Boot에서는 `logback-spring.xml`을 사용하면 Spring Profile 연동이 가능하다.

```xml
<!-- src/main/resources/logback-spring.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<configuration scan="true" scanPeriod="30 seconds">

    <!-- 변수 정의 -->
    <property name="LOG_PATH" value="${LOG_PATH:-./logs}"/>
    <property name="LOG_FILE" value="${LOG_FILE:-application}"/>

    <!-- 콘솔 출력 패턴 -->
    <property name="CONSOLE_PATTERN"
              value="%d{yyyy-MM-dd HH:mm:ss.SSS} %highlight(%-5level) [%thread] %cyan(%logger{36}) - %msg%n"/>

    <!-- 파일 출력 패턴 -->
    <property name="FILE_PATTERN"
              value="%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{36} - %msg%n"/>

    <!-- 콘솔 Appender -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>${CONSOLE_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
    </appender>

    <!-- 파일 Appender (Rolling) -->
    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_PATH}/${LOG_FILE}.log</file>
        <encoder>
            <pattern>${FILE_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
        <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
            <!-- 일별 롤링 -->
            <fileNamePattern>${LOG_PATH}/${LOG_FILE}.%d{yyyy-MM-dd}.log</fileNamePattern>
            <!-- 30일 보관 -->
            <maxHistory>30</maxHistory>
            <!-- 최대 총 용량 -->
            <totalSizeCap>10GB</totalSizeCap>
        </rollingPolicy>
    </appender>

    <!-- 에러 전용 파일 -->
    <appender name="ERROR_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_PATH}/${LOG_FILE}-error.log</file>
        <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
            <level>ERROR</level>
        </filter>
        <encoder>
            <pattern>${FILE_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
        <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
            <fileNamePattern>${LOG_PATH}/${LOG_FILE}-error.%d{yyyy-MM-dd}.log</fileNamePattern>
            <maxHistory>90</maxHistory>
        </rollingPolicy>
    </appender>

    <!-- Profile별 설정 -->
    <springProfile name="local">
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
        </root>
        <logger name="com.example.marketplace" level="DEBUG"/>
        <logger name="org.hibernate.SQL" level="DEBUG"/>
    </springProfile>

    <springProfile name="dev">
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
            <appender-ref ref="FILE"/>
        </root>
        <logger name="com.example.marketplace" level="DEBUG"/>
    </springProfile>

    <springProfile name="prod">
        <root level="WARN">
            <appender-ref ref="FILE"/>
            <appender-ref ref="ERROR_FILE"/>
        </root>
        <logger name="com.example.marketplace" level="INFO"/>
    </springProfile>

</configuration>
```

### 4.2 비동기 로깅 설정

로그 쓰기가 애플리케이션 성능에 영향을 주지 않도록 비동기로 처리한다.

```xml
<!-- 비동기 Appender -->
<appender name="ASYNC_FILE" class="ch.qos.logback.classic.AsyncAppender">
    <!-- 큐 크기 (기본값: 256) -->
    <queueSize>1024</queueSize>
    <!-- 큐가 80% 차면 WARN 이하 로그 버림 -->
    <discardingThreshold>20</discardingThreshold>
    <!-- 큐가 가득 차면 블로킹하지 않고 버림 -->
    <neverBlock>true</neverBlock>
    <!-- 실제 Appender -->
    <appender-ref ref="FILE"/>
</appender>

<springProfile name="prod">
    <root level="WARN">
        <appender-ref ref="ASYNC_FILE"/>
        <appender-ref ref="ERROR_FILE"/>
    </root>
</springProfile>
```

### 4.3 로그 로테이션 전략

```xml
<!-- 크기 + 시간 기반 롤링 -->
<rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
    <!-- 일별 + 인덱스 -->
    <fileNamePattern>${LOG_PATH}/${LOG_FILE}.%d{yyyy-MM-dd}.%i.log</fileNamePattern>
    <!-- 파일당 최대 크기 -->
    <maxFileSize>100MB</maxFileSize>
    <!-- 보관 기간 -->
    <maxHistory>30</maxHistory>
    <!-- 전체 최대 용량 -->
    <totalSizeCap>10GB</totalSizeCap>
</rollingPolicy>
```

---

## 5. 구조화된 로그 (JSON)

### 5.1 왜 JSON 로그인가?

```
일반 로그:
2024-01-15 10:30:45.123 INFO [http-nio-8080-exec-1] OrderService - 주문 생성 완료: orderId=12345, userId=678

JSON 로그:
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "INFO",
  "thread": "http-nio-8080-exec-1",
  "logger": "OrderService",
  "message": "주문 생성 완료",
  "orderId": "12345",
  "userId": "678",
  "traceId": "abc123",
  "spanId": "def456"
}
```

**JSON 로그의 장점:**
- 로그 수집 시스템에서 파싱 용이
- 필드별 검색/필터링 가능
- 구조화된 데이터로 분석 용이

### 5.2 Logstash Encoder 설정

```kotlin
// build.gradle.kts
dependencies {
    implementation("net.logstash.logback:logstash-logback-encoder:7.4")
}
```

```xml
<!-- logback-spring.xml -->
<appender name="JSON_CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <!-- 타임스탬프 형식 -->
        <timestampPattern>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</timestampPattern>
        <!-- 커스텀 필드 추가 -->
        <customFields>{"application":"marketplace-api","environment":"${SPRING_PROFILES_ACTIVE:-local}"}</customFields>
        <!-- 예외 스택트레이스 포함 -->
        <throwableConverter class="net.logstash.logback.stacktrace.ShortenedThrowableConverter">
            <maxDepthPerThrowable>30</maxDepthPerThrowable>
            <maxLength>2048</maxLength>
            <shortenedClassNameLength>20</shortenedClassNameLength>
            <rootCauseFirst>true</rootCauseFirst>
        </throwableConverter>
    </encoder>
</appender>

<appender name="JSON_FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>${LOG_PATH}/${LOG_FILE}.json</file>
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <timestampPattern>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</timestampPattern>
    </encoder>
    <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
        <fileNamePattern>${LOG_PATH}/${LOG_FILE}.%d{yyyy-MM-dd}.json</fileNamePattern>
        <maxHistory>30</maxHistory>
    </rollingPolicy>
</appender>
```

### 5.3 구조화된 로그 출력

```kotlin
import net.logstash.logback.argument.StructuredArguments.*

@Service
class OrderService {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun createOrder(request: CreateOrderRequest): Order {
        // 구조화된 인자 사용
        logger.info("주문 생성 완료",
            kv("orderId", order.id),
            kv("userId", request.userId),
            kv("amount", request.amount),
            kv("productCount", request.items.size)
        )

        // 출력:
        // {
        //   "message": "주문 생성 완료",
        //   "orderId": "12345",
        //   "userId": "678",
        //   "amount": 50000,
        //   "productCount": 3
        // }
    }
}
```

---

## 6. MDC를 활용한 요청 추적

### 6.1 MDC란?

```
MDC (Mapped Diagnostic Context):
스레드 로컬에 저장되는 컨텍스트 정보

┌─────────────────────────────────────────────────────────┐
│  요청 A (Thread-1)                                      │
│  MDC: {traceId: "abc123", userId: "100"}               │
│  └── OrderService.createOrder()                        │
│       └── PaymentService.process()                     │
│            └── NotificationService.send()              │
│  모든 로그에 traceId, userId 자동 포함                  │
│                                                         │
│  요청 B (Thread-2)                                      │
│  MDC: {traceId: "def456", userId: "200"}               │
│  └── 별도의 컨텍스트로 격리됨                           │
└─────────────────────────────────────────────────────────┘
```

### 6.2 MDC Filter 구현

```kotlin
// MdcLoggingFilter.kt
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)  // 가장 먼저 실행되어야 함
class MdcLoggingFilter : OncePerRequestFilter() {

    companion object {
        const val TRACE_ID = "traceId"
        const val SPAN_ID = "spanId"
        const val USER_ID = "userId"
        const val REQUEST_URI = "requestUri"
        const val REQUEST_METHOD = "requestMethod"
        const val CLIENT_IP = "clientIp"
    }

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        try {
            // TraceId 생성 (또는 헤더에서 추출)
            val traceId = request.getHeader("X-Trace-Id")
                ?: UUID.randomUUID().toString().replace("-", "").take(16)
            val spanId = UUID.randomUUID().toString().replace("-", "").take(8)

            // MDC에 컨텍스트 설정
            MDC.put(TRACE_ID, traceId)
            MDC.put(SPAN_ID, spanId)
            MDC.put(REQUEST_URI, request.requestURI)
            MDC.put(REQUEST_METHOD, request.method)
            MDC.put(CLIENT_IP, getClientIp(request))

            // 응답 헤더에 TraceId 포함 (프론트엔드에서 확인용)
            response.setHeader("X-Trace-Id", traceId)

            filterChain.doFilter(request, response)
        } finally {
            // 스레드 재사용을 위해 반드시 clear
            MDC.clear()
        }
    }

    private fun getClientIp(request: HttpServletRequest): String {
        val xForwardedFor = request.getHeader("X-Forwarded-For")
        return if (xForwardedFor.isNullOrEmpty()) {
            request.remoteAddr
        } else {
            xForwardedFor.split(",")[0].trim()
        }
    }
}
```

**@Order(Ordered.HIGHEST_PRECEDENCE)를 사용하는 이유:**

```
필터 실행 순서:
┌─────────────────────────────────────────────────────────┐
│  1. MdcLoggingFilter (HIGHEST_PRECEDENCE = 가장 먼저)   │
│     └── traceId 생성, MDC 설정                          │
│                                                         │
│  2. Spring Security Filters                             │
│     └── 인증/인가 처리                                  │
│                                                         │
│  3. 기타 필터들                                         │
│                                                         │
│  4. Controller                                          │
└─────────────────────────────────────────────────────────┘

이유:
- 모든 로그에 traceId가 포함되려면 가장 먼저 실행되어야 함
- Security 필터에서 발생하는 로그에도 traceId 포함
- 인증 실패 로그에도 요청 추적 가능
```

**X-Trace-Id, X-Forwarded-For 헤더 표준:**

| 헤더 | 표준 여부 | 정의 |
|------|----------|------|
| **X-Forwarded-For** | 사실상 표준 | RFC 7239에서 `Forwarded` 헤더로 표준화됨. 하지만 `X-Forwarded-For`가 더 널리 사용됨 |
| **X-Trace-Id** | 비표준 (사실상 표준) | W3C Trace Context에서 `traceparent` 헤더로 표준화됨. 하지만 `X-Trace-Id`, `X-Request-Id` 등이 관례적으로 사용됨 |

```
X-Forwarded-For:
- 프록시/로드밸런서가 원본 클라이언트 IP를 전달할 때 사용
- 형식: X-Forwarded-For: client, proxy1, proxy2
- RFC 7239 Forwarded 헤더가 공식 표준이지만, X-Forwarded-For가 더 보편적

X-Trace-Id (X-Request-Id):
- 분산 시스템에서 요청 추적용 ID
- W3C Trace Context (https://www.w3.org/TR/trace-context/)가 공식 표준
  - traceparent: 00-{trace-id}-{span-id}-{flags}
- 하지만 단순한 X-Trace-Id가 더 많이 사용됨
- OpenTelemetry, Jaeger, Zipkin 등에서 표준 헤더 지원
```

### 6.3 인증 후 사용자 ID 추가

사용자 ID를 MDC에 추가하려면 인증 필터 이후에 실행되어야 한다. Spring Security의 필터 체인에 명시적으로 등록한다.

```kotlin
// MdcUserFilter.kt
class MdcUserFilter : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        try {
            // SecurityContext에서 사용자 정보 추출
            SecurityContextHolder.getContext().authentication?.let { auth ->
                if (auth.isAuthenticated && auth.principal is UserDetails) {
                    val user = auth.principal as UserDetails
                    MDC.put("userId", user.username)
                }
            }
            filterChain.doFilter(request, response)
        } finally {
            MDC.remove("userId")
        }
    }
}
```

**SecurityConfig에 필터 등록:**

```kotlin
// SecurityConfig.kt
@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .authorizeHttpRequests { auth ->
                auth.anyRequest().authenticated()
            }
            .oauth2Login { }
            // SecurityContextPersistenceFilter 이후에 MdcUserFilter 추가
            .addFilterAfter(MdcUserFilter(), SecurityContextPersistenceFilter::class.java)

        return http.build()
    }
}
```

```
필터 실행 순서:
┌─────────────────────────────────────────────────────────┐
│  MdcLoggingFilter (HIGHEST_PRECEDENCE)                  │
│  └── traceId 설정                                       │
│                                                         │
│  ... Spring Security 필터들 ...                         │
│                                                         │
│  SecurityContextPersistenceFilter                       │
│  └── SecurityContext 로드                               │
│                                                         │
│  MdcUserFilter (addFilterAfter로 등록)                  │
│  └── userId 설정 (인증 정보 사용 가능)                  │
│                                                         │
│  ... 나머지 필터들 ...                                  │
│                                                         │
│  Controller                                             │
└─────────────────────────────────────────────────────────┘
```

### 6.4 Logback 패턴에 MDC 적용

```xml
<!-- 일반 로그 패턴 -->
<property name="CONSOLE_PATTERN"
          value="%d{HH:mm:ss.SSS} %highlight(%-5level) [%thread] [%X{traceId}] %cyan(%logger{36}) - %msg%n"/>

<!-- JSON 로그에서는 자동으로 MDC 필드 포함 -->
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <includeMdcKeyName>traceId</includeMdcKeyName>
    <includeMdcKeyName>spanId</includeMdcKeyName>
    <includeMdcKeyName>userId</includeMdcKeyName>
    <includeMdcKeyName>requestUri</includeMdcKeyName>
</encoder>
```

### 6.5 비동기 작업에서 MDC 전파

MDC는 **스레드 로컬(ThreadLocal)** 기반이므로 비동기 작업 시 자동으로 전파되지 않는다. 별도 설정이 필요하다.

**MDC와 로깅 프레임워크:**

| 프레임워크 | MDC 지원 | 비고 |
|-----------|---------|------|
| **SLF4J** | O | MDC API 제공 (org.slf4j.MDC) |
| **Logback** | O | SLF4J MDC 그대로 사용 |
| **Log4j2** | O | ThreadContext 사용 (SLF4J MDC와 연동됨) |

> **결론:** MDC 전파 코드는 SLF4J API를 사용하므로 **Logback, Log4j2 모두에서 동일하게 동작**한다.

**TaskDecorator로 MDC 전파:**

```kotlin
// AsyncConfig.kt
@Configuration
@EnableAsync
class AsyncConfig : AsyncConfigurer {

    override fun getAsyncExecutor(): Executor {
        val executor = ThreadPoolTaskExecutor()
        executor.corePoolSize = 10
        executor.maxPoolSize = 50
        executor.setTaskDecorator(MdcTaskDecorator())  // MDC 전파 설정
        executor.initialize()
        return executor
    }
}

class MdcTaskDecorator : TaskDecorator {
    override fun decorate(runnable: Runnable): Runnable {
        // 현재 스레드(호출자)의 MDC 복사
        val contextMap = MDC.getCopyOfContextMap()
        return Runnable {
            try {
                // 새 스레드(비동기 작업)에 MDC 설정
                contextMap?.let { MDC.setContextMap(it) }
                runnable.run()
            } finally {
                MDC.clear()
            }
        }
    }
}
```

**실제 사용 예시:**

```kotlin
@Service
class OrderService(
    private val notificationService: NotificationService
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun createOrder(request: CreateOrderRequest): Order {
        // MDC에 traceId가 설정된 상태
        logger.info("주문 생성: orderId={}", order.id)  // traceId 포함

        // 비동기 호출 - MdcTaskDecorator가 MDC를 전파
        notificationService.sendAsync(order)

        return order
    }
}

@Service
class NotificationService {
    private val logger = LoggerFactory.getLogger(javaClass)

    @Async  // 별도 스레드에서 실행
    fun sendAsync(order: Order) {
        // MdcTaskDecorator 덕분에 동일한 traceId 유지
        logger.info("알림 발송: orderId={}", order.id)  // 동일한 traceId 포함!
    }
}
```

```
로그 출력:
[traceId=abc123] 주문 생성: orderId=100        (http-nio-8080-exec-1)
[traceId=abc123] 알림 발송: orderId=100        (async-executor-1)
                 ↑ 동일한 traceId로 연결됨
```

**CompletableFuture에서 MDC 전파:**

```kotlin
// CompletableFuture 사용 시에도 동일한 방식
fun processAsync(): CompletableFuture<Result> {
    val contextMap = MDC.getCopyOfContextMap()

    return CompletableFuture.supplyAsync({
        try {
            contextMap?.let { MDC.setContextMap(it) }
            // 비동기 작업
            doProcess()
        } finally {
            MDC.clear()
        }
    }, asyncExecutor)
}
```

---

## 7. 중앙 집중식 로그 관리

### 7.1 왜 중앙 집중식 로그가 필요한가?

```
분산 환경의 문제:
┌────────────────────────────────────────────────────────┐
│  서버 A (/var/log/app.log)                             │
│  서버 B (/var/log/app.log)                             │
│  서버 C (/var/log/app.log)                             │
│                                                        │
│  문제: "에러가 어느 서버에서 발생했지?"                 │
│        "전체 요청 흐름을 어떻게 추적하지?"              │
└────────────────────────────────────────────────────────┘

중앙 집중식:
┌────────────────────────────────────────────────────────┐
│  서버 A ─┐                                             │
│  서버 B ─┼──▶ 로그 수집기 ──▶ 중앙 저장소 ──▶ UI     │
│  서버 C ─┘                                             │
│                                                        │
│  해결: traceId로 전체 서버의 로그를 한 번에 검색       │
└────────────────────────────────────────────────────────┘
```

### 7.2 ELK Stack 구성

```yaml
# docker-compose.yml
version: '3.8'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - elasticsearch-data:/usr/share/elasticsearch/data

  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
    ports:
      - "5044:5044"
    depends_on:
      - elasticsearch

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch

  filebeat:
    image: docker.elastic.co/beats/filebeat:8.11.0
    volumes:
      - ./filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml
      - ./logs:/var/log/app
    depends_on:
      - logstash

volumes:
  elasticsearch-data:
```

```yaml
# filebeat/filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/app/*.json
    json.keys_under_root: true
    json.add_error_key: true

output.logstash:
  hosts: ["logstash:5044"]
```

### 7.3 Loki + Grafana 구성 (경량 대안)

```yaml
# docker-compose.yml
version: '3.8'
services:
  loki:
    image: grafana/loki:2.9.0
    ports:
      - "3100:3100"
    volumes:
      - ./loki/config.yml:/etc/loki/config.yml
    command: -config.file=/etc/loki/config.yml

  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - ./promtail/config.yml:/etc/promtail/config.yml
      - ./logs:/var/log/app
    command: -config.file=/etc/promtail/config.yml

  grafana:
    image: grafana/grafana:10.0.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
```

```yaml
# promtail/config.yml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: spring-app
    static_configs:
      - targets:
          - localhost
        labels:
          job: marketplace-api
          __path__: /var/log/app/*.log
    pipeline_stages:
      - json:
          expressions:
            level: level
            traceId: traceId
            message: message
      - labels:
          level:
          traceId:
```

### 7.4 Logback에서 직접 전송 (Loki)

```kotlin
// build.gradle.kts
dependencies {
    implementation("com.github.loki4j:loki-logback-appender:1.4.2")
}
```

```xml
<!-- logback-spring.xml -->
<appender name="LOKI" class="com.github.loki4j.logback.Loki4jAppender">
    <http>
        <url>http://loki:3100/loki/api/v1/push</url>
    </http>
    <format>
        <label>
            <pattern>application=marketplace-api,host=${HOSTNAME},level=%level</pattern>
        </label>
        <message>
            <pattern>{"timestamp":"%d{yyyy-MM-dd'T'HH:mm:ss.SSS'Z'}","level":"%level","logger":"%logger","traceId":"%X{traceId}","message":"%message"}</pattern>
        </message>
    </format>
</appender>
```

---

## 8. 실무 유의사항

### 8.1 민감정보 마스킹

```kotlin
// ❌ 위험: 민감정보 직접 로깅
logger.info("사용자 로그인: email={}, password={}", email, password)
logger.info("결제 정보: cardNumber={}", cardNumber)

// ✓ 마스킹 적용
logger.info("사용자 로그인: email={}", maskEmail(email))
logger.info("결제 정보: cardNumber={}", maskCardNumber(cardNumber))

// 마스킹 유틸리티
object LogMaskingUtils {
    fun maskEmail(email: String): String {
        val parts = email.split("@")
        if (parts.size != 2) return "***"
        val local = parts[0]
        val masked = if (local.length > 2) {
            "${local.take(2)}***"
        } else {
            "***"
        }
        return "$masked@${parts[1]}"
    }

    fun maskCardNumber(cardNumber: String): String {
        if (cardNumber.length < 4) return "****"
        return "****-****-****-${cardNumber.takeLast(4)}"
    }

    fun maskPhoneNumber(phone: String): String {
        if (phone.length < 4) return "****"
        return "${phone.take(3)}-****-${phone.takeLast(4)}"
    }
}
```

### 8.2 Logback 패턴에서 마스킹

```xml
<!-- 정규식으로 패턴 마스킹 -->
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <jsonGeneratorDecorator class="net.logstash.logback.mask.MaskingJsonGeneratorDecorator">
        <!-- 특정 필드 마스킹 -->
        <valueMask>
            <value>password</value>
            <mask>****</mask>
        </valueMask>
        <!-- 정규식 마스킹 -->
        <valueMask>
            <value>\d{4}-\d{4}-\d{4}-\d{4}</value>
            <mask>****-****-****-****</mask>
        </valueMask>
    </jsonGeneratorDecorator>
</encoder>
```

### 8.3 로깅 성능 고려사항

```kotlin
// ❌ 비효율적: 로그 레벨과 관계없이 문자열 연결 발생
logger.debug("사용자 정보: " + user.toString())

// ❌ 비효율적: toString() 항상 호출
logger.debug("사용자 정보: {}", user.toString())

// ✓ 효율적: 플레이스홀더 사용 (DEBUG가 비활성화면 연산 안 함)
logger.debug("사용자 정보: userId={}, name={}", user.id, user.name)

// ✓ 더 효율적: 로그 레벨 체크
if (logger.isDebugEnabled) {
    logger.debug("복잡한 계산 결과: {}", expensiveCalculation())
}

// ✓ Kotlin에서 lazy 로깅 (라이브러리 사용)
// implementation("io.github.microutils:kotlin-logging:3.0.5")
import mu.KotlinLogging
private val logger = KotlinLogging.logger {}

logger.debug { "복잡한 계산 결과: ${expensiveCalculation()}" }
// DEBUG가 비활성화면 람다 자체가 실행되지 않음
```

### 8.4 예외 로깅 주의사항

```kotlin
// ❌ 잘못된 예외 로깅
try {
    process()
} catch (e: Exception) {
    logger.error("에러 발생: " + e.message)  // 스택트레이스 없음
    logger.error("에러 발생: {}", e)          // e.toString()만 출력
}

// ✓ 올바른 예외 로깅 (스택트레이스 포함)
try {
    process()
} catch (e: Exception) {
    logger.error("에러 발생: orderId={}", orderId, e)  // e가 마지막 인자면 스택트레이스 출력
}

// ✓ 비즈니스 예외는 WARN + 간단한 메시지
try {
    process()
} catch (e: BusinessException) {
    logger.warn("비즈니스 예외: code={}, message={}", e.code, e.message)
    // 스택트레이스 불필요
}
```

### 8.5 운영 환경 로그 설정 체크리스트

```
✓ 로그 레벨
  - 루트: WARN 이상
  - 애플리케이션: INFO
  - 프레임워크 (hibernate, spring): WARN

✓ 로그 로테이션
  - 일별 또는 크기 기반
  - 보관 기간 설정 (30일 권장)
  - 최대 용량 제한

✓ 비동기 로깅
  - 고성능 필요 시 AsyncAppender 사용
  - neverBlock=true로 블로킹 방지

✓ 민감정보
  - 비밀번호, 카드번호, 주민번호 마스킹
  - 개인정보 최소 로깅

✓ 구조화된 로그
  - JSON 포맷 (로그 수집 용이)
  - MDC로 traceId 포함

✓ 에러 로그 분리
  - 에러 전용 파일
  - 알림 연동 고려
```

---

## 9. 면접 대비 Q&A

### Q1. SLF4J와 Logback의 관계는?

```
SLF4J = 로깅 추상화 (인터페이스)
Logback = 로깅 구현체

비유:
JDBC = 데이터베이스 추상화
MySQL Driver = 구현체

장점:
- 코드에서는 SLF4J만 사용
- 구현체 변경 시 코드 수정 불필요
- 예: Logback → Log4j2 변경 가능
```

### Q2. 로그 레벨 선택 기준은?

```
ERROR: 즉시 대응 필요, 서비스 기능 장애
WARN:  주의 필요, 예상 가능한 예외
INFO:  운영에 필요한 비즈니스 이벤트
DEBUG: 개발/디버깅 용도 (운영 OFF)
TRACE: 매우 상세한 추적 (거의 사용 안 함)
```

**운영 환경 권장 설정:**

```yaml
logging:
  level:
    root: WARN                        # 기본값 (프레임워크, 라이브러리 포함)
    com.example.myapp: INFO           # 내가 만든 패키지
    org.springframework: WARN         # Spring 프레임워크
    org.hibernate: WARN               # Hibernate
    org.apache.kafka: WARN            # Kafka
```

```
설명:
- root: WARN → 모든 로그의 기본 레벨 (Spring, 라이브러리 등)
- com.example.myapp: INFO → 내가 작성한 코드의 로그 레벨
  (실제 패키지명으로 변경: com.company.projectname 등)
```

### Q3. MDC는 무엇이고 왜 사용하나?

```
MDC (Mapped Diagnostic Context):
- 스레드 로컬에 저장되는 컨텍스트 정보
- 요청별로 traceId, userId 등을 저장
- 모든 로그에 자동으로 포함

사용 이유:
- 분산 환경에서 요청 추적
- 로그 검색/필터링 용이
- 문제 발생 시 관련 로그만 추출

주의점:
- 스레드 재사용 시 반드시 clear()
- 비동기 작업 시 전파 필요 (TaskDecorator)
```

### Q4. ELK와 Loki의 차이점은?

```
ELK Stack (Elasticsearch + Logstash + Kibana):
- 전문 검색 (Full-text indexing)
- 복잡한 쿼리, 분석 가능
- 리소스 많이 필요
- 비용 높음

Loki + Grafana:
- 라벨 기반 인덱싱 (메타데이터만)
- 라벨 검색 빠름, 본문 검색 느림
- 리소스 적게 필요
- Grafana와 자연스러운 통합
- 비용 효율적

선택 기준:
- 복잡한 로그 분석 → ELK
- 비용 효율, 간단한 검색 → Loki
```

### Q5. 비동기 로깅의 장단점은?

```
장점:
- 로그 쓰기가 애플리케이션 성능에 영향 안 줌
- 처리량 향상

단점:
- 로그 유실 가능성 (큐 overflow 시)
- 즉시성 떨어짐 (버퍼링)
- 애플리케이션 비정상 종료 시 유실

설정 팁:
- neverBlock=true: 블로킹 대신 버림
- discardingThreshold: 큐가 차면 낮은 레벨 버림
- 에러 로그는 동기로 처리 권장
```

### Q6. 구조화된 로그(JSON)의 장점은?

```
장점:
- 로그 수집기에서 파싱 용이
- 필드별 검색/필터링 가능
- 자동화된 분석 가능
- 일관된 포맷

예시:
{"timestamp":"2024-01-15T10:30:45Z","level":"INFO","traceId":"abc123","orderId":"12345"}

검색 예:
- orderId=12345인 모든 로그
- level=ERROR인 최근 1시간 로그
- 특정 traceId의 전체 요청 흐름
```

---

## 10. 정리

### 핵심 개념 정리

| 개념 | 설명 |
|------|------|
| **SLF4J** | 로깅 추상화 (인터페이스) |
| **Logback** | Spring Boot 기본 로깅 구현체 |
| **MDC** | 스레드 로컬 컨텍스트 (요청 추적) |
| **JSON 로깅** | 구조화된 로그 (파싱 용이) |
| **비동기 로깅** | 성능 최적화 (AsyncAppender) |
| **ELK/Loki** | 중앙 집중식 로그 관리 |

### 실무 체크리스트

```
로그 레벨:
✓ ERROR: 즉시 대응 필요한 장애
✓ WARN: 예상 가능한 예외, 주의 필요
✓ INFO: 주요 비즈니스 이벤트
✓ DEBUG: 개발 환경에서만 사용

로그 내용:
✓ 누가: userId, sessionId
✓ 무엇을: 작업 내용
✓ 어떻게: 파라미터, 결과
✓ 왜: 에러 원인 (예외 포함)

주의사항:
✓ 민감정보 마스킹
✓ 예외 스택트레이스 포함
✓ MDC로 요청 추적
✓ 비동기 로깅 고려
✓ 로그 로테이션 설정
```

---

## 시리즈를 마치며

지금까지 7편에 걸쳐 대용량 트래픽 처리를 위한 스프링부트 실무 기법들을 다뤘다.

| 편 | 주제 | 핵심 기술 |
|---|------|----------|
| 1편 | 동시성 제어 | Atomic UPDATE, 분산 락, 멱등성 키 |
| 2편 | 캐싱 전략 | Redis, Caffeine, Cache-Aside |
| 3편 | 이벤트 드리븐 | Kafka, Outbox 패턴, 중복 처리 |
| 4편 | Resilience 패턴 | Circuit Breaker, Rate Limiter, Bulkhead |
| 5편 | DB 최적화 | 인덱스, 커서 페이지네이션, Read Replica |
| 6편 | 모니터링 | Prometheus, Grafana, 커스텀 메트릭 |
| 7편 | 로깅 | SLF4J, Logback, MDC, ELK/Loki |

이 시리즈에서 다룬 내용들은 실제 대규모 서비스에서 공통적으로 사용되는 패턴들이다. 각 기술이 **어떤 문제를 해결하는지** 이해하고, 직접 코드를 작성해보면서 체감해보길 권한다.

핵심은 **왜 필요한지**를 이해하는 것이다. 분산 락이 왜 필요한지, MDC가 어떤 상황에서 유용한지, 구조화된 로그가 왜 중요한지를 설명할 수 있다면 면접에서도 좋은 결과가 있을 것이다.
