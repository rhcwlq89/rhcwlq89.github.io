---
title: "AWS EC2 가이드"
description: "EC2 인스턴스의 기본 개념부터 실무 운영까지 완벽 가이드"
pubDate: 2026-02-02T10:00:00+09:00
tags:
  [
    "AWS",
    "EC2",
    "Cloud",
    "Infrastructure",
    "DevOps",
  ]
heroImage: "../../assets/AWS_EC2_GUIDE/AwsEc2Guide.png"
---

## 서론

AWS EC2(Elastic Compute Cloud)는 AWS의 핵심 컴퓨팅 서비스다.
클라우드에서 가상 서버를 생성하고 관리할 수 있으며,
필요에 따라 몇 분 만에 수천 대의 서버를 프로비저닝할 수 있다.

이 글에서는 EC2의 기본 개념부터 인스턴스 선택, 스토리지, 네트워킹,
보안, 비용 최적화, 그리고 실무 운영 노하우까지 다룬다.

---

## EC2 기본 아키텍처

### EC2 구성 요소

EC2 인스턴스는 다음 요소들로 구성된다.

![EC2_Instance.png](../../assets/AWS_EC2_GUIDE/EC2_Instance.png)


### 인스턴스 생명주기

```
pending → running ⇄ stopping → stopped
                 ↓
            shutting-down → terminated
```

| 상태 | 설명 | 과금 |
|------|------|------|
| `pending` | 인스턴스 시작 준비 중 | X |
| `running` | 실행 중 | O |
| `stopping` | 중지 중 | X |
| `stopped` | 중지됨 (EBS만 과금) | △ |
| `shutting-down` | 종료 중 | X |
| `terminated` | 완전 삭제됨 | X |

> **중요**: `stopped` 상태에서는 인스턴스 비용은 없지만 **EBS 볼륨 비용**은 계속 발생한다.

---

## Region & Availability Zone

### AWS 글로벌 인프라 구조

![AWS_Global_Infrastructure.png](../../assets/AWS_EC2_GUIDE/AWS_Global_Infrastructure.png)


### Region (리전)

리전은 지리적으로 분리된 AWS 인프라 영역이다.

| 리전 코드 | 위치 | 특징 |
|-----------|------|------|
| `ap-northeast-2` | 서울 | 한국 서비스 기본 |
| `ap-northeast-1` | 도쿄 | 아시아 태평양 허브 |
| `us-east-1` | 버지니아 | AWS 최초 리전, 가장 많은 서비스 |
| `eu-west-1` | 아일랜드 | 유럽 허브 |

**리전 선택 기준**:
```
1. 지연 시간 (Latency)
   → 사용자와 가까운 리전 선택
   → 한국 사용자 대상이면 ap-northeast-2

2. 규정 준수 (Compliance)
   → 데이터 주권 요구사항 확인
   → 금융권은 국내 데이터 저장 의무

3. 서비스 가용성
   → 일부 서비스는 특정 리전에서만 제공
   → us-east-1이 가장 먼저 새 서비스 출시

4. 비용
   → 리전마다 가격 차이 존재
   → 일반적으로 us-east-1이 가장 저렴
```

### Availability Zone (가용 영역)

AZ는 리전 내 물리적으로 분리된 데이터센터 그룹이다.

```
서울 리전 (ap-northeast-2)의 AZ:
├── ap-northeast-2a
├── ap-northeast-2b
├── ap-northeast-2c
└── ap-northeast-2d
```

**AZ 특징**:
- 각 AZ는 독립된 전력, 냉각, 네트워크
- AZ 간 지연 시간: 1ms 이하
- AZ 장애가 다른 AZ에 영향 없음
- 동일 리전 내 AZ 간 데이터 전송 비용 발생

**AZ ID vs AZ Name**:
```bash
# AZ Name은 계정마다 매핑이 다를 수 있음
# 계정 A의 ap-northeast-2a ≠ 계정 B의 ap-northeast-2a

# AZ ID는 물리적 위치를 나타냄 (계정 간 일관성)
aws ec2 describe-availability-zones \
  --query 'AvailabilityZones[*].[ZoneName,ZoneId]' \
  --output table

# 결과 예시:
# ap-northeast-2a  |  apne2-az1
# ap-northeast-2b  |  apne2-az2
# ap-northeast-2c  |  apne2-az3
```

### 다중 AZ 아키텍처

**고가용성을 위한 다중 AZ 배치**:

![Region.png](../../assets/AWS_EC2_GUIDE/Region.png)

**다중 AZ 설계 원칙**:
```
1. 최소 2개 AZ에 리소스 분산
2. 로드 밸런서로 트래픽 분산
3. Auto Scaling으로 AZ 간 균등 배포
4. 데이터베이스도 Multi-AZ 구성
5. AZ 장애 시 자동 페일오버
```

### 리전 간 아키텍처

**글로벌 서비스를 위한 멀티 리전**:

```bash
# 리전 간 VPC 피어링
aws ec2 create-vpc-peering-connection \
  --vpc-id vpc-seoul \
  --peer-vpc-id vpc-tokyo \
  --peer-region ap-northeast-1

# AMI를 다른 리전으로 복사
aws ec2 copy-image \
  --source-region ap-northeast-2 \
  --source-image-id ami-xxx \
  --region ap-northeast-1 \
  --name "my-ami-tokyo"

# 스냅샷을 다른 리전으로 복사 (DR용)
aws ec2 copy-snapshot \
  --source-region ap-northeast-2 \
  --source-snapshot-id snap-xxx \
  --destination-region ap-northeast-1
```

---

## AMI (Amazon Machine Image)

### AMI란?

AMI는 인스턴스를 시작하는 데 필요한 모든 정보를 담은 템플릿이다.

```
AMI = OS + 소프트웨어 + 설정 + 권한 정보
```

### AMI 유형

| 유형 | 설명 | 예시 |
|------|------|------|
| **AWS 제공** | AWS가 관리하는 공식 이미지 | Amazon Linux 2023, Ubuntu |
| **마켓플레이스** | 벤더가 제공하는 이미지 | WordPress, Jenkins |
| **커뮤니티** | 커뮤니티가 공유한 이미지 | 다양한 오픈소스 |
| **커스텀** | 직접 생성한 이미지 | 자체 구성 서버 |

### Amazon Linux vs Ubuntu

실무에서 가장 많이 사용하는 두 가지를 비교한다.

**Amazon Linux 2023**
```
장점:
- AWS 서비스와 최적화된 통합
- 기본 AWS CLI, SSM Agent 포함
- 장기 지원 (LTS)
- AWS 최적화 커널

단점:
- RHEL/CentOS 계열이라 Ubuntu에 익숙하면 학습 필요
- 일부 패키지가 yum/dnf에 없을 수 있음
```

> **yum/dnf란?**
> RHEL/CentOS/Amazon Linux 계열에서 사용하는 패키지 관리자다.
> Ubuntu의 `apt`와 같은 역할로, 소프트웨어 설치/업데이트/삭제를 관리한다.
> - `yum`: 기존 패키지 관리자 (Amazon Linux 2까지 사용)
> - `dnf`: 차세대 패키지 관리자 (Amazon Linux 2023부터 기본)
> - 예: `sudo dnf install nginx`, `sudo yum update`

**Ubuntu**
```
장점:
- 풍부한 커뮤니티와 문서
- 최신 패키지 지원
- 개발자에게 친숙함
- apt 패키지 관리자로 쉬운 소프트웨어 설치

단점:
- AWS 최적화가 Amazon Linux보다 부족
- 일부 AWS 기능 사용 시 추가 설정 필요
```

> **apt란?**
> Debian/Ubuntu 계열에서 사용하는 패키지 관리자다.
> - 예: `sudo apt install nginx`, `sudo apt update`

### 커스텀 AMI 생성

배포 속도를 높이려면 커스텀 AMI를 만들어 사용한다.

```bash
# 1. 기존 인스턴스에서 AMI 생성
aws ec2 create-image \
  --instance-id i-0123456789abcdef0 \
  --name "my-app-v1.0.0" \
  --description "Production ready app server" \
  --no-reboot

# 2. AMI 조회
aws ec2 describe-images \
  --owners self \
  --query 'Images[*].[ImageId,Name,CreationDate]' \
  --output table
```

**AMI 생성 모범 사례**:
- 버전 정보를 이름에 포함 (예: `my-app-v1.0.0-2024-01-15`)
- 불필요한 로그, 캐시 정리 후 생성
- `--no-reboot` 사용 시 파일 시스템 일관성 주의
- 정기적으로 오래된 AMI 삭제

---

## EC2 인스턴스 타입 상세

### 네이밍 규칙

```
[패밀리][세대][추가속성].[사이즈]

예: m7g.2xlarge
    │││  └── 사이즈: 2xlarge
    ││└── 추가속성: g (Graviton)
    │└── 세대: 7
    └── 패밀리: m (범용)
```

### 추가 속성 (Processor & Features)

인스턴스 이름의 세대 뒤에 붙는 문자는 프로세서 종류와 추가 기능을 나타낸다.

#### 프로세서 속성

| 속성 | 의미 | 설명 | 예시 |
|------|------|------|------|
| **i** | Intel | Intel Xeon 프로세서 | m6i, c6i, r6i |
| **a** | AMD | AMD EPYC 프로세서 (Intel 대비 ~10% 저렴) | m6a, c6a, r6a |
| **g** | Graviton | AWS 자체 ARM 프로세서 (최대 40% 저렴) | m7g, c7g, r7g |

