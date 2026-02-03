---
title: "AWS CLI 설정부터 리소스 조회까지 완벽 가이드"
description: "AWS CLI 인증 방법(CloudShell, IAM Identity Center, 액세스 키)과 주요 서비스별 리소스 조회 명령어 총정리"
pubDate: 2026-02-03
tags:
  [
    "AWS",
    "CLI",
    "Cloud",
    "DevOps",
    "Infrastructure",
    "IAM Identity Center",
    "CloudShell",
  ]
heroImage: "../../assets/AWSCliGuide.png"
---

## 서론

AWS CLI(Command Line Interface)는 AWS 서비스를 명령줄에서 관리할 수 있는 도구다.
웹 콘솔보다 빠르게 리소스 상태를 확인하고, 스크립트를 통한 자동화가 가능하다.

이 글에서는 다음 내용을 다룬다:
- AWS CLI 인증 방법 비교 및 설정
- AWS 권장 방식: CloudShell, IAM Identity Center
- 주요 AWS 서비스별 리소스 조회 명령어

---

## 인증 방법 선택

AWS CLI를 사용하려면 먼저 인증이 필요하다. AWS에서는 **장기 액세스 키 대신 임시 자격 증명 방식을 권장**한다.

| 방법 | 보안 | 설치 | 권장 상황 |
|------|-----|------|----------|
| **CloudShell** | 높음 | 불필요 | 빠른 작업, 임시 조회 |
| **IAM Identity Center** | 높음 | 필요 | 조직 환경, 다중 계정 |
| **액세스 키 + aws-vault** | 중간 | 필요 | 로컬 자동화, CI/CD |
| **액세스 키 (평문)** | 낮음 | 필요 | 비권장 |

---

## 방법 1: AWS CloudShell (가장 간단)

**CloudShell**은 브라우저에서 바로 사용할 수 있는 AWS CLI 환경이다.
설치나 인증 설정 없이 AWS 콘솔 로그인만으로 CLI를 사용할 수 있다.

### 사용 방법

