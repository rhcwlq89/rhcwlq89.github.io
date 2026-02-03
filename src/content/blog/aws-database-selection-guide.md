---
title: "AWS 데이터베이스 선택 가이드: EC2+Docker vs RDS vs Aurora"
description: "EC2에 Docker로 DB 직접 운영, RDS, Aurora, Aurora Serverless v2 중 어떤 것을 선택해야 할까? 비용, 성능, 운영 부담 관점에서 상세 비교"
pubDate: 2026-02-03T15:30:00+09:00
tags:
  [
    "AWS",
    "RDS",
    "Aurora",
    "EC2",
    "Docker",
    "Database",
    "MySQL",
    "PostgreSQL",
    "Infrastructure",
  ]
heroImage: "../../assets/AwsDatabaseSelectionGuide.png"
---

## 서론

AWS에서 데이터베이스를 운영할 때 크게 다섯 가지 선택지가 있다.

1. **EC2 + Docker**: 직접 DB 설치 및 운영
2. **RDS**: AWS 관리형 관계형 데이터베이스
3. **Aurora**: AWS 자체 개발 클라우드 네이티브 DB
4. **Aurora + Read Replica**: 읽기 부하 분산을 위한 Aurora 확장 구성
5. **Aurora Serverless v2**: 자동 스케일링되는 서버리스 Aurora

"RDS가 편하다는데 비싸지 않나?", "Aurora는 언제 쓰는 거지?", "EC2에 Docker로 띄우면 안 되나?", "Serverless는 언제 쓰는 게 좋지?"

이런 고민을 하고 있다면 이 글이 도움이 될 것이다.

---

## 한눈에 보는 비교

### 기본 옵션 비교

| 항목 | EC2 + Docker | RDS | Aurora |
|------|-------------|-----|--------|
| **관리 주체** | 직접 관리 | AWS 관리 | AWS 관리 |
| **비용** | 낮음 (인건비 별도) | 중간 | 높음 |
| **가용성** | 직접 구성 | Multi-AZ 옵션 | 기본 3 AZ 복제 |
| **성능** | 인스턴스 의존 | 인스턴스 의존 | MySQL 5배, PostgreSQL 3배 |
| **확장성** | 수동 | 수직 확장 쉬움 | 수직/수평 확장 쉬움 |
| **백업/복구** | 직접 구현 | 자동화 | 자동화 + 빠른 복구 |
| **권장 상황** | 학습/테스트 | 중소규모 프로덕션 | 대규모 프로덕션 |

### Aurora 세부 옵션 비교

Aurora를 선택했다면, 워크로드에 맞는 구성을 선택한다.

| 항목 | Provisioned | + Read Replica | Serverless v2 |
|------|-------------|----------------|---------------|
| **구성** | Writer 단독 | Writer + Reader N대 | 자동 스케일링 |
| **비용** | 고정 | Reader 수에 비례 | 사용량 비례 |
| **읽기 확장** | 제한적 | 최대 15대 | 자동 |
| **트래픽 대응** | 수동 스케일링 | Reader 추가 | 자동 스케일링 |
| **권장 상황** | 안정적 트래픽 | 읽기 80% 이상 | 트래픽 변동 큼 |
| **월 비용 예시** | ~$250 | ~$700 (Reader 2대) | $50~400 (변동) |

### 스토리지 구조 비교

| 서비스 | 스토리지 | 과금 방식 |
|--------|----------|----------|
| **EC2 + Docker** | EBS (gp2, gp3 등) | 프로비저닝 크기 기준 |
| **RDS** | EBS (gp2, gp3, io1) | 프로비저닝 크기 기준 |
| **Aurora** | 자체 분산 스토리지 | 실제 사용량 기준 |

- **EC2/RDS**: 100GB를 프로비저닝하면 30GB만 써도 100GB 비용 청구
- **Aurora**: 실제 사용한 만큼만 과금, 10GB~128TB 자동 확장