```
가격 비교 (동일 사양 기준):
┌─────────────────────────────────────────────────────┐
│  m6i.large (Intel)   ████████████████████  $0.096  │
│  m6a.large (AMD)     █████████████████     $0.086  │
│  m7g.large (Graviton)████████████          $0.082  │
└─────────────────────────────────────────────────────┘

선택 기준:
- Intel (i): 호환성이 가장 좋음, 레거시 앱에 안전
- AMD (a): Intel과 유사한 호환성, 비용 절감
- Graviton (g): 가성비 최고, ARM 호환 필요
```

#### 기능 속성

| 속성 | 의미 | 설명 | 예시 |
|------|------|------|------|
| **d** | NVMe SSD | 로컬 인스턴스 스토리지 포함 | m6id, c6id, r6id |
| **n** | Network | 네트워크 최적화 (최대 200 Gbps) | m5n, c5n, r5n |
| **z** | High Frequency | 높은 CPU 클럭 (최대 4.5 GHz) | m5zn |
| **e** | Extra Memory | 추가 메모리 (표준 대비 2배) | r6i**e**n |
| **flex** | Flexible | 다양한 프로세서 혼합 사용 | m7i-flex |

#### 속성 조합 예시

```
m6i.large      → M 시리즈, 6세대, Intel
m6a.large      → M 시리즈, 6세대, AMD
m7g.large      → M 시리즈, 7세대, Graviton (ARM)
m6id.large     → M 시리즈, 6세대, Intel + NVMe SSD
m5n.large      → M 시리즈, 5세대, 네트워크 최적화
m5zn.large     → M 시리즈, 5세대, 고주파수 + 네트워크
c6in.large     → C 시리즈, 6세대, Intel + 네트워크 최적화
r6idn.large    → R 시리즈, 6세대, Intel + NVMe + 네트워크
```

#### 프로세서별 상세 비교

**Intel (i) 인스턴스**:
```
프로세서: Intel Xeon Scalable (Ice Lake, Sapphire Rapids)
장점:
- 가장 넓은 소프트웨어 호환성
- AVX-512 명령어 지원 (과학 계산, ML)
- 안정적이고 검증된 성능

사용 사례:
- 레거시 애플리케이션
- Windows 워크로드
- x86 전용 소프트웨어
- 라이센스가 특정 프로세서에 묶인 경우
```

**AMD (a) 인스턴스**:
```
프로세서: AMD EPYC (Milan, Genoa)
장점:
- Intel 대비 약 10% 저렴
- 높은 코어 수 (대규모 병렬 처리에 유리)
- 대부분의 Linux 워크로드 호환

사용 사례:
- 비용 민감한 워크로드
- 컨테이너/마이크로서비스
- 배치 처리
- 웹 서버

주의:
- 일부 Intel 최적화 라이브러리 성능 차이 가능
- Windows 라이센스 정책 확인 필요
```

**Graviton (g) 인스턴스**:
```
프로세서: AWS Graviton2/Graviton3 (ARM 기반)
장점:
- 최대 40% 저렴한 비용
- 최대 60% 더 나은 에너지 효율
- 높은 성능/와트 비율
- AWS가 직접 설계하여 AWS 환경에 최적화

사용 사례:
- 컨테이너 워크로드 (Docker, Kubernetes)
- 웹 서버 (Nginx, Apache)
- 마이크로서비스
- 오픈소스 데이터베이스 (MySQL, PostgreSQL)
- Java, Python, Node.js 애플리케이션

주의:
- x86 전용 바이너리 실행 불가
- 일부 상용 소프트웨어 미지원
- Docker 이미지 ARM64 버전 필요
```

#### Graviton 호환성 확인 방법

```bash
# 1. Docker 이미지 아키텍처 확인
docker manifest inspect nginx:latest | grep architecture
# 결과에 "arm64"가 있으면 Graviton 호환

# 2. 패키지 ARM 지원 확인 (Amazon Linux)
dnf search <package-name> --forcearch aarch64

# 3. Java 애플리케이션
# OpenJDK는 ARM64 지원, Oracle JDK는 버전 확인 필요
java -version
# aarch64가 표시되면 ARM 버전

# 4. Node.js
# v16 이상은 ARM64 완벽 지원
node -p "process.arch"
# arm64 출력 확인
```

#### 인스턴스 타입 선택 플로우

```
┌─────────────────────────────────────────────────────────────┐
│               인스턴스 프로세서 선택 가이드                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ARM64 (Graviton) 호환 가능한가?                             │
│       │                                                      │
│       ├── Yes ──→ Graviton (g) 선택 (가성비 최고)           │
│       │           예: m7g, c7g, r7g                          │
│       │                                                      │
│       └── No ──→ Intel 전용 기능이 필요한가?                │
│                       │                                      │
│                       ├── Yes ──→ Intel (i) 선택            │
│                       │           예: m6i, c6i, r6i          │
│                       │                                      │
│                       └── No ──→ AMD (a) 선택 (비용 절감)   │
│                                   예: m6a, c6a, r6a          │
│                                                              │
│  추가 기능 필요 시:                                          │
│  ├── 빠른 로컬 스토리지 ──→ d 추가 (예: m6id)               │
│  ├── 고성능 네트워크 ──→ n 추가 (예: c5n)                   │
│  └── 높은 CPU 클럭 ──→ z 추가 (예: m5zn)                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 패밀리별 상세 분석

#### M 시리즈 (범용)

```
CPU : Memory = 1 : 4 비율
예: m6i.large = 2 vCPU, 8 GiB Memory
```

| 인스턴스 | vCPU | 메모리 | 네트워크 | 가격(서울, 시간당) |
|---------|------|--------|----------|-------------------|
| m6i.large | 2 | 8 GiB | 최대 12.5 Gbps | ~$0.096 |
| m6i.xlarge | 4 | 16 GiB | 최대 12.5 Gbps | ~$0.192 |
| m6i.2xlarge | 8 | 32 GiB | 최대 12.5 Gbps | ~$0.384 |
| m7g.large | 2 | 8 GiB | 최대 12.5 Gbps | ~$0.082 |

**사용 사례**:
- 웹 서버, API 서버
- 소규모~중규모 데이터베이스
- 개발/테스트 환경
- 엔터프라이즈 애플리케이션

#### C 시리즈 (컴퓨팅 최적화)

```
CPU : Memory = 1 : 2 비율
예: c6i.large = 2 vCPU, 4 GiB Memory
고성능 Intel/AMD/Graviton 프로세서
```

| 인스턴스 | vCPU | 메모리 | 특징 |
|---------|------|--------|------|
| c6i.large | 2 | 4 GiB | Intel Ice Lake |
| c6a.large | 2 | 4 GiB | AMD EPYC (더 저렴) |
| c7g.large | 2 | 4 GiB | Graviton3 (가성비 최고) |

**사용 사례**:
- 배치 처리
- 미디어 트랜스코딩
- 고성능 웹 서버
- 과학 모델링
- 게임 서버

#### R 시리즈 (메모리 최적화)

```
CPU : Memory = 1 : 8 비율
예: r6i.large = 2 vCPU, 16 GiB Memory
```

**사용 사례**:
- 인메모리 데이터베이스 (Redis, Memcached)
- 실시간 빅데이터 분석
- 고성능 관계형 데이터베이스
- 인메모리 캐싱

#### T 시리즈 (버스트 가능)

T 시리즈는 **CPU 크레딧** 방식으로 작동한다.

![EC2_T.png](../../assets/AWS_EC2_GUIDE/EC2_T.png)


| 인스턴스 | 베이스라인 | 크레딧/시간 | 최대 크레딧 |
|---------|-----------|------------|------------|
| t3.micro | 10% | 6 | 144 |
| t3.small | 20% | 12 | 288 |
| t3.medium | 20% | 24 | 576 |
| t3.large | 30% | 36 | 864 |

**Unlimited 모드**:
```bash
# T 인스턴스를 unlimited 모드로 변경
aws ec2 modify-instance-credit-specification \
  --instance-credit-specification "InstanceId=i-xxx,CpuCredits=unlimited"
```

> **주의**: Unlimited 모드에서 크레딧 초과 사용 시 추가 비용 발생

**T 시리즈 선택 기준**:
```
평균 CPU 사용률 < 20% → T 시리즈 적합
평균 CPU 사용률 > 40% → M/C 시리즈가 더 효율적
```

#### I 시리즈 (스토리지 최적화)

로컬 NVMe SSD가 포함된 인스턴스다.

```
i3.xlarge: 1 x 950 GB NVMe SSD
i3.2xlarge: 1 x 1900 GB NVMe SSD
i3.4xlarge: 2 x 1900 GB NVMe SSD
```

**특징**:
- 로컬 스토리지는 인스턴스 중지/종료 시 **데이터 손실**
- 매우 빠른 I/O (수십만 IOPS)
- EBS보다 지연 시간이 낮음

**사용 사례**:
- Elasticsearch, OpenSearch
- Kafka
- Cassandra, ScyllaDB
- 로그 분석 시스템

#### G/P 시리즈 (GPU)

| 시리즈 | GPU | 용도 |
|-------|-----|------|
| p4d | NVIDIA A100 | 대규모 ML 학습 |
| p3 | NVIDIA V100 | ML 학습 |
| g5 | NVIDIA A10G | 추론, 그래픽 |
| g4dn | NVIDIA T4 | 추론, 소규모 학습 |
| inf1 | AWS Inferentia | 추론 전용 (저비용) |

### 세대별 변화

최신 세대로 갈수록 성능과 가격 효율이 개선된다.

```
m5 → m6i: 약 15% 성능 향상, 비슷한 가격
m6i → m7i: 약 15% 성능 향상, 비슷한 가격

결론: 같은 가격에 매 세대 15%씩 성능 향상
      = 구세대 유지 시 매년 10-15% 비용 낭비
