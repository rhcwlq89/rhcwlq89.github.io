# 스프링 사전과제 가이드 로드맵

Spring Boot 기반 사전과제에서 자주 나오는 유형과 체크 포인트를 정리한 가이드 시리즈입니다.

## 시리즈 구성

| 구분 | 편 | 주제 |
|:---:|:---|:---|
| **기본** | 1편 | Core Application Layer |
| **기본** | 2편 | Database & Testing |
| **기본** | 3편 | Documentation & AOP |
| **심화** | 4편 | Performance & Optimization |
| **심화** | 5편 | Security & Authentication |
| **심화** | 6편 | DevOps & Deployment |
| **심화** | 7편 | Advanced Patterns |
| **실전** | 종합 과제 | 온라인 마켓플레이스 API |

---

## 1편: Core Application Layer

> REST API, Service, Repository, Domain 계층의 핵심 구현 가이드

### 다루는 내용

| 섹션 | 주요 토픽 |
|------|----------|
| **REST API (Presentation Layer)** | CRUD-HttpMethod 매핑, URI 설계 원칙, 응답 구조 설계, DTO Validation, Command 패턴 |
| **Business Logic (Service Layer)** | 트랜잭션 관리, `@Transactional(readOnly=true)`, 비즈니스 로직 분리 |
| **DB/Query (Repository Layer)** | JpaRepository 활용, `deleteAll` vs `deleteAllInBatch`, 쿼리 최적화 |
| **Domain (Entity Layer)** | Entity 설계, 연관관계 매핑, Lombok 사용 주의점 |
| **Global Exception Handler** | 예외 처리 전략, 핸들러 우선순위, 로깅 |

### 실무 팁 & 논쟁

- PUT vs PATCH 논쟁
- CommonResponse 패턴 논쟁
- Command 패턴 도입 시점
- Soft Delete vs Hard Delete
- Entity에서의 Lombok 사용

---

## 2편: Database & Testing

> 데이터베이스 설정과 테스트 전략 가이드

### 다루는 내용

| 섹션 | 주요 토픽 |
|------|----------|
| **데이터베이스 설정** | H2/MySQL 설정, `ddl-auto` 환경별 설정, 프로파일 분리 |
| **Repository 테스트** | `@DataJpaTest`, Memory Repository 패턴 |
| **Service 테스트** | Mock vs 실제 객체, 테스트 격리 |
| **Controller 테스트** | MockMvc 활용 (Java/Kotlin), `@WebMvcTest` |

### 실무 팁 & 논쟁

- `ddl-auto` 환경별 설정 가이드
- `@DataJpaTest` vs `@SpringBootTest`
- Mock vs 실제 객체 논쟁
- H2 vs Testcontainers
- 테스트 커버리지 기준

### 코드 샘플

- Java Controller 테스트 (MockMvc)
- Kotlin Controller 테스트 (MockMvc)
- Kotlin Controller 테스트 (Kotest + MockMvc)

---

## 3편: Documentation & Cross-cutting Concerns

> API 문서화, 로깅, AOP 등 횡단 관심사 가이드

### 다루는 내용

| 섹션 | 주요 토픽 |
|------|----------|
| **Swagger** | SpringDoc OpenAPI 설정, 어노테이션 활용, 문서화 범위 |
| **Spring REST Docs** | 테스트 기반 문서화, AsciiDoc 템플릿, Swagger와 비교 |
| **Logging** | SLF4J 설정, 로그 레벨 전략, MDC 활용 |
| **AOP** | 공통 관심사 분리, 커스텀 어노테이션, 실행 시간 측정 |

### 실무 팁 & 논쟁

- Swagger 문서화 범위
- 로깅 성능 고려사항
- MDC vs 분산 추적 시스템
- AOP 남용 주의
- AOP vs Filter vs Interceptor
- 과제 Plus Alpha 팁

### 코드 샘플

- Spring REST Docs 테스트 (Java/Kotlin)
- AsciiDoc 템플릿 예시
- MDC 필터 구현

---

## 4편: Performance & Query Optimization

> 성능 최적화와 쿼리 튜닝 가이드

### 다루는 내용

| 섹션 | 주요 토픽 |
|------|----------|
| **N+1 문제 해결** | Fetch Join, `@EntityGraph`, `@BatchSize`, 지연로딩 전략 |
| **페이지네이션** | Offset vs Cursor 기반, `Pageable` 활용, 무한 스크롤 구현 |
| **캐싱 전략** | Spring Cache 추상화, `@Cacheable`, Redis/Caffeine 적용 |
| **쿼리 최적화** | QueryDSL 동적 쿼리, Projection, Native Query 활용 시점 |
| **인덱스 설계** | 복합 인덱스, 커버링 인덱스, 실행 계획 분석 |

### 실무 팁 & 논쟁

- 즉시로딩 vs 지연로딩 선택 기준
- QueryDSL vs JPQL vs Native Query
- 캐시 무효화 전략
- Offset 페이지네이션의 한계

---

## 5편: Security & Authentication

> 인증/인가와 보안 설정 가이드

### 다루는 내용

| 섹션 | 주요 토픽 |
|------|----------|
| **Spring Security 기초** | SecurityFilterChain, 인증 흐름 이해 |
| **JWT 인증** | Access Token / Refresh Token, 토큰 저장 위치 |
| **비밀번호 관리** | BCrypt 암호화, PasswordEncoder |
| **API 권한 관리** | `@PreAuthorize`, Role 기반 접근 제어 |
| **CORS 설정** | 허용 Origin 설정, Preflight 요청 처리 |

