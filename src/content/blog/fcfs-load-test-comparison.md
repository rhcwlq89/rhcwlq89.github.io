---
title: "선착순 시스템 전체 방식 성능 비교: k6 부하 테스트로 직접 확인"
description: "DB 락, Redis, 대기열, 토큰 — 4가지 선착순 구현 방식을 k6로 동일 조건(재고 100개, 동시 100/500/1000명) 부하 테스트한다. TPS, P95 응답 시간, 실패율을 측정하고, 상황별 최적 방식을 정리한다."
pubDate: 2026-03-24T22:00:00+09:00
tags:
  - System Design
  - First-Come-First-Served
  - Load Testing
  - k6
  - Performance
heroImage: "../../assets/FcfsLoadTestComparison.png"
---

## 서론

지금까지 4가지 방식으로 선착순 시스템을 구현했다.

| 편 | 방식 | 핵심 기술 |
|----|------|----------|
| [4편](/blog/fcfs-db-lock-implementation) | DB 락 | SELECT FOR UPDATE |
| [5편](/blog/fcfs-redis-implementation) | Redis | DECR, Lua 스크립트 |
| [6편](/blog/fcfs-queue-implementation) | 대기열 | Redis Sorted Set + Kafka |
| [7편](/blog/fcfs-token-implementation) | 토큰 | JWT + Redis |

각 글에서 "빠르다", "느리다"를 말했지만, **동일 조건에서 직접 비교한 적은 없다.** 이번 글에서 k6 부하 테스트로 4가지 방식을 동일 환경, 동일 시나리오로 테스트하고 숫자로 비교한다.

---

## 1. 테스트 환경

### 1.1 인프라

| 구성 요소 | 스펙 |
|----------|------|
| 애플리케이션 | Spring Boot 3.x, Java 17 (로컬 실행) |
| DB | MySQL 8.0 (InnoDB) |
| Redis | Redis 7.x (Standalone) |
| Kafka | Apache Kafka 3.x (1 broker, 3 partitions) |
| 부하 테스트 도구 | k6 v1.5.0 |
| HikariCP | maxPoolSize: 20, connectionTimeout: 30s |

> 인프라(MySQL, Redis, Kafka)는 Docker Compose로, 애플리케이션은 로컬에서 실행했다.

### 1.2 테스트 시나리오

모든 방식에 동일한 조건을 적용한다:

- **재고**: 100개
- **동시 사용자**: 100명 / 500명 / 1,000명
- **요청 패턴**: 모든 사용자가 동시에 구매 시도 (ramp-up 없음)
- **측정 항목**: TPS, 평균 응답 시간, P95 응답 시간, 성공률, 실패율

### 1.3 측정 방법

각 방식의 **"재고 차감 API"** 를 직접 호출한다:

| 방식 | 엔드포인트 |
|------|----------|
| DB 락 | `POST /api/orders/db-lock` |
| Redis | `POST /api/orders/redis` |
| 대기열 | `POST /api/queue/enter` + 폴링 + `POST /api/orders` |
| 토큰 | `POST /api/tokens/issue` + `POST /api/orders/token` |

> 대기열과 토큰은 2단계 호출이므로, **전체 흐름의 총 소요 시간**을 측정한다.

각 테스트 전에 `POST /api/fcfs/reset` 엔드포인트로 재고와 Redis 상태를 초기화했다.

---

## 2. k6 테스트 스크립트

### 2.1 DB 락 테스트

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const successCount = new Counter('success_count');
const failCount = new Counter('fail_count');
const purchaseTime = new Trend('purchase_time');

export const options = {
    scenarios: {
        spike: {
            executor: 'shared-iterations',
            vus: __ENV.VUS ? parseInt(__ENV.VUS) : 100,
            iterations: __ENV.ITERATIONS ? parseInt(__ENV.ITERATIONS) : 100,
            maxDuration: '120s',
        },
    },
};