```

### Graviton (ARM) 인스턴스

AWS 자체 설계 ARM 프로세서로, 가성비가 뛰어나다.

```
Intel/AMD 대비:
- 최대 40% 저렴
- 최대 60% 더 나은 에너지 효율
- 대부분의 Linux 워크로드 호환
```

**Graviton 호환성 확인**:
```bash
# Docker 이미지가 ARM을 지원하는지 확인
docker manifest inspect nginx:latest | grep architecture

# 결과에 "arm64"가 있으면 Graviton에서 실행 가능
```

**Graviton 마이그레이션 체크리스트**:
- [ ] 애플리케이션이 ARM64 지원하는지 확인
- [ ] 의존성 라이브러리 ARM64 호환 확인
- [ ] Docker 이미지 multi-arch 지원 확인
- [ ] 테스트 환경에서 성능 검증
- [ ] 점진적 마이그레이션 (Canary 배포)

---

## EBS (Elastic Block Store) 상세

EBS는 EC2에 연결되는 **블록 스토리지**다.
인스턴스의 루트 볼륨 및 추가 데이터 볼륨으로 사용된다.

### EBS vs Instance Store

| 구분 | EBS | Instance Store |
|------|-----|----------------|
| **지속성** | 인스턴스와 독립 | 인스턴스 종료 시 삭제 |
| **크기** | 최대 64TB | 인스턴스 타입에 따라 고정 |
| **성능** | 볼륨 타입에 따라 | 매우 빠름 (NVMe) |
| **스냅샷** | 지원 | 미지원 |
| **비용** | 별도 과금 | 인스턴스 비용에 포함 |
| **용도** | 영구 데이터 | 캐시, 임시 데이터 |

### EBS 볼륨 타입 상세

| 타입 | 용도 | 최대 IOPS | 최대 처리량 | 가격 (GB/월) |
|------|------|----------|------------|--------------|
| **gp3** | 범용 SSD | 16,000 | 1,000 MB/s | ~$0.08 |
| **gp2** | 범용 SSD (구형) | 16,000 | 250 MB/s | ~$0.10 |
| **io2** | 고성능 SSD | 256,000 | 4,000 MB/s | ~$0.125 |
| **io2 Block Express** | 초고성능 SSD | 256,000 | 4,000 MB/s | ~$0.125 |
| **st1** | 처리량 최적화 HDD | 500 | 500 MB/s | ~$0.045 |
| **sc1** | 콜드 HDD | 250 | 250 MB/s | ~$0.025 |

#### 볼륨 타입별 상세

**gp3 (General Purpose SSD)**:
```
기본 성능:
- IOPS: 3,000 (무료)
- 처리량: 125 MB/s (무료)

추가 프로비저닝 (별도 비용):
- IOPS: 최대 16,000 (3,000 초과분 과금)
- 처리량: 최대 1,000 MB/s (125 초과분 과금)

사용 사례:
- 부트 볼륨
- 일반 워크로드
- 개발/테스트 환경
```

**io2 (Provisioned IOPS SSD)**:
```
특징:
- IOPS를 직접 프로비저닝
- 99.999% 내구성 (gp3는 99.8~99.9%)
- Multi-Attach 지원

성능:
- IOPS: GB당 최대 500 IOPS
- 예: 100GB 볼륨 → 최대 50,000 IOPS

사용 사례:
- 고성능 데이터베이스 (Oracle, SQL Server)
- 지연 시간에 민감한 트랜잭션 워크로드
- I/O 집약적 NoSQL 데이터베이스
```

**st1 (Throughput Optimized HDD)**:
```
특징:
- 대용량 순차 읽기/쓰기에 최적화
- 부트 볼륨으로 사용 불가

성능:
- 기준 처리량: 40 MB/s per TB
- 버스트 처리량: 250 MB/s per TB
- 최대 처리량: 500 MB/s

사용 사례:
- 빅데이터 (Hadoop, Kafka)
- 로그 처리
- 데이터 웨어하우스
```

**sc1 (Cold HDD)**:
```
특징:
- 가장 저렴한 옵션
- 드문 접근에 적합
- 부트 볼륨으로 사용 불가

성능:
- 기준 처리량: 12 MB/s per TB
- 버스트 처리량: 80 MB/s per TB
- 최대 처리량: 250 MB/s

사용 사례:
- 아카이브 데이터
- 드물게 접근하는 대용량 데이터
```

### EBS 볼륨 선택 가이드

```
┌────────────────────────────────────────────────────────────┐
│                    EBS 볼륨 선택 플로우                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  부트 볼륨인가?                                            │
│       │                                                    │
│       ├── Yes → gp3 (기본 선택)                           │
│       │                                                    │
│       └── No → 데이터 접근 패턴은?                        │
│                    │                                       │
│                    ├── 랜덤 I/O (DB) → IOPS 필요량?       │
│                    │       │                               │
│                    │       ├── ≤16,000 → gp3              │
│                    │       └── >16,000 → io2              │
│                    │                                       │
│                    ├── 순차 I/O (빅데이터)                 │
│                    │       │                               │
│                    │       └── st1                         │
│                    │                                       │
│                    └── 드문 접근 (아카이브)                │
│                            │                               │
│                            └── sc1                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### EBS 볼륨 연결 및 관리

```bash
# EBS 볼륨 생성
aws ec2 create-volume \
  --volume-type gp3 \
  --size 100 \
  --iops 3000 \
  --throughput 125 \
  --availability-zone ap-northeast-2a \
  --encrypted \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=my-data-volume}]'

# EC2에 볼륨 연결
aws ec2 attach-volume \
  --volume-id vol-xxx \
  --instance-id i-xxx \
  --device /dev/sdf

# 인스턴스 내부에서 볼륨 마운트
# 1. 파일시스템 생성 (최초 1회)
sudo mkfs -t xfs /dev/xvdf

# 2. 마운트 포인트 생성
sudo mkdir /data

# 3. 마운트
sudo mount /dev/xvdf /data

# 4. 영구 마운트 설정 (/etc/fstab)
echo '/dev/xvdf /data xfs defaults,nofail 0 2' | sudo tee -a /etc/fstab
```

### EBS 볼륨 확장

온라인으로 볼륨 크기와 성능을 변경할 수 있다 (다운타임 없음).

```bash
# 볼륨 크기 및 IOPS 변경
aws ec2 modify-volume \
  --volume-id vol-xxx \
  --size 200 \
  --iops 6000 \
  --throughput 250

# 변경 상태 확인
aws ec2 describe-volumes-modifications \
  --volume-ids vol-xxx

# 인스턴스 내부에서 파티션 확장
sudo growpart /dev/xvda 1

# 파일시스템 확장
sudo xfs_growfs /dev/xvda1    # XFS
sudo resize2fs /dev/xvda1     # ext4
```

**볼륨 수정 제한사항**:
```
- 6시간에 1회만 수정 가능
- 크기는 증가만 가능 (축소 불가)
- gp2 → gp3 타입 변경 가능
- io1 → io2 타입 변경 가능
```

### EBS Multi-Attach

하나의 io2 볼륨을 여러 EC2 인스턴스에 동시 연결한다.

```bash
# Multi-Attach 활성화된 볼륨 생성
aws ec2 create-volume \
  --volume-type io2 \
  --size 100 \
  --iops 50000 \
  --multi-attach-enabled \
  --availability-zone ap-northeast-2a
```

**Multi-Attach 제한사항**:
```
- io2 볼륨만 지원
- 동일 AZ의 인스턴스만 연결 가능
- 최대 16개 인스턴스 연결
- 클러스터 인식 파일시스템 필요 (GFS2, OCFS2)
- 일반 파일시스템 사용 시 데이터 손상 위험
```

### EBS 암호화

```bash
# 기본 암호화 활성화 (리전 단위)
aws ec2 enable-ebs-encryption-by-default

# 암호화된 볼륨 생성
aws ec2 create-volume \
  --volume-type gp3 \
  --size 100 \
  --encrypted \
  --kms-key-id alias/my-key \
  --availability-zone ap-northeast-2a

# 비암호화 볼륨을 암호화된 볼륨으로 변환
# 1. 스냅샷 생성
aws ec2 create-snapshot --volume-id vol-unencrypted-xxx

# 2. 암호화된 스냅샷 복사
aws ec2 copy-snapshot \
  --source-region ap-northeast-2 \
  --source-snapshot-id snap-xxx \
  --encrypted \
  --kms-key-id alias/my-key

# 3. 암호화된 스냅샷에서 볼륨 생성
aws ec2 create-volume \
  --snapshot-id snap-encrypted-xxx \
  --availability-zone ap-northeast-2a
```

**암호화 특징**:
```
- AES-256 암호화
- AWS 관리형 키 또는 CMK(Customer Managed Key, 고객 관리형 키) 사용
- 암호화/복호화는 EC2 호스트에서 처리 (성능 영향 없음)
- 암호화된 볼륨의 스냅샷도 암호화됨
- 리전 간 스냅샷 복사 시 다른 키로 재암호화 가능
```

### gp3 vs gp2

**gp3를 선택해야 하는 이유**:
```
gp2: IOPS가 볼륨 크기에 비례 (3 IOPS/GB)
     → 1TB 볼륨 = 3,000 IOPS

gp3: 크기와 무관하게 3,000 IOPS 기본 제공
     → 100GB 볼륨도 3,000 IOPS

결론: gp3가 대부분의 경우 더 저렴하고 유연함
```

**gp3 설정 예시**:
```bash
aws ec2 create-volume \
  --volume-type gp3 \
  --size 100 \
  --iops 3000 \
  --throughput 125 \
  --availability-zone ap-northeast-2a
```

