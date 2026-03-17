---
title: "Introduction to TSDB: Why You Need a Time Series Database"
description: "What is a Time Series Database (TSDB), why RDBs fall short for time series data, and a comparison of Prometheus, InfluxDB, and TimescaleDB."
pubDate: "2026-03-17T21:30:00+09:00"
tags: ["TSDB", "Prometheus", "InfluxDB", "Monitoring", "Database"]
heroImage: "../../../assets/TsdbIntroductionGuide.png"
lang: en
---

## Introduction

Server CPU usage, request latency, IoT sensor temperature — these all share one trait: **they accumulate continuously along a time axis**. This kind of data is called **time series data**, and the specialized database built to efficiently store and query it is a **TSDB (Time Series Database)**.

"Can't I just add a timestamp column in MySQL?" — for small scale, sure. But once you're dealing with tens of thousands of metrics per second, RDBs hit a wall.

Think of TSDB as a **specialized temperature log**. You could write temperatures in a regular notebook (RDB), but a dedicated temperature chart has time-marked columns, lets you draw graphs instantly, and automatically tears out old pages. When you're tracking a few entries, any notebook works. When you're logging tens of thousands of readings every day, the specialized one wins by a landslide.

---

## 1. Characteristics of Time Series Data

Time series data behaves differently from typical business data.

| Characteristic | Time Series Data | Business Data |
|---------------|-----------------|---------------|
| **Write pattern** | Append-only (insert only) | CRUD (insert, update, delete) |
| **Read pattern** | Recent data, time-range aggregations | Random access, individual lookups |
| **Volume** | Thousands to tens of thousands per second | Relatively low |
| **Lifespan** | Old data loses value | Permanent retention needed |
| **Updates** | Almost never | Frequent |

The key takeaway: **"high-volume writes, time-range queries, automatic old data cleanup."**

---

## 2. Why RDBs Don't Cut It

Here's what happens when you put time series data in MySQL or PostgreSQL.

### 2.1 Write Performance Bottleneck

RDBs update indexes and write transaction logs for every row insert. With 10,000 metric points per second, this overhead becomes critical.

Here's an analogy: inserting data into an RDB is like **shelving a book in a library while updating the catalog every single time**. One or two books? No problem. But when tens of thousands of books pour in every second, you can't even shelve them because you're stuck updating the catalog. TSDBs stack books in order first and update the catalog in bulk later — much faster.

```
# 100 servers × 50 metrics × every 10 seconds = 500 writes/sec
# 10,000 servers? 50,000 writes/sec
INSERT INTO metrics (timestamp, host, metric_name, value) VALUES (...)
```

TSDBs are optimized for **batch writes and compressed storage**, handling this volume easily.

### 2.2 Storage Explosion

Storing a single metric at 1-second intervals for a year:

```
365 days × 24 hours × 60 min × 60 sec = 31,536,000 rows (per metric)
```

With 100 metrics, that's **3.1 billion rows**. In a regular RDB, the disk cost alone would be enormous.

TSDBs use specialized **compression algorithms** (delta encoding, gorilla compression, etc.) and use 10–20x less space than a typical RDB.

### 2.3 Aggregation Query Performance

Calculating "average CPU over the last 7 days" in an RDB means scanning millions of rows. TSDBs handle this in milliseconds using **time-based partitioning and pre-aggregation (downsampling)**.

Think of it this way: finding "last March's average temperature" by **flipping through 365 pages of a diary one by one** is the RDB approach. TSDBs pre-build **monthly summary pages**, so you just flip to the right page and get the answer instantly.

---

## 3. Core TSDB Features

Most TSDBs share these common capabilities.

### 3.1 Automatic Downsampling

Raw data at 1-second intervals is automatically aggregated over time:

```
# Raw: 1-second interval
09:00:01 → cpu: 45.2%
09:00:02 → cpu: 46.1%
09:00:03 → cpu: 44.8%
...

# After 7 days: compressed to 1-minute averages
09:00 → cpu_avg: 45.4%
09:01 → cpu_avg: 47.2%

# After 30 days: compressed to 1-hour averages
09:00 → cpu_avg: 46.1%
```

Recent data stays high-resolution while old data gets progressively compressed.

Think of your smartwatch's heart rate history. Today's data shows second-by-second detail, but data from 6 months ago only shows "that day's average heart rate." The same principle applies here. Since detailed historical data is rarely needed, this approach can reduce storage by 10x or more.

### 3.2 Automatic Data Expiration (Retention Policy)

Old data is deleted automatically. In RDBs, you'd need to run DELETE queries separately. In TSDBs, it's just a config setting.

```
# InfluxDB: auto-delete after 30 days
CREATE RETENTION POLICY "one_month" ON "mydb" DURATION 30d REPLICATION 1 DEFAULT

# Prometheus: set in config
--storage.tsdb.retention.time=30d
```

### 3.3 Label-Based Querying

TSDBs attach **labels (tags)** to metrics for multi-dimensional queries.

```
# Metric: http_requests_total
# Labels: method="GET", status="200", service="order-api"

# "5xx error rate for order-api" in a single query
rate(http_requests_total{service="order-api", status=~"5.."}[5m])
```

The equivalent in an RDB would require complex JOINs and GROUP BYs.

Labels work like **hashtags**. Just as searching `#Seoul #foodie #pasta` on Instagram filters to matching posts, combining labels like `service="order-api"` and `status="500"` in a TSDB instantly filters to exactly the metrics you need.

---

## 4. Major TSDB Comparison

### 4.1 Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['localhost:8080']
```

| Aspect | Details |
|--------|---------|
| **Type** | Pull-based (server scrapes targets periodically) |
| **Query language** | PromQL |
| **Storage** | Local disk (built-in TSDB engine) |
| **Strengths** | Kubernetes ecosystem standard, Grafana integration, built-in AlertManager |
| **Weaknesses** | Not suited for long-term storage (single node), no clustering |
| **Best for** | Infrastructure/application monitoring, K8s environments |

> **What's Pull vs Push?**
>
> - **Pull (Prometheus)**: "I'll check your status every 10 seconds" — the server actively fetches data from targets.
> - **Push (InfluxDB)**: "I'll tell you when my status changes" — clients send data to the server.
>
> Prometheus uses Pull because it naturally detects when a target is down: "I went to check, but nobody answered."

#### How Does Prometheus Actually Pull Data?

The mechanism is dead simple. The target app exposes a `/metrics` endpoint over HTTP, and Prometheus periodically sends GET requests to fetch the data.

```
[Spring Boot App]                          [Prometheus]
   :8080/actuator/prometheus                  :9090
         │                                      │
         │  ← GET /actuator/prometheus ────── │  (every 15s)
         │                                      │
         │  ── text response ────────────────→ │
         │                                      │
                                          parse → store in TSDB
```

The `/metrics` response looks like this:

```
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1523
http_requests_total{method="POST",status="201"} 342

# TYPE process_cpu_usage gauge
process_cpu_usage 0.0423
```

Not JSON. No special protocol. Just **plain text key-value pairs**.

In Spring Boot, it takes a single dependency:

```groovy
// build.gradle
implementation 'io.micrometer:micrometer-registry-prometheus'
```

Add this and `/actuator/prometheus` is automatically available, exposing JVM metrics, HTTP request counts, response times, and more. Zero application code changes needed.

In Kubernetes, Prometheus uses **service discovery** to automatically detect Pods, so you don't need to update config when servers scale up or down.

PromQL examples:

```promql
# HTTP request rate over last 5 minutes (per second)
rate(http_server_requests_seconds_count[5m])

# Top 5 servers by CPU usage
topk(5, 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100))

