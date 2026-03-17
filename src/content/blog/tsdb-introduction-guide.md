---
title: "TSDB(시계열 데이터베이스) 소개: 왜 필요하고, 어떤 걸 써야 할까?"
description: "시계열 데이터베이스(TSDB)가 무엇인지, 왜 RDB로는 부족한지, 그리고 Prometheus·InfluxDB·TimescaleDB 등 대표 솔루션을 비교한다."
pubDate: 2026-03-17T21:30:00+09:00
tags: ["TSDB", "Prometheus", "InfluxDB", "Monitoring", "Database"]
heroImage: "../../assets/TsdbIntroductionGuide.png"
---

## 서론

서버 CPU 사용률, 요청 지연 시간, IoT 센서 온도 — 이런 데이터의 공통점은 **시간 축을 기준으로 끊임없이 쌓인다**는 것이다. 이런 데이터를 **시계열 데이터(Time Series Data)** 라고 하고, 이를 효율적으로 저장·조회하기 위해 만들어진 전용 데이터베이스가 **TSDB(Time Series Database)** 다.

"그냥 MySQL에 timestamp 컬럼 넣으면 안 되나?" — 소규모에서는 가능하지만, 초당 수만 건씩 쌓이는 메트릭을 다루기 시작하면 RDB는 한계에 부딪힌다.

---

## 1. 시계열 데이터의 특성

시계열 데이터는 일반적인 비즈니스 데이터와 성격이 다르다.

| 특성 | 시계열 데이터 | 일반 비즈니스 데이터 |
|------|-------------|-------------------|
| **쓰기 패턴** | Append-only (삽입만) | CRUD (삽입·수정·삭제) |
| **읽기 패턴** | 최근 데이터 위주, 시간 범위 집계 | 랜덤 액세스, 개별 조회 |
| **데이터 양** | 초당 수천~수만 건 | 상대적으로 적음 |
| **수명** | 오래된 데이터는 가치 감소 | 영구 보관 필요 |
| **갱신** | 거의 없음 | 빈번함 |

핵심 키워드는 **"대량 쓰기, 시간 범위 조회, 오래된 데이터 자동 정리"** 다.

---

## 2. RDB로 하면 안 되는 이유

MySQL이나 PostgreSQL에 시계열 데이터를 넣으면 어떤 일이 생기는지 보자.

### 2.1 쓰기 성능 병목

RDB는 행(row)을 삽입할 때 인덱스를 업데이트하고, 트랜잭션 로그를 기록한다. 초당 1만 건씩 쌓이는 메트릭 데이터에서는 이 오버헤드가 치명적이다.

```
# 서버 100대 × 메트릭 50개 × 10초 간격 = 초당 500건
# 서버 10,000대라면? 초당 50,000건
INSERT INTO metrics (timestamp, host, metric_name, value) VALUES (...)
```

TSDB는 **배치 쓰기, 압축 저장**에 최적화되어 이 수준의 쓰기를 쉽게 처리한다.

### 2.2 저장 공간 폭발

1초 간격으로 메트릭 1개를 1년간 저장하면:

```
365일 × 24시간 × 60분 × 60초 = 31,536,000 행 (메트릭 1개당)
```

TSDB는 시계열 데이터에 특화된 **압축 알고리즘**(delta encoding, gorilla compression 등)으로 일반 RDB 대비 10~20배 적은 공간을 사용한다.

### 2.3 집계 쿼리 성능

"지난 7일간 CPU 평균"을 구하려면 RDB에서는 수백만 행을 스캔해야 한다. TSDB는 **시간 기반 파티셔닝과 사전 집계(downsampling)** 로 이 쿼리를 밀리초 단위에 처리한다.

---

## 3. TSDB의 핵심 기능

대부분의 TSDB가 공통으로 제공하는 기능들이다.

### 3.1 자동 다운샘플링 (Downsampling)

1초 간격의 원본 데이터를 일정 기간이 지나면 자동으로 집계한다:

```
# 원본: 1초 간격
09:00:01 → cpu: 45.2%
09:00:02 → cpu: 46.1%
09:00:03 → cpu: 44.8%
...

# 7일 후 자동 다운샘플링: 1분 평균으로 압축
09:00 → cpu_avg: 45.4%
09:01 → cpu_avg: 47.2%

# 30일 후: 1시간 평균으로 추가 압축
09:00 → cpu_avg: 46.1%
```

최근 데이터는 높은 해상도로, 과거 데이터는 낮은 해상도로 유지하여 저장 공간을 절약한다.

### 3.2 자동 데이터 만료 (Retention Policy)

오래된 데이터를 자동으로 삭제한다. RDB에서는 DELETE 쿼리를 별도로 실행해야 하지만, TSDB는 설정만 해두면 된다.

```
# InfluxDB: 30일 후 자동 삭제
CREATE RETENTION POLICY "one_month" ON "mydb" DURATION 30d REPLICATION 1 DEFAULT

# Prometheus: 설정 파일에서 지정
--storage.tsdb.retention.time=30d
```

### 3.3 레이블 기반 조회

TSDB는 메트릭에 **레이블(tag)** 을 붙여서 다차원 조회를 지원한다.

```
# 메트릭: http_requests_total
# 레이블: method="GET", status="200", service="order-api"

# "order-api의 5xx 에러 비율"을 한 줄로 조회
rate(http_requests_total{service="order-api", status=~"5.."}[5m])
```

RDB에서 같은 조회를 하려면 복잡한 JOIN과 GROUP BY가 필요하다.

---

## 4. 대표 TSDB 비교

### 4.1 Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['localhost:8080']
```

| 항목 | 내용 |
|------|------|
| **유형** | Pull 기반 (서버가 대상을 주기적으로 스크래핑) |
| **쿼리 언어** | PromQL |
| **저장** | 로컬 디스크 (자체 TSDB 엔진) |
| **장점** | Kubernetes 생태계 표준, Grafana 연동, 알림 매니저 내장 |
| **단점** | 장기 저장에 부적합 (단일 노드), 클러스터링 미지원 |
| **적합한 경우** | 인프라/애플리케이션 모니터링, K8s 환경 |

PromQL 예시:

```promql
# 최근 5분간 HTTP 요청 비율 (초당)
rate(http_server_requests_seconds_count[5m])

# CPU 사용률 상위 5개 서버
topk(5, 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100))

# 95퍼센타일 응답 시간
histogram_quantile(0.95, rate(http_server_requests_seconds_bucket[5m]))
```

### 4.2 InfluxDB

```
# InfluxDB Line Protocol로 데이터 쓰기
curl -XPOST 'http://localhost:8086/write?db=mydb' \
  --data-binary 'cpu,host=server01,region=kr value=0.64 1742212800000000000'
```

| 항목 | 내용 |
|------|------|
| **유형** | Push 기반 (클라이언트가 데이터를 전송) |
| **쿼리 언어** | Flux / InfluxQL (SQL 유사) |
| **저장** | 자체 TSM 엔진 |
| **장점** | SQL과 유사한 쿼리, 다운샘플링 내장, 클라우드 서비스 제공 |
| **단점** | 오픈소스 버전은 클러스터링 미지원 (Enterprise만 가능) |
| **적합한 경우** | IoT, 비즈니스 메트릭, 독립적인 시계열 저장소가 필요한 경우 |

Flux 쿼리 예시:

```flux
from(bucket: "mydb")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "cpu" and r.host == "server01")
  |> aggregateWindow(every: 5m, fn: mean)
```

### 4.3 TimescaleDB

```sql
-- PostgreSQL 확장이므로 일반 SQL 사용
CREATE TABLE metrics (
    time        TIMESTAMPTZ NOT NULL,
    host        TEXT,
    cpu_usage   DOUBLE PRECISION
);