### EBS 최적화 인스턴스

EBS 최적화 인스턴스는 EBS 전용 대역폭을 제공한다.

```
비최적화: 네트워크와 EBS가 대역폭 공유
최적화:   EBS 전용 대역폭 확보

최신 세대(5세대 이상)는 기본적으로 EBS 최적화
```

---

## Backup & Snapshot

### EBS 스냅샷 상세

EBS 스냅샷은 EBS 볼륨의 **특정 시점 복사본**이다.
S3에 저장되며, 증분 백업 방식으로 효율적이다.

#### 스냅샷 동작 원리

```
┌─────────────────────────────────────────────────────────────┐
│                    증분 스냅샷 (Incremental)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  EBS Volume: [A][B][C][D][E][F][G][H]                       │
│                                                              │
│  Snapshot 1: [A][B][C][D][E][F][G][H]  ← 전체 복사          │
│              (10GB 저장)                                     │
│                                                              │
│  --- 블록 C, F 변경 ---                                      │
│                                                              │
│  EBS Volume: [A][B][C'][D][E][F'][G][H]                     │
│                                                              │
│  Snapshot 2: [C'][F']  ← 변경된 블록만 저장                  │
│              (2GB 저장, 나머지는 Snapshot 1 참조)            │
│                                                              │
│  Snapshot 1 삭제해도 Snapshot 2는 완전한 데이터 유지         │
│  (필요한 블록이 자동으로 Snapshot 2로 이동)                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 스냅샷 생성 및 관리

```bash
# 스냅샷 생성
aws ec2 create-snapshot \
  --volume-id vol-xxx \
  --description "Daily backup $(date +%Y-%m-%d)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=my-app-backup},{Key=Environment,Value=production}]'

# 스냅샷 목록 조회
aws ec2 describe-snapshots \
  --owner-ids self \
  --query 'Snapshots[*].[SnapshotId,VolumeId,StartTime,State,VolumeSize]' \
  --output table

# 스냅샷 상태 확인
aws ec2 describe-snapshots \
  --snapshot-ids snap-xxx \
  --query 'Snapshots[0].State'

# 스냅샷 삭제
aws ec2 delete-snapshot --snapshot-id snap-xxx
```

#### 스냅샷에서 볼륨 복원

```bash
# 동일 AZ에 복원
aws ec2 create-volume \
  --snapshot-id snap-xxx \
  --availability-zone ap-northeast-2a \
  --volume-type gp3 \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=restored-volume}]'

# 다른 AZ에 복원
aws ec2 create-volume \
  --snapshot-id snap-xxx \
  --availability-zone ap-northeast-2c \
  --volume-type gp3

# 더 큰 크기로 복원
aws ec2 create-volume \
  --snapshot-id snap-xxx \
  --size 200 \
  --availability-zone ap-northeast-2a \
  --volume-type gp3
```

#### 스냅샷 리전 간 복사

DR(재해 복구)를 위해 다른 리전으로 스냅샷을 복사한다.

```bash
# 다른 리전으로 스냅샷 복사
aws ec2 copy-snapshot \
  --source-region ap-northeast-2 \
  --source-snapshot-id snap-xxx \
  --destination-region us-east-1 \
  --description "DR copy from Seoul"

# 암호화하면서 복사 (다른 KMS 키 사용 가능)
aws ec2 copy-snapshot \
  --source-region ap-northeast-2 \
  --source-snapshot-id snap-xxx \
  --destination-region us-east-1 \
  --encrypted \
  --kms-key-id alias/dr-key
```

#### 스냅샷 공유

```bash
# 특정 AWS 계정과 스냅샷 공유
aws ec2 modify-snapshot-attribute \
  --snapshot-id snap-xxx \
  --attribute createVolumePermission \
  --operation-type add \
  --user-ids 123456789012

# 공유 계정 확인
aws ec2 describe-snapshot-attribute \
  --snapshot-id snap-xxx \
  --attribute createVolumePermission

# 공유 해제
aws ec2 modify-snapshot-attribute \
  --snapshot-id snap-xxx \
  --attribute createVolumePermission \
  --operation-type remove \
  --user-ids 123456789012
```

### EBS Snapshots Archive

자주 접근하지 않는 스냅샷을 아카이브하여 비용을 절감한다.

```bash
# 스냅샷을 Archive 티어로 이동
aws ec2 modify-snapshot-tier \
  --snapshot-id snap-xxx \
  --storage-tier archive

# Archive에서 복원 (24-72시간 소요)
aws ec2 restore-snapshot-tier \
  --snapshot-id snap-xxx \
  --temporary-restore-days 7

# Archive 상태 확인
aws ec2 describe-snapshots \
  --snapshot-ids snap-xxx \
  --query 'Snapshots[0].StorageTier'
```

**Archive 비용 비교**:
```
Standard 스냅샷:  ~$0.05/GB/월
Archive 스냅샷:   ~$0.0125/GB/월 (75% 저렴)

단, Archive에서 복원 시:
- 복원 비용: ~$0.03/GB
- 복원 시간: 24-72시간
- 최소 90일 보관 필요

Archive 적합 케이스:
- 90일 이상 보관하는 스냅샷
- 즉시 복원이 필요 없는 백업
- 규정 준수를 위한 장기 보관
```

### Amazon Data Lifecycle Manager (DLM)

EBS 스냅샷을 자동으로 생성하고 관리한다.

```bash
# 스냅샷 라이프사이클 정책 생성
aws dlm create-lifecycle-policy \
  --description "Daily snapshots with 7-day retention" \
  --state ENABLED \
  --execution-role-arn arn:aws:iam::xxx:role/AWSDataLifecycleManagerDefaultRole \
  --policy-details '{
    "PolicyType": "EBS_SNAPSHOT_MANAGEMENT",
    "ResourceTypes": ["VOLUME"],
    "TargetTags": [{"Key": "Backup", "Value": "true"}],
    "Schedules": [{
      "Name": "DailySnapshots",
      "CreateRule": {
        "Interval": 24,
        "IntervalUnit": "HOURS",
        "Times": ["09:00"]
      },
      "RetainRule": {
        "Count": 7
      },
      "CopyTags": true
    }]
  }'
```

**DLM 정책 예시**:
```
1. 일일 백업 (7일 보관)
   - 매일 09:00 UTC 스냅샷 생성
   - 최근 7개 유지

2. 주간 백업 (4주 보관)
   - 매주 일요일 스냅샷 생성
   - 최근 4개 유지

3. 월간 백업 (12개월 보관)
   - 매월 1일 스냅샷 생성
   - 최근 12개 유지

4. DR용 크로스 리전 복사
   - 일일 스냅샷을 다른 리전으로 자동 복사
```

### AWS Backup

여러 AWS 서비스의 백업을 중앙에서 관리한다.

```
지원 서비스:
- EC2 (AMI 기반)
- EBS
- RDS
- DynamoDB
- EFS
- FSx
- S3
- Storage Gateway
```

#### AWS Backup 설정

```bash
# 백업 볼트 생성
aws backup create-backup-vault \
  --backup-vault-name my-backup-vault \
  --encryption-key-arn arn:aws:kms:ap-northeast-2:xxx:key/xxx

# 백업 플랜 생성
aws backup create-backup-plan \
  --backup-plan '{
    "BackupPlanName": "DailyBackupPlan",
    "Rules": [{
      "RuleName": "DailyRule",
      "TargetBackupVaultName": "my-backup-vault",
      "ScheduleExpression": "cron(0 5 ? * * *)",
      "StartWindowMinutes": 60,
      "CompletionWindowMinutes": 180,
      "Lifecycle": {
        "DeleteAfterDays": 30
      }
    }]
  }'

# 리소스 할당
aws backup create-backup-selection \
  --backup-plan-id plan-xxx \
  --backup-selection '{
    "SelectionName": "EC2Selection",
    "IamRoleArn": "arn:aws:iam::xxx:role/AWSBackupDefaultServiceRole",
    "Resources": [
      "arn:aws:ec2:ap-northeast-2:xxx:instance/i-xxx"
    ]
  }'
```

#### 백업 플랜 설계 예시

```
┌─────────────────────────────────────────────────────────────┐
│                    백업 플랜 예시                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  프로덕션 환경:                                              │
│  ├── 일일 백업                                               │
│  │   ├── 시간: 매일 05:00 UTC                               │
│  │   ├── 보관: 30일                                          │
│  │   └── 리전: 서울                                          │
│  │                                                           │
│  ├── 주간 백업                                               │
│  │   ├── 시간: 매주 일요일 05:00 UTC                        │
│  │   ├── 보관: 12주                                          │
│  │   └── 리전: 서울 + 도쿄 (DR)                             │
│  │                                                           │
│  └── 월간 백업                                               │
│      ├── 시간: 매월 1일 05:00 UTC                           │
│      ├── 보관: 1년                                           │
│      └── Cold Storage로 이동: 90일 후                       │
│                                                              │
│  개발 환경:                                                   │
│  └── 일일 백업                                               │
│      ├── 시간: 매일 05:00 UTC                               │
│      └── 보관: 7일                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### EC2 AMI 백업

EC2 인스턴스 전체를 백업하려면 AMI를 생성한다.

```bash
# AMI 생성 (인스턴스 재부팅 없이)
aws ec2 create-image \
  --instance-id i-xxx \
  --name "my-app-backup-$(date +%Y%m%d)" \
  --description "Weekly backup" \
  --no-reboot

# AMI에서 인스턴스 복원
aws ec2 run-instances \
  --image-id ami-xxx \
  --instance-type m6i.large \
  --key-name my-key \
  --security-group-ids sg-xxx \
  --subnet-id subnet-xxx

# 오래된 AMI 정리 (30일 이상)
aws ec2 describe-images \
  --owners self \
  --query 'Images[?CreationDate<=`2024-01-01`].[ImageId,Name]' \
  --output table
```

