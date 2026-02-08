---
title: "Spring Boot Practical Guide Part 6: Monitoring and Observability"
description: "Real-time system monitoring with Prometheus, Grafana, and custom metrics"
pubDate: 2026-02-08T12:40:00+09:00
lang: en
tags: ["Spring Boot", "Prometheus", "Grafana", "Monitoring", "Backend", "Practical Guide"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 5: DB Optimization](/en/blog/springboot-practical-guide-5) | **Part 6: Monitoring** | [Part 7: Logging](/en/blog/springboot-practical-guide-7) |

---

## Introduction

No matter how well a system is designed, issues will arise during operation. What matters is **how quickly you can identify and resolve problems**. In this part, we cover the core concepts of observability and how to build metrics-driven monitoring.

> **Note:** Detailed coverage of Logs can be found in [Part 7: Logging Practical Guide](/en/blog/springboot-practical-guide-7).

**What Part 6 covers:**
- The 3 pillars of observability (Metrics, Logs, Traces)
- Collecting metrics with Prometheus and Micrometer
- Implementing custom business metrics
- Health checks and Kubernetes Probes
- Grafana dashboards and alert configuration

### Table of Contents

- [What is Observability?](#1-what-is-observability)
- [Prometheus & Micrometer](#2-prometheus--micrometer)
- [Metric Types](#3-metric-types)
- [Custom Business Metrics](#4-custom-business-metrics)
- [Dimensional Analysis with Tags (Labels)](#5-dimensional-analysis-with-tags-labels)
- [Health Check](#6-health-check)
- [Grafana Dashboard](#7-grafana-dashboard)
- [Alert Configuration](#8-alert-configuration)
- [FAQ](#10-interview-prep-qa)
- [Summary](#summary)

---

## 1. What is Observability?

### 1.1 Monitoring vs Observability

```
Monitoring:
"Watch predefined things"
- Alert if CPU usage > 80%
- Alert if error rate > 5%
- Can only detect known issues

Observability:
"Understand internal system state from the outside"
- Why did it slow down? → Root cause traceable
- Where is the bottleneck? → Analyzable
- Can identify unexpected problems too
```

Monitoring requires you to decide "what to watch" in advance. Observability, on the other hand, collects all system state data so you can trace "why" when problems occur.

### 1.2 The 3 Pillars of Observability

```
┌─────────────────────────────────────────────────────────┐
│                    Observability                        │
│                                                         │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│   │   Metrics   │  │    Logs     │  │   Traces    │   │
│   └─────────────┘  └─────────────┘  └─────────────┘   │
│         │                │                │            │
│      "What"          "What              "Where"        │
│    "How much"       happened"         "Which path"     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

| Pillar | Description | Example Tools |
|-----|------|----------|
| **Metrics** | Numerical time-series data | Prometheus, Datadog |
| **Logs** | Event records | ELK Stack, Loki |
| **Traces** | Request flow tracking | Jaeger, Zipkin |

By combining all three, you can quickly identify the root cause of failures:
- **Metrics**: "Error rate exceeded 5%" (problem detection)
- **Logs**: "Timeout error in PaymentService" (details)
- **Traces**: "5-second delay in external PG API call" (bottleneck location)

### 1.3 Real-World Incident Response Comparison

```
Incident scenario:
10:05 AM - User reports "Payment isn't working"

Without observability:
├── "Where are the log files?"
├── "Which server did it happen on?"
├── "I can't reproduce it..."
└── Root cause identified after 3 hours

With observability:
├── Metrics: Payment API latency spike starting at 10:03
├── Logs: Timeout error in PaymentService
├── Traces: External PG API response taking 5 seconds
└── Root cause identified in 15 minutes
```

---

## 2. Prometheus & Micrometer

### 2.1 Prometheus Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 Prometheus Architecture                  │
│                                                         │
│   ┌─────────────┐     Pull      ┌─────────────┐        │
│   │   Spring    │ ◀──────────── │ Prometheus  │        │
│   │   Boot App  │  /actuator/   │   Server    │        │
│   │             │  prometheus   │             │        │
│   └─────────────┘               └──────┬──────┘        │
│                                        │                │
│                                        │ Query          │
│                                        ▼                │
│                                 ┌─────────────┐        │
│                                 │   Grafana   │        │
│                                 │  Dashboard  │        │
│                                 └─────────────┘        │
└─────────────────────────────────────────────────────────┘

Key characteristics:
- Pull model: Prometheus fetches metrics from the app
- Time-series DB: Stores metric changes over time
- PromQL: Powerful query language
```

**Advantages of the Pull model:**
- The application only needs to expose metrics
- Prometheus centrally manages scrape targets
- Application independence is maintained

### 2.2 The Role of Micrometer

```
Micrometer = SLF4J for Metrics (abstraction layer)

┌─────────────────────────────────────────────────────────┐
│                     Application Code                     │
│                                                         │
│              meterRegistry.counter("orders").increment() │
│                              │                          │
│                              ▼                          │
│                    ┌─────────────────┐                  │
│                    │   Micrometer    │                  │
│                    │ (Abstraction    │                  │
│                    │     Layer)      │                  │
│                    └────────┬────────┘                  │
│                             │                           │
│          ┌──────────────────┼──────────────────┐       │
│          ▼                  ▼                  ▼       │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐  │
│   │ Prometheus │    │  Datadog   │    │ CloudWatch │  │
│   │  Registry  │    │  Registry  │    │  Registry  │  │
│   └────────────┘    └────────────┘    └────────────┘  │
└─────────────────────────────────────────────────────────┘
```

With Micrometer:
- Write **vendor-neutral** code
- No code changes needed when switching monitoring systems
- Automatic integration with Spring Boot Actuator

### 2.3 Project Setup

```kotlin
// build.gradle.kts
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("io.micrometer:micrometer-registry-prometheus")
}
```

```yaml
# application-prod.yml
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus
  endpoint:
    health:
      show-details: when_authorized
  prometheus:
    metrics:
      export:
        enabled: true
```

### 2.4 Verifying the Metrics Endpoint

```bash
# Query Prometheus metrics
curl http://localhost:8080/actuator/prometheus

# Example output
# HELP jvm_memory_used_bytes Used JVM memory
# TYPE jvm_memory_used_bytes gauge
jvm_memory_used_bytes{area="heap",id="Eden Space"} 5.0331648E7
jvm_memory_used_bytes{area="heap",id="Survivor Space"} 6291456.0

# HELP http_server_requests_seconds HTTP request duration
# TYPE http_server_requests_seconds summary
http_server_requests_seconds_count{method="GET",uri="/api/products"} 150
http_server_requests_seconds_sum{method="GET",uri="/api/products"} 12.5
```

Spring Boot Actuator automatically provides default metrics for JVM, HTTP, connection pools, and more.

---

## 3. Metric Types

### 3.1 The 4 Basic Metric Types

```
┌─────────────────────────────────────────────────────────┐
│  1. Counter                                              │
│     - Can only increase (never decrease)                │
│     - Resets to 0 on restart                            │
│     - Examples: total requests, total errors            │
│                                                         │
│     0 → 1 → 2 → 3 → 4 → 5 → ...                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  2. Gauge                                                │
│     - Can increase and decrease                         │
│     - Represents current state                          │
│     - Examples: current memory usage, active threads    │
│                                                         │
│     50 → 70 → 45 → 80 → 30 → ...                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  3. Timer                                                │
│     - Event duration + occurrence count                 │
│     - Examples: API response time, query execution time │
│                                                         │
│     count: 100, sum: 5.2s, max: 0.5s                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  4. Histogram                                            │
│     - Measures value distribution using buckets         │
│     - Example: response time distribution               │
│       (0-100ms: 50%, 100-500ms: 40%)                    │
│                                                         │
│     bucket_0.1: 50, bucket_0.5: 90, bucket_1.0: 98     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 When to Use Which?

| What to Measure | Metric Type | Example |
|----------|------------|------|
| Cumulative count | Counter | Order count, error count |
| Current state | Gauge | Memory usage, active connections |
| Elapsed time | Timer | API response time |
| Value distribution | Histogram | Response time percentiles |

### 3.3 Counter vs Gauge Selection Criteria

```
Use Counter when:
- "How many total so far?" → Order count, error count
- Value never decreases
- Can calculate "per-second rate" with rate()

Use Gauge when:
- "How many right now?" → Active connections, queue size
- Value can increase or decrease
- Current snapshot matters
```

---

## 4. Custom Business Metrics

### 4.1 OrderMetrics Implementation

```kotlin
// MetricsConfig.kt
@Component
class OrderMetrics(private val meterRegistry: MeterRegistry) {

    // Counter: number of orders created (increment only)
    private val orderCreatedCounter: Counter = Counter.builder("marketplace.orders.created")
        .description("Total number of orders created")
        .register(meterRegistry)

    // Counter: number of orders cancelled
    private val orderCancelledCounter: Counter = Counter.builder("marketplace.orders.cancelled")
        .description("Total number of orders cancelled")
        .register(meterRegistry)

    // Counter: number of failed orders
    private val orderFailedCounter: Counter = Counter.builder("marketplace.orders.failed")
        .description("Total number of failed order attempts")
        .register(meterRegistry)

    // Timer: order creation duration
    private val orderCreationTimer: Timer = Timer.builder("marketplace.orders.creation.time")
        .description("Time taken to create an order")
        .register(meterRegistry)

    // Gauge: current active orders
    private val activeOrders: AtomicInteger = AtomicInteger(0)

    init {
        meterRegistry.gauge("marketplace.orders.active", activeOrders)
    }

    // Usage methods
    fun incrementOrderCreated() {
        orderCreatedCounter.increment()
        activeOrders.incrementAndGet()
    }

    fun incrementOrderCancelled() {
        orderCancelledCounter.increment()
        activeOrders.decrementAndGet()
    }

    fun incrementOrderFailed() {
        orderFailedCounter.increment()
    }

    // Measure elapsed time with Timer
    fun <T> timeOrderCreation(block: () -> T): T {
        return orderCreationTimer.recordCallable(block)!!
    }
}
```

### 4.2 ProductMetrics Implementation

```kotlin
@Component
class ProductMetrics(private val meterRegistry: MeterRegistry) {

    private val productCreatedCounter = Counter.builder("marketplace.products.created")
        .description("Total number of products created")
        .register(meterRegistry)

    private val productViewCounter = Counter.builder("marketplace.products.views")
        .description("Total number of product views")
        .register(meterRegistry)

    private val stockDecreasedCounter = Counter.builder("marketplace.products.stock.decreased")
        .description("Total number of stock decrease operations")
        .register(meterRegistry)

    private val insufficientStockCounter = Counter.builder("marketplace.products.stock.insufficient")
        .description("Total number of insufficient stock errors")
        .register(meterRegistry)

    fun incrementProductCreated() = productCreatedCounter.increment()
    fun incrementProductView() = productViewCounter.increment()
    fun incrementStockDecreased() = stockDecreasedCounter.increment()
    fun incrementInsufficientStock() = insufficientStockCounter.increment()
}
```

### 4.3 Usage in Services

```kotlin
// Usage in OrderService.kt
@Service
class OrderService(
    private val orderMetrics: OrderMetrics
) {
    fun createOrder(request: CreateOrderRequest): OrderResponse {
        return orderMetrics.timeOrderCreation {
            try {
                // Order creation logic
                val order = processOrder(request)
                orderMetrics.incrementOrderCreated()
                order
            } catch (e: Exception) {
                orderMetrics.incrementOrderFailed()
                throw e
            }
        }
    }
}
```

### 4.4 Metrics as Seen in Prometheus

```
# Order counters
marketplace_orders_created_total 150
marketplace_orders_cancelled_total 12
marketplace_orders_failed_total 3

# Active orders (Gauge)
marketplace_orders_active 138

# Order creation time (Timer)
marketplace_orders_creation_time_seconds_count 150
marketplace_orders_creation_time_seconds_sum 45.2
marketplace_orders_creation_time_seconds_max 1.2

# Product metrics
marketplace_products_views_total 5000
marketplace_products_stock_insufficient_total 23
```

---

## 5. Dimensional Analysis with Tags (Labels)

### 5.1 Why Tags Matter

```
Without tags:
marketplace_orders_created_total 150
→ Only know the total order count

With tags:
marketplace_orders_created_total{status="success",payment="card"} 100
marketplace_orders_created_total{status="success",payment="bank"} 40
marketplace_orders_created_total{status="failed",payment="card"} 10
→ Can analyze by payment method and status
```

Tags enable multi-dimensional analysis with a single metric.

### 5.2 How to Add Tags

```kotlin
// Counter with tags
private fun orderCounter(status: String, paymentType: String): Counter {
    return Counter.builder("marketplace.orders")
        .tag("status", status)
        .tag("payment_type", paymentType)
        .register(meterRegistry)
}

// Usage
fun recordOrder(paymentType: String, success: Boolean) {
    val status = if (success) "success" else "failed"
    orderCounter(status, paymentType).increment()
}
```

### 5.3 Cautions When Using Tags

```
Bad practice:
Counter.builder("orders")
    .tag("user_id", userId)     // Metric explosion per user!
    .tag("order_id", orderId)   // Metric explosion per order!

Good practice:
Counter.builder("orders")
    .tag("status", "success")      // Limited set of values
    .tag("payment_type", "card")   // Limited set of values
    .tag("region", "seoul")        // Limited set of values
```

If the number of tag combinations (cardinality) is too high, memory usage will spike dramatically.

### 5.4 Analyzing with PromQL

```promql
# Total order count
sum(marketplace_orders_created_total)

# Order count by payment method
sum by (payment_type) (marketplace_orders_created_total)

# Failure rate
sum(marketplace_orders_created_total{status="failed"})
  / sum(marketplace_orders_created_total) * 100

# Orders per second over the last 5 minutes
rate(marketplace_orders_created_total[5m])
```

---

## 6. Health Check

### 6.1 The Role of Health Checks

```
An endpoint to determine "Is this service healthy?"

GET /actuator/health

{
  "status": "UP",          ← Overall status
  "components": {
    "db": { "status": "UP" },          ← DB connection OK
    "redis": { "status": "UP" },       ← Redis OK
    "kafka": { "status": "UP" },       ← Kafka OK
    "diskSpace": { "status": "UP" }    ← Disk OK
  }
}

Use cases:
- Kubernetes: Liveness/Readiness Probe
- Load balancer: Route traffic only to healthy instances
- Monitoring: Failure detection and alerting
```

### 6.2 Custom HealthIndicator - Redis

```kotlin
// HealthIndicators.kt
@Component
@Profile("docker", "prod")
class RedisHealthIndicator(
    private val redisConnectionFactory: RedisConnectionFactory
) : HealthIndicator {

    override fun health(): Health {
        return try {
            val connection = redisConnectionFactory.connection
            val pong = connection.ping()  // PING → PONG
            connection.close()

            if (pong != null) {
                Health.up()
                    .withDetail("status", "Redis is available")
                    .withDetail("response", pong)
                    .build()
            } else {
                Health.down()
                    .withDetail("status", "Redis ping returned null")
                    .build()
            }
        } catch (e: Exception) {
            Health.down(e)
                .withDetail("status", "Redis is unavailable")
                .withDetail("error", e.message)
                .build()
        }
    }
}
```

### 6.3 Custom HealthIndicator - Kafka

```kotlin
@Component
@Profile("docker", "prod")
class KafkaHealthIndicator(
    private val kafkaTemplate: KafkaTemplate<String, Any>
) : HealthIndicator {

    override fun health(): Health {
        return try {
            kafkaTemplate.producerFactory  // Verify producer initialization
            Health.up()
                .withDetail("status", "Kafka producer is initialized")
                .build()
        } catch (e: Exception) {
            Health.down(e)
                .withDetail("status", "Kafka is unavailable")
                .build()
        }
    }
}
```

### 6.4 Kubernetes Probe Configuration

```yaml
# deployment.yaml
spec:
  containers:
    - name: marketplace-api
      livenessProbe:           # Is it alive?
        httpGet:
          path: /actuator/health
          port: 8080
        initialDelaySeconds: 60
        periodSeconds: 10
        failureThreshold: 3    # Restart after 3 failures

      readinessProbe:          # Is it ready to receive traffic?
        httpGet:
          path: /actuator/health
          port: 8080
        initialDelaySeconds: 30
        periodSeconds: 5
        failureThreshold: 3    # Remove from service after 3 failures
```

### 6.5 Liveness vs Readiness

| Probe | Purpose | On Failure |
|-------|------|--------|
| **Liveness** | Verify container is alive | Restart |
| **Readiness** | Verify ready to receive traffic | Remove from service (no restart) |

```
Example scenario:
┌────────────────────────────────────────────────────────┐
│ 1. Pod starts                                          │
│    Liveness: Not checked (waiting for initialDelay)    │
│    Readiness: FAIL → Not receiving traffic             │
│                                                        │
│ 2. App initialization complete                         │
│    Liveness: UP                                        │
│    Readiness: UP → Starts receiving traffic            │
│                                                        │
│ 3. DB connection lost                                  │
│    Liveness: UP (app itself is still alive)            │
│    Readiness: DOWN → Traffic stopped                   │
│                                                        │
│ 4. App deadlock                                        │
│    Liveness: FAIL → Container restarted                │
└────────────────────────────────────────────────────────┘
```

---

## 7. Grafana Dashboard

### 7.1 The Role of Grafana

```
Prometheus (data storage) → Grafana (visualization)

┌─────────────────────────────────────────────────────────┐
│                     Grafana Dashboard                    │
│                                                         │
│  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Orders/min     │  │  Response Time  │              │
│  │   ▄▄▄█▄▄▄▄█    │  │   ___/\___/\_   │              │
│  └─────────────────┘  └─────────────────┘              │
│                                                         │
│  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Error Rate     │  │  Active Users   │              │
│  │      2.3%       │  │      1,234      │              │
│  └─────────────────┘  └─────────────────┘              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Data Source Configuration

```yaml
# grafana/provisioning/datasources/datasources.yml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    access: proxy
    isDefault: true
```

### 7.3 Useful PromQL Queries

**RED Method (request-based services):**

```promql
# Rate: Requests per second
rate(http_server_requests_seconds_count[5m])

# Errors: Error rate (%)
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
  / sum(rate(http_server_requests_seconds_count[5m])) * 100

# Duration: Average response time
rate(http_server_requests_seconds_sum[5m])
  / rate(http_server_requests_seconds_count[5m])

# Duration: 95th percentile response time
histogram_quantile(0.95,
  rate(http_server_requests_seconds_bucket[5m]))
```

**USE Method (resources):**

```promql
# Utilization: JVM memory usage
jvm_memory_used_bytes{area="heap"}
  / jvm_memory_max_bytes{area="heap"} * 100

# Saturation: HikariCP pending threads
hikaricp_connections_pending

# Errors: DB connection timeouts
hikaricp_connections_timeout_total
```

**Business metrics:**

```promql
# Orders per minute
rate(marketplace_orders_created_total[1m]) * 60

# Order success rate
sum(marketplace_orders_created_total{status="success"})
  / sum(marketplace_orders_created_total) * 100
```

---

## 8. Alert Configuration

### 8.1 Alert Rule Examples

```yaml
# Prometheus alerting rules
groups:
  - name: marketplace-alerts
    rules:
      # Error rate exceeds 5%
      - alert: HighErrorRate
        expr: |
          sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
          / sum(rate(http_server_requests_seconds_count[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"

      # Response time exceeds 2 seconds
      - alert: SlowResponseTime
        expr: |
          histogram_quantile(0.95,
            rate(http_server_requests_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow response time"

      # Service down
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.instance }} is down"
```

### 8.2 Alert Configuration Tips

- **for clause**: Ignore temporary spikes (alert only if condition persists for 5 minutes)
- **severity label**: Categorize alert priority
- **annotations**: Content to include in Slack/PagerDuty messages

---

## 9. Project File Structure

```
marketplace/
├── marketplace-api/
│   ├── build.gradle.kts              # actuator, micrometer-prometheus
│   └── src/main/
│       ├── kotlin/.../config/
│       │   ├── MetricsConfig.kt      # OrderMetrics, ProductMetrics
│       │   └── HealthIndicators.kt   # Redis, Kafka health checks
│       └── resources/
│           └── application-prod.yml  # Prometheus endpoint config
│
├── k8s/monitoring/
│   └── prometheus.yaml               # Prometheus deployment config
│
├── grafana/
│   └── provisioning/
│       └── datasources/
│           └── datasources.yml       # Prometheus data source
│
└── docker-compose.yml                # Prometheus, Grafana services
```

---

## 10. Interview Prep Q&A

### Q1. What are the 3 pillars of observability?

| Pillar | Purpose | Example |
|---|------|------|
| **Metrics** | Understand state through numbers | CPU 80%, error rate 2% |
| **Logs** | Detailed event records | Error stack traces |
| **Traces** | Track request flow | Service A → Service B → DB |

### Q2. What is the difference between Counter and Gauge?

```
Counter: Can only increase, cumulative value
- Total requests, total errors
- Resets to 0 on restart
- Calculate per-second rate with rate()

Gauge: Can increase or decrease, current state
- Memory usage, active connections
- Represents a point-in-time value
```

### Q3. What are the advantages of Prometheus's Pull model?

```
Push model:
App → Sends to monitoring server
- App must know the monitoring server address
- Data loss if server is down

Pull model (Prometheus):
Prometheus → Fetches from app
- App only exposes metrics
- Centralized scrape target management
- App independence maintained
```

### Q4. What is the difference between Liveness and Readiness Probes?

| Probe | Purpose | On Failure |
|-------|------|--------|
| **Liveness** | Verify container is alive | Restart |
| **Readiness** | Verify ready to receive traffic | Remove from service |

Liveness checks "Are you dead?", while Readiness checks "Are you ready?"

### Q5. What is the difference between rate() and increase()?

```promql
# rate(): Average per-second increase rate
rate(http_requests_total[5m])  → 10.5 (10.5 per second)

# increase(): Total increase within a time period
increase(http_requests_total[5m])  → 3150 (3150 in 5 minutes)

Relationship: increase() ≈ rate() × time(seconds)
```

- **rate()**: Display throughput per second on dashboards
- **increase()**: Check total occurrences over a specific time period

### Q6. What metrics should you monitor?

**RED Method (request-based services):**
- **R**ate: Requests per second
- **E**rrors: Error rate
- **D**uration: Response time

**USE Method (resources):**
- **U**tilization: Usage rate (CPU 80%)
- **S**aturation: Saturation level (queue backlog)
- **E**rrors: Error count

```
Services (APIs, microservices) → RED Method
Resources (CPU, memory, DB) → USE Method
```

---

## Summary

| Concept | Description | Tools |
|------|------|------|
| **Metrics** | Numerical time-series data | Prometheus + Micrometer |
| **Logs** | Detailed event records | ELK, Loki |
| **Traces** | Distributed request tracing | Jaeger, Zipkin |
| **Counter** | Cumulative counter (increment only) | Request count, error count |
| **Gauge** | Current state (can increase/decrease) | Memory, connections |
| **Timer** | Duration + count | API response time |
| **HealthCheck** | Service status verification | Kubernetes Probe |

---

## Next Part Preview

In Part 7, we cover **the second pillar of observability: Logs**.

- Comparing SLF4J, Logback, and Log4j2 technology stacks
- Structured logging (JSON) configuration
- Request tracing with MDC
- Centralized log management with ELK Stack and Loki
- Practical considerations (sensitive data masking, performance, etc.)

[Part 7: Logging Practical Guide](/en/blog/springboot-practical-guide-7)