1. [AWS 콘솔](https://console.aws.amazon.com) 로그인
2. 상단 메뉴바의 **CloudShell 아이콘** 클릭 (터미널 모양)
3. 터미널에서 바로 명령 실행

```bash
# CloudShell에서 바로 실행 가능 (인증 설정 불필요)
aws s3 ls
aws ec2 describe-instances --region ap-northeast-2
aws lambda list-functions
```

### 장점

- **설치 불필요**: 브라우저만 있으면 됨
- **인증 자동**: 콘솔 로그인 권한 그대로 사용
- **도구 사전 설치**: AWS CLI, git, python, node, jq 등
- **1GB 홈 디렉토리**: 스크립트, 파일 저장 가능 (리전별)
- **무료**: 추가 비용 없음

### 제한 사항

- 브라우저 필요 (로컬 스크립트 자동화 불가)
- 세션 타임아웃 (20분 비활동 시)
- 일부 리전에서만 사용 가능
- 아웃바운드 네트워크 제한 (SSH, VPN 등)

### 권장 사용 케이스

- 빠른 리소스 상태 확인
- 일회성 작업
- CLI 명령어 테스트
- 로컬 환경 설정 없이 작업해야 할 때

---

## 방법 2: IAM Identity Center (조직 환경 권장)

**IAM Identity Center**(구 AWS SSO)는 조직에서 AWS를 사용할 때 권장되는 인증 방식이다.
장기 액세스 키 없이 임시 자격 증명을 사용한다.

> **무료 서비스**: IAM Identity Center와 AWS Organizations 모두 추가 비용 없이 사용할 수 있다.

### Bastion Host와 뭐가 다른가?

둘 다 "중간에서 접근을 관리한다"는 점에서 비슷해 보이지만, **목적과 대상이 완전히 다르다.**

| 구분 | Bastion Host | IAM Identity Center |
|------|--------------|---------------------|
| **목적** | 서버(EC2)에 SSH 접속 | AWS API/콘솔에 인증 |
| **대상** | EC2 인스턴스 (리눅스/윈도우) | AWS 서비스 (S3, EC2, RDS 등) |
| **접근 방식** | SSH (22번 포트) | HTTPS (AWS API) |
| **보호 대상** | 프라이빗 네트워크의 서버 | AWS 계정/리소스 |
| **하는 일** | 서버 안에 들어가서 직접 작업 | AWS 리소스 조회/생성/삭제 |

**비유:**

```
Bastion Host     = 건물 출입구 경비실 → 서버 "안에" 들어가려면 통과
IAM Identity Center = AWS 관리 포털 로그인 → AWS "서비스"를 사용하려면 인증
```

**예시 시나리오:**

```bash
# IAM Identity Center 사용 (AWS API 호출)
aws ec2 describe-instances      # EC2 목록 조회
aws s3 ls                       # S3 버킷 목록
aws rds describe-db-instances   # RDS 인스턴스 조회
# → 서버 "밖에서" AWS 리소스를 관리

# Bastion Host 사용 (서버 접속)
ssh -J bastion@bastion.example.com ec2-user@10.0.1.50
# → 서버 "안에" 들어가서 로그 확인, 파일 수정, 앱 재시작
```

**둘 다 필요한 경우:**

```bash
# 1. IAM Identity Center로 AWS CLI 인증
aws sso login --profile production

# 2. EC2 인스턴스 정보 조회
aws ec2 describe-instances --query 'Reservations[*].Instances[*].[InstanceId,PrivateIpAddress]'

# 3. Bastion Host를 통해 프라이빗 서버에 SSH 접속
ssh -J ubuntu@bastion.example.com ubuntu@10.0.2.100

# 4. 서버 안에서 작업
tail -f /var/log/application.log
```

**정리:**
- **AWS 리소스 관리** (생성, 조회, 삭제) → IAM Identity Center
- **서버 내부 작업** (로그, 설정, 배포) → Bastion Host (또는 SSM Session Manager)

### 사전 요구 사항

IAM Identity Center를 사용하려면 다음이 필요하다:

1. **관리 계정(Management Account)** 에서 설정
2. **AWS Organizations** 활성화
3. **IAM Identity Center** 활성화
4. 사용자 및 권한 세트 생성

> **"조직의 루트를 로드할 수 없습니다" 에러가 발생하는 경우:**
> - 관리 계정이 아닌 멤버 계정에서 접근하고 있음
> - AWS Organizations가 활성화되지 않음
> - IAM 권한이 부족함

### 관리자 초기 설정 (최초 1회)

IAM Identity Center는 **관리 계정의 관리자**가 설정해야 한다. 일반 사용자는 이 단계를 건너뛰고 [CLI 사용자 설정](#sso-설정)으로 이동한다.

#### 1단계: AWS Organizations 활성화

```
AWS 콘솔 → AWS Organizations → 조직 생성
```

이미 조직이 있다면 이 단계는 건너뛴다.

#### 2단계: IAM Identity Center 활성화

```
AWS 콘솔 → IAM Identity Center → 활성화
```

처음 활성화하면 Identity Center 디렉터리가 자동 생성된다.

#### 3단계: 사용자 생성

```
IAM Identity Center → 사용자 → 사용자 추가
```

- 사용자 이름, 이메일 입력
- 이메일로 초대장 발송됨

#### 4단계: 권한 세트 생성

```
IAM Identity Center → 권한 세트 → 권한 세트 생성
```

| 권한 세트 | 설명 |
|----------|------|
| AdministratorAccess | 전체 관리자 권한 |
| PowerUserAccess | IAM 제외 전체 권한 |
| ReadOnlyAccess | 읽기 전용 |
| 사용자 지정 | 필요한 권한만 선택 |

#### 5단계: AWS 계정에 사용자 할당

```
IAM Identity Center → AWS 계정 → 계정 선택 → 사용자 또는 그룹 할당
```

- 사용자/그룹 선택
- 권한 세트 선택
- 할당 완료

#### 필요한 IAM 권한 (관리자용)

관리 계정에서 IAM Identity Center를 설정하려면 다음 권한이 필요하다:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sso:*",
        "sso-directory:*",
        "identitystore:*",
        "organizations:DescribeOrganization",
        "organizations:ListRoots",
        "organizations:ListAccounts",
        "organizations:ListAccountsForParent",
        "organizations:ListOrganizationalUnitsForParent"
      ],
      "Resource": "*"
    }
  ]
}
```

또는 다음 AWS 관리형 정책을 사용한다:
- `AWSSSOMasterAccountAdministrator`
- `AWSSSODirectoryAdministrator`

### AWS CLI 설치

```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Windows
# https://aws.amazon.com/cli/ 에서 MSI 다운로드
```

### SSO 설정

```bash
aws configure sso
```

대화형 프롬프트가 나타난다. 각 항목의 의미는 다음과 같다:

#### 1단계: SSO 세션 정보 입력

```
SSO session name (Recommended): my-company-sso
SSO start URL [None]: https://my-company.awsapps.com/start
SSO region [None]: ap-northeast-2
SSO registration scopes [sso:account:access]:
```

| 항목 | 설명 | 확인 방법 |
|------|------|----------|
| **SSO session name** | 로컬에서 사용할 세션 이름. 자유롭게 지정 | 원하는 이름 입력 (예: `my-company-sso`) |
| **SSO start URL** | IAM Identity Center 포털 URL (AWS가 자동 생성) | AWS 콘솔 → IAM Identity Center → 설정 → 포털 URL |
| **SSO region** | IAM Identity Center가 활성화된 리전 | AWS 콘솔 → IAM Identity Center → 설정 → 리전 |
| **SSO registration scopes** | 접근 범위. 기본값 사용 | 그냥 Enter (기본값: `sso:account:access`) |

**SSO start URL이란?**

IAM Identity Center를 활성화하면 **AWS가 자동으로 포털 URL을 생성**한다. 자체 SSO 서버를 구축할 필요 없다.

```
# AWS가 자동 생성하는 URL 형식
https://d-xxxxxxxxxx.awsapps.com/start

