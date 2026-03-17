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

TSDBs use specialized **compression algorithms** (delta encoding, gorilla compression, etc.) and use 10–20x less space than a typical RDB.

### 2.3 Aggregation Query Performance

Calculating "average CPU over the last 7 days" in an RDB means scanning millions of rows. TSDBs handle this in milliseconds using **time-based partitioning and pre-aggregation (downsampling)**.

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
