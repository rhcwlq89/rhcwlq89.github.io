---
title: "Spring Boot Practical Guide Part 7: Logging Strategy and Practice"
description: "From SLF4J, Logback, Log4j2 comparison to structured logging, MDC, and centralized log management"
pubDate: 2026-02-08T12:50:00+09:00
lang: en
tags: ["Spring Boot", "Logging", "SLF4J", "Logback", "Backend", "Practical Guide"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 6: Monitoring](/en/blog/springboot-practical-guide-6) | **Part 7: Logging** | - |

---

## Introduction

In Part 6, we covered Metrics, one of the three pillars of observability (Metrics, Logs, Traces). In this part, we focus intensively on **Logs**.

Logging is not simply a replacement for `System.out.println()`. A well-designed logging system can **reduce the time to identify the root cause of an incident from hours to minutes**.

**What Part 7 covers:**
- Spring logging technology stack comparison (SLF4J, Logback, Log4j2)
- Log level guide
- Logback configuration in practice
- Structured logging (JSON format)
- Request tracing with MDC
- Centralized log management (ELK, Loki)
- Practical considerations

### Table of Contents

- [Why are logs important?](#1-why-are-logs-important)
- [Technology stack selection guide](#2-technology-stack-selection-guide)
- [Log level guide](#3-log-level-guide)
- [Logback configuration](#4-logback-configuration)
- [Structured logging (JSON)](#5-structured-logging-json)
- [Request tracing with MDC](#6-request-tracing-with-mdc)
- [Centralized log management](#7-centralized-log-management)
- [Practical considerations](#8-practical-considerations)
- [Interview prep Q&A](#9-interview-prep-qa)
- [Summary](#10-summary)

---

## 1. Why Are Logs Important?

### 1.1 Incident Response Without Logs

```
Incident scenario:
"Intermittent 500 errors on the Payment API"

Without logs:
├── "Which request caused the error?"
├── "What parameters were used?"
├── "Is it a DB query issue? An external API issue?"
├── "Can't reproduce it..."
└── Unable to identify root cause

With logs:
├── ERROR PaymentService - Payment failed for orderId=12345
├── ERROR External PG API timeout after 5000ms
├── DEBUG Request: POST /api/payments, userId=678, amount=50000
└── Root cause identified in 5 minutes: PG API latency
```

### 1.2 Good Logs vs Bad Logs

```kotlin
// Bad logs
logger.info("Error occurred")
logger.error("Failed")
logger.debug(user.toString())  // Risk of exposing sensitive info

// Good logs
logger.info("Order created: orderId={}, userId={}, amount={}", orderId, userId, amount)
logger.error("Payment processing failed: orderId={}, errorCode={}, message={}", orderId, e.code, e.message, e)
logger.debug("Product lookup request: productId={}", productId)
```

Characteristics of good logs:
- **Who**: userId, sessionId
- **What**: which operation
- **How**: parameters, result values
- **Why**: error cause (including exceptions)

---

## 2. Technology Stack Selection Guide

### 2.1 Spring Logging Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Application Code                       │
│                                                         │
│              logger.info("Hello World")                 │
│                         │                               │
│                         ▼                               │
│              ┌─────────────────┐                        │
│              │     SLF4J       │  ← Logging Abstraction │
│              │  (Simple Logging│       (Facade)         │
│              │   Facade 4 Java)│                        │
│              └────────┬────────┘                        │
│                       │                                 │
│         ┌─────────────┼─────────────┐                  │
│         ▼             ▼             ▼                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│   │ Logback  │  │  Log4j2  │  │ JUL      │            │
│   │ (Default)│  │          │  │(java.util│            │
│   │          │  │          │  │ .logging)│            │
│   └──────────┘  └──────────┘  └──────────┘            │
│                                                         │
│                Actual Logging Implementations            │
└─────────────────────────────────────────────────────────┘
```

**SLF4J** is the logging interface (abstraction), while **Logback/Log4j2** are the actual implementations.

### 2.2 Technology Stack Comparison

| Category | Logback | Log4j2 |
|------|---------|--------|
| **Spring Boot default** | Yes (built-in) | No (requires separate config) |
| **Performance** | Good | Better (Async Logger) |
| **Config file** | logback-spring.xml | log4j2-spring.xml |
| **Developer** | SLF4J creator (Ceki) | Apache |
| **JSON logging** | Requires additional library | Built-in support |
| **Async logging** | AsyncAppender | Built-in (LMAX Disruptor) |

### 2.3 Selection Guide

```
┌─────────────────────────────────────────────────────────┐
│              Technology Stack Selection                   │
│                                                         │
│  Q1. Do you have special requirements?                  │
│      │                                                  │
│      ├── Ultra-high perf needed (hundreds of thousands  │
│      │   TPS) → Log4j2                                  │
│      ├── Default config is enough → Logback (default)   │
│      └── JSON logging required → Both are capable       │
│                                                         │
│  Recommendation: Logback (Spring Boot default)          │
│       for most cases                                    │
│       - Ready to use without extra configuration        │
│       - Built-in Spring Profile integration             │
│       - Sufficient performance                          │
└─────────────────────────────────────────────────────────┘
```

> **What is TPS (Transactions Per Second)?**
> It refers to the number of transactions (requests) a system can process in one second.
> It is a key metric for measuring server performance; the higher the value, the more requests can be handled.
> - Small-scale services: hundreds to thousands TPS
> - Mid-scale services: thousands to tens of thousands TPS
> - Large-scale services: hundreds of thousands TPS or more

### 2.4 Centralized Log Management Comparison

| Category | ELK Stack | Loki + Grafana |
|------|-----------|----------------|
| **Components** | Elasticsearch + Logstash + Kibana | Loki + Promtail + Grafana |
| **Indexing** | Full-text search | Label-based (metadata only) |
| **Resources** | High (ES is heavy) | Low |
| **Search speed** | Fast (leverages index) | Fast for label search, slow for content search |
| **Complexity** | High | Low |

### 2.5 Full-Text Search vs Label-Based Indexing

**Full-Text Search Indexing (ELK - Elasticsearch)**

```
Original log:
{"timestamp":"2024-01-15T10:30:45Z","level":"ERROR","message":"Payment failed for user 12345","traceId":"abc123"}

Elasticsearch indexing:
┌─────────────────────────────────────────────────────────┐
│  Inverted Index Creation                                 │
│                                                         │
│  "payment" → [doc1, doc15, doc203, ...]                │
│  "failed"  → [doc1, doc42, doc89, ...]                 │
│  "user"    → [doc1, doc2, doc3, ...]                   │
│  "12345"   → [doc1, doc156, ...]                       │
│  "error"   → [doc1, doc5, doc10, ...]                  │
│                                                         │
│  All words are indexed → searchable by any word         │
└─────────────────────────────────────────────────────────┘

Search examples:
- All logs containing "Payment failed" → instant return
- Logs containing "NullPointerException" → instant return
- message contains "timeout" AND level="ERROR" → instant return
```

**Label-Based Indexing (Loki)**

```
Original log:
{"timestamp":"2024-01-15T10:30:45Z","level":"ERROR","message":"Payment failed for user 12345","traceId":"abc123"}

Loki indexing:
┌─────────────────────────────────────────────────────────┐
│  Only labels (metadata) are indexed                      │
│                                                         │
│  {app="payment-service", level="ERROR", env="prod"}    │
│       ↓                                                 │
│  Only stores the location of log chunks matching        │
│  this label combination                                 │
│                                                         │
│  Log body ("Payment failed for user 12345") is          │
│  only compressed, not indexed                           │
└─────────────────────────────────────────────────────────┘

Search examples:
- {app="payment-service", level="ERROR"} → fast (uses index)
- {app="payment-service"} |= "Payment failed" → slow (full scan)
- Logs containing "NullPointerException" → slow (full scan)
```

**Search Performance Comparison**

| Search type | ELK | Loki |
|----------|-----|------|
| Label/field search (`level=ERROR`) | Fast | Fast |
| Specific ID search (`traceId=abc123`) | Fast | Fast (if traceId is a label) |
| Content keyword search (`"NullPointer"`) | **Fast** | Slow (full scan) |
| Regex search (`message =~ "timeout.*"`) | **Fast** | Slow |
| Complex aggregation (error rate stats) | **Fast** | Limited |

**Practical Scenario Suitability**

```
Scenario 1: "All logs for traceId=abc123"
├── ELK: Fast ✓
└── Loki: Fast ✓ (if traceId is set as a label)

Scenario 2: "Find all NullPointerExceptions that occurred today"
├── ELK: Fast ✓ (instant search via inverted index)
└── Loki: Slow ✗ (requires full scan of today's logs)

Scenario 3: "Error logs from the last hour containing 'timeout'"
├── ELK: Fast ✓
└── Loki: Moderate (scans only 1 hour of data)

Scenario 4: "Error rate statistics per API over the last 30 days"
├── ELK: Fast ✓ (powerful aggregation queries)
└── Loki: Slow/Not possible ✗
```

**Conclusion:**

```
Choose ELK when:
- Frequent log content searches are needed
- "I don't know what error occurred but I need to find it"
- Complex statistics/analysis is required

Choose Loki when:
- Mostly searching by specific IDs like traceId, userId
- Searches at the level of "show me the logs for this request"
- Cost optimization is a priority
```

### 2.6 Cost Comparison Guide

**Why the cost difference?**

```
ELK Stack:
- Elasticsearch indexes all log content
- Index storage requires 1.5~2x the original data size
- High CPU/memory requirements for indexing/searching
- Minimum recommended: 16GB RAM, 4 Cores (single node)

Loki:
- Log body is only compressed and stored, not indexed
- Only labels (metadata) are indexed
- Storage usage is 10~20% compared to ELK
- Minimum recommended: 4GB RAM, 2 Cores
```

**Cost Comparison by Scale (Estimated monthly cost on AWS)**

| Log volume | ELK (Self-hosted) | Loki (Self-hosted) | Notes |
|----------|-------------------|-------------------|------|
| **10GB/day** | $150~250 | $50~80 | Small scale, Loki recommended |
| **50GB/day** | $400~600 | $100~150 | Mid scale, Loki recommended |
| **200GB/day** | $1,500~2,500 | $300~500 | Large scale, choose based on requirements |
| **1TB/day** | $5,000+ | $1,000~2,000 | ELK if complex search is needed |

> **Note:** Using managed services (AWS OpenSearch, Grafana Cloud) increases costs by 2~5x but reduces operational burden.

**Selection Guide**

```
Choose Loki when:
├── Daily log volume under 100GB
├── "Show me logs for traceId=xxx" level of search is sufficient
├── Already using Grafana (monitoring integration)
├── Cost optimization is important
└── Limited operations staff

Choose ELK when:
├── Full-text log search is essential ("all logs containing NullPointerException")
├── Complex aggregation/analysis needed (error pattern analysis, statistics)
├── Daily log volume hundreds of GB+ with fast search required
├── Security/compliance requirements (audit log analysis)
└── Dedicated operations staff available
```

**Practical tip: Hybrid approach**

```
Getting both cost savings and functionality:
┌─────────────────────────────────────────────────────────┐
│  All logs → Loki (low-cost long-term retention)         │
│      │                                                  │
│      └── ERROR logs only → ELK (detailed analysis)      │
│                                                         │
│  Result:                                                │
│  - 70% reduction in total cost                          │
│  - ELK used only for error analysis                     │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Log Level Guide

### 3.1 Log Level Definitions

```
┌─────────────────────────────────────────────────────────┐
│  Level      │  Purpose                    │  Production │
├─────────────────────────────────────────────────────────┤
│  ERROR      │  Errors requiring immediate │  Yes        │
│             │  attention                  │             │
│  WARN       │  Attention needed,          │  Yes        │
│             │  potential issues           │             │
│  INFO       │  Key business events        │  Yes        │
│  DEBUG      │  Detailed debugging info    │  No (dev    │
│             │                             │  only)      │
│  TRACE      │  Very detailed information  │  No         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Usage Examples by Level

```kotlin
@Service
class OrderService(
    private val orderRepository: OrderRepository,
    private val paymentClient: PaymentClient
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun createOrder(request: CreateOrderRequest): Order {
        // DEBUG: Method entry, detailed parameters
        logger.debug("Order creation started: request={}", request)

        // INFO: Key business event
        logger.info("Order creation request: userId={}, productId={}, quantity={}",
            request.userId, request.productId, request.quantity)

        try {
            val order = Order.create(request)
            orderRepository.save(order)

            // INFO: Success result
            logger.info("Order created: orderId={}, userId={}", order.id, request.userId)
            return order

        } catch (e: InsufficientStockException) {
            // WARN: Expected business exception
            logger.warn("Order failed due to insufficient stock: productId={}, requested={}, available={}",
                request.productId, request.quantity, e.availableStock)
            throw e

        } catch (e: Exception) {
            // ERROR: Unexpected system error
            logger.error("Error during order creation: userId={}, productId={}",
                request.userId, request.productId, e)
            throw e
        }
    }
}
```

### 3.3 Should You Check Log Levels?

In the example above, there are no level checks like `logger.isDebugEnabled()`. There is a reason for this.

**How SLF4J Parameterized Logging Works**

```kotlin
// When you write this
logger.debug("Order creation started: request={}", request)

// SLF4J internally handles it like this
if (logger.isDebugEnabled()) {
    String message = "Order creation started: request=" + request.toString()
    // Actual log output
}
```

When using placeholders (`{}`), **string concatenation does not occur at all if the log level is disabled.**

**When level check is NOT needed (most cases)**

```kotlin
// Placeholder usage - no level check needed
logger.debug("userId={}, orderId={}", userId, orderId)
logger.debug("request={}", request)  // toString() is only called when level is active

// Reason: If DEBUG is OFF, parameter evaluation itself is skipped
```

**When level check IS needed (expensive operations)**

```kotlin
// Expensive operation requires level check
logger.debug("Result: {}", expensiveCalculation())  // Always called!

// Level check prevents unnecessary computation
if (logger.isDebugEnabled) {
    logger.debug("Result: {}", expensiveCalculation())
}

// In Kotlin, solve with lambdas (kotlin-logging library)
// implementation("io.github.microutils:kotlin-logging:3.0.5")
logger.debug { "Result: ${expensiveCalculation()}" }  // Lambda not executed if DEBUG is OFF
```

**Summary: When to check log levels?**

| Situation | Level check | Reason |
|------|----------|------|
| Simple variable output | Not needed | Placeholder handles it |
| Object toString() | Not needed | Only called when level is active |
| **Method call** | **Needed** | Method is always executed |
| **Complex computation** | **Needed** | Computation cost incurred |
| **Collection iteration** | **Needed** | Iteration cost incurred |

```kotlin
// Practical example
class OrderService {
    fun processOrder(order: Order) {
        // Simple variable - no check needed
        logger.debug("Order processing started: orderId={}", order.id)

        // Object - no check needed (toString only when level is active)
        logger.debug("Order details: {}", order)

        // Method call - check needed
        if (logger.isDebugEnabled) {
            logger.debug("Stock status: {}", inventoryService.getStockSummary())
        }

        // Collection transformation - check needed
        if (logger.isDebugEnabled) {
            val itemNames = order.items.map { it.name }.joinToString()
            logger.debug("Order items: {}", itemNames)
        }
    }
}
```

### 3.4 Log Level Selection Criteria

```
ERROR usage:
- Situations requiring immediate response
- Service functionality is broken
- e.g., DB connection failure, essential external API error

WARN usage:
- OK for now but needs attention
- Expected business exceptions
- e.g., Insufficient stock, invalid input, retries occurring

INFO usage:
- Information needed for operations
- Key business events
- e.g., Order creation, payment completion, user registration

DEBUG usage:
- Needed only during development/debugging
- Method entry/exit, detailed parameters
- OFF in production

TRACE usage:
- Very detailed tracing
- Inside loops, variable value changes
- Rarely used
```

### 3.5 Log Level Settings by Environment

```yaml
# application.yml - Common settings
logging:
  level:
    root: INFO
    com.example.marketplace: INFO

---
# application-local.yml - Local development
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
# application-prod.yml - Production
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

## 4. Logback Configuration

### 4.1 Basic Configuration File

In Spring Boot, using `logback-spring.xml` enables Spring Profile integration.

```xml
<!-- src/main/resources/logback-spring.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<configuration scan="true" scanPeriod="30 seconds">

    <!-- Variable definitions -->
    <property name="LOG_PATH" value="${LOG_PATH:-./logs}"/>
    <property name="LOG_FILE" value="${LOG_FILE:-application}"/>

    <!-- Console output pattern -->
    <property name="CONSOLE_PATTERN"
              value="%d{yyyy-MM-dd HH:mm:ss.SSS} %highlight(%-5level) [%thread] %cyan(%logger{36}) - %msg%n"/>

    <!-- File output pattern -->
    <property name="FILE_PATTERN"
              value="%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{36} - %msg%n"/>

    <!-- Console Appender -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>${CONSOLE_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
    </appender>

    <!-- File Appender (Rolling) -->
    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_PATH}/${LOG_FILE}.log</file>
        <encoder>
            <pattern>${FILE_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
        <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
            <!-- Daily rolling -->
            <fileNamePattern>${LOG_PATH}/${LOG_FILE}.%d{yyyy-MM-dd}.log</fileNamePattern>
            <!-- Retain for 30 days -->
            <maxHistory>30</maxHistory>
            <!-- Maximum total size -->
            <totalSizeCap>10GB</totalSizeCap>
        </rollingPolicy>
    </appender>

    <!-- Error-only file -->
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

    <!-- Profile-specific settings -->
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

### 4.2 Async Logging Configuration

Process logs asynchronously so that log writing does not impact application performance.

```xml
<!-- Async Appender -->
<appender name="ASYNC_FILE" class="ch.qos.logback.classic.AsyncAppender">
    <!-- Queue size (default: 256) -->
    <queueSize>1024</queueSize>
    <!-- Discard WARN and below when queue is 80% full -->
    <discardingThreshold>20</discardingThreshold>
    <!-- Drop instead of blocking when queue is full -->
    <neverBlock>true</neverBlock>
    <!-- Actual Appender -->
    <appender-ref ref="FILE"/>
</appender>

<springProfile name="prod">
    <root level="WARN">
        <appender-ref ref="ASYNC_FILE"/>
        <appender-ref ref="ERROR_FILE"/>
    </root>
</springProfile>
```

### 4.3 Log Rotation Strategy

```xml
<!-- Size + time based rolling -->
<rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
    <!-- Daily + index -->
    <fileNamePattern>${LOG_PATH}/${LOG_FILE}.%d{yyyy-MM-dd}.%i.log</fileNamePattern>
    <!-- Max size per file -->
    <maxFileSize>100MB</maxFileSize>
    <!-- Retention period -->
    <maxHistory>30</maxHistory>
    <!-- Total max size -->
    <totalSizeCap>10GB</totalSizeCap>
</rollingPolicy>
```

---

## 5. Structured Logging (JSON)

### 5.1 Why JSON Logs?

```
Plain log:
2024-01-15 10:30:45.123 INFO [http-nio-8080-exec-1] OrderService - Order created: orderId=12345, userId=678

JSON log:
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "INFO",
  "thread": "http-nio-8080-exec-1",
  "logger": "OrderService",
  "message": "Order created",
  "orderId": "12345",
  "userId": "678",
  "traceId": "abc123",
  "spanId": "def456"
}
```

**Advantages of JSON logs:**
- Easy to parse by log collection systems
- Enables per-field search/filtering
- Facilitates analysis as structured data

### 5.2 Logstash Encoder Setup

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
        <!-- Timestamp format -->
        <timestampPattern>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</timestampPattern>
        <!-- Custom fields -->
        <customFields>{"application":"marketplace-api","environment":"${SPRING_PROFILES_ACTIVE:-local}"}</customFields>
        <!-- Exception stacktrace inclusion -->
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

### 5.3 Structured Log Output

```kotlin
import net.logstash.logback.argument.StructuredArguments.*

@Service
class OrderService {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun createOrder(request: CreateOrderRequest): Order {
        // Using structured arguments
        logger.info("Order created",
            kv("orderId", order.id),
            kv("userId", request.userId),
            kv("amount", request.amount),
            kv("productCount", request.items.size)
        )

        // Output:
        // {
        //   "message": "Order created",
        //   "orderId": "12345",
        //   "userId": "678",
        //   "amount": 50000,
        //   "productCount": 3
        // }
    }
}
```

---

## 6. Request Tracing with MDC

### 6.1 What is MDC?

```
MDC (Mapped Diagnostic Context):
Context information stored in thread-local storage

┌─────────────────────────────────────────────────────────┐
│  Request A (Thread-1)                                    │
│  MDC: {traceId: "abc123", userId: "100"}               │
│  └── OrderService.createOrder()                        │
│       └── PaymentService.process()                     │
│            └── NotificationService.send()              │
│  traceId and userId automatically included in all logs  │
│                                                         │
│  Request B (Thread-2)                                    │
│  MDC: {traceId: "def456", userId: "200"}               │
│  └── Isolated with its own context                      │
└─────────────────────────────────────────────────────────┘
```

### 6.2 MDC Filter Implementation

```kotlin
// MdcLoggingFilter.kt
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)  // Must execute first
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
            // Generate TraceId (or extract from header)
            val traceId = request.getHeader("X-Trace-Id")
                ?: UUID.randomUUID().toString().replace("-", "").take(16)
            val spanId = UUID.randomUUID().toString().replace("-", "").take(8)

            // Set context in MDC
            MDC.put(TRACE_ID, traceId)
            MDC.put(SPAN_ID, spanId)
            MDC.put(REQUEST_URI, request.requestURI)
            MDC.put(REQUEST_METHOD, request.method)
            MDC.put(CLIENT_IP, getClientIp(request))

            // Include TraceId in response header (for frontend reference)
            response.setHeader("X-Trace-Id", traceId)

            filterChain.doFilter(request, response)
        } finally {
            // Must clear for thread reuse
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

**Why use @Order(Ordered.HIGHEST_PRECEDENCE):**

```
Filter execution order:
┌─────────────────────────────────────────────────────────┐
│  1. MdcLoggingFilter (HIGHEST_PRECEDENCE = first)        │
│     └── Generate traceId, set MDC                        │
│                                                         │
│  2. Spring Security Filters                             │
│     └── Authentication/Authorization processing          │
│                                                         │
│  3. Other filters                                       │
│                                                         │
│  4. Controller                                          │
└─────────────────────────────────────────────────────────┘

Reason:
- Must execute first so all logs include traceId
- Logs from Security filters also include traceId
- Authentication failure logs can also be traced
```

**X-Trace-Id, X-Forwarded-For header standards:**

| Header | Standard status | Definition |
|------|----------|------|
| **X-Forwarded-For** | De facto standard | Standardized as `Forwarded` header in RFC 7239. However, `X-Forwarded-For` is more widely used |
| **X-Trace-Id** | Non-standard (de facto standard) | Standardized as `traceparent` header in W3C Trace Context. However, `X-Trace-Id`, `X-Request-Id`, etc. are conventionally used |

```
X-Forwarded-For:
- Used by proxies/load balancers to forward the original client IP
- Format: X-Forwarded-For: client, proxy1, proxy2
- RFC 7239 Forwarded header is the official standard, but X-Forwarded-For is more prevalent

X-Trace-Id (X-Request-Id):
- Request tracking ID in distributed systems
- W3C Trace Context (https://www.w3.org/TR/trace-context/) is the official standard
  - traceparent: 00-{trace-id}-{span-id}-{flags}
- However, the simpler X-Trace-Id is more commonly used
- Standard header support in OpenTelemetry, Jaeger, Zipkin, etc.
```

### 6.3 Adding User ID After Authentication

To add the user ID to MDC, it must execute after the authentication filter. Register it explicitly in Spring Security's filter chain.

```kotlin
// MdcUserFilter.kt
class MdcUserFilter : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        try {
            // Extract user info from SecurityContext
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

**Registering the filter in SecurityConfig:**

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
            // Add MdcUserFilter after SecurityContextPersistenceFilter
            .addFilterAfter(MdcUserFilter(), SecurityContextPersistenceFilter::class.java)

        return http.build()
    }
}
```

```
Filter execution order:
┌─────────────────────────────────────────────────────────┐
│  MdcLoggingFilter (HIGHEST_PRECEDENCE)                  │
│  └── Set traceId                                        │
│                                                         │
│  ... Spring Security filters ...                        │
│                                                         │
│  SecurityContextPersistenceFilter                       │
│  └── Load SecurityContext                               │
│                                                         │
│  MdcUserFilter (registered with addFilterAfter)         │
│  └── Set userId (authentication info available)         │
│                                                         │
│  ... Remaining filters ...                              │
│                                                         │
│  Controller                                             │
└─────────────────────────────────────────────────────────┘
```

### 6.4 Applying MDC to Logback Patterns

```xml
<!-- Plain log pattern -->
<property name="CONSOLE_PATTERN"
          value="%d{HH:mm:ss.SSS} %highlight(%-5level) [%thread] [%X{traceId}] %cyan(%logger{36}) - %msg%n"/>

<!-- JSON logs automatically include MDC fields -->
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <includeMdcKeyName>traceId</includeMdcKeyName>
    <includeMdcKeyName>spanId</includeMdcKeyName>
    <includeMdcKeyName>userId</includeMdcKeyName>
    <includeMdcKeyName>requestUri</includeMdcKeyName>
</encoder>
```

### 6.5 MDC Propagation in Async Tasks

MDC is based on **ThreadLocal**, so it is not automatically propagated during async tasks. Separate configuration is required.

**MDC and Logging Frameworks:**

| Framework | MDC support | Notes |
|-----------|---------|------|
| **SLF4J** | Yes | Provides MDC API (org.slf4j.MDC) |
| **Logback** | Yes | Uses SLF4J MDC as-is |
| **Log4j2** | Yes | Uses ThreadContext (integrates with SLF4J MDC) |

> **Conclusion:** MDC propagation code uses the SLF4J API, so it **works identically with both Logback and Log4j2**.

**MDC Propagation with TaskDecorator:**

```kotlin
// AsyncConfig.kt
@Configuration
@EnableAsync
class AsyncConfig : AsyncConfigurer {

    override fun getAsyncExecutor(): Executor {
        val executor = ThreadPoolTaskExecutor()
        executor.corePoolSize = 10
        executor.maxPoolSize = 50
        executor.setTaskDecorator(MdcTaskDecorator())  // MDC propagation setup
        executor.initialize()
        return executor
    }
}

class MdcTaskDecorator : TaskDecorator {
    override fun decorate(runnable: Runnable): Runnable {
        // Copy MDC from current thread (caller)
        val contextMap = MDC.getCopyOfContextMap()
        return Runnable {
            try {
                // Set MDC in new thread (async task)
                contextMap?.let { MDC.setContextMap(it) }
                runnable.run()
            } finally {
                MDC.clear()
            }
        }
    }
}
```

**Practical usage example:**

```kotlin
@Service
class OrderService(
    private val notificationService: NotificationService
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun createOrder(request: CreateOrderRequest): Order {
        // traceId is set in MDC
        logger.info("Order created: orderId={}", order.id)  // Includes traceId

        // Async call - MdcTaskDecorator propagates MDC
        notificationService.sendAsync(order)

        return order
    }
}

@Service
class NotificationService {
    private val logger = LoggerFactory.getLogger(javaClass)

    @Async  // Runs in a separate thread
    fun sendAsync(order: Order) {
        // Same traceId maintained thanks to MdcTaskDecorator
        logger.info("Notification sent: orderId={}", order.id)  // Same traceId included!
    }
}
```

```
Log output:
[traceId=abc123] Order created: orderId=100        (http-nio-8080-exec-1)
[traceId=abc123] Notification sent: orderId=100     (async-executor-1)
                 ↑ Connected by the same traceId
```

**MDC Propagation in CompletableFuture:**

CompletableFuture does not have TaskDecorator automatically applied unlike `@Async`. There are two approaches.

**Approach 1: Manual handling each time (Service code)**

```kotlin
// OrderService.kt - Handle directly where it's used
@Service
class OrderService(
    private val asyncExecutor: Executor  // Injected from Configuration
) {
    fun processAsync(): CompletableFuture<Result> {
        // Copy MDC from current thread
        val contextMap = MDC.getCopyOfContextMap()

        return CompletableFuture.supplyAsync({
            try {
                contextMap?.let { MDC.setContextMap(it) }
                doProcess()
            } finally {
                MDC.clear()
            }
        }, asyncExecutor)
    }
}
```

Drawback: Requires writing boilerplate code each time

**Approach 2: Register MDC-propagating Executor in Configuration (Recommended)**

```kotlin
// AsyncConfig.kt - Register in Configuration
@Configuration
class AsyncConfig {

    /**
     * Executor that automatically propagates MDC
     * Use as CompletableFuture.supplyAsync(..., mdcExecutor)
     */
    @Bean
    fun mdcExecutor(): Executor {
        val executor = ThreadPoolTaskExecutor()
        executor.corePoolSize = 10
        executor.maxPoolSize = 50
        executor.setThreadNamePrefix("mdc-async-")
        executor.setTaskDecorator(MdcTaskDecorator())  // MDC propagation
        executor.initialize()
        return executor
    }
}

// MdcTaskDecorator.kt (same as defined above)
class MdcTaskDecorator : TaskDecorator {
    override fun decorate(runnable: Runnable): Runnable {
        val contextMap = MDC.getCopyOfContextMap()
        return Runnable {
            try {
                contextMap?.let { MDC.setContextMap(it) }
                runnable.run()
            } finally {
                MDC.clear()
            }
        }
    }
}
```

```kotlin
// OrderService.kt - Clean usage
@Service
class OrderService(
    @Qualifier("mdcExecutor") private val mdcExecutor: Executor
) {
    fun processAsync(): CompletableFuture<Result> {
        // MDC propagation happens automatically!
        return CompletableFuture.supplyAsync({
            doProcess()  // No extra handling needed
        }, mdcExecutor)
    }
}
```

**Summary:**

| Approach | Location | Pros | Cons |
|------|------|------|------|
| Manual handling | Service code | Explicit | Lots of boilerplate |
| **mdcExecutor Bean** | Configuration | Clean, reusable | Requires Bean injection |

### 6.6 traceId Propagation in EDA Environments (Kafka/RabbitMQ)

The `@Async` discussed earlier is for cases where only the thread differs **within the same JVM**. However, in **EDA (Event-Driven Architecture)** environments, messages are delivered to other services over the network, so the MDC propagation approach is different.

**@Async vs Kafka/RabbitMQ difference:**

```
@Async (same JVM):
┌─────────────────────────────────────────────────────────┐
│  Order Service (JVM)                                    │
│                                                         │
│  Thread-1 ──TaskDecorator──▶ Thread-2                  │
│  Solved by copying MDC                                  │
└─────────────────────────────────────────────────────────┘

Kafka/RabbitMQ (different JVMs):
┌─────────────────────────────────────────────────────────┐
│  Order Service        Kafka         Payment Service    │
│  (JVM 1)              Broker        (JVM 2)            │
│                                                         │
│  MDC: {traceId}  ─────X─────▶  MDC: {} (empty!)       │
│                                                         │
│  MDC is ThreadLocal so it can't be sent over network   │
│  → Must include traceId in message headers              │
└─────────────────────────────────────────────────────────┘
```

**Kafka Producer - Include traceId in headers:**

```kotlin
@Component
class OrderEventProducer(
    private val kafkaTemplate: KafkaTemplate<String, OrderEvent>
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun sendOrderCreatedEvent(order: Order) {
        val event = OrderCreatedEvent(order.id, order.userId, order.amount)

        // Extract traceId from MDC and add to headers
        val traceId = MDC.get("traceId") ?: UUID.randomUUID().toString()

        val record = ProducerRecord<String, OrderEvent>(
            "order-events",      // topic
            null,                // partition
            order.id.toString(), // key
            event                // value
        ).apply {
            headers().add("traceId", traceId.toByteArray())
            headers().add("spanId", UUID.randomUUID().toString().take(8).toByteArray())
        }

        kafkaTemplate.send(record)
        logger.info("Event published: orderId={}, traceId={}", order.id, traceId)
    }
}
```

**Kafka Consumer - Extract traceId from headers and set MDC:**

```kotlin
@Component
class PaymentEventConsumer {
    private val logger = LoggerFactory.getLogger(javaClass)

    @KafkaListener(topics = ["order-events"], groupId = "payment-service")
    fun handleOrderCreated(
        event: OrderCreatedEvent,
        @Header("traceId", required = false) traceIdBytes: ByteArray?
    ) {
        // Extract traceId from header and set in MDC
        val traceId = traceIdBytes?.let { String(it) } ?: UUID.randomUUID().toString()

        try {
            MDC.put("traceId", traceId)
            MDC.put("eventType", "OrderCreated")

            logger.info("Event received: orderId={}", event.orderId)  // traceId included

            // Payment processing logic
            processPayment(event)

            logger.info("Payment processing complete: orderId={}", event.orderId)

        } finally {
            MDC.clear()
        }
    }
}
```

**Extracting common logic into an Interceptor:**

```kotlin
// Producer Interceptor - Automatically adds traceId on publish
@Component
class TracingProducerInterceptor : ProducerInterceptor<String, Any> {

    override fun onSend(record: ProducerRecord<String, Any>): ProducerRecord<String, Any> {
        val traceId = MDC.get("traceId") ?: UUID.randomUUID().toString()
        record.headers().add("traceId", traceId.toByteArray())
        return record
    }

    override fun onAcknowledgement(metadata: RecordMetadata?, exception: Exception?) {}
    override fun close() {}
    override fun configure(configs: MutableMap<String, *>?) {}
}

// Consumer Interceptor - Automatically sets MDC on consume
@Component
class TracingConsumerInterceptor : ConsumerInterceptor<String, Any> {

    override fun onConsume(records: ConsumerRecords<String, Any>): ConsumerRecords<String, Any> {
        // MDC setup before processing each record is handled in @KafkaListener
        return records
    }

    override fun onCommit(offsets: MutableMap<TopicPartition, OffsetAndMetadata>?) {}
    override fun close() {}
    override fun configure(configs: MutableMap<String, *>?) {}
}
```

**Registering the Interceptor in KafkaConfig:**

```kotlin
@Configuration
class KafkaConfig {

    @Bean
    fun producerFactory(): ProducerFactory<String, Any> {
        val config = mapOf(
            ProducerConfig.BOOTSTRAP_SERVERS_CONFIG to "localhost:9092",
            ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
            ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG to JsonSerializer::class.java,
            ProducerConfig.INTERCEPTOR_CLASSES_CONFIG to listOf(
                TracingProducerInterceptor::class.java.name
            )
        )
        return DefaultKafkaProducerFactory(config)
    }
}
```

**Log output example (traceId linked across services):**

```
# Order Service (Producer)
[traceId=abc123] Order created: orderId=100
[traceId=abc123] Event published: orderId=100

# Payment Service (Consumer) - Same traceId!
[traceId=abc123] Event received: orderId=100
[traceId=abc123] Payment processing complete: orderId=100

# Searching traceId=abc123 in the centralized log system
# returns logs from both services
```

**Same approach for RabbitMQ:**

```kotlin
// RabbitMQ Producer
@Component
class OrderEventPublisher(
    private val rabbitTemplate: RabbitTemplate
) {
    fun publish(event: OrderCreatedEvent) {
        val traceId = MDC.get("traceId") ?: UUID.randomUUID().toString()

        rabbitTemplate.convertAndSend("order-exchange", "order.created", event) { message ->
            message.messageProperties.setHeader("traceId", traceId)
            message
        }
    }
}

// RabbitMQ Consumer
@Component
class PaymentEventListener {

    @RabbitListener(queues = ["payment-queue"])
    fun handle(event: OrderCreatedEvent, @Header("traceId") traceId: String?) {
        try {
            MDC.put("traceId", traceId ?: UUID.randomUUID().toString())
            // Processing logic
        } finally {
            MDC.clear()
        }
    }
}
```

**Summary: MDC Propagation Methods Compared**

| Scenario | Propagation method | Implementation |
|------|----------|------|
| **@Async** (same JVM) | TaskDecorator | MDC.getCopyOfContextMap() |
| **CompletableFuture** | Manual copy | MDC.setContextMap() |
| **Kafka** | Message headers | ProducerRecord.headers() |
| **RabbitMQ** | Message headers | MessageProperties.setHeader() |
| **HTTP calls** (other services) | HTTP headers | X-Trace-Id header |

> **Practical tip:** When distributed tracing gets complex, consider using libraries like **OpenTelemetry** or **Spring Cloud Sleuth**. They automatically propagate traceId and integrate with tools like Jaeger and Zipkin.

---

## 7. Centralized Log Management

### 7.1 Why is Centralized Logging Needed?

```
Problem in distributed environments:
┌────────────────────────────────────────────────────────┐
│  Server A (/var/log/app.log)                           │
│  Server B (/var/log/app.log)                           │
│  Server C (/var/log/app.log)                           │
│                                                        │
│  Problem: "Which server did the error occur on?"       │
│           "How do I trace the entire request flow?"    │
└────────────────────────────────────────────────────────┘

Centralized approach:
┌────────────────────────────────────────────────────────┐
│  Server A ─┐                                           │
│  Server B ─┼──▶ Log Collector ──▶ Central Store ──▶ UI│
│  Server C ─┘                                           │
│                                                        │
│  Solution: Search logs across all servers at once      │
│            using traceId                               │
└────────────────────────────────────────────────────────┘
```

### 7.2 ELK Stack Setup

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

### 7.3 Loki + Grafana Setup (Lightweight Alternative)

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

### 7.4 Direct Sending from Logback (Loki)

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

## 8. Practical Considerations

### 8.1 Sensitive Information Masking

```kotlin
// Dangerous: Logging sensitive info directly
logger.info("User login: email={}, password={}", email, password)
logger.info("Payment info: cardNumber={}", cardNumber)

// Masking applied
logger.info("User login: email={}", maskEmail(email))
logger.info("Payment info: cardNumber={}", maskCardNumber(cardNumber))

// Masking utility
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

### 8.2 Masking in Logback Patterns

```xml
<!-- Pattern masking with regex -->
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <jsonGeneratorDecorator class="net.logstash.logback.mask.MaskingJsonGeneratorDecorator">
        <!-- Mask specific fields -->
        <valueMask>
            <value>password</value>
            <mask>****</mask>
        </valueMask>
        <!-- Regex masking -->
        <valueMask>
            <value>\d{4}-\d{4}-\d{4}-\d{4}</value>
            <mask>****-****-****-****</mask>
        </valueMask>
    </jsonGeneratorDecorator>
</encoder>
```

### 8.3 Logging Performance Considerations

```kotlin
// Inefficient: String concatenation occurs regardless of log level
logger.debug("User info: " + user.toString())

// Inefficient: toString() is always called
logger.debug("User info: {}", user.toString())

// Efficient: Using placeholders (no computation if DEBUG is disabled)
logger.debug("User info: userId={}, name={}", user.id, user.name)

// More efficient: Log level check
if (logger.isDebugEnabled) {
    logger.debug("Complex calculation result: {}", expensiveCalculation())
}

// Kotlin lazy logging (using library)
// implementation("io.github.microutils:kotlin-logging:3.0.5")
import mu.KotlinLogging
private val logger = KotlinLogging.logger {}

logger.debug { "Complex calculation result: ${expensiveCalculation()}" }
// If DEBUG is disabled, the lambda itself is not executed
```

### 8.4 Exception Logging Pitfalls

```kotlin
// Incorrect exception logging
try {
    process()
} catch (e: Exception) {
    logger.error("Error occurred: " + e.message)  // No stacktrace
    logger.error("Error occurred: {}", e)          // Only e.toString() is output
}

// Correct exception logging (includes stacktrace)
try {
    process()
} catch (e: Exception) {
    logger.error("Error occurred: orderId={}", orderId, e)  // Stacktrace printed when e is the last argument
}

// Business exceptions: WARN + simple message
try {
    process()
} catch (e: BusinessException) {
    logger.warn("Business exception: code={}, message={}", e.code, e.message)
    // Stacktrace not needed
}
```

### 8.5 Production Environment Log Configuration Checklist

```
Log levels:
  - Root: WARN or higher
  - Application: INFO
  - Frameworks (hibernate, spring): WARN

Log rotation:
  - Daily or size-based
  - Retention period configured (30 days recommended)
  - Maximum size limit

Async logging:
  - Use AsyncAppender when high performance is needed
  - neverBlock=true to prevent blocking

Sensitive information:
  - Mask passwords, card numbers, personal IDs
  - Minimize personal data logging

Structured logging:
  - JSON format (easy log collection)
  - Include traceId via MDC

Error log separation:
  - Dedicated error file
  - Consider alert integration
```

---

## 9. Interview Prep Q&A

### Q1. What is the relationship between SLF4J and Logback?

```
SLF4J = Logging abstraction (interface)
Logback = Logging implementation

Analogy:
JDBC = Database abstraction
MySQL Driver = Implementation

Advantages:
- Code only uses SLF4J
- No code changes needed when switching implementations
- e.g., Can switch from Logback to Log4j2
```

### Q2. What are the criteria for choosing log levels?

```
ERROR: Requires immediate response, service functionality failure
WARN:  Attention needed, expected exceptions
INFO:  Business events needed for operations
DEBUG: For development/debugging purposes (OFF in production)
TRACE: Very detailed tracing (rarely used)
```

**Recommended production settings:**

```yaml
logging:
  level:
    root: WARN                        # Default (includes frameworks, libraries)
    com.example.myapp: INFO           # Your own packages
    org.springframework: WARN         # Spring framework
    org.hibernate: WARN               # Hibernate
    org.apache.kafka: WARN            # Kafka
```

```
Explanation:
- root: WARN → Default level for all logs (Spring, libraries, etc.)
- com.example.myapp: INFO → Log level for your own code
  (Replace with your actual package name: com.company.projectname, etc.)
```

### Q3. What is MDC and why use it?

```
MDC (Mapped Diagnostic Context):
- Context information stored in thread-local
- Stores traceId, userId, etc. per request
- Automatically included in all logs

Why use it:
- Request tracing in distributed environments
- Easy log search/filtering
- Extract only relevant logs when issues occur

Cautions:
- Must clear() when threads are reused
- Propagation needed for async tasks (TaskDecorator)
```

### Q4. What are the differences between ELK and Loki?

```
ELK Stack (Elasticsearch + Logstash + Kibana):
- Full-text search (full-text indexing)
- Complex queries and analysis possible
- Requires many resources
- High cost

Loki + Grafana:
- Label-based indexing (metadata only)
- Fast label search, slow content search
- Requires fewer resources
- Natural integration with Grafana
- Cost-effective

Selection criteria:
- Complex log analysis → ELK
- Cost efficiency, simple search → Loki
```

### Q5. What are the pros and cons of async logging?

```
Pros:
- Log writing does not affect application performance
- Improved throughput

Cons:
- Possible log loss (on queue overflow)
- Reduced immediacy (buffering)
- Loss on abnormal application termination

Configuration tips:
- neverBlock=true: Drop instead of blocking
- discardingThreshold: Drop lower levels when queue fills up
- Recommend synchronous processing for error logs
```

### Q6. What are the advantages of structured logging (JSON)?

```
Advantages:
- Easy parsing by log collectors
- Per-field search/filtering possible
- Enables automated analysis
- Consistent format

Example:
{"timestamp":"2024-01-15T10:30:45Z","level":"INFO","traceId":"abc123","orderId":"12345"}

Search examples:
- All logs where orderId=12345
- ERROR level logs from the last hour
- Entire request flow for a specific traceId
```

---

## 10. Summary

### Key Concepts Overview

| Concept | Description |
|------|------|
| **SLF4J** | Logging abstraction (interface) |
| **Logback** | Spring Boot's default logging implementation |
| **MDC** | Thread-local context (request tracing) |
| **JSON Logging** | Structured logs (easy parsing) |
| **Async Logging** | Performance optimization (AsyncAppender) |
| **ELK/Loki** | Centralized log management |

### Practical Checklist

```
Log levels:
- ERROR: Failures requiring immediate response
- WARN: Expected exceptions, attention needed
- INFO: Key business events
- DEBUG: Development environment only

Log content:
- Who: userId, sessionId
- What: Operation details
- How: Parameters, results
- Why: Error cause (including exceptions)

Considerations:
- Sensitive information masking
- Include exception stacktraces
- Request tracing with MDC
- Consider async logging
- Configure log rotation
```

---

## Wrapping Up the Series

Over the course of 7 parts, we have covered practical Spring Boot techniques for handling high-traffic systems.

| Part | Topic | Key Technologies |
|---|------|----------|
| Part 1 | Concurrency Control | Atomic UPDATE, Distributed Lock, Idempotency Key |
| Part 2 | Caching Strategy | Redis, Caffeine, Cache-Aside |
| Part 3 | Event-Driven | Kafka, Outbox Pattern, Deduplication |
| Part 4 | Resilience Patterns | Circuit Breaker, Rate Limiter, Bulkhead |
| Part 5 | DB Optimization | Indexes, Cursor Pagination, Read Replica |
| Part 6 | Monitoring | Prometheus, Grafana, Custom Metrics |
| Part 7 | Logging | SLF4J, Logback, MDC, ELK/Loki |

The content covered in this series represents patterns commonly used across real large-scale services. I encourage you to understand **what problem each technology solves** and gain hands-on experience by writing the code yourself.

The key is understanding **why it's needed**. If you can explain why distributed locks are necessary, in what situations MDC is useful, and why structured logging matters, you will see good results in interviews as well.