# 사용자 지정 URL로 변경 가능 (선택)
https://my-company.awsapps.com/start
```

**SSO start URL 찾는 방법:**

```
AWS 콘솔 → IAM Identity Center → 설정 → "AWS 액세스 포털 URL"
```

이 URL은 관리자가 IAM Identity Center를 활성화한 후 사용자에게 공유한다.

#### 2단계: 브라우저 인증

위 정보 입력 후 브라우저가 자동으로 열린다:

1. IAM Identity Center 로그인 페이지 표시
2. 사용자 이름/비밀번호 입력 (또는 MFA)
3. "Allow" 클릭하여 CLI 접근 허용

#### 3단계: 계정 및 역할 선택

```
There are 2 AWS accounts available to you.
> Production (123456789012)
  Development (987654321098)

Using the role name "PowerUserAccess"
CLI default client Region [ap-northeast-2]:
CLI default output format [json]:
CLI profile name [PowerUserAccess-123456789012]: production
```

| 항목 | 설명 |
|------|------|
| **AWS accounts** | 접근 가능한 AWS 계정 목록에서 선택 |
| **role name** | 해당 계정에서 사용할 권한 세트 (관리자가 할당한 것) |
| **CLI default client Region** | 기본 리전 (예: `ap-northeast-2`) |
| **CLI default output format** | 출력 형식 (`json`, `table`, `text`) |
| **CLI profile name** | 로컬에서 사용할 프로필 이름. 자유롭게 지정 |

> **팁:** 여러 계정/역할에 접근해야 한다면 `aws configure sso`를 여러 번 실행하여 프로필을 추가한다.

### 사용 방법

```bash
# SSO 로그인 (세션 만료 시)
aws sso login --profile production

# 명령 실행
aws s3 ls --profile production
aws ec2 describe-instances --profile production

# 기본 프로필 설정
export AWS_PROFILE=production
aws s3 ls  # --profile 생략 가능
```

### 설정 파일 예시

**~/.aws/config**

```ini
[profile production]
sso_session = my-company-sso
sso_account_id = 123456789012
sso_role_name = PowerUserAccess
region = ap-northeast-2
output = json

[profile development]
sso_session = my-company-sso
sso_account_id = 987654321098
sso_role_name = PowerUserAccess
region = ap-northeast-2
output = json