-- 하이퍼테이블로 변환 (시계열 최적화)
SELECT create_hypertable('metrics', 'time');

-- 일반 SQL로 조회
SELECT time_bucket('5 minutes', time) AS interval,
       host,
       avg(cpu_usage) as avg_cpu
FROM metrics
WHERE time > now() - interval '1 hour'
GROUP BY interval, host
ORDER BY interval DESC;
```

| 항목 | 내용 |
|------|------|
| **유형** | PostgreSQL 확장 |
| **쿼리 언어** | SQL (표준 PostgreSQL) |
| **저장** | PostgreSQL의 테이블을 시간 기반으로 자동 파티셔닝 |
| **장점** | 기존 PostgreSQL 지식 그대로 사용, JOIN 가능, 풀 SQL 지원 |
| **단점** | 순수 TSDB 대비 쓰기 성능 낮음, 운영 복잡도 |
| **적합한 경우** | 시계열 + 관계형 데이터를 함께 다뤄야 하는 경우 |

### 4.4 비교 요약

| | Prometheus | InfluxDB | TimescaleDB |
|--|-----------|----------|-------------|
| **쿼리 언어** | PromQL | Flux / InfluxQL | SQL |
| **학습 곡선** | 중간 | 낮음 | 낮음 (SQL) |
| **쓰기 성능** | 높음 | 매우 높음 | 중간 |
| **장기 저장** | △ (외부 연동 필요) | ○ | ○ |
| **K8s 연동** | ◎ (표준) | ○ | △ |
| **관계형 JOIN** | ✕ | ✕ | ○ |
| **라이선스** | Apache 2.0 | MIT (OSS) / 상용 | Apache 2.0 / 상용 |

---

## 5. 어떤 TSDB를 선택해야 할까?

### Kubernetes 모니터링이 목적이라면 → Prometheus

Kubernetes와 Prometheus는 사실상 세트다. 서비스 디스커버리, kube-state-metrics, Grafana 대시보드까지 이미 생태계가 완성되어 있다.

장기 저장이 필요하면 **Thanos**나 **Cortex**를 Prometheus 위에 얹으면 된다.

### IoT나 비즈니스 메트릭이 목적이라면 → InfluxDB

센서 데이터, 주가, 사용자 행동 메트릭 등 **Push 방식**이 자연스러운 시나리오에 적합하다. SQL과 비슷한 쿼리를 제공해서 학습 곡선이 낮다.

### 기존 PostgreSQL을 활용하고 싶다면 → TimescaleDB

"시계열 데이터도 필요한데 별도 인프라를 띄우기 싫다"면 TimescaleDB가 답이다. 기존 PostgreSQL에 확장만 설치하면 되고, SQL을 그대로 쓸 수 있다.

---

## 6. 실무 아키텍처 예시

모니터링 시스템의 일반적인 구성을 보자:

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

- **Prometheus**: 인프라/앱 메트릭 수집 (Pull)
- **InfluxDB**: IoT 센서 데이터 수집 (Push)
- **Grafana**: 두 데이터 소스를 하나의 대시보드에서 시각화
- **AlertManager**: 임계치 초과 시 알림

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **TSDB란?** | 시간 축 기준으로 쌓이는 데이터를 효율적으로 저장·조회하는 전용 DB |
| **왜 필요한가?** | 대량 쓰기, 시간 범위 집계, 자동 만료 — RDB로는 한계 |
| **핵심 기능** | 다운샘플링, 데이터 만료, 레이블 기반 다차원 조회 |
| **선택 기준** | K8s 모니터링 → Prometheus, IoT/Push → InfluxDB, SQL 필요 → TimescaleDB |

시계열 데이터를 다루게 되면 "그냥 RDB에 넣으면 되겠지"라는 생각이 들 수 있다. 소규모에서는 맞는 말이지만, 규모가 커지면 TSDB의 가치가 분명해진다. 특히 모니터링 시스템을 구축한다면 TSDB는 선택이 아니라 필수다.