# 95th percentile response time
histogram_quantile(0.95, rate(http_server_requests_seconds_bucket[5m]))
```

### 4.2 InfluxDB

```
# Write data using InfluxDB Line Protocol
curl -XPOST 'http://localhost:8086/write?db=mydb' \
  --data-binary 'cpu,host=server01,region=kr value=0.64 1742212800000000000'
```

| Aspect | Details |
|--------|---------|
| **Type** | Push-based (clients send data) |
| **Query language** | Flux / InfluxQL (SQL-like) |
| **Storage** | Custom TSM engine |
| **Strengths** | SQL-like queries, built-in downsampling, cloud service available |
| **Weaknesses** | Open-source version has no clustering (Enterprise only) |
| **Best for** | IoT, business metrics, standalone time series storage |

> **What does InfluxDB feel like?**
>
> If you know SQL but find Prometheus queries intimidating, InfluxDB is for you. InfluxQL looks almost identical to SQL: `SELECT mean(cpu) FROM metrics WHERE time > now() - 1h GROUP BY time(5m)`.

#### How Does InfluxDB's Push Model Work?

InfluxDB opens its own **HTTP API port (default 8086)** and waits for data. Clients (apps, IoT devices, etc.) send data via POST requests to this port, and InfluxDB stores it.

```
[IoT Sensor]  ──POST──→  [InfluxDB :8086]
[Spring App]  ──POST──→  [InfluxDB :8086]
[Telegraf]    ──POST──→  [InfluxDB :8086]
```

Unlike Prometheus, which goes out to find targets, InfluxDB **waits for data to come in**. This is especially useful for IoT devices that sit behind firewalls and can't be scraped from outside.

The data format is **Line Protocol** — a simple text format:

```
# Format: metric_name,tag1=val1,tag2=val2 field=value timestamp
cpu,host=server01,region=kr usage=0.64 1742212800000000000
temperature,sensor=A1,floor=3 value=24.5 1742212800000000000
```

One metric per line. It handles hundreds of thousands of writes per second with ease.

In practice, rather than sending data directly to InfluxDB, many teams use **Telegraf** (InfluxDB's official agent) as a middleman. Telegraf collects system metrics and forwards them to InfluxDB.

Flux query example:

```flux
from(bucket: "mydb")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "cpu" and r.host == "server01")
  |> aggregateWindow(every: 5m, fn: mean)
```

### 4.3 TimescaleDB

```sql
-- PostgreSQL extension, so you use standard SQL
CREATE TABLE metrics (
    time        TIMESTAMPTZ NOT NULL,
    host        TEXT,
    cpu_usage   DOUBLE PRECISION
);

-- Convert to hypertable (time series optimization)
SELECT create_hypertable('metrics', 'time');

-- Query with standard SQL
SELECT time_bucket('5 minutes', time) AS interval,
       host,
       avg(cpu_usage) as avg_cpu
FROM metrics
WHERE time > now() - interval '1 hour'
GROUP BY interval, host
ORDER BY interval DESC;
```

| Aspect | Details |
|--------|---------|
| **Type** | PostgreSQL extension |
| **Query language** | SQL (standard PostgreSQL) |
| **Storage** | PostgreSQL tables with automatic time-based partitioning |
| **Strengths** | Existing PostgreSQL knowledge transfers, JOINs supported, full SQL |
| **Weaknesses** | Lower write performance than pure TSDBs, operational complexity |
| **Best for** | When you need time series + relational data together |

> **When is TimescaleDB the right choice?**
>
> For example: "I want to JOIN the orders table with server response time metrics to analyze the order cancellation rate during slow response periods." This is impossible in Prometheus or InfluxDB, but TimescaleDB handles it with a simple SQL JOIN — because it's all in the same PostgreSQL instance.

#### Does TimescaleDB Really Work with Regular SQL?

Yes. TimescaleDB is a PostgreSQL **extension**, so you just install it on your existing PostgreSQL. You're not learning a new database.

```sql
-- 1. Install extension (once)
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 2. Create a regular table (identical to PostgreSQL)
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   TEXT,
    temperature DOUBLE PRECISION,
    humidity    DOUBLE PRECISION
);