[sso-session my-company-sso]
sso_start_url = https://my-company.awsapps.com/start
sso_region = ap-northeast-2
sso_registration_scopes = sso:account:access
```

### 장점

- **장기 액세스 키 불필요**: 유출 위험 최소화
- **임시 자격 증명**: 자동 발급 및 갱신
- **MFA 통합**: Identity Center 레벨에서 적용
- **중앙 관리**: 권한을 한 곳에서 관리
- **다중 계정**: 여러 AWS 계정을 쉽게 전환

### 권장 사용 케이스

- 조직/회사 AWS 환경
- 다중 계정 관리
- 보안 규정 준수가 필요한 환경

---

## 방법 3: IAM 액세스 키 (레거시/특수 상황)

> **주의:** AWS에서는 가능하면 IAM Identity Center나 CloudShell 사용을 권장한다.
> 액세스 키는 CI/CD 파이프라인, 서버 자동화 등 SSO를 사용할 수 없는 상황에서만 사용한다.

### 액세스 키가 필요한 경우

- CI/CD 파이프라인 (GitHub Actions, Jenkins 등)
- 서버에서 실행되는 자동화 스크립트
- IAM Identity Center가 설정되지 않은 환경
- 로컬 개발 환경 (SSO 미지원 시)

### 액세스 키 생성

1. AWS 콘솔 → **IAM** → **사용자(Users)**
2. 사용자 선택 → **보안 자격 증명** 탭
3. **액세스 키 만들기** 클릭
4. 사용 사례: **Command Line Interface (CLI)** 선택
5. 대안 권장 경고 확인 후 체크박스 선택
6. **액세스 키 만들기** 클릭
7. **Access Key ID**와 **Secret Access Key** 저장

> **중요:** Secret Access Key는 이 시점에만 확인 가능하다. 반드시 안전하게 저장한다.

### aws-vault 사용 (권장)

액세스 키를 사용해야 한다면 **aws-vault**로 안전하게 관리한다.
평문 저장 대신 OS 키체인에 암호화하여 저장한다.

```bash
# 설치
brew install aws-vault          # macOS
choco install aws-vault         # Windows

# 자격 증명 추가 (키체인에 암호화 저장)
aws-vault add production
# Enter Access Key ID: AKIA...
# Enter Secret Access Key: ...

# 명령 실행 (임시 토큰 자동 발급)
aws-vault exec production -- aws s3 ls
aws-vault exec production -- aws ec2 describe-instances

# 서브쉘 진입
aws-vault exec production
```

**aws-vault 장점:**

| 항목 | 평문 저장 | aws-vault |
|------|----------|-----------|
| 저장 방식 | ~/.aws/credentials (평문) | OS 키체인 (암호화) |
| 유출 위험 | 파일 접근 시 노출 | 키체인 잠금 필요 |
| 세션 토큰 | 장기 키 직접 사용 | 임시 토큰 자동 발급 |
| MFA 지원 | 수동 | 자동 프롬프트 |

### 평문 저장 (비권장)

SSO나 aws-vault를 사용할 수 없는 경우에만 사용한다.

```bash
aws configure
# AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
# AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# Default region name: ap-northeast-2
# Default output format: json
```

**~/.aws/credentials** (평문 저장됨 - 주의)

```ini
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**~/.aws/config**

```ini
[default]
region = ap-northeast-2
output = json

[profile production]
region = ap-northeast-2
output = table
```

### 보안 주의 사항

- **Root 계정 키 생성 금지**
- **최소 권한 원칙** 적용
- **90일마다 키 교체**
- **미사용 키 삭제**
- **Git에 절대 커밋 금지**
- **.gitignore에 ~/.aws 추가**

---

## EC2 (Elastic Compute Cloud)

### 인스턴스 조회

```bash
# 모든 인스턴스 목록
aws ec2 describe-instances

# 실행 중인 인스턴스만 조회
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running"

# 특정 태그로 필터링
aws ec2 describe-instances \
  --filters "Name=tag:Environment,Values=production"

# 간단한 테이블 형식 출력
aws ec2 describe-instances \
  --query 'Reservations[*].Instances[*].[InstanceId,InstanceType,State.Name,PrivateIpAddress,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### 인스턴스 상태 요약

```bash
# 인스턴스 상태별 개수
aws ec2 describe-instances \
  --query 'Reservations[*].Instances[*].State.Name' \
  --output text | tr '\t' '\n' | sort | uniq -c
```

### 보안 그룹 조회

```bash
# 모든 보안 그룹
aws ec2 describe-security-groups