**AMI vs EBS 스냅샷**:
```
AMI:
- 인스턴스 전체 (루트 볼륨 + 추가 볼륨 + 메타데이터)
- EC2 인스턴스를 바로 시작 가능
- 더 큰 저장 공간 필요

EBS 스냅샷:
- 개별 볼륨만
- 볼륨 복원 후 인스턴스에 연결 필요
- 더 세밀한 관리 가능
```

### 백업 모범 사례

```
1. 3-2-1 규칙
   - 3개의 데이터 복사본
   - 2개의 다른 스토리지 매체
   - 1개는 오프사이트 (다른 리전)

2. 백업 테스트
   - 정기적으로 복원 테스트 수행
   - DR(Disaster Recovery, 재해복구) 시나리오 시뮬레이션
   - RTO(복구 목표 시간)/RPO(복구 목표 시점) 검증

3. 암호화
   - 모든 백업 암호화 적용
   - KMS 키 관리 정책 수립
   - 크로스 리전 복사 시 키 관리

4. 보관 정책
   - 규정 준수 요구사항 확인
   - 비용 대비 보관 기간 최적화
   - Archive 티어 적극 활용

5. 모니터링
   - 백업 실패 알림 설정
   - 백업 완료 검증
   - 스토리지 비용 모니터링
```

### 스냅샷 비용 최적화

```bash
# 사용되지 않는 스냅샷 찾기
aws ec2 describe-snapshots \
  --owner-ids self \
  --query 'Snapshots[?StartTime<=`2024-01-01`].[SnapshotId,VolumeId,StartTime,VolumeSize]' \
  --output table

# 볼륨이 삭제된 스냅샷 찾기 (고아 스냅샷)
# 1. 모든 스냅샷의 VolumeId 목록
SNAP_VOLS=$(aws ec2 describe-snapshots --owner-ids self --query 'Snapshots[*].VolumeId' --output text)

# 2. 현재 존재하는 볼륨 목록
CURRENT_VOLS=$(aws ec2 describe-volumes --query 'Volumes[*].VolumeId' --output text)

# 대량 스냅샷 삭제 (주의해서 사용)
aws ec2 describe-snapshots \
  --owner-ids self \
  --query 'Snapshots[?StartTime<=`2024-01-01`].SnapshotId' \
  --output text | xargs -n 1 aws ec2 delete-snapshot --snapshot-id
```

**비용 절감 체크리스트**:
```
- [ ] 오래된 스냅샷 정리
- [ ] 고아 스냅샷 (볼륨 삭제됨) 정리
- [ ] 90일 이상 보관 스냅샷 Archive로 이동
- [ ] DLM으로 자동 정리 정책 적용
- [ ] 불필요한 AMI 및 연관 스냅샷 삭제
- [ ] 개발 환경 보관 기간 단축
```

---

### EBS 볼륨 크기 변경

```bash
# 온라인으로 볼륨 크기 확장 (다운타임 없음)
aws ec2 modify-volume \
  --volume-id vol-xxx \
  --size 200

# 파일시스템 확장 (인스턴스 내부에서)
sudo growpart /dev/xvda 1
sudo xfs_growfs /dev/xvda1  # XFS의 경우
sudo resize2fs /dev/xvda1   # ext4의 경우
```

---

## 네트워킹

### VPC (Virtual Private Cloud) 상세

VPC는 AWS 클라우드 내 논리적으로 격리된 가상 네트워크다.
EC2 인스턴스는 반드시 VPC 내에서 실행된다.

#### VPC 핵심 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                        VPC (10.0.0.0/16)                         │
│                       65,536개 IP 주소                           │
│                                                                  │
│  ┌────────────────────────────┐  ┌────────────────────────────┐ │
│  │     Public Subnet          │  │     Public Subnet          │ │
│  │     10.0.1.0/24           │  │     10.0.2.0/24           │ │
│  │     (256 IPs, AZ-a)       │  │     (256 IPs, AZ-c)       │ │
│  │                            │  │                            │ │
│  │  ┌──────┐  ┌──────┐       │  │  ┌──────┐  ┌──────┐       │ │
│  │  │ NAT  │  │ ALB  │       │  │  │ NAT  │  │ ALB  │       │ │
│  │  │ GW   │  │      │       │  │  │ GW   │  │      │       │ │
│  │  └──────┘  └──────┘       │  │  └──────┘  └──────┘       │ │
│  │       ↑                    │  │       ↑                    │ │
│  │       │ IGW 연결           │  │       │ IGW 연결           │ │
│  └───────┼────────────────────┘  └───────┼────────────────────┘ │
│          │                               │                       │
│  ┌───────┼────────────────────┐  ┌───────┼────────────────────┐ │
│  │     Private Subnet         │  │     Private Subnet         │ │
│  │     10.0.11.0/24          │  │     10.0.12.0/24          │ │
│  │     (256 IPs, AZ-a)       │  │     (256 IPs, AZ-c)       │ │
│  │                            │  │                            │ │
│  │  ┌──────┐  ┌──────┐       │  │  ┌──────┐  ┌──────┐       │ │
│  │  │ EC2  │  │ EC2  │       │  │  │ EC2  │  │ EC2  │       │ │
│  │  │ App  │  │ App  │       │  │  │ App  │  │ App  │       │ │
│  │  └──────┘  └──────┘       │  │  └──────┘  └──────┘       │ │
│  │       ↑                    │  │       ↑                    │ │
│  │       │ NAT GW 통해 외부   │  │       │ NAT GW 통해 외부   │ │
│  └───────┼────────────────────┘  └───────┼────────────────────┘ │
│          │                               │                       │
│  ┌───────┼────────────────────┐  ┌───────┼────────────────────┐ │
│  │     DB Subnet              │  │     DB Subnet              │ │
│  │     10.0.21.0/24          │  │     10.0.22.0/24          │ │
│  │                            │  │                            │ │
│  │  ┌──────┐                  │  │  ┌──────┐                  │ │
│  │  │ RDS  │                  │  │  │ RDS  │                  │ │
│  │  │Standby│                 │  │  │Primary│                 │ │
│  │  └──────┘                  │  │  └──────┘                  │ │
│  │       ↑                    │  │       ↑                    │ │
│  │       │ 외부 접근 불가     │  │       │ 외부 접근 불가     │ │
│  └────────────────────────────┘  └────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Internet Gateway                         │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### CIDR 블록 설계

```
VPC CIDR 예시: 10.0.0.0/16 (65,536 IPs)

서브넷 설계:
├── Public Subnets
│   ├── 10.0.1.0/24  (AZ-a) - 256 IPs
│   ├── 10.0.2.0/24  (AZ-b) - 256 IPs
│   └── 10.0.3.0/24  (AZ-c) - 256 IPs
├── Private Subnets (App)
│   ├── 10.0.11.0/24 (AZ-a) - 256 IPs
│   ├── 10.0.12.0/24 (AZ-b) - 256 IPs
│   └── 10.0.13.0/24 (AZ-c) - 256 IPs
└── Private Subnets (DB)
    ├── 10.0.21.0/24 (AZ-a) - 256 IPs
    ├── 10.0.22.0/24 (AZ-b) - 256 IPs
    └── 10.0.23.0/24 (AZ-c) - 256 IPs
```

**CIDR 설계 시 주의사항**:
- VPC CIDR은 생성 후 변경 불가 (보조 CIDR 추가는 가능)
- 온프레미스, 다른 VPC와 IP 대역 충돌 피하기
- 향후 확장을 고려해 충분히 크게 설계
- /16 ~ /28 범위 (65,536 ~ 16 IPs)

#### VPC 생성

```bash
# VPC 생성
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=my-vpc}]'

# 서브넷 생성 (Public)
aws ec2 create-subnet \
  --vpc-id vpc-xxx \
  --cidr-block 10.0.1.0/24 \
  --availability-zone ap-northeast-2a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=public-subnet-a}]'

# 인터넷 게이트웨이 생성 및 연결
aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=my-igw}]'

aws ec2 attach-internet-gateway \
  --internet-gateway-id igw-xxx \
  --vpc-id vpc-xxx

# 라우팅 테이블에 인터넷 경로 추가
aws ec2 create-route \
  --route-table-id rtb-xxx \
  --destination-cidr-block 0.0.0.0/0 \
  --gateway-id igw-xxx
```

#### Public vs Private Subnet

| 구분 | Public Subnet | Private Subnet |
|------|---------------|----------------|
| **인터넷 접근** | 직접 가능 (IGW) | NAT GW 통해서만 |
| **외부에서 접근** | 가능 | 불가능 |
| **용도** | ALB, NAT GW, Bastion | EC2 App, DB |
| **라우팅** | 0.0.0.0/0 → IGW | 0.0.0.0/0 → NAT GW |

#### NAT Gateway

Private Subnet의 EC2가 인터넷에 접근할 때 사용한다.

```bash
# Elastic IP 할당 (NAT GW용)
aws ec2 allocate-address --domain vpc

# NAT Gateway 생성 (Public Subnet에)
aws ec2 create-nat-gateway \
  --subnet-id subnet-public-xxx \
  --allocation-id eipalloc-xxx \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=nat-gw-a}]'

# Private Subnet 라우팅 테이블에 NAT GW 경로 추가
aws ec2 create-route \
  --route-table-id rtb-private-xxx \
  --destination-cidr-block 0.0.0.0/0 \
  --nat-gateway-id nat-xxx
```

