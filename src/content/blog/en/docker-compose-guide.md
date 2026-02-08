---
title: "Docker Compose Configuration Guide"
description: "A guide to setting up multi-container environments with Docker Compose"
pubDate: 2026-02-08T14:20:00+09:00
lang: en
tags: ["Docker", "Docker Compose", "DevOps", "Infrastructure"]
heroImage: "../../../assets/DockerComposeGuide.png"
---

## Introduction

This guide is for developers who are new to Docker Compose
or want to use it in practice.

Docker Compose is a tool for defining and running multiple containers,
allowing you to easily manage complex multi-container environments with a single `docker-compose.yml` file.

It is especially useful to learn the basics of writing Compose files,
as they are frequently used in local development environments, test environment setups, and CI/CD pipelines.

---

## Basic Structure

Docker Compose files are written in YAML format
and consist of three top-level keys: `services`, `networks`, and `volumes`.

```yaml
version: "3.8"  # Compose file version (optional, can be omitted in recent versions)

services:
  # Container definitions

networks:
  # Network definitions

volumes:
  # Volume definitions
```

> **Note**: Starting from Docker Compose V2, the `version` field is optional.
> If you are using the latest Docker Desktop, you can safely omit it.

---

## Defining Services

Services are the core section where you define the containers to run.

### 1. Image-Based Services

When using official images or images from Docker Hub:

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

### 2. Dockerfile-Based Services

When building an image from a custom Dockerfile:

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
<summary>Build option details</summary>

```yaml
services:
  app:
    build:
      context: .                    # Path where the Dockerfile is located
      dockerfile: Dockerfile        # Dockerfile name (default: Dockerfile)
      args:                         # Arguments to pass during build
        JAR_FILE: target/*.jar
      target: production            # Target stage for multi-stage builds
```

</details>

### 3. Key Service Options

| Option | Description |
|------|------|
| `image` | Image name to use |
| `build` | Dockerfile build configuration |
| `container_name` | Container name |
| `restart` | Restart policy (no, always, on-failure, unless-stopped) |
| `ports` | Port mapping (host:container) |
| `expose` | Expose ports only to other services (not exposed to the host) |
| `environment` | Environment variable settings |
| `env_file` | Environment variable file |
| `volumes` | Volume mounts |
| `depends_on` | Service dependency definition |
| `command` | Command to execute when the container starts |
| `entrypoint` | Override the container entrypoint |

---

## Environment Variable Configuration

### 1. Direct Definition

```yaml
services:
  app:
    environment:
      - SPRING_PROFILES_ACTIVE=local
      - DB_HOST=mysql
      - DB_PORT=3306
```

Or in map format:

```yaml
services:
  app:
    environment:
      SPRING_PROFILES_ACTIVE: local
      DB_HOST: mysql
      DB_PORT: 3306
```

### 2. Using Environment Variable Files

It is recommended to separate sensitive information into `.env` files.

```yaml
services:
  app:
    env_file:
      - .env
      - .env.local
```

<details>
<summary>.env file example</summary>

```properties
# .env
MYSQL_ROOT_PASSWORD=rootpassword
MYSQL_DATABASE=mydb
MYSQL_USER=user
MYSQL_PASSWORD=password

SPRING_PROFILES_ACTIVE=local
```

</details>

> **Warning**: Add the `.env` file to `.gitignore` to exclude it from version control.

### 3. Variable Substitution

You can reference environment variables within the Compose file:

```yaml
services:
  app:
    image: myapp:${APP_VERSION:-latest}  # Default value can be set
    ports:
      - "${APP_PORT:-8080}:8080"
```

---

## Volume Configuration

Volumes are used to ensure data persistence.

### 1. Named Volume

A Docker-managed volume, used when data persistence is required:

```yaml
services:
  mysql:
    image: mysql:8.0
    volumes:
      - mysql-data:/var/lib/mysql

volumes:
  mysql-data:  # Named volume definition
```

### 2. Bind Mount

Mount a specific host path into the container:

```yaml
services:
  app:
    volumes:
      - ./src:/app/src          # Source code mount (for development)
      - ./config:/app/config:ro # Read-only mount
```

### 3. Volume Options (Long Syntax)

Using the long syntax allows more granular option configuration:

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

## Network Configuration

### 1. Default Network

Without any additional configuration, services in the same Compose file
are automatically connected to the same network and can communicate using service names.

```yaml
services:
  app:
    image: myapp
    # Can access the mysql service using the hostname 'mysql'

  mysql:
    image: mysql:8.0
```

### 2. Custom Networks

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

### 3. Connecting to External Networks

Connect to an already existing external network:

```yaml
networks:
  existing-network:
    external: true
```

---

## Dependency Management

### 1. Basic depends_on

Define the service startup order:

```yaml
services:
  app:
    depends_on:
      - mysql
      - redis
```

### 2. Conditional Dependencies

Wait until a service starts up properly:

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

## Practical Example: Spring Boot + MySQL + Redis

<details>
<summary>docker-compose.yml (full example)</summary>

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
# Multi-stage build
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
<summary>.env file</summary>

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

## Frequently Used Commands

### Basic Commands

```bash
# Start services (background)
docker compose up -d

# Start services (with log output)
docker compose up

# Stop services
docker compose down

# Stop services + delete volumes
docker compose down -v

# Restart services
docker compose restart

# Restart a specific service only
docker compose restart app
```

### Build-Related

```bash
# Build images
docker compose build

# Build without cache
docker compose build --no-cache

# Build and start
docker compose up -d --build
```

### Logs and Status

```bash
# View all logs
docker compose logs

# View specific service logs (real-time)
docker compose logs -f app

# View running services
docker compose ps

# View service status
docker compose top
```

### Accessing Containers

```bash
# Access container shell
docker compose exec app /bin/sh

# Access MySQL
docker compose exec mysql mysql -u root -p
```

---

## Separating Development and Production Environments

### 1. File Separation Approach

```bash
# Development environment
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Production environment
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
      - ./src:/app/src  # Source code mount (hot reload)
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

### 2. Profile Approach

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
    # No profile = always runs
```

```bash
# Development environment
docker compose --profile dev up -d

# Production environment
docker compose --profile prod up -d
```

---

## Tips and Considerations

### 1. Security

- Always add `.env` files to `.gitignore`
- Use Docker Secrets or an external secrets management tool for sensitive information
- Avoid running containers with root privileges in production

### 2. Performance

- Unnecessary volume mounts can cause performance degradation
- Bind mounts on macOS/Windows have lower I/O performance
- Consider using `delegated` or `cached` options

```yaml
volumes:
  - ./src:/app/src:delegated
```

### 3. Debugging

- Verify the final configuration with `docker compose config`
- Identify issues using `docker compose logs`
- Monitor service health using healthchecks

### 4. Resource Limits

Setting resource limits is recommended for production environments:

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

### 5. Logging Configuration

Prevent log files from growing indefinitely:

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

## Conclusion

Docker Compose is a powerful tool that can be used in a variety of scenarios,
from local development environments to testing and staging environments.

The key takeaways are:
1. **services**: Define the containers to run
2. **volumes**: Ensure data persistence
3. **networks**: Configure communication between services
4. **Environment variables**: Maintain configuration flexibility
5. **depends_on + healthcheck**: Ensure reliable service startup order

It is recommended to start with a simple configuration
and gradually add features as needed.
