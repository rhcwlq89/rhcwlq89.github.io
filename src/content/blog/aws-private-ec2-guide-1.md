---
title: "AWS Private EC2 운영 가이드 1편: 왜 Private Subnet인가? — ALB + NAT Gateway 표준 아키텍처와 규모별 판단 기준"
description: "EC2를 Private Subnet에 두고 ALB + NAT Gateway로 감싸는 표준 아키텍처의 '왜'를 정리한다. Public IPv4 vs Elastic IP, 규모별 추천 구성, HA 개념, 그리고 개인정보를 다룰 때 Public Subnet이 왜 리스크인지 구체적으로 본다. Bastion 없는 AWS EC2 운영 시리즈의 1편."
pubDate: 2026-04-24T10:00:00+09:00
tags:
  - AWS
  - EC2
  - VPC
  - Architecture
  - Private Subnet
  - ALB
  - NAT Gateway
heroImage: "../../assets/AwsPrivateEc2Guide1.png"
---

## 서론

"EC2는 Private Subnet에 두고, ALB와 NAT Gateway로 감싸세요"라는 말은 AWS를 조금만 검색해도 나온다. 하지만 <strong>왜</strong> 그래야 하는지 설명 없이 Terraform 코드부터 보여주는 글이 많다. 이 시리즈는 거기서 출발한다.

5편에 걸쳐 AWS에서 EC2를 Private Subnet에 두고, Bastion 없이 SSM으로 접속하고, GitHub Actions로 배포하고, 비용을 최적화하는 실무 가이드를 다룬다. 1편은 <strong>"왜"에 대한 이야기</strong>다 — 구성을 납득하고 2편으로 넘어가기 위한 토대다.

- <strong>1편 — 왜 Private Subnet인가? (이 글)</strong>
- 2편 — Terraform으로 VPC 인프라 구성하기
- 3편 — SSM Session Manager로 Bastion 없이 접속하기
- 4편 — GitHub Actions + SSM/CodeDeploy CI/CD 파이프라인
- 5편 — 비용 분석과 최적화 전략

이 글의 대상 독자는 "AWS 튜토리얼을 따라 EC2를 만들어봤지만 Private Subnet이나 NAT Gateway가 왜 필요한지는 모르겠는" 주니어다. 다 읽고 나면 <strong>"아, 그래서 이렇게 해야 하는구나"</strong>가 남아야 한다.

---

## TL;DR

- <strong>표준 아키텍처</strong>: `Internet → ALB(Public) → EC2(Private) → NAT(Public) → Internet`. 모두 같은 VPC 안. Public/Private 차이는 물리적 격리가 아닌 <strong>라우트 테이블</strong>(IGW 경로 유무)뿐.
- <strong>Multi-AZ</strong>: ALB 하나가 여러 AZ를 커버한다. Subnet은 AZ마다 만들어야 하지만, <strong>ALB를 AZ마다 만들면 안 된다</strong>.
- <strong>이 구성이 항상 필수는 아니다</strong>: 사이드 프로젝트는 월 $40짜리 Public Subnet + SG로 충분. Private Subnet 풀 구성은 월 $100~320.
- <strong>언제 필수가 되나</strong>: EC2 2대+ HA / 개인정보·결제 / 컴플라이언스(ISMS, PCI DSS 등) / 99.9% SLA — 하나라도 해당하면 넘어갈 때.
- <strong>개인정보 서버를 Public Subnet에 두면 3가지 리스크</strong>: 직접 공격 노출, 컴플라이언스 위반, 사고 시 책임 확대. 이 순간부터 Private Subnet은 "비용이 아니라 보험".

---

## 1. 표준 아키텍처

### 1.1 구성도

```mermaid
flowchart TB
    I1([Internet])
    I2([Internet])
    subgraph VPC["VPC (10.0.0.0/16)"]
        subgraph Public["Public Subnet"]
            ALB[ALB]
            NAT["NAT Gateway<br/>(outbound only)"]
        end
        subgraph Private["Private Subnet"]
            EC2[EC2]
        end
    end
    I1 -->|inbound| ALB
    ALB --> EC2
    EC2 -->|outbound| NAT
    NAT --> I2
```

### 1.2 각 컴포넌트의 역할

먼저 오해하기 쉬운 지점부터. <strong>VPC는 ALB/NAT Gateway/EC2 셋을 모두 감싸는 외곽 박스</strong>다. "ALB와 NAT가 Public Subnet에 있다"는 말은 VPC 바깥이 아니라 <strong>같은 VPC 안의 Public Subnet 구역에 배치된다</strong>는 뜻이다.