**NAT Gateway 비용 최적화**:
```
NAT Gateway 비용 = 시간당 요금 + 데이터 처리 요금

비용 절감 방법:
1. VPC Endpoint 사용 (S3, DynamoDB 등)
   → NAT GW 통하지 않고 직접 연결
2. 개발 환경에서는 NAT Instance 사용
   → t3.micro로 저렴하게 구성
3. 불필요한 외부 트래픽 최소화
```

#### VPC Endpoint

AWS 서비스에 프라이빗하게 연결한다 (NAT GW 불필요).

```bash
# S3 Gateway Endpoint (무료)
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxx \
  --service-name com.amazonaws.ap-northeast-2.s3 \
  --route-table-ids rtb-xxx

# ECR Interface Endpoint (비용 발생)
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxx \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.ap-northeast-2.ecr.api \
  --subnet-ids subnet-xxx \
  --security-group-ids sg-xxx
```

**주요 VPC Endpoint**:

| 서비스 | Endpoint 타입 | 비용 |
|--------|---------------|------|
| S3 | Gateway | 무료 |
| DynamoDB | Gateway | 무료 |
| ECR | Interface | 유료 |
| SSM | Interface | 유료 |
| CloudWatch | Interface | 유료 |

---

### 보안 그룹 (Security Group) 상세

보안 그룹은 EC2 인스턴스의 **인스턴스 레벨 방화벽**이다.

#### Security Group vs NACL

| 구분 | Security Group | NACL |
|------|----------------|------|
| **레벨** | 인스턴스 | 서브넷 |
| **상태** | Stateful | Stateless |
| **규칙** | 허용만 | 허용/거부 |
| **평가** | 모든 규칙 평가 | 순서대로 평가 |
| **기본** | 모두 거부 | 모두 허용 |

#### Stateful의 의미

```
Stateful (Security Group):
  인바운드 허용 → 응답 아웃바운드 자동 허용

  예: 443 인바운드 허용
  Client → EC2:443 (허용)
  EC2 → Client (응답 자동 허용, 별도 규칙 불필요)

Stateless (NACL):
  인바운드와 아웃바운드 각각 규칙 필요

  예: 443 인바운드 허용
  Inbound: 443 허용
  Outbound: 1024-65535 (Ephemeral ports) 허용 필요
```

#### Security Group 규칙 작성

```bash
# 보안 그룹 생성
aws ec2 create-security-group \
  --group-name web-server-sg \
  --description "Security group for web servers" \
  --vpc-id vpc-xxx

# HTTPS 허용 (모든 곳에서)
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

# 다른 보안 그룹에서 오는 트래픽 허용
aws ec2 authorize-security-group-ingress \
  --group-id sg-app-xxx \
  --protocol tcp \
  --port 8080 \
  --source-group sg-alb-xxx

# 특정 IP 대역에서 SSH 허용
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 22 \
  --cidr 10.0.0.0/8
```

#### 보안 그룹 설계 패턴

```
┌─────────────────────────────────────────────────────────┐
│                    3-Tier Architecture                   │
│                                                          │
│  ┌─────────────┐                                        │
│  │  ALB SG     │  Inbound: 443 from 0.0.0.0/0          │
│  │             │  Outbound: All                         │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐                                        │
│  │  App SG     │  Inbound: 8080 from ALB SG            │
│  │             │  Outbound: All                         │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐                                        │
│  │  DB SG      │  Inbound: 3306 from App SG            │
│  │             │  Outbound: All                         │
│  └─────────────┘                                        │
│                                                          │
│  보안 그룹 체이닝: SG 간 참조로 최소 권한 구현          │
└─────────────────────────────────────────────────────────┘
```

**보안 그룹 모범 사례**:

```
# 좋은 예: 보안 그룹 간 참조
App SG:
  - Inbound: 8080 from sg-alb-xxx (ALB SG)
  - Inbound: 22 from sg-bastion-xxx (Bastion SG)

DB SG:
  - Inbound: 3306 from sg-app-xxx (App SG)

# 나쁜 예: IP 직접 지정
App SG:
  - Inbound: 8080 from 0.0.0.0/0  # 모든 곳에서 접근 가능!
  - Inbound: 22 from 0.0.0.0/0    # SSH 전체 공개!
```

#### 보안 그룹 개수 제한

```
기본 제한:
- VPC당 보안 그룹: 2,500개
- 보안 그룹당 인바운드 규칙: 60개
- 보안 그룹당 아웃바운드 규칙: 60개
- ENI당 보안 그룹: 5개

규칙 수 계산:
- 보안 그룹 참조 1개 = 규칙 1개
- CIDR 1개 = 규칙 1개
```

---

### Elastic IP (EIP)

Elastic IP는 고정 퍼블릭 IPv4 주소다.

#### 언제 Elastic IP가 필요한가?

```
필요한 경우:
1. 인스턴스 재시작 후에도 같은 IP 유지 필요
2. 외부 시스템에 IP를 등록해야 하는 경우 (화이트리스트)
3. 도메인을 IP에 직접 연결하는 경우 (비권장)
4. NAT Gateway에 고정 IP 필요

필요없는 경우:
1. ALB/NLB 뒤의 EC2 (로드밸런서가 트래픽 처리)
2. Auto Scaling 환경 (인스턴스가 동적으로 변경)
3. DNS/Route53을 통한 접근
```

#### Elastic IP 관리

```bash
# Elastic IP 할당
aws ec2 allocate-address --domain vpc

# 결과:
# {
#   "PublicIp": "52.78.xxx.xxx",
#   "AllocationId": "eipalloc-xxx"
# }

# EC2 인스턴스에 연결
aws ec2 associate-address \
  --instance-id i-xxx \
  --allocation-id eipalloc-xxx

# Elastic IP 해제
aws ec2 disassociate-address --association-id eipassoc-xxx

# Elastic IP 반납
aws ec2 release-address --allocation-id eipalloc-xxx
```

#### Elastic IP 비용

```
연결된 상태:
  - 실행 중인 인스턴스에 연결: 무료
  - 하나의 EIP만 연결된 경우: 무료

비용 발생:
  - 연결되지 않은 EIP: 시간당 ~$0.005
  - 중지된 인스턴스에 연결된 EIP: 시간당 ~$0.005
  - 인스턴스당 두 번째 이상의 EIP: 시간당 ~$0.005
  - EIP 재매핑 (월 100회 초과): 건당 ~$0.10

⚠️ 사용하지 않는 EIP는 반드시 반납!
   → 방치된 EIP는 매달 ~$3.6 비용 발생
```

#### Elastic IP vs Auto-assigned Public IP

| 구분 | Elastic IP | Auto-assigned Public IP |
|------|------------|------------------------|
| **지속성** | 영구 (해제 전까지) | 인스턴스 중지 시 변경 |
| **비용** | 미사용 시 과금 | 무료 |
| **개수 제한** | 리전당 5개 (기본) | 제한 없음 |
| **용도** | 고정 IP 필요 시 | 일반적인 웹 서버 |

#### Elastic IP 대안

```
1. Application Load Balancer (ALB)
   - 고정 DNS 이름 제공
   - 다수의 EC2에 트래픽 분산
   - SSL 종료 가능

2. Network Load Balancer (NLB)
   - 고정 IP 제공 (AZ당 1개)
   - 초저지연, 고성능
   - TCP/UDP 지원

3. Global Accelerator
   - 글로벌 고정 IP 2개 제공
   - 전 세계 엣지 로케이션 활용
   - 리전 장애 시 자동 페일오버

4. Route 53 (DNS)
   - EC2 퍼블릭 DNS에 CNAME/Alias 설정
   - 헬스 체크 기반 페일오버
```

---

### ENI (Elastic Network Interface)

ENI는 가상 네트워크 카드다.

```
하나의 EC2 인스턴스에 여러 ENI 연결 가능
→ 관리용 네트워크와 서비스용 네트워크 분리
→ 네트워크 어플라이언스 구성
```

**ENI 활용 사례**:
```
1. 듀얼 홈 인스턴스
   - eth0: 프라이빗 서브넷 (애플리케이션 트래픽)
   - eth1: 관리 서브넷 (SSH, 모니터링)

2. 고가용성
   - 장애 시 ENI를 다른 인스턴스로 이동
   - IP 주소 유지
```

### ENA (Elastic Network Adapter)

최신 인스턴스에서 사용하는 고성능 네트워크 어댑터다.

```
기존 드라이버: 최대 10 Gbps
ENA: 최대 100 Gbps (인스턴스 타입에 따라)
ENA Express: 최대 25 Gbps 단일 플로우 (SRD 프로토콜)
```

---

## 배치 그룹 (Placement Groups)

### 클러스터 배치 그룹

```
┌─────────────────────────────────────────┐
│           Cluster Placement Group        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │
│  │ EC2 │─│ EC2 │─│ EC2 │─│ EC2 │        │
│  └─────┘ └─────┘ └─────┘ └─────┘        │
│      같은 랙, 초저지연 네트워크           │
└─────────────────────────────────────────┘

특징:
- 단일 AZ 내 물리적으로 인접 배치
- 10 Gbps 이상의 네트워크 대역폭
- 마이크로초 단위 지연 시간

사용 사례:
- HPC (High Performance Computing)
- 분산 학습
- 저지연 필요 애플리케이션
```

### 분산 배치 그룹

