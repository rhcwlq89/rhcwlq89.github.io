# Design: Terraform 기본 개념 정리 블로그

## Overview

독립 단독 포스트. Docker/K8s 기본을 아는 개발자가 Terraform을 처음 접할 때 필요한 핵심 개념을 정리한다. 실습 없이 개념 중심이지만 HCL 코드 예시를 충분히 포함.

## Target Audience

DevOps 입문자. Docker/K8s 기본은 알고, 인프라 코드화에 관심 있는 수준. 기존 K8s 시리즈 독자층.

## Structure

1. 서론 — 콘솔 클릭의 한계, 왜 IaC인지
2. IaC란 — 짧게 개념 설명
3. Terraform 소개 — HashiCorp, 멀티 클라우드, 선언형, 오픈소스 (OpenTofu 언급)
4. 다른 도구와 비교 — 간단한 표 하나 (CloudFormation, Pulumi, Ansible)
5. 핵심 개념 — Provider, Resource, Data Source, Variable, Output, State, Module (HCL 예시 포함, AWS 기준)
6. 워크플로우 — init → plan → apply → destroy
7. State 관리 — 로컬 vs 리모트(S3 + DynamoDB)
8. 모듈 — 재사용, 공개 레지스트리
9. 실무 팁 — 디렉토리 구조, .gitignore, tfvars
10. 정리 — 요약, K8s 시리즈 연결 (Terraform → EKS → ArgoCD 전체 그림)

## Blog Conventions

- pubDate with time, KST (+09:00)
- Korean + English versions
- Korean: 반말 체, unquoted pubDate, multi-line tags
- English: practical tone, quoted pubDate, lang: en, single-line tags, extra ../ in heroImage
- 독립 글 (시리즈 아님)