export default function () {
    const productId = 1;
    const userId = __VU;

    const start = Date.now();
    const res = http.post(
        `http://localhost:8080/api/orders/db-lock`,
        JSON.stringify({ productId, userId, quantity: 1 }),
        { headers: { 'Content-Type': 'application/json' } }
    );
    const elapsed = Date.now() - start;

    purchaseTime.add(elapsed);

    if (res.status === 200) {
        successCount.add(1);
    } else {
        failCount.add(1);
    }

    check(res, {
        'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    });
}
```

### 2.2 Redis 테스트

```javascript
export const options = {
    scenarios: {
        spike: {
            executor: 'shared-iterations',
            vus: __ENV.VUS ? parseInt(__ENV.VUS) : 100,
            iterations: __ENV.ITERATIONS ? parseInt(__ENV.ITERATIONS) : 100,
            maxDuration: '120s',
        },
    },
};

export default function () {
    const productId = 1;
    const userId = __VU;

    const start = Date.now();
    const res = http.post(
        `http://localhost:8080/api/orders/redis`,
        JSON.stringify({ productId, userId, quantity: 1 }),
        { headers: { 'Content-Type': 'application/json' } }
    );
    const elapsed = Date.now() - start;

    purchaseTime.add(elapsed);

    if (res.status === 200) {
        successCount.add(1);
    } else {
        failCount.add(1);
    }
}
```

### 2.3 대기열 테스트

```javascript
export default function () {
    const productId = 1;
    const userId = __VU;
    const start = Date.now();

    // Phase 1: 대기열 진입
    const enterRes = http.post(
        `http://localhost:8080/api/queue/enter`,
        JSON.stringify({ productId, userId }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    // Phase 2: 폴링 (진입 허용 대기)
    let allowed = false;
    for (let i = 0; i < 60; i++) {
        const statusRes = http.get(
            `http://localhost:8080/api/queue/status?productId=${productId}&userId=${userId}`
        );
        const body = JSON.parse(statusRes.body);

        if (body.status === 'ALLOWED') {
            allowed = true;
            break;
        }
        if (body.status === 'NOT_IN_QUEUE') {
            break; // 이미 처리됨
        }
        sleep(1);
    }

    // Phase 3: 구매
    if (allowed) {
        const orderRes = http.post(
            `http://localhost:8080/api/orders`,
            JSON.stringify({ productId, userId, quantity: 1 }),
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (orderRes.status === 200) {
            successCount.add(1);
        } else {
            failCount.add(1);
        }
    } else {
        failCount.add(1);
    }

    const elapsed = Date.now() - start;
    purchaseTime.add(elapsed);
}
```

### 2.4 토큰 테스트

```javascript
export default function () {
    const productId = 1;
    const userId = __VU;
    const start = Date.now();

    // Phase 1: 토큰 발급
    const tokenRes = http.post(
        `http://localhost:8080/api/tokens/issue`,
        JSON.stringify({ productId, userId }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    if (tokenRes.status !== 200) {
        failCount.add(1);
        purchaseTime.add(Date.now() - start);
        return;
    }

    const token = JSON.parse(tokenRes.body).token;

    // Phase 2: 토큰으로 구매
    const orderRes = http.post(
        `http://localhost:8080/api/orders/token`,
        JSON.stringify({ quantity: 1 }),
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    const elapsed = Date.now() - start;
    purchaseTime.add(elapsed);

    if (orderRes.status === 200) {
        successCount.add(1);
    } else {
        failCount.add(1);
    }
}
```

---

## 3. 테스트 결과

> **실측 데이터 (2026.03.27 측정)** — 모든 수치는 실제 테스트에서 측정한 값이다.

### 3.1 동시 100명 (재고 100개)

```bash
k6 run -e VUS=100 -e ITERATIONS=100 test-db-lock.js
```

| 측정 항목 | DB 락 | Redis | 대기열 | 토큰 |
|----------|-------|-------|--------|------|
| 총 소요 시간 | 1.2s | 0.6s | ~30s | 2.3s |
| 평균 응답 시간 | 324ms | 487ms | 폴링 포함 ~16s | 251ms |
| P95 응답 시간 | 544ms | 524ms | ~30s | 283ms |
| 성공 | 100 | 100 | 99 | 100 |
| 실패 | 0 | 0 | 1 | 0 |

> 대기열은 스케줄러가 3초마다 10명씩 진입시키므로, 100명 전원 처리에 ~30초가 걸린다. 이는 성능 문제가 아니라 **의도된 흐름 제어**다.

### 3.2 동시 500명 (재고 100개)

| 측정 항목 | DB 락 | Redis | 대기열 | 토큰 |
|----------|-------|-------|--------|------|
| 총 소요 시간 | 1.8s | 1.1s | ~31s | 1.2s |
| 평균 응답 시간 | 1,513ms | 1,017ms | 폴링 포함 ~5.5s | 937ms |
| P95 응답 시간 | 1,754ms | 1,068ms | ~25s | 1,099ms |
| 성공 | 100 | 100 | 99 | 100 |
| 실패 (품절) | 400 | 400 | 401 | 400 |
| TPS | ~278 | ~455 | N/A | ~417 |

500명에서 DB 락의 P95가 1.7초로 올라가지만, 예상보다 심각하지 않다. HikariCP 타임아웃은 관찰되지 않았다. Redis와 토큰의 격차도 이 시점에서는 크지 않다.

### 3.3 동시 1,000명 (재고 100개)

| 측정 항목 | DB 락 | Redis | 대기열 | 토큰 |
|----------|-------|-------|--------|------|
| 총 소요 시간 | 1.3s | 0.2s | ~56s | 0.3s |
| 평균 응답 시간 | 826ms | 202ms | 폴링 포함 ~10s | 117ms |
| P95 응답 시간 | 1,165ms | 302ms | ~41s | 197ms |
| 성공 | 100 | 100 | 185* | 100 |
| 실패 (품절) | 900 | 900 | 815 | 900 |
| TPS | ~783 | ~2,008 | N/A | ~2,736 |

> \* 대기열 1,000명에서 성공이 185건으로 나타난 것은 알려진 이슈다. Kafka Consumer가 재고 소진 후에도 대기열 상태를 COMPLETED로 마킹하면서 구매 API까지 도달한 요청이 있었다. 재고 차감 자체는 정확히 100건만 처리된다.

---

## 4. 결과 분석

### 4.1 TPS 비교 그래프

```
TPS (동시 1,000명 기준)
──────────────────────────────────────────────

DB 락      ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  783
Redis      ████████████████████████████████████████  2,008
토큰       ████████████████████████████████████████████  2,736
대기열     (흐름 제어 방식 — TPS 비교 대상 아님)
```

1,000명 시점에서 **토큰이 Redis보다 빠르다** (2,736 vs 2,008 TPS). 토큰 방식은 봇 방지뿐 아니라 고부하에서의 순수 처리량도 뛰어나다.

### 4.2 P95 응답 시간 비교

```
P95 응답 시간 (동시 1,000명)
──────────────────────────────────────────────

DB 락      ██████░░░░░░░░░░░░░░░░░░░░░░░░░  1,165ms
Redis      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░  302ms
토큰       █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  197ms
대기열     의도된 대기 시간 (~41s)
```

### 4.3 DB 커넥션 사용 패턴

DB 락은 **모든 요청이 DB 커넥션을 물고 대기**하기 때문에, 선착순과 무관한 일반 API(상품 목록, 마이페이지)도 커넥션을 얻지 못해 느려진다. Redis/토큰 방식은 재고 차감에 DB를 쓰지 않으므로 커넥션 1개면 충분하다.

다만 이번 테스트에서 DB 락은 예상보다 선전했다. 1,000명에서도 P95 1.2초이고, HikariCP 타임아웃은 관찰되지 않았다. 로컬 환경에서의 낮은 네트워크 레이턴시와 DB 응답 속도가 영향을 줬을 가능성이 높다. 실제 프로덕션(네트워크 레이턴시 추가, 다른 API와 커넥션 공유)에서는 결과가 달라질 수 있다.

---

## 5. 비용 대비 성능 분석

### 5.1 인프라 비용

| 방식 | 필요 인프라 | 월 추정 비용 (AWS 기준) |
|------|-----------|----------------------|
| DB 락 | MySQL만 | ~$50 (RDS db.t3.medium) |
| Redis | MySQL + Redis | ~$80 (+ ElastiCache t3.small) |
| 대기열 | MySQL + Redis + Kafka | ~$200 (+ MSK t3.small) |
| 토큰 | MySQL + Redis | ~$80 (+ ElastiCache t3.small) |

### 5.2 비용 대비 TPS

| 방식 | TPS | 월 비용 | TPS/$ |
|------|-----|---------|-------|
| DB 락 | 783 | $50 | 15.66 |
| Redis | 2,008 | $80 | 25.10 |
| 토큰 | 2,736 | $80 | 34.20 |
| 대기열 | N/A (흐름 제어) | $200 | N/A |

**토큰이 비용 효율 1위**다. $80으로 2,736 TPS — Redis보다 36% 더 많은 처리량을 같은 비용으로 낸다.

---

## 6. 상황별 최적 방식

### 6.1 트래픽 규모 × 인프라 여건 매트릭스

| | 인프라 최소화 | Redis 가능 | Redis + Kafka 가능 |
|---|:---:|:---:|:---:|
| **동시 ~50명** | ✅ DB 락 | DB 락도 충분 | 과잉 설계 |
| **동시 ~500명** | ⚠️ DB 락 (커넥션 풀 조정) | ✅ Redis | 과잉 설계 |
| **동시 ~5,000명** | ❌ | ✅ Redis 또는 토큰 | ✅ Redis |
| **동시 ~50,000명** | ❌ | ⚠️ Redis (UX 문제) | ✅ 대기열 + 토큰 |
| **동시 ~100,000명+** | ❌ | ❌ | ✅ 대기열 + 토큰 + 수평 확장 |

### 6.2 상황별 추천

**"사내 이벤트, 소규모 선착순 (동시 50명 이하)"**
→ **DB 락** — 추가 인프라 없이 구현 가능. 충분히 빠르다.

**"쇼핑몰 한정 판매, 중규모 (동시 수백~수천 명)"**
→ **Redis Lua 스크립트** — $30 추가로 2.5배 성능. 구현도 단순하다.

**"한정판 스니커즈, 대규모 (동시 수천~수만 명)"**
→ **토큰 + Redis** — 고부하에서 가장 빠르고 (2,736 TPS), 봇 방지도 가능. 비용 효율도 최강.

**"콘서트 티켓팅, 초대규모 (동시 수만 명 이상)"**
→ **대기열 + 토큰 + Kafka** — 순서 보장 + 트래픽 흡수 + 안정적 처리.

### 6.3 결정 플로우차트

```
동시 접속이 100명 이하인가?
├─ Yes → DB 락
└─ No
    └─ 사용자에게 대기 순번을 보여줘야 하는가?
        ├─ Yes → 대기열 (+ 토큰 조합 권장)
        └─ No
            └─ 봇 방지 또는 최고 처리량이 필요한가?
                ├─ Yes → 토큰 + Redis
                └─ No → Redis Lua 스크립트
```

---

## 7. 테스트 재현 방법

직접 테스트를 실행하고 싶다면:

### 7.1 k6 설치

```bash
brew install k6
```

### 7.2 동시 사용자 수 변경

```bash
# 100명
k6 run -e VUS=100 -e ITERATIONS=100 test-db-lock.js

# 500명
k6 run -e VUS=500 -e ITERATIONS=500 test-db-lock.js

# 1,000명
k6 run -e VUS=1000 -e ITERATIONS=1000 test-db-lock.js
```

### 7.3 HTML 리포트 생성

```bash
k6 run --out json=result.json test-db-lock.js
# 결과를 k6 Cloud나 Grafana로 시각화 가능
```

### 7.4 주의사항

- **상태 초기화**: 각 테스트 전 `POST /api/fcfs/reset`으로 재고와 Redis 상태를 리셋한다
- **JVM 워밍업**: 첫 실행은 JIT 컴파일 때문에 느릴 수 있다. 2~3회 실행 후 결과를 사용한다
- **네트워크**: k6와 서버를 같은 네트워크에 배치해야 네트워크 지연이 결과에 영향을 주지 않는다

테스트 환경을 직접 구축하는 과정은 [9편](/blog/fcfs-load-test-behind-the-scenes)에서 다룬다.

---

## 정리

| 방식 | TPS (1,000명) | P95 | 비용 | 최적 상황 |
|------|:---:|:---:|:---:|----------|
| **DB 락** | 783 | 1,165ms | $50 | 사내 이벤트 (~50명) |
| **Redis** | 2,008 | 302ms | $80 | 중규모 선착순 (~수천 명) |
| **토큰** | 2,736 | 197ms | $80 | 대규모 + 봇 방지 + 최고 처리량 |
| **대기열** | 흐름 제어 | ~41s (의도적) | $200 | 초대규모 티켓팅 |

**핵심 결론:**

1. **DB 락은 예상보다 선전했다.** 1,000명에서도 P95 1.2초, HikariCP 타임아웃 없음. 다만 실제 프로덕션에서는 다른 API와 커넥션을 공유하므로 결과가 달라질 수 있다.
2. **토큰이 고부하에서 가장 빠르다.** 2,736 TPS로 Redis(2,008)를 앞섰다. 봇 방지뿐 아니라 순수 처리량도 최강.
3. **Redis는 여전히 좋은 선택이다.** $30 추가로 2.5배 성능, 구현도 단순하다.
4. **대기열은 성능이 아니라 경험을 위한 것이다.** ~30초 응답 시간은 부하와 무관하게 일정하다 — 이게 설계 목적이다.
5. **실측 결과와 예상의 괴리가 흥미롭다.** 부하가 늘어날수록 전략 간 격차가 예상보다 좁았다.

이 시리즈에서 다룬 내용은 **선착순 시스템의 기초부터 실전까지**다. 1편의 트랜잭션 격리 수준부터 8편의 부하 테스트까지, 어떤 기술이 왜 필요한지를 직접 구현하고 측정해서 확인했다. 이 경험이 실제 시스템 설계에서 **근거 있는 기술 선택**을 하는 데 도움이 되길 바란다.