Public과 Private의 차이는 물리적 격리가 아니라 <strong>라우트 테이블 설정</strong>이다. Public Subnet은 Internet Gateway로 가는 경로가 있고, Private Subnet은 그 경로가 없을 뿐. (실제 라우트 테이블 코드는 2편에서 다룬다.)

- <strong>EC2는 Private Subnet에 둔다.</strong> 공인 IP가 붙지 않고, 외부에서 직접 접근이 불가능하다. 인바운드 트래픽은 ALB를 통해서만 들어온다.
- <strong>ALB는 Public Subnet에 둔다.</strong> 인터넷에서 들어오는 HTTP/HTTPS 트래픽을 받아서 뒤의 Private EC2로 라우팅한다. EC2의 "대문" 역할.
- <strong>NAT Gateway도 Public Subnet에 둔다.</strong> EC2가 외부 API를 호출하거나, OS 패치를 받거나, 로그를 외부로 전송할 때 쓰는 <strong>아웃바운드 전용 통로</strong>다. 역방향(외부 → EC2) 접근은 불가능하다.
- <strong>Multi-AZ 배치가 프로덕션 기준.</strong> ALB, NAT Gateway, EC2 모두 2개 이상의 AZ에 나눠 둔다. 한 AZ가 장애나도 서비스는 살아있어야 하기 때문이다.

핵심 원칙 하나로 요약하면: <strong>"인바운드는 ALB만, 아웃바운드는 NAT만, 그 외 직접 연결은 전부 차단"</strong>.

### 1.3 참고: Subnet ↔ AZ 관계, 그리고 Multi-AZ가 실제로 뭔지

앞에서 "Multi-AZ가 프로덕션 기준"이라고 했다. 실제 구조를 핵심만.

<strong>핵심 3줄</strong>:

1. <strong>Subnet은 정확히 1개 AZ에 속함</strong> — 만들 때 AZ를 반드시 선택. 한 Subnet에 여러 AZ EC2 불가.
2. <strong>VPC는 리전 전체를 덮음</strong> — 같은 VPC에 AZ별 Subnet 여러 개 만들면 자동 Multi-AZ.
3. <strong>ALB 하나가 여러 AZ 걸쳐서 동작</strong> — AZ별 Public Subnet 여러 개 attach하면 AWS가 cross-AZ 자동 처리. <strong>ALB를 AZ마다 따로 만들면 안 된다</strong>.

<strong>2AZ 실제 구조</strong>:

```mermaid
flowchart TB
    Internet([Internet])
    subgraph VPC["VPC (10.0.0.0/16) — 리전 전체"]
        ALB["ALB<br/>(양쪽 AZ의 Public Subnet에 attach, 단 1개)"]
        subgraph AZa["AZ-a"]
            PubA["Public Subnet<br/>NAT GW A"]
            PriA["Private Subnet<br/>EC2-1"]
        end
        subgraph AZc["AZ-c"]
            PubC["Public Subnet<br/>NAT GW B"]
            PriC["Private Subnet<br/>EC2-2"]
        end
    end
    Internet --> ALB
    ALB --> PriA
    ALB --> PriC
    PriA -.outbound.-> PubA
    PriC -.outbound.-> PubC
```

- VPC 1개 (리전 전체)
- ALB 1개 (양쪽 Public Subnet에 attach)
- Public/Private Subnet 각 AZ마다 1개씩
- NAT Gateway AZ마다 1개 (비용 절감 시 단일 AZ 선택지 — 5편)
- EC2는 각 Private Subnet에 분산

<details>
<summary><strong>더 자세히 — AZ 장애 시 동작, ALB AZ별 금지 이유</strong></summary>

<strong>한 AZ가 죽으면</strong>: AZ-a 전체가 장애나도 AZ-c의 Subnet과 EC2는 살아있다. ALB는 AZ-c로만 트래픽을 보내고, 사용자는 장애를 거의 느끼지 못한다. 이것이 "Multi-AZ로 HA 달성"의 실제 의미.

<strong>왜 ALB를 AZ마다 만들면 안 되는가</strong>:

