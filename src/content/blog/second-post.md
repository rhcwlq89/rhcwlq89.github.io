---
title: "Spring Boot Pre-interview Task Guide 2"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-19
tags: ["Spring Boot", "REST API", "Backend", "Interview"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 서론

[1편](https://rhcwlq89.github.io/blog/first-post)에 이어서 Spring Boot 기반의 Pre-interview 과제에서 체크 포인트를 정리합니다.
  
2편에서는 Database Configuration, Test 환경을 중심으로 설명합니다.

---

### DataBase Config

일반적으로 과제에서 제시하는 DB는 세 가지다.
   - Memory 기반 RDB (H2)
   - 순수 Memory 저장소 (HashMap 등)
   - Docker 기반 RDB (MySQL, PostgreSQL 등)
   

1. 공통 설정 (application.yml)
   - DB 접속 정보 (url, jdbc driver, username, password)
   - 순수 Memory 저장소 사용시 별도 설정 불필요
   
    <details>
    <summary>application.yml (DB Connection)</summary>
    
    ```yaml
    spring:
        datasource:
            url: jdbc:mysql://localhost:3306/app
            driver-class-name: com.mysql.cj.jdbc.Driver
            username: app
            password: secret


    jpa:
        hibernate:
            ddl-auto: update
            show-sql: true
    ```
    
    </details>
   
2. H2 설정
    - H2 콘솔 활성화
    - JDBC URL 설정
    
    <details>
    <summary>application.yml (H2 설정)</summary>
    
    ```yaml
    spring:
        datasource:
            url: jdbc:h2:mem:testdb
            driver-class-name: org.h2.Driver
            username: sa
            password:


    h2:
        console:
            enabled: true
            path: /h2
    ```
    </details>  

    <details>
    <summary>build.gradle</summary>
   
    ```groovy
    dependencies {
        runtimeOnly 'com.h2database:h2'
        // 4.0.x 이상부터는 별도 의존성 추가 필요
        runtimeOnly 'org.springframework.boot:spring-boot-h2console'
    }
    ```
    </details>

3. Memory DB 설정
   - HashMap 등 Memory DB 사용 시 별도 설정 불필요
   - Repository 구현체에서 Memory DB 로직 작성
   - 일반적으로 ConcurrentHashMap 사용 권장, 정렬이 필요한 경우 ConcurrentSkipListMap 사용

4. Docker 기반 RDB 설정
   - Docker Compose 파일 작성 (Maria, MySql, Postgresql 등의 Dockerhub 버전 확인)
   - 과제의 경우 대부분 단일 DB만 사용하기 때문에 application.yml 에서 DB 접속 정보만 설정하면 됨

    <details>
    <summary>docker-compose.yml(예: MYSQL)</summary>
    
    ```yaml
    services:
        # MySQL 8.0 데이터베이스 서비스
        test-db:
            # 컨테이너 이름을 명시적으로 지정 (docker ps에서 보이는 이름)
            container_name: test-db
            
            # MySQL 8.0 공식 이미지 사용
            image: mysql:8.0
            
            # 컨테이너 재시작 정책: 수동으로 중지하지 않는 한 항상 재시작
            restart: unless-stopped
            
            # 환경 변수 설정
            environment:
                # MySQL root 계정 비밀번호 (.env 파일에서 가져오거나 기본값 사용)
                MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-rootpassword}
                
                # 초기 생성할 데이터베이스 이름
                MYSQL_DATABASE: test-db
                
                # 초기 생성할 사용자 이름 (.env 파일에서 가져오거나 기본값 사용)
                MYSQL_USER: ${MYSQL_USER:-user}
                
                # 사용자 비밀번호 (.env 파일에서 가져오거나 기본값 사용)
                MYSQL_PASSWORD: ${MYSQL_PASSWORD:-password}
                
                # 컨테이너 타임존 설정 (한국 시간)
                TZ: Asia/Seoul
            
            # 포트 매핑: 호스트의 13306 포트를 컨테이너의 3306 포트로 연결
            # 로컬에서 접속 시 localhost:13306 사용
            ports:
                - "13306:3306"
            
            # 볼륨 마운트: 데이터 영속성 보장
            # MySQL 데이터를 named volume에 저장하여 컨테이너 삭제 시에도 데이터 유지
            volumes:
                - db_data:/var/lib/mysql
            
            # MySQL 서버 실행 시 추가 옵션
            command:
                # UTF-8 문자셋 설정 (이모지 포함 모든 유니코드 문자 지원)
                - --character-set-server=utf8mb4
                # UTF-8 정렬 규칙 설정
                - --collation-server=utf8mb4_unicode_ci
            
            # 헬스체크: 컨테이너가 정상 작동하는지 주기적으로 확인
            healthcheck:
                # mysqladmin ping 명령으로 MySQL 서버 응답 확인
                test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD:-rootpassword}"]
                # 10초마다 헬스체크 실행
                interval: 10s
                # 각 헬스체크의 타임아웃 시간
                timeout: 5s
                # 5번 연속 실패 시 unhealthy 상태로 판단
                retries: 5

    # Named volumes 정의: Docker가 관리하는 영속적 저장소
    volumes:
        # MySQL 데이터를 저장할 볼륨
        # 위치: /var/lib/docker/volumes/db_data (Linux 기준)
        db_data:
    ```
    </details>

5. Querydsl 설정
    - 일부 과제에서는 Querydsl 사용 필요

    <details>
    <summary>Querydsl Config(kotlin)</summary>

    ```kotlin

    @Configuration(proxyBeanMethods = false)
    class QuerydslConfig(
        private val entityManager: EntityManager
    ) {
        @Bean
        fun jpaQueryFactory(): JPAQueryFactory {
            return JPAQueryFactory(entityManager)
        }
    }

    ```

    </details>

### Test Environment

1. Test DB 설정
   - application-test.yml 작성
   - H2 Memory DB 설정

    <details>
    <summary>application-test.yml</summary>
    
    ```yaml
    spring:
        datasource:
            url: jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
            driver-class-name: org.h2.Driver
            username: sa
            password:
   ```
    </details>