```
Aurora 스토리지 특징:
- 3개 AZ에 6개 복제본 자동 저장 (고가용성 기본 제공)
- 미리 크기 지정 불필요 (자동 확장)
- 서울 리전: $0.12/GB/월
- I/O 비용 별도: 백만 요청당 $0.24

비용 예시 (100GB 기준):
- RDS (gp3): 100GB × $0.131 = $13.1/월 (고정)
- Aurora: 100GB × $0.12 = $12/월 + I/O 비용 (변동)
```

> Aurora Provisioned와 Serverless v2는 동일한 스토리지를 사용하므로 스토리지 비용 구조도 동일하다. 차이는 컴퓨팅(인스턴스 vs ACU) 비용뿐.

### I/O-Optimized 옵션

Aurora는 I/O 비용이 별도로 청구되는데, I/O가 많은 워크로드라면 I/O-Optimized 옵션이 유리할 수 있다.

| 옵션 | 스토리지 | I/O 비용 |
|------|----------|----------|
| **Standard** | $0.12/GB/월 | $0.24/백만 요청 |
| **I/O-Optimized** | $0.15/GB/월 | 무료 (포함) |

```
선택 기준:
- I/O 비용이 전체 Aurora 비용의 25% 미만 → Standard
- I/O 비용이 전체 Aurora 비용의 25% 이상 → I/O-Optimized

확인 방법:
- AWS Cost Explorer에서 Aurora I/O 비용 확인
- 또는 CloudWatch에서 VolumeReadIOPs, VolumeWriteIOPs 모니터링
```

---

## 옵션 1: EC2 + Docker DB

EC2 인스턴스에 Docker로 MySQL, PostgreSQL 등을 직접 운영하는 방식이다.

### 구성 예시

```yaml
# docker-compose.yml
version: '3.8'
services:
  mysql:
    image: mysql:8.0
    container_name: mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./my.cnf:/etc/mysql/conf.d/my.cnf
    command: --default-authentication-plugin=mysql_native_password

volumes:
  mysql_data:
```

### 장점

- **비용 절감**: RDS 대비 30-50% 저렴 (동일 스펙 기준)
- **완전한 제어권**: OS 레벨부터 DB 설정까지 모든 것을 제어
- **유연한 설정**: 커스텀 플러그인, 특수 설정 가능
- **멀티 서비스**: 하나의 EC2에 여러 컨테이너 운영 가능

### 단점

- **운영 부담**: 패치, 백업, 모니터링, 장애 대응 직접 수행
- **고가용성 구성 어려움**: Replication, Failover 직접 구현 필요
- **보안 책임**: 보안 패치, 암호화 직접 관리
- **장애 대응**: 새벽에 DB 죽으면 직접 대응해야 함

### 직접 구현해야 할 것들

```bash
# 1. 자동 백업 스크립트 (crontab)
0 3 * * * /home/ec2-user/scripts/mysql-backup.sh

# 2. 모니터링 (CloudWatch Agent 또는 Prometheus)
# 3. 로그 로테이션
# 4. 보안 패치 적용
# 5. 디스크 용량 관리
# 6. Replication 설정 (고가용성 필요시)
```

### 비용 예시 (서울 리전)

```
t3.medium (2 vCPU, 4GB) + 100GB gp3
- EC2: $0.052/시간 × 730시간 = ~$38/월
- EBS: 100GB × $0.096 = ~$10/월
- 총: ~$48/월
```

### 권장 상황

- 개발/테스트 환경
- 비용이 최우선인 스타트업 초기
- DB 튜닝/학습 목적
- 특수한 DB 설정이 필요한 경우

---

## 옵션 2: Amazon RDS

AWS가 관리하는 관계형 데이터베이스 서비스다.
MySQL, PostgreSQL, MariaDB, Oracle, SQL Server를 지원한다.

### 구성

![RDS.png](../../assets/AWS_DATABASE/RDS.png)

### 장점

- **자동화된 관리**: 패치, 백업, 모니터링 자동화
- **고가용성**: Multi-AZ 배포로 자동 장애 조치
- **보안**: 저장 데이터 암호화, IAM 통합
- **확장성**: 몇 번의 클릭으로 스펙 변경
- **Point-in-Time Recovery**: 특정 시점으로 복구 가능

### 단점