- ALB 1개 = DNS 엔드포인트 1개. 2개 만들면 Route 53에서 weighted/failover 라우팅을 직접 관리해야 한다.
- AWS가 제공하는 ALB 자체의 AZ 간 가용성을 못 쓰게 된다. ALB는 내부적으로 이미 Multi-AZ다.
- 비용 2배, 운영 복잡도 2배.

</details>

---

---

## 2. 참고: Public IPv4 vs Elastic IP

이 구성에서 EC2에는 공인 IP가 붙지 않는다. 다만 Public Subnet 경험만 있는 독자를 위해 짚고 넘어간다.

Public Subnet에 EC2를 두면 공인 IP가 붙는데, 이 IP에는 두 종류가 있다.

|  | Public IPv4 | Elastic IP (EIP) |
| --- | --- | --- |
| 할당 방식 | EC2 시작 시 자동 부여 | 사용자가 직접 할당 |
| 수명 | EC2 stop/start하면 바뀜 | 명시적으로 릴리스할 때까지 고정 |
| 비용 | 시간당 $0.005 (2024.02~) | 실행 중 EC2에 연결 시 동일. 미연결 시에도 과금 |
| 용도 | 임시 테스트, IP 고정이 불필요할 때 | DNS 연결, IP 화이트리스트, 외부 연동 |
| 연결 대상 | EC2에 자동 연결 | EC2, NAT Gateway, NLB 등에 수동 연결 |

> <strong>참고</strong>: EC2를 stop → start하면 Public IPv4는 바뀐다. DNS에 IP를 직접 등록했다면 접속이 끊기므로, 고정 IP가 필요하면 EIP를 써야 한다. 단, EIP를 할당해놓고 EC2에 붙이지 않으면 놀고 있는 IP에도 과금된다. IPv4 부족으로 AWS가 "안 쓸 거면 반납하라"는 패널티를 매기는 것이다.

<strong>이 구성과의 관계</strong>: Private Subnet의 EC2는 Public IPv4도 EIP도 없다. 외부 노출 자체가 없기 때문이다. 인바운드는 ALB가, 아웃바운드는 NAT Gateway가 처리한다. 이것이 Private Subnet이 보안상 유리한 이유 중 하나다.

---

## 3. 이 구성이 꼭 필요한가? — 규모별 판단

> <strong>참고</strong>: 솔직히 말하면, 소규모 시스템에서 ALB + Private Subnet + NAT Gateway 구성은 오버엔지니어링일 수 있다. NAT Gateway만 월 $43+, ALB도 월 $20+이라 인프라 비용이 서비스 자체보다 비쌀 수 있다.

"표준 아키텍처"라고 해서 모든 서비스가 이 구성을 써야 한다는 뜻은 아니다. 사이드 프로젝트에 프로덕션 구성을 밀어넣는 건 낭비고, 개인정보를 다루면서 비용을 아끼려고 허술하게 두는 건 리스크다. 그 경계선을 구체적으로 본다.

### 3.1 규모별 추천 구성

| 구성 | 월 비용 (대략) | 적합한 경우 |
| --- | --- | --- |
| EC2 Public Subnet + Security Group | ~$40 | 사이드 프로젝트, 1인 운영. SG로 포트 제한만 잘하면 충분 |
| EC2 + Nginx (리버스 프록시) | ~$40 | ALB 없이 EC2에서 직접 Nginx로 라우팅 처리 |
| Lightsail | $10~40 | 가장 저렴. 고정 요금, VPC 설계 불필요 |
| ALB + Private EC2 + NAT Instance | ~$60 | 보안은 챙기되 NAT Gateway 비용을 절감하는 절충안 |
| ALB + Private EC2 + NAT Gateway (이 시리즈) | $100~320 | 중규모 이상, 컴플라이언스 요구, 다인원 팀 |

### 3.2 참고: Nginx(리버스 프록시)와 ALB — 뭐가 다른가

표에 "EC2 + Nginx (리버스 프록시)" 옵션이 있어서 짚고 간다.

- <strong>Nginx</strong> = 오픈소스 웹 서버 / 리버스 프록시. 요청을 받아 뒤쪽 앱(Node.js, Spring 등)으로 중계. HTTPS 종료 · 정적 파일 서빙 · 캐싱 · L7 라우팅까지 EC2 한 대 안에서 처리 가능.
- <strong>ALB</strong>도 사실 리버스 프록시의 한 종류 — AWS가 관리형으로 운영하는 L7 리버스 프록시 + 로드밸런서.

<strong>기능 비교</strong>:

| 기능 | Nginx (EC2 위) | ALB |
| --- | --- | --- |
| L7 라우팅, HTTPS 종료 | O | O |
| 정적 파일 서빙 | O | X (S3/CloudFront 별도) |
| Multi-AZ 가용성 | 해당 EC2 죽으면 끝 | AWS 자동 처리 |
| 헬스 체크 / Auto Scaling | 수동 | 자동 |
| WAF, Shield 연동 | 별도 구축 | 원클릭 |
| 월 비용 | EC2에 포함 | $20+ 별도 |
| 운영 부담 | 직접 관리 | 없음 (관리형) |

L7 라우팅·HTTPS 종료·리버스 프록시 자체는 기능이 겹친다. <strong>EC2 1대뿐이면 ALB는 사치</strong>다 — 로드밸런싱할 대상이 없기 때문.

<strong>어느 상황에 뭘 쓰나</strong>:

| 상황 | 선택 |
| --- | --- |
| EC2 2대+ HA 필요 | <strong>ALB</strong> (Nginx 혼자는 Multi-AZ 못 만듦) |
| Auto Scaling / WAF·Shield·Cognito 연동 | <strong>ALB</strong> |
| EC2 1대 소규모 | <strong>Nginx</strong> |
| 정적 파일 직접 서빙 / Lua·ngx_module 커스터마이징 | <strong>Nginx</strong> |
| 프로덕션 대형 서비스 | <strong>ALB → EC2(Nginx) → 앱</strong> 조합 (역할 분담) |

둘은 경쟁이 아니라 <strong>서로 다른 계층의 역할 분담</strong> 관계다. 프로덕션에서는 ALB가 HA/헬스체크/WAF를 맡고, Nginx가 EC2 안에서 gzip/정적/URL 리라이팅을 맡는 구성이 흔하다.

### 3.3 언제부터 Private Subnet 구성이 필요한가

소규모와 중규모의 경계를 판단하는 구체적 기준:

| 지표 | 소규모 (Public Subnet OK) | 중규모 이상 (Private Subnet 권장) |
| --- | --- | --- |
| 일일 트래픽 | ~10만 요청 이하 | 10만+ 요청 |
| EC2 대수 | 1대 | 2대 이상 (HA 필요) |
| 운영 인원 | 1~2명 | 3명+ (접근 제어 필요) |
| 매출/예산 | 인프라 비용이 매출의 10%+ | 인프라 비용이 매출의 5% 이하 |
| 컴플라이언스 | 없음 | 금융/의료/개인정보 규제 |
| 가용성 요구 | 다운타임 허용 가능 | 99.9%+ SLA |
| 데이터 민감도 | 공개 데이터 위주 | 개인정보, 결제 정보 |

하나라도 "중규모 이상" 쪽에 해당하면 Private Subnet 구성을 검토할 시점이다. 특히 <strong>컴플라이언스와 데이터 민감도</strong>는 트래픽 규모와 상관없이 무조건 "중규모 기준"으로 가야 한다.

### 3.4 참고: 컴플라이언스(Compliance)란?

<strong>컴플라이언스 = 법·규제·업계 표준 준수</strong>. 백엔드 엔지니어 인프라 결정에 직접 영향을 주는 규제:

| 규제 | 적용 대상 | 인프라에 요구하는 핵심 |
| --- | --- | --- |
| 개인정보보호법 (한국) | 개인정보 처리 사업자 전반 | 접근 통제, 암호화, 로그 보관, 망분리 |
| ISMS / ISMS-P (한국) | 일정 규모 이상 IT 기업 | 네트워크 분리, 접근 제어, 감사 로그 |
| 전자금융감독규정 (한국) | 금융 서비스 | 내부망 격리, DR, 암호화 키 관리 |
| HIPAA (미국) | 의료 데이터 | 암호화, 접근 로그, BAA 체결 서비스만 |
| PCI DSS (글로벌) | 신용카드 처리 | 카드번호 암호화, 네트워크 격리, 취약점 스캔 |
| GDPR (EU) | EU 시민 데이터 | 데이터 소재지, 삭제 권리, 동의 관리 |
| SOC 2 (글로벌) | B2B SaaS | 접근 제어, 감사 로그, 변경 관리 |

<strong>공통 요구사항</strong>: 거의 모든 규제가 <strong>네트워크 분리(망분리)</strong>를 요구한다. "개인정보·결제 처리 서버는 인터넷에서 직접 접근 불가" → <strong>Public Subnet에 EC2 직접 띄우기 금지</strong>. Private Subnet + ALB가 <strong>표준 답안</strong>이다.

