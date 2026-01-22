---
title: "스프링 사전과제 가이드: 종합 과제"
description: "실무형 Spring Boot 백엔드 개발 과제 - 온라인 마켓플레이스 API 구현"
pubDate: 2026-02-05
tags: ["Spring Boot", "사전과제", "Backend", "REST API", "Assignment"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 |
|:---:|:---:|
| [7편: Advanced Patterns](/blog/spring-boot-pre-interview-guide-7) | **종합 과제** |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고
>
> 이 과제는 1~7편에서 다룬 모든 내용을 종합적으로 활용하는 실전 과제입니다.

---

## 과제 개요

온라인 마켓플레이스의 백엔드 API를 구현합니다. 판매자는 상품을 등록하고, 구매자는 상품을 검색하여 주문할 수 있습니다.

### 제출 기한

- **기한**: 과제 수령일로부터 7일

### 기술 스택

- **필수**: Java 17+ 또는 Kotlin, Spring Boot 3.x, JPA/Hibernate, Gradle
- **데이터베이스**: H2 (로컬), MySQL 8.0 (Docker)
- **선택**: QueryDSL, Redis

---

## 비즈니스 요구사항

### 1. 회원 관리

- 회원 유형: `BUYER`(구매자), `SELLER`(판매자), `ADMIN`(관리자)
- 회원가입 시 이메일 중복 검사
- 로그인 시 JWT 토큰 발급 (Access Token + Refresh Token)
- 판매자는 사업자등록번호 필수 입력

### 2. 상품 관리 (판매자 전용)

- 상품 등록/수정/삭제 (본인 상품만)
- 상품 이미지 업로드 (최대 5장, 각 10MB 이하)
- 상품 상태: `DRAFT`(임시저장), `ON_SALE`(판매중), `SOLD_OUT`(품절), `DELETED`(삭제)
- 재고 관리

### 3. 상품 조회 (전체 공개)

- 상품 목록 조회 (페이지네이션, 검색, 필터링)
- 상품 상세 조회
- 카테고리별 조회
- 인기 상품 목록 (캐싱 적용)

### 4. 주문 관리

- 구매자: 주문 생성, 주문 취소, 주문 내역 조회
- 판매자: 본인 상품 주문 확인, 배송 상태 변경
- 주문 상태: `PENDING`(대기) → `CONFIRMED`(확정) → `SHIPPED`(배송중) → `DELIVERED`(배송완료)
- 주문 취소는 `PENDING`, `CONFIRMED` 상태에서만 가능

### 5. 알림

- 주문 생성 시 판매자에게 알림 (비동기)
- 배송 상태 변경 시 구매자에게 알림 (비동기)
- 알림은 로그로 대체 (실제 발송 구현 불필요)

---

## API 명세

### 인증 API

| Method | URI | Description | 인증 |
|--------|-----|-------------|------|
| POST | `/api/v1/auth/signup` | 회원가입 | X |
| POST | `/api/v1/auth/login` | 로그인 | X |
| POST | `/api/v1/auth/refresh` | 토큰 갱신 | X |

### 회원 API

| Method | URI | Description | 인증 |
|--------|-----|-------------|------|
| GET | `/api/v1/members/me` | 내 정보 조회 | O |
| PATCH | `/api/v1/members/me` | 내 정보 수정 | O |
| GET | `/api/v1/admin/members` | 회원 목록 (관리자) | ADMIN |

### 상품 API

| Method | URI | Description | 인증 |
|--------|-----|-------------|------|
| POST | `/api/v1/products` | 상품 등록 | SELLER |
| GET | `/api/v1/products` | 상품 목록 조회 | X |
| GET | `/api/v1/products/{productId}` | 상품 상세 조회 | X |
| PATCH | `/api/v1/products/{productId}` | 상품 수정 | SELLER (본인) |
| DELETE | `/api/v1/products/{productId}` | 상품 삭제 | SELLER (본인) |
| POST | `/api/v1/products/{productId}/images` | 상품 이미지 업로드 | SELLER (본인) |
| GET | `/api/v1/products/popular` | 인기 상품 목록 | X |

### 주문 API

| Method | URI | Description | 인증 |
|--------|-----|-------------|------|
| POST | `/api/v1/orders` | 주문 생성 | BUYER |
| GET | `/api/v1/orders` | 내 주문 목록 | O |
| GET | `/api/v1/orders/{orderId}` | 주문 상세 조회 | O (본인) |
| POST | `/api/v1/orders/{orderId}/cancel` | 주문 취소 | BUYER (본인) |
| GET | `/api/v1/sellers/orders` | 판매자 주문 목록 | SELLER |
| PATCH | `/api/v1/sellers/orders/{orderId}/status` | 배송 상태 변경 | SELLER |

### 카테고리 API

| Method | URI | Description | 인증 |
|--------|-----|-------------|------|
| GET | `/api/v1/categories` | 카테고리 목록 | X |
| POST | `/api/v1/admin/categories` | 카테고리 등록 | ADMIN |

---

## 상세 요구사항

### 1. 인증/인가

```
[요구사항]
- JWT 기반 인증 (Access Token: 1시간, Refresh Token: 7일)
- 비밀번호는 BCrypt로 암호화
- Role 기반 접근 제어 (BUYER, SELLER, ADMIN)
- 리소스 소유자 검증 (본인 상품/주문만 수정 가능)
```

### 2. 상품 검색/필터링

```
GET /api/v1/products?keyword=노트북&categoryId=1&minPrice=100000&maxPrice=2000000&status=ON_SALE&page=0&size=20&sort=createdAt,desc
```

| Parameter | Type       | Description |
|-----------|------------|-------------|
| keyword | String     | 상품명 검색 (부분 일치) |
| categoryId | Long       | 카테고리 필터 |
| minPrice | BigDecimal | 최소 가격 |
| maxPrice | BigDecimal    | 최대 가격 |
| status | String     | 상품 상태 |
| sellerId | Long       | 판매자 필터 |
| page | Integer    | 페이지 번호 (0부터) |
| size | Integer    | 페이지 크기 (기본 20, 최대 100) |
| sort | String     | 정렬 (createdAt, price, salesCount) |

### 3. 주문 생성

```json
// POST /api/v1/orders
{
  "orderItems": [
    {
      "productId": 1,
      "quantity": 2
    },
    {
      "productId": 3,
      "quantity": 1
    }
  ],
  "shippingAddress": {
    "zipCode": "12345",
    "address": "서울시 강남구 테헤란로 123",
    "addressDetail": "456호",
    "receiverName": "홍길동",
    "receiverPhone": "010-1234-5678"
  }
}
```

```
[주문 처리 규칙]
- 재고 확인 후 차감 (동시성 고려)
- 여러 판매자 상품 동시 주문 가능 (판매자별 주문 분리)
- 주문 생성 시 판매자에게 알림 이벤트 발행
- 재고 부족 시 주문 실패 처리
```

### 4. 파일 업로드

```
[요구사항]
- 지원 확장자: jpg, jpeg, png, gif
- 최대 파일 크기: 10MB
- 상품당 최대 5장
- 저장 경로: /uploads/products/{productId}/{filename}
- 파일명은 UUID로 변환하여 저장
```

### 5. 캐싱

```
[캐싱 대상]
- 인기 상품 목록: 10분 TTL
- 카테고리 목록: 1시간 TTL
- 상품 상세 (선택): 5분 TTL, 수정 시 무효화
```

### 6. 로깅

```
[요구사항]
- 모든 요청에 고유 Request ID 부여 (MDC)
- API 요청/응답 로깅 (AOP)
- 로그 포맷: [timestamp] [level] [requestId] [class] message
```

---

## 기술 요구사항

### 프로젝트 구조 선택

다음 두 가지 구조 중 하나를 선택하여 구현합니다.

#### Option A: 싱글 모듈 (권장)

```
marketplace/
└── src/main/java/com/example/
    ├── controller/
    ├── service/
    ├── repository/
    ├── domain/
    ├── dto/
    └── config/
```

#### Option B: 멀티 모듈 (도전)

```
marketplace/
├── marketplace-api/           # Controller, Security, 실행
├── marketplace-domain/        # Entity, Service, Repository 인터페이스
├── marketplace-infra/         # Repository 구현, 외부 연동
└── marketplace-common/        # 공통 예외, 유틸리티
```

> **멀티 모듈 선택 시 추가 요구사항**:
> - 의존성 방향: api → domain ← infra, common은 모든 모듈에서 사용 가능
> - domain 모듈은 infra를 의존하지 않음 (Repository는 인터페이스만 정의)
> - infra 모듈에서 Repository 인터페이스 구현

### 필수 구현

| 항목 | 설명 |
|------|------|
| **계층 분리** | Controller → Service → Repository, DTO/Command 분리 |
| **예외 처리** | GlobalExceptionHandler, 커스텀 예외, 일관된 에러 응답 |
| **Validation** | Request DTO에 Bean Validation 적용 |
| **트랜잭션** | Service 계층 트랜잭션 관리, readOnly 분리 |
| **테스트** | Controller, Service, Repository 테스트 (각 1개 이상) |
| **API 문서** | Swagger 또는 REST Docs |
| **Docker** | Dockerfile + docker-compose.yml (App + MySQL) |
| **README** | 실행 방법, 기술 선택 이유, API 문서 링크 |

### 선택 구현 (가산점)

| 항목 | 설명 |
|------|------|
| **멀티 모듈** | api/domain/infra/common 분리, 의존성 역전 적용 |
| **QueryDSL** | 동적 검색 쿼리 |
| **Redis 캐싱** | 인기 상품 캐싱 |
| **GitHub Actions** | CI 파이프라인 (빌드, 테스트) |
| **테스트 커버리지** | JaCoCo 70% 이상 |
| **이벤트 기반** | 주문/알림 이벤트 분리 |
| **Kotlin** | Kotlin으로 구현 |

---

## 데이터 모델 (참고)

```
Member
├── id (PK)
├── email (UNIQUE)
├── password (encrypted)
├── name
├── phone
├── role (BUYER, SELLER, ADMIN)
├── businessNumber (SELLER only)
├── createdAt
└── updatedAt

Product
├── id (PK)
├── sellerId (FK → Member)
├── categoryId (FK → Category)
├── name
├── description
├── price
├── stockQuantity
├── status (DRAFT, ON_SALE, SOLD_OUT, DELETED)
├── salesCount
├── createdAt
└── updatedAt

ProductImage
├── id (PK)
├── productId (FK → Product)
├── imageUrl
├── displayOrder
└── createdAt

Category
├── id (PK)
├── name
├── parentId (FK → Category, nullable)
└── displayOrder

Order
├── id (PK)
├── buyerId (FK → Member)
├── orderNumber (UNIQUE)
├── status (PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED)
├── totalAmount
├── shippingAddress (embedded)
├── orderedAt
└── updatedAt

OrderItem
├── id (PK)
├── orderId (FK → Order)
├── productId (FK → Product)
├── sellerId (FK → Member)
├── productName (snapshot)
├── productPrice (snapshot)
├── quantity
└── subtotal
```

---

## 평가 기준

### 기본 점수 (70점)

| 항목 | 배점 | 세부 기준 |
|------|------|----------|
| **기능 구현** | 30점 | 요구사항 충족, 정상 동작 |
| **코드 품질** | 20점 | 가독성, 네이밍, 일관성 |
| **설계** | 10점 | 계층 분리, 책임 분배, 예외 처리 |
| **테스트** | 10점 | 테스트 커버리지, 테스트 품질 |

### 가산점 (35점)

| 항목 | 배점 |
|------|------|
| Docker Compose 실행 가능 | +5점 |
| Swagger/REST Docs 문서화 | +5점 |
| GitHub Actions CI | +5점 |
| 캐싱 적용 (Redis 또는 로컬) | +5점 |
| 이벤트 기반 알림 처리 | +5점 |
| QueryDSL 동적 쿼리 | +5점 |
| 멀티 모듈 구조 (의존성 역전 적용) | +5점 |

### 감점 요소

| 항목 | 감점 |
|------|------|
| 빌드 실패 | -20점 |
| README 누락/부실 | -10점 |
| 테스트 미작성 | -10점 |
| SQL Injection 취약점 | -10점 |
| 비밀번호 평문 저장 | -10점 |
| N+1 문제 (명백한 경우) | -5점 |

---

## 제출 방법

1. GitHub Repository에 코드 업로드
2. README.md에 다음 내용 포함:
   - 실행 방법 (로컬, Docker)
   - 기술 스택 및 선택 이유
   - API 문서 접근 방법
   - 프로젝트 구조 설명
   - 추가 구현 사항
3. Repository URL 제출

---

## 참고 사항

### 실행 환경

**싱글 모듈**
```bash
# 로컬 실행 (H2)
./gradlew bootRun --args='--spring.profiles.active=local'

# Docker Compose 실행
docker-compose up -d
```

**멀티 모듈**
```bash
# 로컬 실행 (H2)
./gradlew :marketplace-api:bootRun --args='--spring.profiles.active=local'

# JAR 빌드
./gradlew :marketplace-api:bootJar

# Docker Compose 실행
docker-compose up -d
```

### 테스트 계정 (시드 데이터)

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@example.com | admin123! |
| SELLER | seller@example.com | seller123! |
| BUYER | buyer@example.com | buyer123! |

### 질문

- 과제 진행 중 질문은 이메일로 문의
- 요구사항 해석이 모호한 경우 합리적으로 판단하여 구현하고 README에 명시

---

## 체크리스트

제출 전 확인해주세요:

- [ ] `./gradlew build` 성공
- [ ] `docker-compose up` 실행 가능
- [ ] Swagger UI 또는 REST Docs 접근 가능
- [ ] 테스트 전체 통과
- [ ] README.md 작성 완료
- [ ] .env, 시크릿 키 등 민감 정보 제외
- [ ] 불필요한 파일 (.idea, .DS_Store 등) 제외

---

## 힌트

<details>
<summary>💡 구현 순서 추천 (싱글 모듈)</summary>

1. **프로젝트 설정**: 의존성, 프로파일 분리, Docker Compose
2. **도메인 설계**: Entity, Repository
3. **인증 구현**: Spring Security, JWT
4. **회원 API**: 가입, 로그인, 내 정보
5. **상품 API**: CRUD, 이미지 업로드
6. **주문 API**: 생성, 조회, 상태 변경
7. **검색/페이징**: 상품 검색, 필터링
8. **캐싱/이벤트**: 인기 상품 캐싱, 알림 이벤트
9. **테스트 작성**: 단위/통합 테스트
10. **문서화**: Swagger 설정, README 작성

</details>

<details>
<summary>💡 구현 순서 추천 (멀티 모듈)</summary>

1. **프로젝트 구조 설정**: settings.gradle, 각 모듈 build.gradle
2. **common 모듈**: 공통 예외, ErrorCode, 유틸리티
3. **domain 모듈**: Entity, Repository 인터페이스, Service
4. **infra 모듈**: Repository 구현체, JPA 설정
5. **api 모듈**: Controller, Security, Swagger
6. **통합 테스트**: api 모듈에서 전체 흐름 테스트
7. **Docker 설정**: 멀티 모듈 빌드 Dockerfile
8. **문서화**: 모듈 구조 다이어그램 포함 README

**주의**: 모듈 분리 후에는 순환 의존성이 발생하지 않도록 주의

</details>

<details>
<summary>💡 동시성 처리 힌트</summary>

재고 차감 시 동시성 문제 해결 방법:

```java
// 1. 비관적 락
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT p FROM Product p WHERE p.id = :id")
Optional<Product> findByIdWithLock(@Param("id") Long id);

// 2. 낙관적 락 + 재시도
@Version
private Long version;
```

</details>

<details>
<summary>💡 이벤트 처리 힌트</summary>

```java
// 주문 생성 후 이벤트 발행
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void handleOrderCreated(OrderCreatedEvent event) {
    // 비동기로 알림 처리
    notificationService.notifySeller(event.getSellerId(), event.getOrderId());
}
```

</details>

<details>
<summary>💡 멀티 모듈 구조 힌트</summary>

**settings.gradle**
```groovy
rootProject.name = 'marketplace'

include 'marketplace-api'
include 'marketplace-domain'
include 'marketplace-infra'
include 'marketplace-common'
```

**모듈별 build.gradle 의존성**
```groovy
// marketplace-common: 의존성 없음 (공통 유틸, 예외)

// marketplace-domain
dependencies {
    implementation project(':marketplace-common')
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
}

// marketplace-infra
dependencies {
    implementation project(':marketplace-common')
    implementation project(':marketplace-domain')
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    runtimeOnly 'com.h2database:h2'
    runtimeOnly 'com.mysql:mysql-connector-j'
}

// marketplace-api (실행 모듈)
dependencies {
    implementation project(':marketplace-common')
    implementation project(':marketplace-domain')
    implementation project(':marketplace-infra')
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-security'
}
```

**Repository 인터페이스/구현 분리**
```java
// marketplace-domain/.../ProductRepository.java (인터페이스)
public interface ProductRepository {
    Product save(Product product);
    Optional<Product> findById(Long id);
}

// marketplace-infra/.../ProductRepositoryImpl.java (구현)
@Repository
@RequiredArgsConstructor
public class ProductRepositoryImpl implements ProductRepository {
    private final ProductJpaRepository jpaRepository;

    @Override
    public Product save(Product product) {
        return jpaRepository.save(product);
    }

    @Override
    public Optional<Product> findById(Long id) {
        return jpaRepository.findById(id);
    }
}
```

**Component 스캔 설정**
```java
// marketplace-api의 Application.java
@SpringBootApplication(scanBasePackages = "com.example")
public class MarketplaceApplication { }
```

</details>

<details>
<summary>💡 멀티 모듈 Docker 빌드 힌트</summary>

```dockerfile
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app

# Gradle 파일 먼저 복사 (캐싱)
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
COPY marketplace-common/build.gradle ./marketplace-common/
COPY marketplace-domain/build.gradle ./marketplace-domain/
COPY marketplace-infra/build.gradle ./marketplace-infra/
COPY marketplace-api/build.gradle ./marketplace-api/

RUN gradle dependencies --no-daemon || true

# 소스 복사 및 빌드
COPY . .
RUN gradle :marketplace-api:bootJar --no-daemon -x test

# Runtime
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /app/marketplace-api/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

</details>

---

**Good Luck!**