- **비용**: EC2 직접 운영 대비 1.5-2배
- **제한된 커스터마이징**: OS 접근 불가, 일부 설정 제한
- **벤더 종속**: AWS에 종속됨

### AWS가 해주는 것들

| 항목 | 설명 |
|------|------|
| **자동 백업** | 매일 스냅샷, 트랜잭션 로그 5분마다 |
| **패치 관리** | 마이너 버전 자동 업그레이드 |
| **모니터링** | CloudWatch 메트릭 자동 수집 |
| **장애 조치** | Multi-AZ 시 자동 Failover (60-120초) |
| **암호화** | KMS로 저장 데이터 암호화 |
| **스냅샷** | 수동/자동 스냅샷 지원 |

### 비용 예시 (서울 리전)

```
db.t3.medium (2 vCPU, 4GB) + 100GB gp2, Single-AZ
- 인스턴스: $0.073/시간 × 730시간 = ~$53/월
- 스토리지: 100GB × $0.131 = ~$13/월
- 총: ~$66/월

Multi-AZ 시:
- 인스턴스: $0.146/시간 × 730시간 = ~$107/월
- 스토리지: 100GB × $0.262 = ~$26/월
- 총: ~$133/월
```

### 주요 설정

```bash
# 파라미터 그룹 설정 예시
max_connections = 150
innodb_buffer_pool_size = {DBInstanceClassMemory*3/4}
slow_query_log = 1
long_query_time = 2
```

### 권장 상황

- 중소규모 프로덕션 환경
- 운영 인력이 제한적인 팀
- 안정성이 중요한 서비스
- 표준적인 RDBMS 사용 시

---

## 옵션 3: Amazon Aurora

AWS가 자체 개발한 클라우드 네이티브 데이터베이스다.
MySQL 및 PostgreSQL과 호환된다.

### 아키텍처

![Aurora.png](../../assets/AWS_DATABASE/Aurora.png)

### 장점

- **성능**: MySQL 대비 5배, PostgreSQL 대비 3배 빠름
- **고가용성**: 3개 AZ에 6개 복제본, 자동 복구
- **빠른 장애 조치**: 30초 이내 Failover
- **스토리지 자동 확장**: 10GB ~ 128TB 자동 확장
- **빠른 복제**: Read Replica 추가가 빠름
- **Backtrack**: 데이터베이스를 과거 시점으로 되감기

### 단점

- **비용**: RDS 대비 20-30% 비쌈
- **최소 비용**: 작은 워크로드에도 기본 비용 발생
- **복잡성**: 작은 프로젝트에는 오버스펙

### Aurora만의 기능

| 기능 | 설명 |
|------|------|
| **Aurora Serverless v2** | 자동 스케일링, 사용한 만큼 과금 |
| **Global Database** | 리전 간 1초 이내 복제 |
| **Backtrack** | 최대 72시간 전으로 되감기 |
| **Clone** | 몇 분 만에 전체 DB 복제 |
| **병렬 쿼리** | 스토리지 레이어에서 쿼리 처리 |

### 비용 예시 (서울 리전)

```
db.r6g.large (2 vCPU, 16GB) + 100GB 스토리지
- 인스턴스: $0.313/시간 × 730시간 = ~$229/월
- 스토리지: 100GB × $0.12 = ~$12/월
- I/O: 백만 요청당 $0.24 (사용량에 따라)
- 총: ~$250/월 (I/O 제외)

Aurora Serverless v2 (최소 0.5 ACU ~ 최대 16 ACU)
- ACU당: $0.12/시간
- 스토리지: 100GB × $0.12 = ~$12/월
- 최소 비용 (0.5 ACU 유지 시): ~$44/월 + 스토리지
```

### 권장 상황

- 대규모 트래픽 서비스
- 쓰기 위주 워크로드
- 높은 가용성이 필수인 서비스
- 안정적인 트래픽 패턴

---

## 옵션 4: Aurora + Read Replica

Aurora의 읽기 성능을 극대화하기 위해 Read Replica를 추가한 구성이다.
읽기 트래픽이 많은 서비스에 적합하다.

### 아키텍처

