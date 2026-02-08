---
title: "Spring Boot Pre-Interview Guide Part 6: DevOps & Deployment"
description: "Deployment environment setup and CI/CD — Docker, GitHub Actions, and Actuator"
pubDate: 2026-02-08T13:50:00+09:00
lang: en
tags: ["Spring Boot", "Docker", "CI/CD", "GitHub Actions", "DevOps", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 5: Security](/en/blog/spring-boot-pre-interview-guide-5) | **Part 6: DevOps** | [Part 7: Advanced Patterns](/en/blog/spring-boot-pre-interview-guide-7) |

> **Full Roadmap**: See the [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)

---

## Introduction

Setting up Docker and CI/CD allows the reviewer to run your project immediately without any additional environment configuration, which leaves a great impression.

**Topics covered in Part 6:**
- Docker & Multi-Stage Builds
- Docker Compose
- GitHub Actions CI
- Profile Management
- Actuator & Monitoring

### Table of Contents

- [Docker](#docker)
- [Docker Compose](#docker-compose)
- [GitHub Actions](#github-actions)
- [Profile Management](#profile-management)
- [Actuator & Monitoring](#actuator--monitoring)
- [Summary](#summary)

---

## Docker

### 1. Basic Dockerfile

```dockerfile
FROM eclipse-temurin:17-jdk-alpine

WORKDIR /app

COPY build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 2. Multi-Stage Build

Separate the build and runtime environments to reduce the image size.

```dockerfile
# Build stage
FROM gradle:8.5-jdk17 AS builder

WORKDIR /app

# Copy only gradle files first for dependency caching
COPY build.gradle settings.gradle ./
COPY gradle ./gradle

# Download dependencies (leverage cache)
RUN gradle dependencies --no-daemon || true

# Copy source code and build
COPY src ./src
RUN gradle bootJar --no-daemon -x test

# Runtime stage
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# Copy only the built jar file
COPY --from=builder /app/build/libs/*.jar app.jar

# Security: run as non-root user
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

<details>
<summary>Image Size Comparison</summary>

| Method | Base Image | Estimated Size |
|------|-------------|----------|
| JDK + Full Source | eclipse-temurin:17-jdk | ~500MB |
| JDK + JAR Only | eclipse-temurin:17-jdk-alpine | ~350MB |
| JRE + JAR Only | eclipse-temurin:17-jre-alpine | ~200MB |

**Tip**: `-alpine` images are smaller, but may have compatibility issues with some native libraries.

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

### 4. Build and Run

```bash
# Build JAR (skip tests)
./gradlew bootJar -x test

# Build Docker image
docker build -t my-app:latest .

# Run container
docker run -d -p 8080:8080 --name my-app my-app:latest

# Check logs
docker logs -f my-app
```

<details>
<summary>JIB vs Dockerfile</summary>

| Method | Pros | Cons |
|------|------|------|
| **Dockerfile** | High flexibility, standard approach | Requires Docker daemon, manual optimization |
| **JIB** | No Docker daemon needed, automatic layer optimization, fast builds | Depends on Gradle/Maven plugin |

**JIB Configuration Example** (build.gradle):

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
# Build to local Docker without Docker daemon
./gradlew jibDockerBuild
```

**Recommended for assignments**: Dockerfile is more universal and easier to understand

</details>

---

## Docker Compose

### 1. Basic Configuration

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

### 2. Configuration with Redis

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

### 3. Development Configuration (DB Only)

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

### 4. Execution Commands

```bash
# Start all services
docker-compose up -d

# Build and start
docker-compose up -d --build

# Check logs
docker-compose logs -f app

# Start a specific service only
docker-compose up -d db

# Stop and remove services
docker-compose down

# Remove volumes as well
docker-compose down -v
```

<details>
<summary>Docker Compose Tips</summary>

**depends_on and healthcheck**:
- `depends_on` alone only guarantees container startup order
- Use `healthcheck` + `condition: service_healthy` to ensure the service is actually ready

**Environment Variable Management**:
```yaml
# Using .env file
services:
  db:
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_PASSWORD}
```

```bash
# .env file
DB_PASSWORD=secure_password
```

**Networking**:
- Services within the same docker-compose can communicate using service names
- Example: `jdbc:mysql://db:3306/myapp` (db is the service name)

</details>

---

## GitHub Actions

### 1. Basic CI Pipeline

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

### 2. With Test Coverage

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

JaCoCo Configuration (build.gradle):

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

### 3. Docker Image Build and Push

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
<summary>GitHub Actions vs Jenkins vs GitLab CI</summary>

| Tool | Pros | Cons |
|------|------|------|
| **GitHub Actions** | GitHub integration, free tier, marketplace | GitHub lock-in |
| **Jenkins** | Flexibility, rich plugins | Complex setup, infrastructure required |
| **GitLab CI** | GitLab integration, built-in | GitLab lock-in |

**Recommended for assignments**: If the project is managed on GitHub, GitHub Actions is the simplest option

</details>

<details>
<summary>GitHub Actions Tips</summary>

**Secrets Configuration**:
- Repository > Settings > Secrets and variables > Actions
- Store sensitive information like `DOCKER_USERNAME`, `DOCKER_PASSWORD`, etc.

**Leveraging Cache**:
- Reduce build time with Gradle dependency caching
- Use `actions/cache@v4`

**Conditional Execution**:
```yaml
- name: Deploy
  if: github.ref == 'refs/heads/main'
  run: ./deploy.sh
```

**Matrix Builds**:
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

## Profile Management

### 1. Environment-Specific Configuration Files

```
src/main/resources/
├── application.yml           # Common settings
├── application-local.yml     # Local development
├── application-dev.yml       # Development server
├── application-docker.yml    # Docker environment
├── application-prod.yml      # Production environment
└── application-test.yml      # Testing
```

### 2. Common Settings

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

### 3. Environment-Specific Settings

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

### 4. Activating Profiles

```bash
# Command line
java -jar app.jar --spring.profiles.active=prod

# Environment variable
export SPRING_PROFILES_ACTIVE=prod
java -jar app.jar

# Docker
docker run -e SPRING_PROFILES_ACTIVE=docker my-app

# Docker Compose
environment:
  - SPRING_PROFILES_ACTIVE=docker
```

<details>
<summary>Environment Variables vs application.yml</summary>

| Method | Pros | Cons | When to Use |
|------|------|------|----------|
| **application.yml** | Version controlled, readable | Fixed at build time | Default settings, non-sensitive info |
| **Environment Variables** | Runtime changes, sensitive info separation | Hard to manage | Passwords, API keys, etc. |

**Recommended Pattern**:
- Set default values in application.yml
- Override sensitive information with environment variables
- Provide default values using `${DB_PASSWORD:default}` syntax

</details>

---

## Actuator & Monitoring

### 1. Actuator Configuration

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

### 2. Custom Health Check

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

### 3. Prometheus Metrics

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

### 4. Custom Metrics

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
        // Wait for in-progress tasks to complete, etc.
    }
}
```

<details>
<summary>Actuator Security Tips</summary>

**Limit exposed endpoints in production**:
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus  # Only what's needed
```

**Apply authentication**:
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

**Use a separate port**:
```yaml
management:
  server:
    port: 9090  # Accessible only from internal network
```

</details>

---

## Summary

### Checklist

| Item | Check |
|------|------|
| Is a Dockerfile written? | ⬜ |
| Can the project run locally via Docker Compose? | ⬜ |
| Are execution instructions specified in the README? | ⬜ |
| Is GitHub Actions CI configured? | ⬜ |
| Are profiles separated by environment? | ⬜ |
| Is sensitive information separated into environment variables? | ⬜ |
| Is the Actuator health endpoint enabled? | ⬜ |

### Key Points

1. **Docker**: Optimize image size with multi-stage builds, use .dockerignore
2. **Docker Compose**: Guarantee startup order with depends_on + healthcheck
3. **GitHub Actions**: Leverage caching, automate tests, generate coverage reports
4. **Profiles**: Separate settings by environment, use environment variables for sensitive info

### README Template

````markdown
## How to Run

### Local Execution (H2)

```bash
./gradlew bootRun --args='--spring.profiles.active=local'
```

### Docker Compose Execution

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f app

# Stop
docker-compose down
```

### Access Information

- API: http://localhost:8080
- Swagger: http://localhost:8080/swagger-ui.html
- H2 Console: http://localhost:8080/h2-console (local profile)
- Actuator: http://localhost:8080/actuator/health
````

<details>
<summary>Common Mistakes in Assignments</summary>

1. **Docker Compose fails to run**
   - Missing environment variables, port conflicts
   - Always test in a clean environment

2. **Error when no profile is specified**
   - Provide a default profile setting or H2 fallback
   - Configure application.yml to work with default behavior

3. **GitHub Actions build failure**
   - gradlew execution permission (`chmod +x`)
   - Do not ignore test failures (fix the issues)

4. **Sensitive information exposure**
   - Hard-coding actual passwords in application.yml
   - Pushing secrets to a public GitHub repository

</details>

<details>
<summary>Blue-Green vs Rolling Deployment</summary>

| Strategy | Characteristics | Pros | Cons |
|------|------|------|------|
| **Blue-Green** | Switch between two environments | Instant rollback, zero downtime | Requires 2x resources |
| **Rolling** | Gradual replacement | Resource efficient | Slow rollback, version mixing |
| **Canary** | Apply to a subset only | Minimized risk | Complex implementation |

**For assignments**: You don't need to implement a deployment strategy, but mentioning it in the README can earn bonus points

</details>


<details>
<summary>Prometheus + Grafana Monitoring Setup</summary>

**1. Spring Boot Actuator + Micrometer Configuration**

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

**2. Add Prometheus/Grafana to Docker Compose**

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

**3. Prometheus Configuration File**

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

**4. Grafana Dashboard Setup**

1. Access `http://localhost:3000` (admin/admin)
2. Data Sources > Add data source > Prometheus
3. URL: `http://prometheus:9090`
4. Import Dashboard > ID: `4701` (JVM Micrometer) or `11378` (Spring Boot Statistics)

**For assignments**: Implementing monitoring earns bonus points. At minimum, it's recommended to expose the `/actuator/health` endpoint.

</details>

---

The next part covers **event-driven architecture**, **asynchronous processing**, and **multi-module projects**.

[Previous: Part 5 - Security & Authentication](/en/blog/spring-boot-pre-interview-guide-5)
[Next: Part 7 - Advanced Patterns](/en/blog/spring-boot-pre-interview-guide-7)
