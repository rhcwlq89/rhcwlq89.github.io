---
title: "Docker Compose 작성 가이드"
description: "Docker Compose를 활용한 멀티 컨테이너 환경 구성 가이드"
pubDate: 2026-01-07
tags:
  [
    "Docker",
    "Docker Compose",
    "DevOps",
    "Container",
    "Infrastructure",
  ]
heroImage: "../../assets/DockerComposeGuide.png"
---

## 서론

이 글은 Docker Compose를 처음 접하거나,
실무에서 활용하고자 하는 개발자를 위한 가이드다.

Docker Compose는 여러 컨테이너를 정의하고 실행하기 위한 도구로,
`docker-compose.yml` 파일 하나로 복잡한 멀티 컨테이너 환경을 쉽게 관리할 수 있다.

특히 로컬 개발 환경 구성, 테스트 환경 구축, CI/CD 파이프라인에서
빈번하게 사용되므로 기본적인 작성법을 익혀두면 유용하다.

---

## 기본 구조

Docker Compose 파일은 YAML 형식으로 작성하며,
크게 `services`, `networks`, `volumes` 세 가지 최상위 키로 구성된다.

```yaml
version: "3.8"  # Compose 파일 버전 (선택사항, 최신 버전에서는 생략 가능)

services:
  # 컨테이너 정의

networks:
  # 네트워크 정의

volumes:
  # 볼륨 정의
```

> **참고**: Docker Compose V2부터 `version` 필드는 선택사항이 되었다.   
> 최신 Docker Desktop을 사용한다면 생략해도 무방하다.

---

## 서비스(Services) 정의

서비스는 실행할 컨테이너를 정의하는 핵심 영역이다.

### 1. 이미지 기반 서비스

공식 이미지나 Docker Hub의 이미지를 사용하는 경우:

```yaml
services:
  mysql:
    image: mysql:8.0
    container_name: my-mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: mydb
      MYSQL_USER: user
      MYSQL_PASSWORD: password
```

### 2. Dockerfile 기반 서비스

직접 작성한 Dockerfile로 이미지를 빌드하는 경우:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: my-app
    ports:
      - "8080:8080"
    depends_on:
      - mysql