```
                    ┌─────────────────┐
                    │  Application    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  Writer  │   │  Reader  │   │  Reader  │
        │ Instance │   │ Replica 1│   │ Replica 2│
        └────┬─────┘   └────┬─────┘   └────┬─────┘
             │              │              │
             └──────────────┼──────────────┘
                            │
                    ┌───────▼───────┐
                    │ Aurora Shared │
                    │   Storage     │
                    │   (3 AZ)      │
                    └───────────────┘
```

### 장점

- **읽기 성능 극대화**: 최대 15개의 Read Replica 추가 가능
- **밀리초 단위 복제 지연**: 스토리지 레이어 공유로 빠른 동기화
- **자동 로드 밸런싱**: Reader Endpoint로 읽기 트래픽 자동 분산
- **빠른 Failover**: Reader가 Writer로 승격 시 30초 이내
- **비용 효율**: 읽기 확장이 쓰기 확장보다 저렴

### 단점

- **비용 증가**: Reader 인스턴스 추가당 비용 발생
- **복잡성 증가**: 애플리케이션에서 읽기/쓰기 엔드포인트 분리 필요
- **쓰기 성능 한계**: 쓰기는 여전히 단일 Writer에 의존

### 엔드포인트 구성

```yaml
# 애플리케이션 설정 예시
datasource:
  writer:
    url: jdbc:mysql://mydb.cluster-xxxx.ap-northeast-2.rds.amazonaws.com:3306/mydb
  reader:
    url: jdbc:mysql://mydb.cluster-ro-xxxx.ap-northeast-2.rds.amazonaws.com:3306/mydb
```

### 비용 예시 (서울 리전)

```
Writer: db.r6g.large (2 vCPU, 16GB)
Reader: db.r6g.large × 2

- Writer: $0.313/시간 × 730시간 = ~$229/월
- Reader: $0.313/시간 × 730시간 × 2 = ~$458/월
- 스토리지: 100GB × $0.12 = ~$12/월
- I/O: 사용량에 따라
- 총: ~$700/월 (I/O 제외)
```

### 권장 상황

- 읽기:쓰기 비율이 80:20 이상인 서비스
- 리포트/분석 쿼리가 많은 서비스
- API 조회 트래픽이 많은 서비스
- 캐시 미스 시에도 빠른 응답이 필요한 서비스

---

## 옵션 5: Aurora Serverless v2

사용량에 따라 자동으로 스케일링되는 서버리스 Aurora다.
트래픽 변동이 크거나 예측하기 어려운 서비스에 적합하다.

### 아키텍처

```
트래픽 낮음                        트래픽 높음
    │                                  │
    ▼                                  ▼
┌────────┐                      ┌────────────────┐
│ 0.5 ACU│  ──── 자동 확장 ────▶ │    128 ACU     │
└────────┘                      └────────────────┘
    │                                  │
    └──────────────┬───────────────────┘
                   │
           ┌───────▼───────┐
           │ Aurora Shared │
           │   Storage     │
           └───────────────┘

ACU (Aurora Capacity Unit) = 약 2GB 메모리
```

### 장점

- **자동 스케일링**: 0.5 ACU ~ 128 ACU 범위에서 자동 조절
- **초 단위 과금**: 사용한 ACU만큼만 비용 발생
- **빠른 스케일링**: 수 초 내에 용량 조절
- **운영 부담 최소화**: 인스턴스 크기 고민 불필요
- **Provisioned와 혼용**: Writer는 Provisioned, Reader는 Serverless 가능

### 단점

- **최소 비용 존재**: 0.5 ACU는 항상 유지 (완전 0원 불가)
- **콜드 스타트 없음**: v1과 달리 항상 웜 상태 유지
- **예측 가능한 트래픽에는 비효율**: 안정적 트래픽은 Provisioned가 저렴

### ACU란?

ACU(Aurora Capacity Unit)는 Serverless v2의 용량 단위다.
1 ACU = 약 2GB RAM + 비례하는 vCPU가 할당된다.