```
┌─────────────────────────────────────────┐
│          Spread Placement Group          │
│                                          │
│  Rack1    Rack2    Rack3    Rack4       │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │
│  │ EC2 │ │ EC2 │ │ EC2 │ │ EC2 │        │
│  └─────┘ └─────┘ └─────┘ └─────┘        │
│                                          │
│     각 인스턴스가 다른 하드웨어에 배치    │
└─────────────────────────────────────────┘

특징:
- AZ당 최대 7개 인스턴스
- 하드웨어 장애 격리

사용 사례:
- 고가용성이 중요한 애플리케이션
- 분산 데이터베이스
```

### 파티션 배치 그룹

```
┌─────────────────────────────────────────────────┐
│            Partition Placement Group             │
│                                                  │
│  Partition1     Partition2     Partition3       │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐        │
│  │ EC2 EC2 │   │ EC2 EC2 │   │ EC2 EC2 │        │
│  │ EC2 EC2 │   │ EC2 EC2 │   │ EC2 EC2 │        │
│  └─────────┘   └─────────┘   └─────────┘        │
│                                                  │
│  각 파티션은 독립된 랙에 배치                    │
└─────────────────────────────────────────────────┘

특징:
- AZ당 최대 7개 파티션
- 파티션 내 인스턴스 수 제한 없음
- 파티션 정보를 메타데이터로 제공

사용 사례:
- HDFS, HBase, Cassandra
- Kafka 브로커
```

---

## Auto Scaling

### Auto Scaling 구성 요소

```
┌──────────────────────────────────────────────────────┐
│                   Auto Scaling Group                  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │            Launch Template                       │ │
│  │  - AMI                                          │ │
│  │  - Instance Type                                │ │
│  │  - Security Groups                              │ │
│  │  - User Data                                    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │            Scaling Policy                        │ │
│  │  - Target Tracking                              │ │
│  │  - Step Scaling                                 │ │
│  │  - Scheduled Scaling                            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Min: 2  /  Desired: 4  /  Max: 10                   │
└──────────────────────────────────────────────────────┘
```

### Launch Template 작성

```bash
aws ec2 create-launch-template \
  --launch-template-name my-app-template \
  --version-description "v1.0" \
  --launch-template-data '{
    "ImageId": "ami-xxx",
    "InstanceType": "m6i.large",
    "KeyName": "my-key",
    "SecurityGroupIds": ["sg-xxx"],
    "IamInstanceProfile": {
      "Arn": "arn:aws:iam::xxx:instance-profile/my-role"
    },
    "UserData": "BASE64_ENCODED_SCRIPT",
    "BlockDeviceMappings": [
      {
        "DeviceName": "/dev/xvda",
        "Ebs": {
          "VolumeSize": 50,
          "VolumeType": "gp3",
          "DeleteOnTermination": true
        }
      }
    ],
    "TagSpecifications": [
      {
        "ResourceType": "instance",
        "Tags": [{"Key": "Name", "Value": "my-app"}]
      }
    ]
  }'
```

### Scaling Policy 전략

#### Target Tracking (권장)

```bash
# CPU 사용률 50% 유지
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-asg \
  --policy-name cpu-target-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "TargetValue": 50.0
  }'
```

**미리 정의된 메트릭**:
- `ASGAverageCPUUtilization`: CPU 사용률
- `ASGAverageNetworkIn`: 네트워크 인바운드
- `ASGAverageNetworkOut`: 네트워크 아웃바운드
- `ALBRequestCountPerTarget`: 타겟당 요청 수

#### Step Scaling

```bash
# CPU에 따른 단계별 스케일링
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-asg \
  --policy-name cpu-step-scaling \
  --policy-type StepScaling \
  --adjustment-type ChangeInCapacity \
  --step-adjustments '[
    {"MetricIntervalLowerBound": 0, "MetricIntervalUpperBound": 20, "ScalingAdjustment": 1},
    {"MetricIntervalLowerBound": 20, "MetricIntervalUpperBound": 40, "ScalingAdjustment": 2},
    {"MetricIntervalLowerBound": 40, "ScalingAdjustment": 3}
  ]'
```

#### Scheduled Scaling

```bash
# 매일 오전 9시에 스케일 아웃
aws autoscaling put-scheduled-update-group-action \
  --auto-scaling-group-name my-asg \
  --scheduled-action-name scale-out-morning \
  --recurrence "0 9 * * *" \
  --min-size 4 \
  --desired-capacity 8

# 매일 오후 9시에 스케일 인
aws autoscaling put-scheduled-update-group-action \
  --auto-scaling-group-name my-asg \
  --scheduled-action-name scale-in-evening \
  --recurrence "0 21 * * *" \
  --min-size 2 \
  --desired-capacity 2
```

### Predictive Scaling

ML을 활용하여 트래픽 패턴을 예측하고 미리 스케일링한다.

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name my-asg \
  --policy-name predictive-scaling \
  --policy-type PredictiveScaling \
  --predictive-scaling-configuration '{
    "MetricSpecifications": [{
      "TargetValue": 50,
      "PredefinedMetricPairSpecification": {
        "PredefinedMetricType": "ASGCPUUtilization"
      }
    }],
    "Mode": "ForecastAndScale"
  }'
```

### Warm Pool

인스턴스를 미리 준비해두어 스케일 아웃 시간을 단축한다.

```bash
aws autoscaling put-warm-pool \
  --auto-scaling-group-name my-asg \
  --pool-state Stopped \
  --min-size 2 \
  --max-group-prepared-capacity 5
```

```
┌─────────────────────────────────────────┐
│              Auto Scaling Group          │
│                                          │
│  Running Instances: [EC2] [EC2] [EC2]   │
│                                          │
│  Warm Pool (Stopped):                    │
│    [EC2] [EC2]  ← 미리 준비된 인스턴스    │
│                                          │
│  스케일 아웃 시:                          │
│    Warm Pool → Running (수 초 내)        │
└─────────────────────────────────────────┘
```

---

## 인스턴스 메타데이터

### IMDS (Instance Metadata Service)

EC2 인스턴스 내부에서 자신의 정보를 조회할 수 있다.

```bash
# IMDSv2 (권장) - 토큰 기반
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

# 인스턴스 ID 조회
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-id

# 인스턴스 타입 조회
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-type

# IAM Role 자격 증명 조회
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/my-role

# 사용자 데이터 조회
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/user-data
```

### IMDSv2 강제 적용

보안을 위해 IMDSv2만 허용하도록 설정한다.

```bash
# 기존 인스턴스에 IMDSv2 강제
aws ec2 modify-instance-metadata-options \
  --instance-id i-xxx \
  --http-tokens required \
  --http-endpoint enabled

# Launch Template에서 설정
"MetadataOptions": {
  "HttpTokens": "required",
  "HttpPutResponseHopLimit": 1,
  "HttpEndpoint": "enabled"
}
```

---

## 비용 최적화 상세

### 구매 옵션 비교

```
┌────────────────────────────────────────────────────────────┐
│                    가격 순서 (비싼 순)                       │
├────────────────────────────────────────────────────────────┤
│  On-Demand  >  Savings Plans  >  Reserved  >  Spot        │
│    (100%)        (최대 72%)      (최대 72%)   (최대 90%)    │
└────────────────────────────────────────────────────────────┘
```

### Savings Plans 상세

| 유형 | 할인율 | 유연성 | 권장 상황 |
|------|--------|--------|----------|
| **Compute** | 중간 | 높음 | 인스턴스 타입/리전 변경 가능성 있을 때 |
| **EC2 Instance** | 높음 | 중간 | 특정 패밀리를 계속 사용할 때 |

```bash
# Savings Plans 권장 사항 조회
aws ce get-savings-plans-purchase-recommendation \
  --savings-plans-type COMPUTE_SP \
  --term-in-years ONE_YEAR \
  --payment-option NO_UPFRONT \
  --lookback-period-in-days THIRTY_DAYS
```

### Spot Instance 상세

#### Spot 가격 히스토리 확인

```bash
aws ec2 describe-spot-price-history \
  --instance-types m6i.large \
  --product-descriptions "Linux/UNIX" \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --query 'SpotPriceHistory[*].[Timestamp,SpotPrice,AvailabilityZone]' \
  --output table
```

#### Spot Fleet 구성

```bash
aws ec2 request-spot-fleet \
  --spot-fleet-request-config '{
    "IamFleetRole": "arn:aws:iam::xxx:role/spot-fleet-role",
    "TargetCapacity": 10,
    "SpotPrice": "0.05",
    "AllocationStrategy": "capacityOptimized",
    "LaunchTemplateConfigs": [
      {
        "LaunchTemplateSpecification": {
          "LaunchTemplateId": "lt-xxx",
          "Version": "1"
        },
        "Overrides": [
          {"InstanceType": "m6i.large", "AvailabilityZone": "ap-northeast-2a"},
          {"InstanceType": "m6i.large", "AvailabilityZone": "ap-northeast-2c"},
          {"InstanceType": "m5.large", "AvailabilityZone": "ap-northeast-2a"},
          {"InstanceType": "m5.large", "AvailabilityZone": "ap-northeast-2c"}
        ]
      }
    ]
  }'
```

#### Spot 중단 대응

```bash
# 중단 알림 확인 (2분 전 통보)
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/spot/termination-time

# 중단 시 처리 스크립트 예시
#!/bin/bash
while true; do
  TERMINATION_TIME=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/spot/termination-time)

  if [ ! -z "$TERMINATION_TIME" ]; then
    # 정상 종료 처리
    echo "Spot termination notice received: $TERMINATION_TIME"
    /opt/scripts/graceful-shutdown.sh
    break
  fi
  sleep 5
done
```

### Right Sizing

#### Compute Optimizer 활용

```bash
# 권장 사항 조회
aws compute-optimizer get-ec2-instance-recommendations \
  --filters '[{"name":"Finding","values":["OVER_PROVISIONED"]}]' \
  --query 'instanceRecommendations[*].[instanceArn,finding,recommendationOptions[0].instanceType]'