```

<details>
<summary>build 옵션 상세</summary>

```yaml
services:
  app:
    build:
      context: .                    # Dockerfile이 있는 경로
      dockerfile: Dockerfile        # Dockerfile 이름 (기본값: Dockerfile)
      args:                         # 빌드 시 전달할 인자
        JAR_FILE: target/*.jar
      target: production            # 멀티스테이지 빌드 시 타겟 스테이지
```

</details>

### 3. 주요 서비스 옵션

| 옵션 | 설명 |
|------|------|
| `image` | 사용할 이미지 이름 |
| `build` | Dockerfile 빌드 설정 |
| `container_name` | 컨테이너 이름 지정 |
| `restart` | 재시작 정책 (no, always, on-failure, unless-stopped) |
| `ports` | 포트 매핑 (호스트:컨테이너) |
| `expose` | 다른 서비스에만 포트 노출 (호스트에는 노출 안 함) |
| `environment` | 환경 변수 설정 |
| `env_file` | 환경 변수 파일 지정 |
| `volumes` | 볼륨 마운트 |
| `depends_on` | 서비스 의존성 정의 |
| `command` | 컨테이너 시작 시 실행할 명령어 |
| `entrypoint` | 컨테이너 엔트리포인트 재정의 |

---

## 환경 변수 설정

### 1. 직접 정의

```yaml
services:
  app:
    environment:
      - SPRING_PROFILES_ACTIVE=local
      - DB_HOST=mysql
      - DB_PORT=3306
```

또는 Map 형식으로:

```yaml
services:
  app:
    environment:
      SPRING_PROFILES_ACTIVE: local
      DB_HOST: mysql
      DB_PORT: 3306
```

### 2. 환경 변수 파일 사용

민감한 정보는 `.env` 파일로 분리하는 것이 좋다.

```yaml
services:
  app:
    env_file:
      - .env
      - .env.local
```

<details>
<summary>.env 파일 예시</summary>

```properties
# .env
MYSQL_ROOT_PASSWORD=rootpassword
MYSQL_DATABASE=mydb
MYSQL_USER=user
MYSQL_PASSWORD=password

SPRING_PROFILES_ACTIVE=local
```

</details>

> **주의**: `.env` 파일은 `.gitignore`에 추가하여 버전 관리에서 제외할 것

### 3. 변수 치환

Compose 파일 내에서 환경 변수를 참조할 수 있다:

```yaml
services:
  app:
    image: myapp:${APP_VERSION:-latest}  # 기본값 설정 가능
    ports:
      - "${APP_PORT:-8080}:8080"
```

---

## 볼륨(Volumes) 설정

데이터 영속성을 위해 볼륨을 활용한다.

### 1. Named Volume

Docker가 관리하는 볼륨으로, 데이터 영속성이 필요한 경우 사용:

```yaml
services:
  mysql:
    image: mysql:8.0
    volumes:
      - mysql-data:/var/lib/mysql

volumes:
  mysql-data:  # Named volume 정의
```

### 2. Bind Mount

호스트의 특정 경로를 컨테이너에 마운트:

```yaml
services:
  app:
    volumes:
      - ./src:/app/src          # 소스코드 마운트 (개발용)
      - ./config:/app/config:ro # 읽기 전용 마운트
```

### 3. 볼륨 옵션 (Long Syntax)

긴 형식을 사용하면 더 세밀한 옵션 지정이 가능하다:

```yaml
services:
  app:
    volumes:
      - type: volume
        source: mysql-data
        target: /var/lib/mysql
      - type: bind
        source: ./logs
        target: /app/logs
        read_only: false
```

---

## 네트워크(Networks) 설정

### 1. 기본 네트워크

별도 설정 없이도 같은 Compose 파일의 서비스들은
자동으로 같은 네트워크에 연결되어 서비스명으로 통신 가능하다.

```yaml
services:
  app:
    image: myapp
    # mysql 서비스에 'mysql' 호스트명으로 접근 가능

  mysql:
    image: mysql:8.0
```

### 2. 커스텀 네트워크

```yaml
services:
  app:
    networks:
      - backend
      - frontend

  mysql:
    networks:
      - backend

  nginx:
    networks:
      - frontend

networks:
  backend:
    driver: bridge
  frontend:
    driver: bridge
```

### 3. 외부 네트워크 연결

이미 존재하는 외부 네트워크에 연결:

```yaml
networks:
  existing-network:
    external: true
```

---

## 의존성 관리

### 1. 기본 depends_on

서비스 시작 순서를 정의:

```yaml
services:
  app:
    depends_on:
      - mysql
      - redis
```

### 2. 조건부 의존성

서비스가 정상적으로 시작될 때까지 대기:

```yaml
services:
  app:
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_started

  mysql:
    image: mysql:8.0
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

---

## 실전 예시: Spring Boot + MySQL + Redis

<details>
<summary>docker-compose.yml (전체 예시)</summary>

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: spring-app
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: local
      SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/mydb?useSSL=false&allowPublicKeyRetrieval=true
      SPRING_DATASOURCE_USERNAME: ${DB_USER:-user}
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD:-password}
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PORT: 6379
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - app-network

  mysql:
    image: mysql:8.0
    container_name: mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-rootpassword}
      MYSQL_DATABASE: mydb
      MYSQL_USER: ${DB_USER:-user}
      MYSQL_PASSWORD: ${DB_PASSWORD:-password}
      TZ: Asia/Seoul
    volumes:
      - mysql-data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    networks:
      - app-network

networks:
  app-network:
    driver: bridge

volumes:
  mysql-data:
  redis-data:
```

</details>

<details>
<summary>Dockerfile (Spring Boot)</summary>

```dockerfile
# 멀티스테이지 빌드
FROM eclipse-temurin:17-jdk AS builder
WORKDIR /app
COPY gradlew .
COPY gradle gradle
COPY build.gradle settings.gradle ./
COPY src src
RUN chmod +x ./gradlew && ./gradlew bootJar --no-daemon

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

</details>

<details>
<summary>.env 파일</summary>

```properties
# Database
DB_ROOT_PASSWORD=rootpassword
DB_USER=user
DB_PASSWORD=password

# App
APP_PORT=8080
```

</details>

---

## 자주 사용하는 명령어

### 기본 명령어

```bash
# 서비스 시작 (백그라운드)
docker compose up -d

# 서비스 시작 (로그 출력)
docker compose up

# 서비스 중지
docker compose down

# 서비스 중지 + 볼륨 삭제
docker compose down -v

# 서비스 재시작
docker compose restart

# 특정 서비스만 재시작
docker compose restart app
```

### 빌드 관련

```bash
# 이미지 빌드
docker compose build

# 캐시 없이 빌드
docker compose build --no-cache

# 빌드 후 시작
docker compose up -d --build
```

### 로그 및 상태 확인

```bash
# 전체 로그 확인
docker compose logs

# 특정 서비스 로그 (실시간)
docker compose logs -f app

# 실행 중인 서비스 확인
docker compose ps

# 서비스 상태 확인
docker compose top
```

### 컨테이너 접속

```bash
# 컨테이너 쉘 접속
docker compose exec app /bin/sh

# MySQL 접속
docker compose exec mysql mysql -u root -p
```

---

## 개발 환경 vs 운영 환경 분리

### 1. 파일 분리 방식

```bash
# 개발 환경
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 운영 환경
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

<details>
<summary>docker-compose.dev.yml</summary>

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    volumes:
      - ./src:/app/src  # 소스 코드 마운트 (핫 리로드)
    environment:
      SPRING_PROFILES_ACTIVE: dev
```

</details>

<details>
<summary>docker-compose.prod.yml</summary>

```yaml
services:
  app:
    image: myregistry/myapp:${TAG:-latest}
    restart: always
    environment:
      SPRING_PROFILES_ACTIVE: prod
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

</details>

### 2. 프로파일 방식

```yaml
services:
  app:
    image: myapp
    profiles:
      - prod

  app-dev:
    build: .
    volumes:
      - ./src:/app/src
    profiles:
      - dev

  mysql:
    image: mysql:8.0
    # 프로파일 없음 = 항상 실행
```

```bash
# 개발 환경
docker compose --profile dev up -d

# 운영 환경
docker compose --profile prod up -d
```

---

## 팁과 주의사항

### 1. 보안

- `.env` 파일은 반드시 `.gitignore`에 추가
- 민감한 정보는 Docker Secrets 또는 외부 비밀 관리 도구 사용 권장
- 운영 환경에서는 루트 권한으로 컨테이너 실행 지양

### 2. 성능

- 불필요한 볼륨 마운트는 성능 저하의 원인이 될 수 있음
- 특히 macOS/Windows에서 bind mount는 I/O 성능이 낮음
- `delegated` 또는 `cached` 옵션 활용 고려

```yaml
volumes:
  - ./src:/app/src:delegated
```

### 3. 디버깅

- `docker compose config`로 최종 설정 확인
- `docker compose logs`로 문제 파악
- healthcheck를 활용한 서비스 상태 모니터링

### 4. 리소스 제한

운영 환경에서는 리소스 제한 설정 권장:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### 5. 로깅 설정

로그 파일이 무한히 커지는 것을 방지:

```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

---

## 마무리

Docker Compose는 로컬 개발 환경부터 테스트, 스테이징 환경까지
다양한 상황에서 활용할 수 있는 강력한 도구다.

핵심은 다음과 같다:
1. **services**: 실행할 컨테이너 정의
2. **volumes**: 데이터 영속성 확보
3. **networks**: 서비스 간 통신 설정
4. **환경 변수**: 설정의 유연성 확보
5. **depends_on + healthcheck**: 안정적인 서비스 시작 순서

처음에는 간단한 구성부터 시작하고,
필요에 따라 점진적으로 기능을 추가해 나가는 것을 권장한다.