| ACU | 메모리 | 대응하는 Provisioned 인스턴스 |
|-----|--------|------------------------------|
| 0.5 | 1GB | db.t3.micro 미만 |
| 2 | 4GB | db.t3.medium (2 vCPU, 4GB) |
| 4 | 8GB | db.t3.large (2 vCPU, 8GB) |
| 8 | 16GB | db.r6g.large (2 vCPU, 16GB) |
| 16 | 32GB | db.r6g.xlarge (4 vCPU, 32GB) |
| 32 | 64GB | db.r6g.2xlarge (8 vCPU, 64GB) |

### ACU별 트래픽 감당 수준

단순 CRUD 기준 대략적인 추정치다. 실제 성능은 워크로드에 따라 크게 달라진다.

| ACU | 동시 연결 | 초당 쿼리 (QPS) | 서비스 규모 예시 |
|-----|----------|----------------|-----------------|
| 0.5 | ~50 | ~100 | 개발/테스트 환경 |
| 2 | ~200 | ~500 | 소규모 서비스, DAU 1천 미만 |
| 4 | ~400 | ~1,000 | 소규모 프로덕션, DAU 1~5천 |
| 8 | ~800 | ~3,000 | 중규모 서비스, DAU 1~5만 |
| 16 | ~1,500 | ~6,000 | 중대규모 서비스, DAU 5~20만 |
| 32 | ~3,000 | ~12,000 | 대규모 서비스, DAU 20만+ |

> ⚠️ 위 수치는 참고용이다. 쿼리 복잡도, 인덱스 최적화, 읽기/쓰기 비율에 따라 10배 이상 차이날 수 있다. 실제 운영 전 부하 테스트 필수.

### ACU 스케일링 설정

```
최소 ACU: 0.5 (약 1GB 메모리)
최대 ACU: 128 (약 256GB 메모리)

권장 설정:
- 개발/테스트: 0.5 ~ 4 ACU
- 소규모 프로덕션: 0.5 ~ 16 ACU
- 중규모 프로덕션: 2 ~ 32 ACU
- 대규모 프로덕션: 8 ~ 128 ACU
```

### 비용 예시 (서울 리전)

```
ACU당: $0.12/시간

시나리오 1: 야간에 트래픽 거의 없음
- 주간 (12시간): 평균 8 ACU × $0.12 × 12 = $11.52/일
- 야간 (12시간): 평균 0.5 ACU × $0.12 × 12 = $0.72/일
- 월간: ~$367/월 + 스토리지

시나리오 2: 이벤트성 트래픽
- 평소: 2 ACU × $0.12 × 700시간 = $168/월
- 이벤트 (30시간): 32 ACU × $0.12 × 30 = $115/월
- 월간: ~$283/월 + 스토리지

vs Provisioned (항상 db.r6g.xlarge 유지)
- $0.626/시간 × 730시간 = ~$457/월
```

### Provisioned와 혼용 구성

```
Writer: Provisioned (db.r6g.large) - 안정적인 쓰기 처리
Reader: Serverless v2 (0.5 ~ 16 ACU) - 읽기 트래픽에 따라 자동 확장

이점:
- 쓰기 성능 보장
- 읽기 비용 최적화
- 피크 트래픽 대응
```

### 권장 상황

- 트래픽 변동이 큰 서비스 (주간/야간, 평일/주말 차이)
- 이벤트성 트래픽이 있는 서비스
- 신규 서비스 (트래픽 예측 어려움)
- 개발/테스트 환경 (비용 최적화)
- B2B SaaS (고객사별 사용 패턴 다름)

---

## 상황별 선택 가이드

### 1. 비용이 최우선 (스타트업 초기)

```
추천: EC2 + Docker (또는 RDS Free Tier)

이유:
- 월 $50 이하로 운영 가능
- 트래픽이 낮은 초기에는 직접 운영 부담도 적음
- RDS Free Tier: db.t3.micro 750시간/월 무료 (12개월)
```

### 2. 적은 인력으로 안정적인 운영

```
추천: RDS (Multi-AZ)

이유:
- 자동 백업, 패치, 장애 조치
- 야간/주말 장애 대응 부담 없음
- 운영 인력 1명으로도 관리 가능
```

### 3. 읽기 트래픽이 많은 서비스