# 특정 VPC의 보안 그룹
aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=vpc-12345678"

# 보안 그룹 이름과 ID만 출력
aws ec2 describe-security-groups \
  --query 'SecurityGroups[*].[GroupId,GroupName,Description]' \
  --output table
```

### 볼륨(EBS) 조회

```bash
# 모든 EBS 볼륨
aws ec2 describe-volumes

# 사용 가능한 볼륨만 (연결되지 않은)
aws ec2 describe-volumes \
  --filters "Name=status,Values=available"

# 볼륨 요약 정보
aws ec2 describe-volumes \
  --query 'Volumes[*].[VolumeId,Size,State,VolumeType,Attachments[0].InstanceId]' \
  --output table
```

### AMI 조회

```bash
# 내 소유 AMI 목록
aws ec2 describe-images --owners self

# 특정 이름 패턴의 AMI 검색
aws ec2 describe-images \
  --owners self \
  --filters "Name=name,Values=my-app-*"
```

### 키 페어 조회

```bash
aws ec2 describe-key-pairs \
  --query 'KeyPairs[*].[KeyName,KeyPairId,CreateTime]' \
  --output table
```

---

## VPC (Virtual Private Cloud)

### VPC 조회

```bash
# 모든 VPC
aws ec2 describe-vpcs

# VPC 요약
aws ec2 describe-vpcs \
  --query 'Vpcs[*].[VpcId,CidrBlock,State,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### 서브넷 조회

```bash
# 모든 서브넷
aws ec2 describe-subnets

# 특정 VPC의 서브넷
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=vpc-12345678"

# 서브넷 요약
aws ec2 describe-subnets \
  --query 'Subnets[*].[SubnetId,CidrBlock,AvailabilityZone,AvailableIpAddressCount,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### 인터넷 게이트웨이 조회

```bash
aws ec2 describe-internet-gateways \
  --query 'InternetGateways[*].[InternetGatewayId,Attachments[0].VpcId,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### NAT 게이트웨이 조회

```bash
aws ec2 describe-nat-gateways \
  --query 'NatGateways[*].[NatGatewayId,State,SubnetId,VpcId]' \
  --output table
```

### 라우팅 테이블 조회

```bash
aws ec2 describe-route-tables \
  --query 'RouteTables[*].[RouteTableId,VpcId,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

---

## S3 (Simple Storage Service)

### 버킷 목록

```bash
# 모든 버킷
aws s3 ls

# 버킷 상세 정보 (API)
aws s3api list-buckets \
  --query 'Buckets[*].[Name,CreationDate]' \
  --output table
```

### 버킷 내용 조회

```bash
# 버킷 내 객체 목록
aws s3 ls s3://my-bucket/

# 재귀적으로 모든 객체 나열
aws s3 ls s3://my-bucket/ --recursive

# 요약 정보 (총 개수, 크기)
aws s3 ls s3://my-bucket/ --recursive --summarize
```

### 버킷 정책 조회

```bash
aws s3api get-bucket-policy --bucket my-bucket
```

### 버킷 버전 관리 상태

```bash
aws s3api get-bucket-versioning --bucket my-bucket
```

### 버킷 암호화 설정

```bash
aws s3api get-bucket-encryption --bucket my-bucket
```

### 버킷 수명 주기 규칙

```bash
aws s3api get-bucket-lifecycle-configuration --bucket my-bucket
```

---

## RDS (Relational Database Service)

### DB 인스턴스 조회

```bash
# 모든 DB 인스턴스
aws rds describe-db-instances

# 인스턴스 요약
aws rds describe-db-instances \
  --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceClass,Engine,DBInstanceStatus,Endpoint.Address]' \
  --output table
```

### DB 클러스터 조회 (Aurora)

```bash
aws rds describe-db-clusters \
  --query 'DBClusters[*].[DBClusterIdentifier,Engine,Status,Endpoint]' \
  --output table
```

### DB 스냅샷 조회

```bash
# 수동 스냅샷
aws rds describe-db-snapshots \
  --snapshot-type manual \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,DBInstanceIdentifier,SnapshotCreateTime,Status]' \
  --output table

