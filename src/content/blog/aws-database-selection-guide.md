---
title: "AWS 데이터베이스 선택 가이드: EC2+Docker vs RDS vs Aurora"
description: "EC2에 Docker로 DB 직접 운영, RDS, Aurora 중 어떤 것을 선택해야 할까? 비용, 성능, 운영 부담 관점에서 상세 비교"
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

AWS에서 데이터베이스를 운영할 때 크게 세 가지 선택지가 있다.

1. **EC2 + Docker**: 직접 DB 설치 및 운영
2. **RDS**: AWS 관리형 관계형 데이터베이스
3. **Aurora**: AWS 자체 개발 클라우드 네이티브 DB

"RDS가 편하다는데 비싸지 않나?", "Aurora는 언제 쓰는 거지?", "EC2에 Docker로 띄우면 안 되나?"

이런 고민을 하고 있다면 이 글이 도움이 될 것이다.

---

## 한눈에 보는 비교

| 항목 | EC2 + Docker | RDS | Aurora |
|------|-------------|-----|--------|
| **관리 주체** | 직접 관리 | AWS 관리 | AWS 관리 |
| **초기 비용** | 낮음 | 중간 | 높음 |
| **운영 비용** | 인건비 높음 | 중간 | 중간 |
| **가용성** | 직접 구성 | Multi-AZ 옵션 | 기본 3 AZ 복제 |
| **성능** | 인스턴스 의존 | 인스턴스 의존 | MySQL 5배, PostgreSQL 3배 |
| **확장성** | 수동 | 수직 확장 쉬움 | 수직/수평 확장 쉬움 |
| **백업/복구** | 직접 구현 | 자동화 | 자동화 + 빠른 복구 |
| **권장 상황** | 학습/테스트 | 중소규모 프로덕션 | 대규모 프로덕션 |

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

```
┌─────────────────────────────────────────────────────┐
│                    RDS Instance                      │
│  ┌─────────────┐    ┌─────────────┐                │
│  │   Primary   │───▶│   Standby   │  (Multi-AZ)    │
│  │    (AZ-a)   │    │   (AZ-c)    │                │
│  └─────────────┘    └─────────────┘                │
│         │                                           │
│         ▼                                           │
│  ┌─────────────┐                                   │
│  │ Read Replica│  (선택)                           │
│  └─────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

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

```
┌──────────────────────────────────────────────────────────────┐
│                      Aurora Cluster                          │
│                                                              │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐                   │
│   │ Writer  │   │ Reader  │   │ Reader  │   (인스턴스)      │
│   │Instance │   │Instance │   │Instance │                   │
│   └────┬────┘   └────┬────┘   └────┬────┘                   │
│        │             │             │                         │
│        └─────────────┴─────────────┘                         │
│                      │                                       │
│   ┌──────────────────┴───────────────────┐                  │
│   │         Cluster Volume               │                  │
│   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │                  │
│   │  │ AZ-a│ │ AZ-a│ │ AZ-c│ │ AZ-c│    │  6 복제본        │
│   │  └─────┘ └─────┘ └─────┘ └─────┘    │  (3 AZ × 2)      │
│   │  ┌─────┐ ┌─────┐                    │                  │
│   │  │ AZ-d│ │ AZ-d│                    │                  │
│   │  └─────┘ └─────┘                    │                  │
│   └──────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

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
- 읽기 부하가 높은 서비스
- 글로벌 서비스 (Global Database 활용)
- 높은 가용성이 필수인 서비스
- 트래픽 변동이 큰 서비스 (Serverless v2)

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
- 빠른 복제 (밀리초 단위 지연)
- 자동 로드 밸런싱
```

### 4. 트래픽 변동이 큰 서비스

```
추천: Aurora Serverless v2

이유:
- 0.5 ACU ~ 최대 128 ACU 자동 스케일링
- 트래픽 없을 때 최소 비용만 발생
- 초 단위 과금
```

### 5. 글로벌 서비스

```
추천: Aurora Global Database

이유:
- 최대 5개 리전에 Read Replica
- 리전 간 1초 이내 복제
- 리전 장애 시 자동 Failover
```

### 6. 개발/테스트 환경

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
읽기 트래픽이 많은가? ─── No ──▶ RDS Multi-AZ
  │
 Yes
  │
  ▼
트래픽 변동이 큰가? ─── No ──▶ Aurora (Provisioned)
  │
 Yes
  │
  ▼
Aurora Serverless v2
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
| 대규모 프로덕션 | Aurora |
| 읽기 트래픽 많음 | Aurora + Read Replica |
| 트래픽 변동 큼 | Aurora Serverless v2 |
| 글로벌 서비스 | Aurora Global Database |

**EC2 + Docker**: 직접 관리할 시간과 역량이 있고, 비용이 최우선일 때

**RDS**: 관리 부담을 줄이고 싶고, 적절한 비용으로 안정성을 원할 때

**Aurora**: 최고의 성능과 가용성이 필요하고, 비용보다 안정성이 중요할 때

결국 정답은 없다. 팀의 역량, 예산, 서비스 요구사항에 맞게 선택하면 된다.
처음에는 RDS로 시작해서, 트래픽이 늘면 Aurora로 마이그레이션하는 것도 좋은 전략이다.