```
추천: Aurora + Read Replica

이유:
- Read Replica 15개까지 추가 가능
- 밀리초 단위 복제 지연 (스토리지 공유)
- Reader Endpoint로 자동 로드 밸런싱
- 읽기:쓰기 = 80:20 이상이면 효과적

구성 예시:
- Writer 1대 + Reader 2대로 시작
- 트래픽 증가 시 Reader 추가
```

### 4. 트래픽 변동이 큰 서비스

```
추천: Aurora Serverless v2

이유:
- 0.5 ACU ~ 최대 128 ACU 자동 스케일링
- 트래픽 없을 때 최소 비용만 발생
- 초 단위 과금
- 인스턴스 크기 고민 불필요

적합한 케이스:
- 주간/야간 트래픽 차이가 큼
- 이벤트성 트래픽 발생
- 신규 서비스 (트래픽 예측 어려움)
```

### 5. 읽기 트래픽 많고 + 변동도 큰 서비스

```
추천: Aurora Provisioned (Writer) + Serverless v2 (Reader)

이유:
- Writer: 안정적인 쓰기 성능 보장
- Reader: 트래픽에 따라 자동 스케일링
- 피크 타임에만 비용 증가
- 최적의 비용 대비 성능
```

### 6. 글로벌 서비스

```
추천: Aurora Global Database

이유:
- 최대 5개 리전에 Read Replica
- 리전 간 1초 이내 복제
- 리전 장애 시 자동 Failover
```

### 7. 개발/테스트 환경

```
추천: EC2 + Docker 또는 RDS (Single-AZ)

이유:
- 비용 절감
- 고가용성 불필요
- 빠른 생성/삭제
```

---

## 의사결정 플로우차트

```
시작
  │
  ▼
프로덕션 환경인가? ─── No ──▶ EC2 + Docker 또는 RDS Single-AZ
  │
 Yes
  │
  ▼
월 예산 $100 이하인가? ─── Yes ──▶ RDS Single-AZ
  │
 No
  │
  ▼
고가용성 필수인가? ─── No ──▶ RDS Single-AZ
  │
 Yes
  │
  ▼
트래픽 변동이 큰가? ─── Yes ──┬──▶ 읽기 많은가? ─── Yes ──▶ Provisioned + Serverless v2 혼용
  │                          │
 No                          └── No ──▶ Aurora Serverless v2
  │
  ▼
읽기 트래픽이 많은가? ─── Yes ──▶ Aurora + Read Replica
  │
 No
  │
  ▼
대규모 트래픽인가? ─── Yes ──▶ Aurora (Provisioned)
  │
 No
  │
  ▼
RDS Multi-AZ
```

---

## 마이그레이션 경로

### EC2 → RDS

```bash
# 1. mysqldump로 백업
mysqldump -h ec2-host -u user -p database > backup.sql

# 2. RDS 인스턴스 생성

# 3. RDS로 복원
mysql -h rds-endpoint -u user -p database < backup.sql

# 또는 AWS DMS 사용 (다운타임 최소화)
```

### RDS → Aurora

```
1. RDS 스냅샷 생성
2. 스냅샷에서 Aurora 클러스터 복원 (콘솔에서 가능)
3. 애플리케이션 엔드포인트 변경
```

### Aurora로 직접 마이그레이션

```bash
# AWS DMS 사용 (권장)
# - 온라인 마이그레이션
# - 다운타임 최소화
# - CDC로 실시간 복제 후 전환
```

---

## 비용 최적화 팁

### EC2 + Docker

```
✅ Spot Instance 활용 (개발/테스트)
✅ Reserved Instance (1년/3년)
✅ GP3 스토리지 사용 (GP2 대비 20% 저렴)
✅ 불필요한 스냅샷 정리
```

### RDS

```
✅ Reserved Instance (1년: 30%, 3년: 50% 할인)
✅ 개발 환경은 Single-AZ
✅ 적절한 인스턴스 크기 선택
✅ Storage Auto Scaling 활성화
✅ Performance Insights로 최적화
```

### Aurora

```
✅ Reserved Instance (Provisioned 사용 시)
✅ Aurora Serverless v2 (변동 트래픽)
✅ I/O 최적화 스토리지 (I/O 비용 포함)
✅ 불필요한 Reader 인스턴스 정리
```