# 자동 스냅샷
aws rds describe-db-snapshots --snapshot-type automated
```

### 파라미터 그룹 조회

```bash
aws rds describe-db-parameter-groups \
  --query 'DBParameterGroups[*].[DBParameterGroupName,DBParameterGroupFamily,Description]' \
  --output table
```

### 서브넷 그룹 조회

```bash
aws rds describe-db-subnet-groups \
  --query 'DBSubnetGroups[*].[DBSubnetGroupName,VpcId,SubnetGroupStatus]' \
  --output table
```

---

## Lambda

### 함수 목록

```bash
# 모든 함수
aws lambda list-functions

# 함수 요약
aws lambda list-functions \
  --query 'Functions[*].[FunctionName,Runtime,MemorySize,Timeout,LastModified]' \
  --output table
```

### 특정 함수 상세 정보

```bash
aws lambda get-function --function-name my-function
```

### 함수 설정 조회

```bash
aws lambda get-function-configuration --function-name my-function
```

### 함수 별칭 조회

```bash
aws lambda list-aliases --function-name my-function
```

### 함수 버전 조회

```bash
aws lambda list-versions-by-function --function-name my-function
```

### 이벤트 소스 매핑 조회

```bash
aws lambda list-event-source-mappings \
  --function-name my-function
```

---

## ECS (Elastic Container Service)

### 클러스터 조회

```bash
# 클러스터 ARN 목록
aws ecs list-clusters

# 클러스터 상세 정보
aws ecs describe-clusters \
  --clusters my-cluster \
  --query 'clusters[*].[clusterName,status,runningTasksCount,pendingTasksCount,activeServicesCount]' \
  --output table
```

### 서비스 조회

```bash
# 서비스 목록
aws ecs list-services --cluster my-cluster

# 서비스 상세 정보
aws ecs describe-services \
  --cluster my-cluster \
  --services my-service \
  --query 'services[*].[serviceName,status,runningCount,desiredCount]' \
  --output table
```

### 태스크 조회

```bash
# 실행 중인 태스크 목록
aws ecs list-tasks --cluster my-cluster

# 태스크 상세 정보
aws ecs describe-tasks \
  --cluster my-cluster \
  --tasks <task-arn>
```

### 태스크 정의 조회

```bash
# 태스크 정의 목록
aws ecs list-task-definitions

# 특정 태스크 정의 상세
aws ecs describe-task-definition --task-definition my-task:1
```

---

## EKS (Elastic Kubernetes Service)

### 클러스터 조회

```bash
# 클러스터 목록
aws eks list-clusters

# 클러스터 상세 정보
aws eks describe-cluster --name my-cluster

# 클러스터 요약
aws eks describe-cluster --name my-cluster \
  --query 'cluster.[name,status,version,endpoint]' \
  --output table
```

### 노드 그룹 조회

```bash
# 노드 그룹 목록
aws eks list-nodegroups --cluster-name my-cluster

# 노드 그룹 상세
aws eks describe-nodegroup \
  --cluster-name my-cluster \
  --nodegroup-name my-nodegroup
```

### Fargate 프로파일 조회

```bash
aws eks list-fargate-profiles --cluster-name my-cluster
```

---

## IAM (Identity and Access Management)

### 사용자 조회

```bash
# 모든 사용자
aws iam list-users \
  --query 'Users[*].[UserName,UserId,CreateDate]' \
  --output table

# 특정 사용자 정보
aws iam get-user --user-name my-user
```

### 역할 조회

```bash
# 모든 역할
aws iam list-roles \
  --query 'Roles[*].[RoleName,CreateDate]' \
  --output table

# 특정 역할의 정책
aws iam list-attached-role-policies --role-name my-role
aws iam list-role-policies --role-name my-role
```

### 정책 조회

```bash
# 고객 관리형 정책
aws iam list-policies --scope Local \
  --query 'Policies[*].[PolicyName,Arn,AttachmentCount]' \
  --output table

# 특정 정책 문서
aws iam get-policy-version \
  --policy-arn arn:aws:iam::123456789012:policy/my-policy \
  --version-id v1
```

### 그룹 조회

```bash
aws iam list-groups \
  --query 'Groups[*].[GroupName,CreateDate]' \
  --output table
```

### 액세스 키 조회

```bash
# 특정 사용자의 액세스 키
aws iam list-access-keys --user-name my-user

