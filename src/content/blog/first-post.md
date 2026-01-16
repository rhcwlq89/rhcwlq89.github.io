---
title: "Spring Boot Pre-interview Task Guide"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-16
tags: ["Spring Boot", "REST API", "Backend", "Interview"]
---

대부분 과제는 크게 3가지 정도로 나뉘는 것 같다.

1. REST API 구현
2. 코드 리뷰
3. 특정 도메인 비즈니스 로직 구현

1번, 2번 유형은 유의할 점들은 동일하고 3번의 경우만 조금 다르지만, 대체로 인증부 구현, 동시성 이슈 처리, API 연동 정도를 크게 벗어나진 않을 것 같다.

---

## REST API (Controller 또는 Presentation Layer)

### 1. CRUD 와 HttpMethod가 잘 매핑되어 있는지 체크

### 2. URI가 자원의 위치를 명확하게 표현하는지 체크

```text
/* 상품 도메인
 * GET    /products/{productId}  : 상품 단건 조회
 * GET    /products              : 상품 목록 조회
 * POST   /products              : 상품 생성
 * PUT    /products/{productId}  : 상품 수정
 * DELETE /products/{productId}  : 상품 삭제
 */

/* 회원 도메인
 * POST   /auth/signup           : 회원가입
 * POST   /auth/login            : 로그인
 * POST   /auth/logout           : 로그아웃
 * POST   /auth/refresh          : 토큰 재발급(JWT일 경우)
 * GET    /auth/me               : 내정보 조회
 */
```