---

## 실무 체크리스트

### 보안

- [ ] VPC 내 프라이빗 서브넷에 배포
- [ ] 보안 그룹으로 접근 제한 (특정 IP/SG만 허용)
- [ ] 저장 데이터 암호화 활성화
- [ ] SSL/TLS 연결 강제
- [ ] IAM 인증 사용 고려 (RDS/Aurora)
- [ ] 민감 정보는 Secrets Manager에 저장

### 운영

- [ ] CloudWatch 알람 설정 (CPU, 메모리, 연결 수, 스토리지)
- [ ] 느린 쿼리 로그 활성화
- [ ] 백업 보관 기간 설정 (최소 7일)
- [ ] 유지 관리 기간 설정 (트래픽 낮은 시간대)
- [ ] 파라미터 그룹 튜닝

### 비용

- [ ] 인스턴스 크기 적절성 검토 (월 1회)
- [ ] Reserved Instance 검토 (안정적 워크로드)
- [ ] 개발/테스트 환경 야간 중지 고려
- [ ] 불필요한 스냅샷 정리

---

## 정리

| 상황 | 추천 |
|------|------|
| 학습/테스트 | EC2 + Docker |
| 스타트업 초기 | RDS Single-AZ (Free Tier) |
| 소규모 프로덕션 | RDS Single-AZ |
| 중규모 프로덕션 | RDS Multi-AZ |
| 대규모 프로덕션 | Aurora (Provisioned) |
| 읽기 트래픽 많음 | Aurora + Read Replica |
| 트래픽 변동 큼 | Aurora Serverless v2 |
| 읽기 많음 + 변동 큼 | Provisioned + Serverless v2 혼용 |
| 글로벌 서비스 | Aurora Global Database |

**EC2 + Docker**: 직접 관리할 시간과 역량이 있고, 비용이 최우선일 때

**RDS**: 관리 부담을 줄이고 싶고, 적절한 비용으로 안정성을 원할 때

**Aurora (Provisioned)**: 최고의 성능과 가용성이 필요하고, 트래픽이 안정적일 때

**Aurora + Read Replica**: 읽기 트래픽이 쓰기보다 훨씬 많을 때

**Aurora Serverless v2**: 트래픽 예측이 어렵거나 변동이 클 때

결국 정답은 없다. 팀의 역량, 예산, 서비스 요구사항에 맞게 선택하면 된다.
처음에는 RDS로 시작해서, 트래픽이 늘면 Aurora로 마이그레이션하는 것도 좋은 전략이다.
Aurora 내에서도 Provisioned → Read Replica 추가 → Serverless 혼용 순으로 점진적 확장이 가능하다.

---

## 참고: 다른 클라우드 플랫폼 비교

AWS 외에 Azure, GCP를 고려한다면 아래 대응 서비스를 참고하자.

| 유형 | AWS | Azure | GCP |
|------|-----|-------|-----|
| **관리형 RDBMS** | RDS | Azure SQL Database | Cloud SQL |
| **클라우드 네이티브** | Aurora | Azure SQL Hyperscale | AlloyDB |
| **서버리스** | Aurora Serverless | Azure SQL Serverless | Cloud SQL (자동 스토리지) |
| **글로벌 분산** | Aurora Global Database | Azure Cosmos DB | Cloud Spanner |
| **MySQL 호환** | RDS MySQL, Aurora MySQL | Azure Database for MySQL | Cloud SQL for MySQL |
| **PostgreSQL 호환** | RDS PostgreSQL, Aurora PostgreSQL | Azure Database for PostgreSQL | Cloud SQL for PostgreSQL, AlloyDB |

### 플랫폼별 특징

- **Azure**: 기존 SQL Server 사용자에게 친숙, Microsoft 생태계와 통합 우수
- **GCP**: BigQuery 연동이 강점, AlloyDB는 PostgreSQL 호환 고성능 DB
- **AWS**: 가장 다양한 옵션, Aurora의 성능/가용성이 강점

> 💡 이미 사용 중인 클라우드가 있다면 해당 플랫폼의 관리형 DB를 사용하는 것이 운영 효율성 면에서 유리하다.