# 액세스 키 마지막 사용 정보
aws iam get-access-key-last-used --access-key-id AKIAIOSFODNN7EXAMPLE
```

---

## CloudWatch

### 경보 조회

```bash
# 모든 경보
aws cloudwatch describe-alarms

# 상태별 경보
aws cloudwatch describe-alarms \
  --state-value ALARM \
  --query 'MetricAlarms[*].[AlarmName,StateValue,MetricName]' \
  --output table
```

### 로그 그룹 조회

```bash
# 모든 로그 그룹
aws logs describe-log-groups \
  --query 'logGroups[*].[logGroupName,storedBytes,retentionInDays]' \
  --output table

# 특정 로그 그룹의 스트림
aws logs describe-log-streams \
  --log-group-name /aws/lambda/my-function \
  --order-by LastEventTime \
  --descending
```

### 최근 로그 조회

```bash
# 최근 로그 이벤트
aws logs get-log-events \
  --log-group-name /aws/lambda/my-function \
  --log-stream-name '2024/01/01/[$LATEST]abc123' \
  --limit 50
```

### 메트릭 조회

```bash
# 사용 가능한 메트릭 목록
aws cloudwatch list-metrics --namespace AWS/EC2

# 메트릭 통계 조회
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-1234567890abcdef0 \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average
```

---

## DynamoDB

### 테이블 조회

```bash
# 테이블 목록
aws dynamodb list-tables

# 테이블 상세 정보
aws dynamodb describe-table --table-name my-table

# 테이블 요약
aws dynamodb describe-table --table-name my-table \
  --query 'Table.[TableName,TableStatus,ItemCount,TableSizeBytes]' \
  --output table
```

### 테이블 스캔

```bash
# 테이블 아이템 조회 (주의: 대용량 테이블에서는 비용 발생)
aws dynamodb scan --table-name my-table --limit 10
```

### 글로벌 테이블 조회

```bash
aws dynamodb list-global-tables
```

### 백업 조회

```bash
aws dynamodb list-backups --table-name my-table
```

---

## SQS (Simple Queue Service)

### 대기열 조회

```bash
# 모든 대기열
aws sqs list-queues

# 대기열 속성
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-2.amazonaws.com/123456789012/my-queue \
  --attribute-names All
```

### 대기열 메시지 수

```bash
aws sqs get-queue-attributes \
  --queue-url <queue-url> \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

---

## SNS (Simple Notification Service)

### 토픽 조회

```bash
# 모든 토픽
aws sns list-topics

# 토픽 속성
aws sns get-topic-attributes --topic-arn arn:aws:sns:ap-northeast-2:123456789012:my-topic
```

### 구독 조회

```bash
# 모든 구독
aws sns list-subscriptions

# 특정 토픽의 구독
aws sns list-subscriptions-by-topic --topic-arn <topic-arn>
```

---

## Route 53

### 호스팅 영역 조회

```bash
# 모든 호스팅 영역
aws route53 list-hosted-zones \
  --query 'HostedZones[*].[Id,Name,ResourceRecordSetCount]' \
  --output table
```

### DNS 레코드 조회

```bash
aws route53 list-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --query 'ResourceRecordSets[*].[Name,Type,TTL]' \
  --output table
```

### 헬스 체크 조회

```bash
aws route53 list-health-checks \
  --query 'HealthChecks[*].[Id,HealthCheckConfig.FullyQualifiedDomainName,HealthCheckConfig.Type]' \
  --output table
```

---

## CloudFront

### 배포 조회

```bash
# 모든 배포
aws cloudfront list-distributions \
  --query 'DistributionList.Items[*].[Id,DomainName,Status,Origins.Items[0].DomainName]' \
  --output table
```

### 배포 상세 정보

```bash
aws cloudfront get-distribution --id E1234567890ABC
```

### 캐시 무효화 목록

```bash
aws cloudfront list-invalidations --distribution-id E1234567890ABC
```

---

## Elastic Load Balancing

### ALB/NLB 조회

```bash
# 모든 로드 밸런서
aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[*].[LoadBalancerName,Type,State.Code,DNSName]' \
  --output table
```

### 타겟 그룹 조회