<strong>주니어가 이걸 마주치는 시점</strong>:

- 회사가 ISMS 인증을 준비할 때
- 스타트업이 엔터프라이즈 고객 유치용으로 SOC 2를 받을 때
- 금융·의료 서비스를 런칭할 때

이 시점이 오면 Private Subnet은 "인프라 비용"이 아니라 <strong>"컴플라이언스 비용"</strong>으로 분류되며, 필수가 된다.

### 3.5 참고: HA(High Availability)란?

위 표에서 "EC2 2대 이상"과 "99.9%+ SLA"가 나왔다. 이건 HA와 직결된 얘기라 짧게 설명하고 넘어간다.

HA는 <strong>"서비스가 죽지 않고 계속 살아있는 상태"</strong>를 말한다. ALB는 HA를 달성하기 위한 도구 중 하나다.

```mermaid
flowchart TD
    HA["HA (목표)<br/>서비스가 항상 떠있어야 한다"]
    HA --> L1["달성 수단 1:<br/>EC2 2대 이상 운영<br/>(하나 죽어도 나머지가 처리)"]
    HA --> L2["달성 수단 2:<br/>ALB로 트래픽 분산<br/>(살아있는 EC2에만 보냄)"]
    HA --> L3["달성 수단 3:<br/>Multi-AZ 배치<br/>(AZ 하나 장애시 다른 AZ가 처리)"]
```

EC2가 1대면 그 서버가 죽는 순간 서비스는 끝이다. 2대 이상이면 하나가 죽어도 나머지가 처리할 수 있고, 이 "하나 죽어도 괜찮은 상태"가 HA다. ALB는 그 2대에 트래픽을 나눠주고, 죽은 EC2는 자동으로 빼주는 역할을 한다.

> <strong>핵심 판단 기준</strong>: Private Subnet 구성의 월 $60~140 추가 비용을 정당화할 수 있는가? 사이드 프로젝트나 초기 스타트업에서 월 $40이면 되는 걸 $140 쓰는 건 낭비고, 반대로 개인정보를 다루는데 비용 아끼려고 Public Subnet에 두는 건 리스크다. 상세 비용 분석은 5편에서 다룬다.

Private Subnet 구성이 필요해지는 구체적 시점을 정리하면:

- 트래픽이 일정 수준 이상이어서 ALB의 로드밸런싱이 실제로 필요할 때
- EC2 2대 이상을 운영하면서 가용성이 중요해질 때
- 보안 컴플라이언스 요구사항이 있을 때 (금융, 의료, 개인정보)
- 팀 규모가 커져서 접근 제어가 필요할 때

---

## 4. 개인정보 + Public Subnet, 3가지 리스크

위에서 "개인정보를 다루는데 비용 아끼려고 Public Subnet에 두는 건 리스크"라고 했다. 이게 막연한 이야기가 아니라 구체적으로 3가지 리스크가 있다.

### 4.1 직접 공격 노출 (Attack Surface 증가)

- <strong>공인 IP는 자동 탐색 대상</strong> — EC2 띄운 지 분 단위로 봇이 22번 포트 브루트포스 시작.
- <strong>SG 설정 실수 한 번에 DB/SSH 전세계 노출</strong> — 매년 이 시나리오로 사고가 난다.
- <strong>직접 노출 = 바로 데이터 유출</strong> — 공격자가 "웹 → 내부망 → DB" 단계를 건너뛴다.
- <strong>Private Subnet + ALB = 방어 레이어 추가</strong> — ALB가 L7에서 비정상 요청 차단, WAF까지 붙이면 공격 탐지/차단.

### 4.2 컴플라이언스 위반

- <strong>규제 자체가 망분리 요건</strong> — 개인정보보호법·ISMS-P: "개인정보 처리 시스템은 외부 네트워크와 물리적/논리적으로 분리."
- <strong>감사 시 즉시 지적 사항</strong> — "Public Subnet + 공인 IP 노출"은 기술적 안전조치 미흡으로 판단.
- <strong>사고 시 "합리적 보호 조치 미이행" 근거</strong> — 법적 책임 범위가 넓어진다.

### 4.3 사고 시 책임 확대