### 실무 팁 & 논쟁

- Session vs JWT 논쟁
- Access Token 저장 위치 (LocalStorage vs Cookie)
- Refresh Token Rotation
- 권한 체크 위치 (Filter vs AOP vs Service)

---

## 6편: DevOps & Deployment

> 배포 환경 구성과 CI/CD 가이드

### 다루는 내용

| 섹션 | 주요 토픽 |
|------|----------|
| **Docker** | Dockerfile 작성, 멀티 스테이지 빌드, 이미지 최적화 |
| **Docker Compose** | 로컬 개발 환경 구성, 서비스 의존성 관리 |
| **GitHub Actions** | CI 파이프라인, 테스트 자동화, 빌드 캐싱 |
| **프로파일 관리** | 환경별 설정 분리, 환경변수 관리, Secrets 처리 |
| **Actuator & Monitoring** | Health Check, Prometheus 메트릭, Graceful Shutdown |

### 실무 팁 & 논쟁

- JIB vs Dockerfile
- GitHub Actions vs Jenkins vs GitLab CI
- 환경변수 vs application.yml
- Blue-Green vs Rolling 배포

---

## 7편: Advanced Patterns

> 고급 패턴과 아키텍처 가이드

### 다루는 내용

| 섹션 | 주요 토픽 |
|------|----------|
| **이벤트 기반 아키텍처** | `ApplicationEventPublisher`, `@EventListener`, `@TransactionalEventListener` |
| **비동기 처리** | `@Async`, `CompletableFuture`, 스레드풀 설정 |
| **파일 처리** | Multipart 업로드, S3 연동, 대용량 파일 스트리밍 |
| **API 버저닝** | URI vs Header vs Parameter 방식, 버전 관리 전략 |
| **아키텍처 패턴** | Hexagonal Architecture, Clean Architecture 개요 |
| **멀티 모듈 프로젝트** | api/domain/infra/common 분리, 의존성 역전, Gradle 설정 |

### 실무 팁 & 논쟁

- 이벤트 vs 직접 호출 선택 기준
- 동기 vs 비동기 처리 판단
- 로컬 파일 vs 클라우드 스토리지
- 아키텍처 오버엔지니어링 주의
- 싱글 모듈 vs 멀티 모듈 선택 기준

---

## 학습 순서 권장

```
[기본] 1편 → 2편 → 3편
[심화] 4편 → 5편 → 6편 → 7편
```

### 기본 과정 (필수)

1. **1편 (Core Layer)**: 기본적인 계층 구조와 책임 분리 이해
2. **2편 (DB & Testing)**: 테스트 작성 방법과 DB 설정 학습
3. **3편 (Documentation & AOP)**: 문서화와 횡단 관심사 처리

### 심화 과정 (가산점)

4. **4편 (Performance)**: 쿼리 최적화와 캐싱으로 성능 개선
5. **5편 (Security)**: 인증/인가 구현으로 보안 강화
6. **6편 (DevOps)**: Docker와 CI/CD로 배포 자동화
7. **7편 (Advanced)**: 고급 패턴으로 확장성 있는 설계

---

## 체크리스트 요약

### 필수 체크 항목

- [ ] REST API 설계 원칙 준수 (HTTP Method, URI, 응답 코드)
- [ ] DTO Validation 적용 (`@Valid`, `@NotBlank` 등)
- [ ] Service 계층 트랜잭션 관리
- [ ] Global Exception Handler 구현
- [ ] 테스트 코드 작성 (최소 Service, Repository)
- [ ] README 작성 (실행 방법, 기술 선택 이유)

### 가산점 항목 (3편까지)

- [ ] Swagger 또는 REST Docs로 API 문서화
- [ ] 로깅 전략 수립 (MDC 활용)
- [ ] AOP를 활용한 공통 관심사 분리

### 추가 가산점 항목 (4편 이후)

- [ ] N+1 문제 인지 및 해결 (Fetch Join, @EntityGraph)
- [ ] 페이지네이션 적용 (Pageable)
- [ ] 캐싱 적용 (Spring Cache)
- [ ] Spring Security + JWT 인증 구현
- [ ] Docker Compose로 실행 환경 구성
- [ ] GitHub Actions CI/CD 구성
- [ ] 이벤트 기반 처리 적용 (@EventListener)
- [ ] 비동기 처리 적용 (@Async)

---

## 관련 링크

### 완성된 가이드

- [1편: Core Application Layer](/blog/spring-boot-pre-interview-guide-1)
- [2편: Database & Testing](/blog/spring-boot-pre-interview-guide-2)
- [3편: Documentation & Cross-cutting Concerns](/blog/spring-boot-pre-interview-guide-3)

### 심화 가이드

- [4편: Performance & Query Optimization](/blog/spring-boot-pre-interview-guide-4)
- [5편: Security & Authentication](/blog/spring-boot-pre-interview-guide-5)
- [6편: DevOps & Deployment](/blog/spring-boot-pre-interview-guide-6)
- [7편: Advanced Patterns](/blog/spring-boot-pre-interview-guide-7)

### 실전 과제

- [종합 과제: 온라인 마켓플레이스 API](/blog/spring-boot-pre-interview-assignment)