```

#### CloudWatch 기반 분석

```bash
# 지난 14일간 CPU 사용률 확인
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-xxx \
  --start-time $(date -u -d '14 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average Maximum \
  --query 'Datapoints[*].[Timestamp,Average,Maximum]'
```

**Right Sizing 판단 기준**:
```
CPU 평균 < 5%, 최대 < 30%  → 인스턴스 축소 권장
CPU 평균 > 80%              → 인스턴스 확대 권장
메모리 사용률 < 20%         → 메모리 축소 가능
```

---

## 보안 모범 사례

### 1. 최소 권한 원칙

```json
// 나쁜 예: 과도한 권한
{
  "Effect": "Allow",
  "Action": "ec2:*",
  "Resource": "*"
}

// 좋은 예: 필요한 권한만
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeInstances",
    "ec2:StartInstances",
    "ec2:StopInstances"
  ],
  "Resource": "arn:aws:ec2:ap-northeast-2:xxx:instance/i-xxx"
}
```

### 2. IMDSv2 강제

```bash
# 모든 새 인스턴스에서 IMDSv2 필수로 설정
aws ec2 modify-instance-metadata-defaults \
  --region ap-northeast-2 \
  --http-tokens required
```

### 3. EBS 암호화 기본 활성화

```bash
# 리전 단위 기본 암호화 활성화
aws ec2 enable-ebs-encryption-by-default --region ap-northeast-2

# 기본 KMS 키 설정
aws ec2 modify-ebs-default-kms-key-id \
  --kms-key-id arn:aws:kms:ap-northeast-2:xxx:key/xxx
```

### 4. 보안 그룹 규칙

```yaml
# 필수 점검 사항
- [ ] SSH(22) 포트가 0.0.0.0/0에 열려있지 않은가?
- [ ] RDP(3389) 포트가 0.0.0.0/0에 열려있지 않은가?
- [ ] 불필요한 포트가 열려있지 않은가?
- [ ] 보안 그룹 간 참조를 사용하고 있는가?
```

### 5. Systems Manager (SSM)

SSH 대신 SSM Session Manager를 사용한다.

```bash
# SSM으로 인스턴스 접속 (SSH 키 불필요)
aws ssm start-session --target i-xxx

# 장점:
# - SSH 포트(22) 개방 불필요
# - IAM 기반 접근 제어
# - 모든 세션 CloudTrail 로깅
# - 감사 추적 용이
```

### 6. VPC Flow Logs

```bash
# VPC Flow Logs 활성화
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids vpc-xxx \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flow-logs
```

---

## 모니터링

### CloudWatch 기본 메트릭

EC2는 기본적으로 다음 메트릭을 제공한다 (5분 간격).

| 메트릭 | 설명 |
|--------|------|
| CPUUtilization | CPU 사용률 |
| NetworkIn/Out | 네트워크 트래픽 |
| DiskReadOps/WriteOps | 디스크 I/O 작업 수 |
| StatusCheckFailed | 상태 확인 실패 |

### CloudWatch 상세 모니터링

```bash
# 상세 모니터링 활성화 (1분 간격, 추가 비용)
aws ec2 monitor-instances --instance-ids i-xxx
```

### CloudWatch Agent (메모리, 디스크)

기본 메트릭에는 **메모리와 디스크 사용률이 없다**. CloudWatch Agent를 설치해야 한다.

```bash
# Amazon Linux 2023에서 설치
sudo yum install amazon-cloudwatch-agent

# 설정 마법사 실행
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard

# 에이전트 시작
sudo systemctl start amazon-cloudwatch-agent
```

**설정 파일 예시** (`/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json`):
```json
{
  "metrics": {
    "namespace": "CustomMetrics/EC2",
    "metrics_collected": {
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": ["disk_used_percent"],
        "resources": ["/"],
        "metrics_collection_interval": 60
      }
    }
  }
}
```

### CloudWatch Alarms

```bash
# CPU 80% 이상 시 알림
aws cloudwatch put-metric-alarm \
  --alarm-name "High-CPU-i-xxx" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=InstanceId,Value=i-xxx \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:ap-northeast-2:xxx:my-topic

# 상태 확인 실패 시 자동 복구
aws cloudwatch put-metric-alarm \
  --alarm-name "Auto-Recover-i-xxx" \
  --metric-name StatusCheckFailed_System \
  --namespace AWS/EC2 \
  --statistic Maximum \
  --period 60 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=InstanceId,Value=i-xxx \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:automate:ap-northeast-2:ec2:recover
```

---

## 트러블슈팅

### 인스턴스 접속 불가

```bash
# 1. 인스턴스 상태 확인
aws ec2 describe-instance-status --instance-ids i-xxx

# 2. 시스템 로그 확인
aws ec2 get-console-output --instance-id i-xxx

# 3. 스크린샷 확인 (GUI 부팅 문제)
aws ec2 get-console-screenshot --instance-id i-xxx

# 체크리스트:
# - [ ] 인스턴스가 running 상태인가?
# - [ ] 퍼블릭 IP 또는 Elastic IP가 있는가?
# - [ ] 보안 그룹에서 SSH(22) 포트가 열려있는가?
# - [ ] 라우팅 테이블에 인터넷 게이트웨이가 있는가?
# - [ ] NACL에서 트래픽이 허용되는가?
# - [ ] SSH 키가 올바른가?
```

### 디스크 용량 부족

```bash
# 1. 디스크 사용량 확인
df -h

# 2. 큰 파일 찾기
sudo du -sh /* 2>/dev/null | sort -hr | head -20

# 3. 오래된 로그 정리
sudo journalctl --vacuum-time=7d
sudo find /var/log -type f -name "*.gz" -delete

# 4. 패키지 캐시 정리
sudo yum clean all  # Amazon Linux
sudo apt clean      # Ubuntu

# 5. EBS 볼륨 확장 (필요 시)
aws ec2 modify-volume --volume-id vol-xxx --size 100
```

### 높은 CPU 사용률

```bash
# 1. CPU를 많이 사용하는 프로세스 확인
top -b -n 1 | head -20

# 2. 프로세스별 상세 분석
pidstat -u 1 5

# 3. 특정 프로세스 추적
strace -p <PID> -c

# 4. T 시리즈의 경우 CPU 크레딧 확인
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUCreditBalance \
  --dimensions Name=InstanceId,Value=i-xxx \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

### 높은 메모리 사용률

```bash
# 1. 메모리 사용량 확인
free -h

# 2. 프로세스별 메모리 사용량
ps aux --sort=-%mem | head -20

# 3. OOM Killer 로그 확인
dmesg | grep -i "out of memory"

# 4. 스왑 확인
swapon --show
```

### 네트워크 문제

```bash
# 1. 연결 상태 확인
ss -tuln

# 2. 특정 포트 리스닝 확인
ss -tuln | grep :8080

# 3. 패킷 손실 확인
ping -c 100 <target_ip>

# 4. DNS 확인
nslookup example.com
dig example.com

# 5. 라우팅 확인
traceroute <target_ip>

# 6. iptables 규칙 확인
sudo iptables -L -n
```

---

## 실무 체크리스트

### 인스턴스 선택

- [ ] 워크로드 특성 분석 (CPU/메모리/I/O 집약적)
- [ ] 최신 세대 인스턴스 선택
- [ ] Graviton 호환성 검토
- [ ] 사이즈는 작게 시작

### 보안

- [ ] IMDSv2 강제
- [ ] EBS 암호화 기본 활성화
- [ ] 보안 그룹 최소 권한
- [ ] SSH 대신 SSM Session Manager 사용
- [ ] VPC Flow Logs 활성화

### 비용 최적화

- [ ] Compute Optimizer 권장 사항 확인
- [ ] 개발/테스트에 Spot 인스턴스 활용
- [ ] 프로덕션에 Savings Plans 검토
- [ ] 정기적 Right Sizing 수행

### 고가용성

- [ ] 다중 AZ 배치
- [ ] Auto Scaling 구성
- [ ] 배치 그룹 검토
- [ ] 자동 복구 알람 설정

### 모니터링

- [ ] CloudWatch Agent 설치 (메모리, 디스크)
- [ ] 주요 메트릭 알람 설정
- [ ] 상태 확인 실패 자동 복구

---

## 결론

EC2는 AWS의 가장 기본적인 서비스지만, 제대로 활용하려면 깊은 이해가 필요하다.

**핵심 포인트**:

1. **인스턴스 선택**: 워크로드 특성에 맞는 패밀리 선택, 최신 세대와 Graviton 활용
2. **스토리지**: gp3를 기본으로, 워크로드에 따라 io2 또는 인스턴스 스토리지 선택
3. **네트워킹**: VPC 설계, 보안 그룹 최소 권한, 배치 그룹 활용
4. **Auto Scaling**: Target Tracking을 기본으로, Predictive Scaling과 Warm Pool 검토
5. **비용 최적화**: Spot + Savings Plans 조합, 정기적 Right Sizing
6. **보안**: IMDSv2, EBS 암호화, SSM Session Manager
7. **모니터링**: CloudWatch Agent로 메모리/디스크 수집, 알람 자동화

---

## 참고 자료

- [AWS EC2 공식 문서](https://docs.aws.amazon.com/ec2/)
- [EC2 인스턴스 타입](https://aws.amazon.com/ec2/instance-types/)
- [AWS Graviton](https://aws.amazon.com/ec2/graviton/)
- [EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/)
- [AWS Compute Optimizer](https://aws.amazon.com/compute-optimizer/)
- [EC2 요금](https://aws.amazon.com/ec2/pricing/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