- <strong>Private Subnet + ALB</strong> → 감사에서 "표준 보안 아키텍처 적용했다"고 항변 가능 (AWS Well-Architected 근거).
- <strong>Public Subnet 방치</strong> → "비용 절감 위해 보안 소홀" 판단으로 불리한 근거가 된다.
- <strong>이 판단이 과징금·배상 규모에 직접 영향</strong> — 과실 범위가 커질수록 배상액도 커진다.

> <strong>결론</strong>: 공개 데이터만 다루는 사이드 프로젝트라면 Public Subnet + Security Group으로 충분하다. 하지만 개인정보(회원 데이터, 결제 정보, 민감 정보)가 들어가는 순간 네트워크 레벨 격리(Private Subnet)는 <strong>비용이 아니라 보험</strong>이다. 월 $60~100의 추가 비용과 사고 시 과징금·평판 손해를 비교하면 방향은 명확하다.

실무적으로는 <strong>소규모에는 Public Subnet + SG로 시작하고, 규모가 커지거나 개인정보를 다루게 되면 Private Subnet 구조로 마이그레이션</strong>하는 게 현실적이다. 처음부터 무조건 풀 구성을 잡을 필요는 없지만, 데이터 성격이 바뀌는 순간 주저 없이 넘어가야 한다.

---

## 정리

이 글에서 다룬 핵심:

1. <strong>표준 아키텍처는 "ALB + Private EC2 + NAT Gateway"</strong> 다. 인바운드는 ALB만, 아웃바운드는 NAT만, 그 외 직접 연결은 차단하는 원칙이다.
2. <strong>Public IPv4와 EIP의 차이</strong>를 알아야 왜 Private Subnet 구성에서 둘 다 필요 없는지 이해된다. 외부 노출 자체가 없기 때문이다.
3. <strong>모든 서비스가 이 구성을 써야 하는 건 아니다.</strong> 소규모 사이드 프로젝트에는 월 $40짜리 Public Subnet + SG 구성이 합리적이고, 중규모 이상이거나 컴플라이언스 요구가 있을 때 Private Subnet으로 넘어가면 된다.
4. <strong>HA는 "EC2 2대 + ALB + Multi-AZ"</strong> 로 달성한다. 이게 Private Subnet 구성이 필요해지는 실질적인 전환점 중 하나다.
5. <strong>개인정보 + Public Subnet의 3가지 리스크</strong>: 직접 공격 노출, 컴플라이언스 위반, 사고 시 책임 확대. 개인정보를 다루는 순간 Private Subnet은 비용이 아니라 보험이다.

1편의 목표는 하나였다 — <strong>구성을 납득하는 것</strong>. "왜 Private Subnet인가"에 대해 "어? 그럼 이렇게 해야겠네" 소리가 나오면 됐다. 2편부터는 이 아키텍처를 실제 코드로 만든다.

다음 편에서는 <strong>Terraform으로 VPC 인프라 구성하기</strong> — VPC CIDR 설계부터 2AZ Public/Private Subnet, Route Table, Security Group의 "SG-참조 패턴", ALB와 EC2까지 단일 `main.tf`로 엮어서 `terraform apply` 한 번으로 올리는 과정을 다룬다.

---

## 부록. 이 시리즈에서 자주 나오는 약어

읽다가 헷갈리면 여기로 돌아와서 참고.

| 약어 | 풀이 |
| --- | --- |
| VPC | Virtual Private Cloud. AWS 안에 만드는 나만의 가상 네트워크 |
| Subnet | VPC 안의 IP 대역 구분. Public Subnet(인터넷 연결)과 Private Subnet(내부만)으로 나뉨 |
| ALB | Application Load Balancer. 들어오는 트래픽을 여러 EC2에 분배하는 L7 로드밸런서 |
| NAT | Network Address Translation. Private Subnet의 EC2가 외부 인터넷으로 나갈 수 있게 해주는 장치 |
| AZ | Availability Zone. 하나의 리전 안에 있는 물리적으로 분리된 데이터센터. 서울 리전에는 2a, 2b, 2c, 2d가 있다 |
| SG | Security Group. EC2/ALB 등에 붙는 인스턴스 단위 방화벽 |
| NACL | Network Access Control List. Subnet 단위 방화벽 |
| IAM | Identity and Access Management. AWS의 권한 관리 시스템 |
| SSM | AWS Systems Manager. EC2 통합 관리 서비스 (Session Manager, Run Command 등 포함) |
| CloudTrail | AWS API 호출 기록 서비스. 누가 언제 무엇을 했는지 자동 기록 |