-- 3. Convert to hypertable (this one line is the magic)
SELECT create_hypertable('sensor_data', 'time');
```

The moment you run `create_hypertable`, automatic **time-based partitioning** kicks in behind the scenes. But from your perspective, nothing changes:

```sql
-- INSERT works the same
INSERT INTO sensor_data VALUES (now(), 'A1', 24.5, 60.2);

-- SELECT works the same
SELECT * FROM sensor_data WHERE time > now() - interval '1 hour';

-- JOIN with other tables works too (impossible in Prometheus/InfluxDB)
SELECT s.sensor_id, s.temperature, l.location_name
FROM sensor_data s
JOIN sensor_locations l ON s.sensor_id = l.sensor_id
WHERE s.time > now() - interval '1 hour';
```

Aside from `time_bucket` (a TimescaleDB-specific function), everything else is **100% standard PostgreSQL SQL**. Existing tools like pg_dump, pg_restore, and psql all work as-is.

### 4.4 Comparison Summary

| | Prometheus | InfluxDB | TimescaleDB |
|--|-----------|----------|-------------|
| **Query language** | PromQL | Flux / InfluxQL | SQL |
| **Learning curve** | Medium | Low | Low (SQL) |
| **Write performance** | High | Very high | Medium |
| **Long-term storage** | Limited (needs external) | Yes | Yes |
| **K8s integration** | Excellent (standard) | Good | Limited |
| **Relational JOINs** | No | No | Yes |
| **License** | Apache 2.0 | MIT (OSS) / Commercial | Apache 2.0 / Commercial |

---

## 5. How to Choose

### Kubernetes monitoring → Prometheus

Kubernetes and Prometheus are practically a package deal. Service discovery, kube-state-metrics, and Grafana dashboards are all part of the ecosystem.

For long-term storage, add **Thanos** or **Cortex** on top of Prometheus.

### IoT or business metrics → InfluxDB

Sensor data, stock prices, user behavior metrics — scenarios where **push-based** ingestion is natural. SQL-like queries keep the learning curve low.

### Want to leverage existing PostgreSQL → TimescaleDB

"I need time series data but don't want to spin up separate infrastructure." TimescaleDB is the answer. Just install an extension on your existing PostgreSQL and keep using SQL.

---

## 6. Production Architecture Example

A typical monitoring system setup:

```
[Spring Boot App]          [Node Exporter]          [IoT Device]
   /actuator/prometheus       :9100/metrics             MQTT
        │                         │                       │
        └──── Pull ───────────────┘                       │
                    │                                     │
              [Prometheus]                          [InfluxDB]
                    │                                     │
                    └─────────── [Grafana] ────────────────┘
                                    │
                              [AlertManager]
                                    │
                            Slack / PagerDuty
```

- **Prometheus**: Collects infrastructure/app metrics (Pull)
- **InfluxDB**: Collects IoT sensor data (Push)
- **Grafana**: Visualizes both data sources in a single dashboard
- **AlertManager**: Sends alerts when thresholds are exceeded

---

## Summary

| Key Point | Details |
|-----------|---------|
| **What is TSDB?** | A specialized DB for efficiently storing and querying time-axis data |
| **Why needed?** | High-volume writes, time-range aggregation, automatic expiration — RDBs can't keep up |
| **Core features** | Downsampling, retention policies, label-based multi-dimensional queries |
| **Selection guide** | K8s monitoring → Prometheus, IoT/Push → InfluxDB, Need SQL → TimescaleDB |

When working with time series data, you might think "just throw it in an RDB." At small scale, that works. But as volume grows, the value of a TSDB becomes clear. Especially for monitoring systems, a TSDB isn't optional — it's essential.
