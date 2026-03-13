---
title: "스프링 사전과제 가이드 6편: DevOps & Deployment"
description: "배포 환경 구성과 CI/CD - Docker, GitHub Actions, Actuator"
pubDate: 2026-01-19T10:00:00+09:00
tags: ["Spring Boot", "Docker", "GitHub Actions", "DevOps", "Backend", "사전과제"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [5편: Security](/blog/spring-boot-pre-interview-guide-5) | **6편: DevOps** | [7편: Advanced Patterns](/blog/spring-boot-pre-interview-guide-7) |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고

---

## 서론

Docker와 CI/CD를 구성하면 평가자가 별도의 환경 설정 없이 바로 실행해볼 수 있어 좋은 인상을 줄 수 있다.

**6편에서 다루는 내용:**
- Docker & 멀티 스테이지 빌드
- Docker Compose
- GitHub Actions CI
- 프로파일 관리
- Actuator & Monitoring

### 목차

- [Docker](#docker)
- [Docker Compose](#docker-compose)
- [GitHub Actions](#github-actions)
- [프로파일 관리](#프로파일-관리)
- [Actuator & Monitoring](#actuator--monitoring)
- [정리](#정리)

---

## Docker

### 1. 기본 Dockerfile

```dockerfile
FROM eclipse-temurin:17-jdk-alpine

WORKDIR /app

COPY build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 2. 멀티 스테이지 빌드

빌드와 실행 환경을 분리하여 이미지 크기를 줄인다.

```dockerfile
# Build stage
FROM gradle:8.5-jdk17 AS builder

WORKDIR /app

# 의존성 캐싱을 위해 gradle 파일만 먼저 복사
COPY build.gradle settings.gradle ./
COPY gradle ./gradle

# 의존성 다운로드 (캐시 활용)
RUN gradle dependencies --no-daemon || true

# 소스 코드 복사 및 빌드
COPY src ./src
RUN gradle bootJar --no-daemon -x test

# Runtime stage
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# 빌드된 jar 파일만 복사
COPY --from=builder /app/build/libs/*.jar app.jar

# 보안: non-root 사용자로 실행
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

<details>
<summary>💡 이미지 크기 비교</summary>

| 방식 | 베이스 이미지 | 예상 크기 |
|------|-------------|----------|
| JDK + 소스 전체 | eclipse-temurin:17-jdk | ~500MB |
| JDK + JAR만 | eclipse-temurin:17-jdk-alpine | ~350MB |
| JRE + JAR만 | eclipse-temurin:17-jre-alpine | ~200MB |

**팁**: `-alpine` 이미지는 크기가 작지만, 일부 네이티브 라이브러리 호환 문제가 있을 수 있다.

</details>

### 3. .dockerignore

```plaintext
# .dockerignore
.git
.gitignore
.idea
*.iml
.gradle
build
!build/libs/*.jar
node_modules
*.md
docker-compose*.yml
Dockerfile*
```

### 4. 빌드 및 실행

```bash
# JAR 빌드 (테스트 스킵)
./gradlew bootJar -x test

# Docker 이미지 빌드
docker build -t my-app:latest .

# 컨테이너 실행
docker run -d -p 8080:8080 --name my-app my-app:latest

# 로그 확인
docker logs -f my-app
```

<details>
<summary>💬 JIB vs Dockerfile</summary>

| 방식 | 장점 | 단점 |
|------|------|------|
| **Dockerfile** | 유연성 높음, 표준 방식 | Docker 데몬 필요, 수동 최적화 |
| **JIB** | Docker 데몬 불필요, 자동 레이어 최적화, 빠른 빌드 | Gradle/Maven 플러그인 의존 |

**JIB 설정 예시** (build.gradle):

```groovy
plugins {
    id 'com.google.cloud.tools.jib' version '3.4.0'
}

jib {
    from {
        image = 'eclipse-temurin:17-jre-alpine'
    }
    to {
        image = 'my-app'
        tags = ['latest', project.version]
    }
    container {
        jvmFlags = ['-Xms512m', '-Xmx512m']
        ports = ['8080']
    }
}
```

```bash
# Docker 데몬 없이 로컬 Docker에 빌드
./gradlew jibDockerBuild
```

**과제에서 권장**: Dockerfile이 더 보편적이고 이해하기 쉬움

</details>

---

## Docker Compose

### 1. 기본 구성

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=docker
      - SPRING_DATASOURCE_URL=jdbc:mysql://db:3306/myapp?useSSL=false&allowPublicKeyRetrieval=true
      - SPRING_DATASOURCE_USERNAME=root
      - SPRING_DATASOURCE_PASSWORD=password
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      - MYSQL_ROOT_PASSWORD=password
      - MYSQL_DATABASE=myapp
    volumes:
      - mysql_data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mysql_data:
```

### 2. Redis 포함 구성

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=docker
      - SPRING_DATASOURCE_URL=jdbc:mysql://db:3306/myapp?useSSL=false&allowPublicKeyRetrieval=true
      - SPRING_DATASOURCE_USERNAME=root
      - SPRING_DATASOURCE_PASSWORD=password
      - SPRING_DATA_REDIS_HOST=redis
      - SPRING_DATA_REDIS_PORT=6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=password
      - MYSQL_DATABASE=myapp
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  mysql_data:
```

### 3. 개발용 구성 (DB만)

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  db:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      - MYSQL_ROOT_PASSWORD=password
      - MYSQL_DATABASE=myapp
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
```

### 4. 실행 명령어

```bash
# 전체 서비스 실행
docker-compose up -d

# 빌드 후 실행
docker-compose up -d --build

# 로그 확인
docker-compose logs -f app

# 특정 서비스만 실행
docker-compose up -d db

# 서비스 중지 및 삭제
docker-compose down

# 볼륨까지 삭제
docker-compose down -v
```

<details>
<summary>💡 Docker Compose 팁</summary>

**depends_on과 healthcheck**:
- `depends_on`만으로는 컨테이너 시작 순서만 보장
- 실제 서비스 준비 완료를 위해 `healthcheck` + `condition: service_healthy` 사용

**환경 변수 관리**:
```yaml
# .env 파일 사용
services:
  db:
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_PASSWORD}
```

```bash
# .env 파일
DB_PASSWORD=secure_password
```

**네트워크**:
- 같은 docker-compose 내 서비스는 서비스명으로 통신 가능
- 예: `jdbc:mysql://db:3306/myapp` (db는 서비스명)

</details>

---

## GitHub Actions

### 1. 기본 CI 파이프라인

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Grant execute permission for gradlew
        run: chmod +x gradlew

      - name: Cache Gradle packages
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
          restore-keys: |
            ${{ runner.os }}-gradle-

      - name: Build with Gradle
        run: ./gradlew build

      - name: Run tests
        run: ./gradlew test

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: build/reports/tests/
```

### 2. 테스트 커버리지 포함

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Grant execute permission for gradlew
        run: chmod +x gradlew

      - name: Cache Gradle packages
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
          restore-keys: |
            ${{ runner.os }}-gradle-

      - name: Build and Test with Coverage
        run: ./gradlew build jacocoTestReport

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          file: build/reports/jacoco/test/jacocoTestReport.xml
          fail_ci_if_error: false
```

JaCoCo 설정 (build.gradle):

```groovy
plugins {
    id 'jacoco'
}

jacoco {
    toolVersion = "0.8.11"
}

jacocoTestReport {
    dependsOn test
    reports {
        xml.required = true
        html.required = true
    }
}

test {
    finalizedBy jacocoTestReport
}
```

### 3. Docker 이미지 빌드 및 푸시

```yaml
# .github/workflows/docker.yml
name: Docker Build and Push

on:
  push:
    branches: [ main ]
    tags: [ 'v*' ]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Build JAR
        run: ./gradlew bootJar -x test

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ secrets.DOCKER_USERNAME }}/my-app
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

<details>
<summary>💬 GitHub Actions vs Jenkins vs GitLab CI</summary>

| 도구 | 장점 | 단점 |
|------|------|------|
| **GitHub Actions** | GitHub 통합, 무료 제공량, 마켓플레이스 | GitHub 종속 |
| **Jenkins** | 유연성, 플러그인 풍부 | 설정 복잡, 인프라 필요 |
| **GitLab CI** | GitLab 통합, 기본 제공 | GitLab 종속 |

**과제에서 권장**: GitHub에서 관리하는 과제라면 GitHub Actions가 가장 간단

</details>

<details>
<summary>💡 GitHub Actions 팁</summary>

**Secrets 설정**:
- Repository → Settings → Secrets and variables → Actions
- `DOCKER_USERNAME`, `DOCKER_PASSWORD` 등 민감 정보 저장

**캐시 활용**:
- Gradle 의존성 캐시로 빌드 시간 단축
- `actions/cache@v4` 사용

**조건부 실행**:
```yaml
- name: Deploy
  if: github.ref == 'refs/heads/main'
  run: ./deploy.sh
```

**Matrix 빌드**:
```yaml
strategy:
  matrix:
    java: [17, 21]
steps:
  - uses: actions/setup-java@v4
    with:
      java-version: ${{ matrix.java }}
```

</details>

---

## 프로파일 관리

### 1. 환경별 설정 파일

```
src/main/resources/
├── application.yml           # 공통 설정
├── application-local.yml     # 로컬 개발
├── application-dev.yml       # 개발 서버
├── application-docker.yml    # Docker 환경
├── application-prod.yml      # 운영 환경
└── application-test.yml      # 테스트
```

### 2. 공통 설정

```yaml
# application.yml
spring:
  application:
    name: my-app
  jpa:
    open-in-view: false
    properties:
      hibernate:
        default_batch_fetch_size: 100

server:
  port: 8080

logging:
  level:
    root: INFO
```

### 3. 환경별 설정

```yaml
# application-local.yml
spring:
  datasource:
    url: jdbc:h2:mem:testdb
    driver-class-name: org.h2.Driver
    username: sa
    password:
  h2:
    console:
      enabled: true
  jpa:
    hibernate:
      ddl-auto: create-drop
    show-sql: true

logging:
  level:
    org.hibernate.SQL: DEBUG
    com.example: DEBUG
```

```yaml
# application-docker.yml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:db}:${DB_PORT:3306}/${DB_NAME:myapp}?useSSL=false&allowPublicKeyRetrieval=true
    driver-class-name: com.mysql.cj.jdbc.Driver
    username: ${DB_USERNAME:root}
    password: ${DB_PASSWORD:password}
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false

logging:
  level:
    root: INFO
    com.example: INFO
```

```yaml
# application-prod.yml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
  jpa:
    hibernate:
      ddl-auto: none
    show-sql: false

logging:
  level:
    root: WARN
    com.example: INFO

server:
  shutdown: graceful

management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
```

### 4. 프로파일 활성화

```bash
# 명령줄
java -jar app.jar --spring.profiles.active=prod

# 환경변수
export SPRING_PROFILES_ACTIVE=prod
java -jar app.jar

# Docker
docker run -e SPRING_PROFILES_ACTIVE=docker my-app

# Docker Compose
environment:
  - SPRING_PROFILES_ACTIVE=docker
```

<details>
<summary>💬 환경변수 vs application.yml</summary>

| 방식 | 장점 | 단점 | 사용 시점 |
|------|------|------|----------|
| **application.yml** | 버전 관리, 가독성 | 빌드 시 고정 | 기본 설정, 비민감 정보 |
| **환경변수** | 런타임 변경, 민감 정보 분리 | 관리 어려움 | 비밀번호, API Key 등 |

**권장 패턴**:
- 기본값은 application.yml에 설정
- 민감 정보는 환경변수로 오버라이드
- `${DB_PASSWORD:default}` 형태로 기본값 제공

</details>

---

## Actuator & Monitoring

### 1. Actuator 설정

```groovy
// build.gradle
implementation 'org.springframework.boot:spring-boot-starter-actuator'
```

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
      base-path: /actuator
  endpoint:
    health:
      show-details: when_authorized
  info:
    env:
      enabled: true

info:
  app:
    name: ${spring.application.name}
    version: 1.0.0
    description: My Spring Boot Application
```

### 2. Health Check 커스터마이징

```java
@Component
public class CustomHealthIndicator implements HealthIndicator {

    private final DataSource dataSource;

    public CustomHealthIndicator(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public Health health() {
        try (Connection connection = dataSource.getConnection()) {
            if (connection.isValid(1)) {
                return Health.up()
                    .withDetail("database", "Available")
                    .build();
            }
        } catch (SQLException e) {
            return Health.down()
                .withDetail("database", "Unavailable")
                .withException(e)
                .build();
        }
        return Health.down().build();
    }
}
```

### 3. Prometheus 메트릭

```groovy
// build.gradle
implementation 'io.micrometer:micrometer-registry-prometheus'
```

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  metrics:
    tags:
      application: ${spring.application.name}
```

### 4. 커스텀 메트릭

```java
@Component
@RequiredArgsConstructor
public class OrderMetrics {

    private final MeterRegistry meterRegistry;
    private Counter orderCounter;
    private Timer orderProcessingTimer;

    @PostConstruct
    public void init() {
        orderCounter = Counter.builder("orders.created")
            .description("Number of orders created")
            .register(meterRegistry);

        orderProcessingTimer = Timer.builder("orders.processing.time")
            .description("Order processing time")
            .register(meterRegistry);
    }

    public void incrementOrderCount() {
        orderCounter.increment();
    }

    public void recordProcessingTime(long milliseconds) {
        orderProcessingTimer.record(Duration.ofMillis(milliseconds));
    }
}
```

### 5. Graceful Shutdown

```yaml
# application.yml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

```java
@Component
@RequiredArgsConstructor
public class GracefulShutdownHandler {

    private static final Logger log = LoggerFactory.getLogger(GracefulShutdownHandler.class);

    @PreDestroy
    public void onShutdown() {
        log.info("Application is shutting down gracefully...");
        // 진행 중인 작업 완료 대기 등
    }
}
```

<details>
<summary>💡 Actuator 보안 팁</summary>

**프로덕션 노출 엔드포인트 제한**:
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus  # 필요한 것만
```

**인증 적용**:
```java
@Bean
public SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/actuator/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/health").permitAll()
            .requestMatchers("/actuator/**").hasRole("ADMIN")
        )
        .build();
}
```

**별도 포트 사용**:
```yaml
management:
  server:
    port: 9090  # 내부 네트워크에서만 접근
```

</details>

---

## 정리

### 체크리스트

| 항목 | 확인 |
|------|------|
| Dockerfile이 작성되어 있는가? | ⬜ |
| Docker Compose로 로컬 실행이 가능한가? | ⬜ |
| README에 실행 방법이 명시되어 있는가? | ⬜ |
| GitHub Actions CI가 설정되어 있는가? | ⬜ |
| 환경별 프로파일이 분리되어 있는가? | ⬜ |
| 민감 정보가 환경변수로 분리되어 있는가? | ⬜ |
| Actuator health 엔드포인트가 활성화되어 있는가? | ⬜ |

### 핵심 포인트

1. **Docker**: 멀티 스테이지 빌드로 이미지 최적화, .dockerignore 활용
2. **Docker Compose**: depends_on + healthcheck로 시작 순서 보장
3. **GitHub Actions**: 캐시 활용, 테스트 자동화, 커버리지 리포트
4. **프로파일**: 환경별 설정 분리, 민감 정보는 환경변수로

### README 템플릿

````markdown
## 실행 방법

### 로컬 실행 (H2)

```bash
./gradlew bootRun --args='--spring.profiles.active=local'
```

### Docker Compose 실행

```bash
# 전체 서비스 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f app

# 종료
docker-compose down
```

### 접속 정보

- API: http://localhost:8080
- Swagger: http://localhost:8080/swagger-ui.html
- H2 Console: http://localhost:8080/h2-console (로컬 프로파일)
- Actuator: http://localhost:8080/actuator/health
````

<details>
<summary>⚠️ 과제에서 흔한 실수</summary>

1. **Docker Compose 실행 불가**
   - 환경변수 누락, 포트 충돌
   - 반드시 클린 환경에서 테스트

2. **프로파일 미지정 시 에러**
   - 기본 프로파일 설정 또는 H2 폴백 제공
   - application.yml에 기본 동작 가능하도록 설정

3. **GitHub Actions 빌드 실패**
   - gradlew 실행 권한 (`chmod +x`)
   - 테스트 실패 무시 금지 (문제 수정 필요)

4. **민감 정보 노출**
   - application.yml에 실제 비밀번호 하드코딩
   - GitHub 공개 저장소에 secret 푸시

</details>

<details>
<summary>💬 Blue-Green vs Rolling 배포</summary>

| 방식 | 특징 | 장점 | 단점 |
|------|------|------|------|
| **Blue-Green** | 두 환경 전환 | 즉시 롤백, 다운타임 없음 | 리소스 2배 필요 |
| **Rolling** | 점진적 교체 | 리소스 효율적 | 롤백 느림, 버전 혼재 |
| **Canary** | 일부에만 적용 | 위험 최소화 | 구현 복잡 |

**과제에서**: 배포 전략까지 구현할 필요는 없지만, README에 언급하면 가산점

</details>


<details>
<summary>📊 Prometheus + Grafana 모니터링 설정</summary>

**1. Spring Boot Actuator + Micrometer 설정**

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health, info, prometheus, metrics
  endpoint:
    health:
      show-details: when_authorized
  metrics:
    tags:
      application: ${spring.application.name}
```

```groovy
// build.gradle
implementation 'org.springframework.boot:spring-boot-starter-actuator'
implementation 'io.micrometer:micrometer-registry-prometheus'
```

**2. Docker Compose에 Prometheus/Grafana 추가**

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=docker

  prometheus:
    image: prom/prometheus:v2.45.0
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'

  grafana:
    image: grafana/grafana:10.0.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  grafana-data:
```

**3. Prometheus 설정 파일**

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['app:8080']
```

**4. Grafana 대시보드 설정**

1. `http://localhost:3000` 접속 (admin/admin)
2. Data Sources > Add data source > Prometheus
3. URL: `http://prometheus:9090`
4. Import Dashboard > ID: `4701` (JVM Micrometer) 또는 `11378` (Spring Boot Statistics)

**과제에서**: 모니터링 설정까지 구현하면 가산점. 최소한 `/actuator/health` 엔드포인트는 노출하는 것을 권장.

</details>

---

다음 편에서는 **이벤트 기반 아키텍처**, **비동기 처리**, **멀티 모듈 프로젝트** 에 대해 다룹니다.

👉 [이전: 5편 - Security & Authentication](/blog/spring-boot-pre-interview-guide-5)
👉 [다음: 7편 - Advanced Patterns](/blog/spring-boot-pre-interview-guide-7)