```bash
# 타겟 그룹 목록
aws elbv2 describe-target-groups \
  --query 'TargetGroups[*].[TargetGroupName,Protocol,Port,TargetType]' \
  --output table

# 타겟 헬스 체크
aws elbv2 describe-target-health --target-group-arn <target-group-arn>
```

### 리스너 조회

```bash
aws elbv2 describe-listeners \
  --load-balancer-arn <lb-arn> \
  --query 'Listeners[*].[Protocol,Port,DefaultActions[0].Type]' \
  --output table
```

### Classic ELB 조회

```bash
aws elb describe-load-balancers \
  --query 'LoadBalancerDescriptions[*].[LoadBalancerName,DNSName,Scheme]' \
  --output table
```

---

## ElastiCache

### 클러스터 조회

```bash
# Redis/Memcached 클러스터
aws elasticache describe-cache-clusters \
  --query 'CacheClusters[*].[CacheClusterId,Engine,CacheNodeType,CacheClusterStatus]' \
  --output table
```

### 복제 그룹 조회 (Redis)

```bash
aws elasticache describe-replication-groups \
  --query 'ReplicationGroups[*].[ReplicationGroupId,Status,NodeGroups[0].PrimaryEndpoint.Address]' \
  --output table
```

---

## Secrets Manager

### 시크릿 목록

```bash
aws secretsmanager list-secrets \
  --query 'SecretList[*].[Name,LastChangedDate,LastAccessedDate]' \
  --output table
```

### 시크릿 상세 정보

```bash
aws secretsmanager describe-secret --secret-id my-secret
```

---

## Systems Manager (SSM)

### 파라미터 조회

```bash
# 파라미터 목록
aws ssm describe-parameters \
  --query 'Parameters[*].[Name,Type,LastModifiedDate]' \
  --output table

# 파라미터 값 조회
aws ssm get-parameter --name /my/parameter --with-decryption
```

### 관리형 인스턴스 조회

```bash
aws ssm describe-instance-information \
  --query 'InstanceInformationList[*].[InstanceId,PingStatus,LastPingDateTime,PlatformName]' \
  --output table
```

---

## 유용한 팁

### 출력 형식

```bash
# JSON (기본값)
aws ec2 describe-instances --output json

# 테이블
aws ec2 describe-instances --output table

# 텍스트
aws ec2 describe-instances --output text

# YAML
aws ec2 describe-instances --output yaml
```

### JMESPath 쿼리

```bash
# 특정 필드만 추출
--query 'Items[*].{Name: Name, Status: Status}'

# 필터링
--query 'Items[?Status==`ACTIVE`]'

# 첫 번째 항목
--query 'Items[0]'

# 정렬
--query 'sort_by(Items, &Name)'
```

### 페이지네이션

```bash
# 최대 항목 수 제한
aws s3api list-objects-v2 --bucket my-bucket --max-items 100

# 자동 페이지네이션 (모든 결과)
aws s3api list-objects-v2 --bucket my-bucket --no-paginate
```

### 결과를 jq로 처리

```bash
# jq 설치
brew install jq  # macOS
apt install jq   # Ubuntu

# 사용 예시
aws ec2 describe-instances | jq '.Reservations[].Instances[] | {id: .InstanceId, state: .State.Name}'
```

### 리소스 전체 조회 스크립트

```bash
#!/bin/bash
# 주요 리소스 요약 스크립트

echo "=== EC2 Instances ==="
aws ec2 describe-instances \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,InstanceType]' \
  --output table

echo -e "\n=== RDS Instances ==="
aws rds describe-db-instances \
  --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus,Engine]' \
  --output table

echo -e "\n=== S3 Buckets ==="
aws s3 ls

echo -e "\n=== Lambda Functions ==="
aws lambda list-functions \
  --query 'Functions[*].[FunctionName,Runtime]' \
  --output table

echo -e "\n=== ECS Clusters ==="
aws ecs list-clusters
```

---

## 결론

AWS CLI를 활용하면 콘솔보다 빠르게 리소스 상태를 파악할 수 있다.

핵심 포인트:
- `--query` 옵션으로 필요한 정보만 추출
- `--output table`로 가독성 향상
- `--filters`로 원하는 리소스만 조회
- 자주 사용하는 명령어는 alias나 스크립트로 저장

CLI 명령어에 익숙해지면 운영 효율성이 크게 향상된다.
