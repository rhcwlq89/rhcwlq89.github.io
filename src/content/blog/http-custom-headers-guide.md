---
title: "실무에서 자주 쓰는 HTTP 커스텀 헤더 정리"
description: "X-Request-ID, X-Forwarded-For 등 실무에서 흔히 사용하는 HTTP 커스텀 헤더의 용도와 사용법을 정리한다. X- 접두사 관례의 역사, CORS와의 관계, Spring Boot에서의 활용까지 다룬다."
pubDate: 2026-03-16T14:00:00+09:00
tags: ["HTTP", "Custom Header", "Spring Boot", "CORS", "Web"]
heroImage: "../../assets/HttpCustomHeadersGuide.png"
---

## 서론

HTTP 헤더는 클라이언트와 서버 사이에서 메타데이터를 전달하는 핵심 수단이다. `Content-Type`, `Authorization` 같은 표준 헤더 외에도, 실무에서는 프로젝트 요구사항에 맞게 **커스텀 헤더**를 정의해서 사용하는 경우가 매우 많다.

이 글에서는 커스텀 헤더가 무엇인지, 어떤 관례가 있는지, 그리고 실무에서 자주 쓰이는 커스텀 헤더들을 용도별로 정리한다.

---

## 1. 커스텀 헤더란?

HTTP 명세에 정의되지 않은, 애플리케이션이 자체적으로 정의하여 사용하는 헤더를 **커스텀 헤더(Custom Header)** 라고 한다.

```
GET /api/users HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGci...        ← 표준 헤더
X-Request-ID: 550e8400-e29b-41d4-a716    ← 커스텀 헤더
X-Client-Version: 2.4.1                  ← 커스텀 헤더
```

표준 헤더는 [IANA HTTP 헤더 레지스트리](https://www.iana.org/assignments/http-fields/http-fields.xhtml)에 등록된 헤더를 의미하며, 그 외에 애플리케이션이 자유롭게 추가한 헤더가 커스텀 헤더다.

---

## 2. `X-` 접두사의 역사

### 2.1 관례의 시작

과거에는 커스텀 헤더에 `X-` 접두사를 붙이는 것이 일반적인 관례였다.

```
X-Forwarded-For: 203.0.113.50
X-Request-ID: abc-123
X-Custom-Auth: my-token
```

"이 헤더는 비표준이다"라는 것을 명시하기 위한 네이밍 규칙이었다.

### 2.2 RFC 6648 — `X-` 접두사의 폐기 권고

2012년에 발표된 [RFC 6648](https://datatracker.ietf.org/doc/html/rfc6648)은 `X-` 접두사 관례를 **더 이상 사용하지 말 것**을 권고했다.

이유는 명확했다:

| 문제 | 설명 |
|------|------|
| **표준화 시 이름 변경** | `X-Forwarded-For`가 표준이 되면 `Forwarded`로 이름이 바뀌어야 하지만, 이미 널리 퍼진 이름은 바꿀 수 없다 |
| **이중 지원 부담** | 서버가 `X-Forwarded-For`와 `Forwarded` 를 모두 지원해야 하는 상황이 발생한다 |
| **혼란** | `X-`가 붙었는지 여부만으로 표준/비표준을 판단할 수 없다 (`X-Forwarded-For`는 사실상 표준이다) |

### 2.3 현재 실무의 현실

RFC 6648의 권고에도 불구하고, **현실에서는 `X-` 접두사가 여전히 널리 사용된다.**

```
# 사실상 표준(de facto standard) — X- 를 떼기엔 이미 너무 늦었다
X-Forwarded-For
X-Forwarded-Proto
X-Request-ID

# 최근 정의된 표준 — X- 없이 등록되었다
Forwarded          (RFC 7239, X-Forwarded-For의 공식 후속)
Origin-Agent-Cluster
```

**실무 권장**: 새로운 커스텀 헤더를 정의할 때는 `X-` 접두사 없이 의미 있는 이름을 사용하되, 기존에 `X-`로 널리 퍼진 헤더는 그대로 사용한다.

---

## 3. 실무에서 자주 쓰는 커스텀 헤더

### 3.1 요청 추적 (Tracing / Observability)

분산 시스템에서 하나의 요청이 여러 서비스를 거치면서 처리되는 경우, 요청을 추적하기 위한 헤더가 필수다.

| 헤더 | 용도 | 비고 |
|------|------|------|
| `X-Request-ID` | 요청 단위 고유 식별자 | UUID를 주로 사용 |
| `X-Correlation-ID` | 여러 서비스에 걸친 트랜잭션 추적 | 서비스 간 전파 |
| `traceparent` | W3C Trace Context 표준 | OpenTelemetry에서 사용 |

```
# 클라이언트 → API Gateway → 서비스 A → 서비스 B
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
X-Correlation-ID: txn-20260316-001
```

> **X-Request-ID vs X-Correlation-ID**
>
> - `X-Request-ID`는 개별 HTTP 요청을 식별한다. 서비스 A가 서비스 B를 호출하면 새로운 `X-Request-ID`가 생긴다.
> - `X-Correlation-ID`는 사용자의 하나의 동작(예: 주문)에서 발생한 모든 요청을 묶는다. 전체 흐름에서 동일하게 유지된다.

#### Spring Boot에서 X-Request-ID 처리

```java
@Component
public class RequestIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String requestId = request.getHeader("X-Request-ID");
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        // MDC에 저장 → 로그에 자동 포함
        MDC.put("requestId", requestId);
        response.setHeader("X-Request-ID", requestId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

`logback-spring.xml`에서 MDC 값을 포맷에 포함하면 로그 추적이 편해진다:

```xml
<pattern>%d{HH:mm:ss.SSS} [%X{requestId}] %-5level %logger{36} - %msg%n</pattern>
```

---

### 3.2 프록시 / 로드밸런서 관련

리버스 프록시(Nginx, AWS ALB 등)가 원본 요청 정보를 백엔드에 전달하기 위해 사용하는 헤더들이다.

| 헤더 | 용도 | 예시 값 |
|------|------|---------|
| `X-Forwarded-For` | 원본 클라이언트 IP | `203.0.113.50, 70.41.3.18` |
| `X-Forwarded-Proto` | 원본 프로토콜 | `https` |
| `X-Forwarded-Host` | 원본 Host | `www.example.com` |
| `X-Forwarded-Port` | 원본 포트 | `443` |
| `X-Real-IP` | 클라이언트 실제 IP (Nginx) | `203.0.113.50` |

```
# 클라이언트(203.0.113.50) → ALB(10.0.0.1) → 서버
X-Forwarded-For: 203.0.113.50, 10.0.0.1
X-Forwarded-Proto: https
```

> **주의: X-Forwarded-For의 스푸핑**
>
> 클라이언트가 직접 `X-Forwarded-For` 헤더를 조작해서 보낼 수 있다. 따라서 이 헤더 값을 신뢰하려면 **신뢰할 수 있는 프록시 목록**을 설정해야 한다.

#### Spring Boot에서 프록시 헤더 처리

```yaml
# application.yml
server:
  forward-headers-strategy: native   # Tomcat이 X-Forwarded-* 처리
  tomcat:
    remoteip:
      internal-proxies: 10\\.0\\.\\d{1,3}\\.\\d{1,3}  # 신뢰할 프록시 IP
```

`forward-headers-strategy: native`로 설정하면 `request.getRemoteAddr()`가 `X-Forwarded-For`의 첫 번째 IP를 반환한다.

---

### 3.3 클라이언트 정보 전달

서버가 클라이언트의 버전, 플랫폼, 디바이스 정보를 파악하기 위해 사용하는 헤더들이다.

| 헤더 | 용도 | 예시 값 |
|------|------|---------|
| `X-Client-Version` | 앱 버전 | `2.4.1` |
| `X-Platform` | 플랫폼 종류 | `iOS`, `Android`, `Web` |
| `X-Device-ID` | 디바이스 고유 식별자 | `device-abc-123` |
| `X-App-Name` | 앱 이름 | `MyApp-iOS` |

```
GET /api/config HTTP/1.1
X-Client-Version: 2.4.1
X-Platform: iOS
X-Device-ID: 5A3F2B1C-...
```

이 정보들은 **서버 사이드에서 기능 분기(Feature Flag)** 에 유용하다:

```java
@GetMapping("/api/config")
public ResponseEntity<AppConfig> getConfig(
        @RequestHeader(value = "X-Client-Version", required = false) String clientVersion) {

    if (clientVersion != null && isVersionBelow(clientVersion, "2.0.0")) {
        return ResponseEntity.ok(legacyConfig());
    }
    return ResponseEntity.ok(currentConfig());
}
```

---

### 3.4 인증 / 보안 관련

| 헤더 | 용도 | 비고 |
|------|------|------|
| `X-API-Key` | API 키 인증 | `Authorization` 대신 사용하는 경우 |
| `X-CSRF-Token` | CSRF 토큰 전달 | 폼 기반 인증에서 사용 |
| `X-Forwarded-User` | 프록시가 인증된 사용자 정보 전달 | 리버스 프록시 인증 |
| `Idempotency-Key` | 멱등성 보장 키 | 결제 API에서 중복 요청 방지 |

#### Idempotency-Key 활용 예시

결제나 송금 같은 중요한 작업에서 네트워크 재시도로 인한 중복 처리를 방지한다.

```
POST /api/payments HTTP/1.1
Idempotency-Key: pay-20260316-user42-ord789
Content-Type: application/json

{"amount": 50000, "currency": "KRW"}
```

```java
@PostMapping("/api/payments")
public ResponseEntity<PaymentResult> createPayment(
        @RequestHeader("Idempotency-Key") String idempotencyKey,
        @RequestBody PaymentRequest request) {

    // 이미 처리된 키인지 확인
    Optional<PaymentResult> existing = paymentRepository.findByIdempotencyKey(idempotencyKey);
    if (existing.isPresent()) {
        return ResponseEntity.ok(existing.get());  // 기존 결과 반환
    }

    PaymentResult result = paymentService.process(request, idempotencyKey);
    return ResponseEntity.status(HttpStatus.CREATED).body(result);
}
```

---

### 3.5 Rate Limiting 관련

API Rate Limiting 상태를 클라이언트에 알려주기 위한 **응답 헤더**들이다.

| 헤더 | 용도 | 예시 값 |
|------|------|---------|
| `X-RateLimit-Limit` | 허용된 최대 요청 수 | `1000` |
| `X-RateLimit-Remaining` | 남은 요청 수 | `742` |
| `X-RateLimit-Reset` | 제한 초기화 시각 (Unix timestamp) | `1742108400` |
| `Retry-After` | 재시도 가능 시각 (표준 헤더) | `60` (초) |

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 742
X-RateLimit-Reset: 1742108400
```

Rate Limit을 초과하면 `429 Too Many Requests`와 함께 `Retry-After` 헤더를 반환하는 것이 일반적이다:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Remaining: 0
```

> **참고**: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` 형태(X- 없이)로 표준화 논의가 진행 중이다 ([draft-ietf-httpapi-ratelimit-headers](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)).

---

### 3.6 캐시 / 성능 관련

| 헤더 | 용도 | 비고 |
|------|------|------|
| `X-Cache` | 캐시 히트 여부 | CDN이 응답에 추가 |
| `X-Cache-TTL` | 캐시 TTL | 디버깅 용도 |
| `X-Response-Time` | 서버 응답 시간 | 모니터링 용도 |

```
HTTP/1.1 200 OK
X-Cache: HIT from edge-server-tokyo
X-Response-Time: 45ms
```

---

## 4. 커스텀 헤더와 CORS

커스텀 헤더는 **CORS(Cross-Origin Resource Sharing)** 와 밀접한 관계가 있다. 이 부분을 모르면 프론트엔드에서 커스텀 헤더를 보내거나 읽을 때 에러가 발생한다.

### 4.1 Preflight 트리거

브라우저는 **Simple Request** 조건을 벗어나는 요청에 대해 Preflight(OPTIONS) 요청을 먼저 보낸다. 커스텀 헤더를 포함하면 Simple Request 조건을 벗어나므로 Preflight가 발생한다.

```
# Simple Request에서 허용되는 헤더 (커스텀 헤더는 포함되지 않음)
Accept, Accept-Language, Content-Language, Content-Type(일부)
```

따라서 `X-Request-ID`를 프론트엔드에서 보내려면:

```javascript
// 프론트엔드
fetch('https://api.example.com/users', {
  headers: {
    'X-Request-ID': crypto.randomUUID(),  // ← Preflight 발생
  }
});
```

서버에서 해당 헤더를 허용해야 한다:

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("https://frontend.example.com")
                .allowedHeaders("X-Request-ID", "X-Client-Version")  // 커스텀 헤더 허용
                .exposedHeaders("X-Request-ID", "X-RateLimit-Remaining");  // 프론트에서 읽기 허용
    }
}
```

### 4.2 `Access-Control-Expose-Headers`

기본적으로 프론트엔드 JavaScript는 응답의 **CORS-safelisted 헤더**만 읽을 수 있다:

```
Cache-Control, Content-Language, Content-Length,
Content-Type, Expires, Last-Modified, Pragma
```

서버가 `X-RateLimit-Remaining` 같은 커스텀 응답 헤더를 프론트엔드에서 읽게 하려면, `Access-Control-Expose-Headers`에 명시해야 한다:

```
Access-Control-Expose-Headers: X-RateLimit-Remaining, X-Request-ID
```

이 설정이 없으면 `response.headers.get('X-RateLimit-Remaining')`이 `null`을 반환한다.

> **CORS 설정 전체를 다루는 글**: [CORS를 이해하기: 브라우저 보안 정책부터 Spring Boot 설정까지](/blog/cors-understanding-guide)

---

## 5. 커스텀 헤더 네이밍 가이드

### 5.1 좋은 이름을 짓는 원칙

| 원칙 | 좋은 예 | 나쁜 예 |
|------|---------|---------|
| 용도가 명확해야 한다 | `X-Request-ID` | `X-ID` |
| 일관된 네이밍 컨벤션 | `X-Client-Version` | `x_client_ver` |
| 충돌을 피한다 | `MyApp-Trace-ID` | `Trace-ID` (다른 시스템과 충돌 가능) |
| 대소문자 무관하게 동작한다 | — | HTTP 헤더는 case-insensitive |

### 5.2 조직 전용 접두사 사용

`X-` 대신 **조직/프로젝트 접두사**를 사용하면 충돌을 방지할 수 있다:

```
MyApp-Request-ID: abc-123
MyApp-Client-Version: 2.4.1
MyApp-Tenant-ID: tenant-42
```

GitHub, AWS 등도 이 패턴을 사용한다:

```
X-GitHub-Request-Id: ABCD:1234:5678
X-Amzn-Trace-Id: Root=1-5759e988-bd862e3fe1be46a994272793
```

---

## 6. 주의사항

### 6.1 헤더에 민감한 정보를 담지 말 것

HTTP 헤더는 로그에 기록되기 쉽고, 프록시를 거치면서 노출될 수 있다. 비밀번호, 주민번호, 카드번호 같은 민감한 정보는 절대 커스텀 헤더에 담지 않는다.

```
# 절대 하지 말 것
X-User-Password: mySecret123
X-SSN: 900101-1234567
```

### 6.2 헤더 크기 제한

대부분의 웹 서버와 프록시는 헤더 크기에 제한이 있다:

| 서버/프록시 | 기본 헤더 크기 제한 |
|-------------|---------------------|
| Nginx | 4KB (단일 헤더), 8KB (전체) |
| Apache | 8KB (전체) |
| Tomcat | 8KB (전체) |
| AWS ALB | 16KB (전체) |

큰 데이터(JSON 객체 등)를 헤더에 담으려 하면 `431 Request Header Fields Too Large` 에러가 발생할 수 있다. 큰 데이터는 요청 본문(body)에 담는다.

### 6.3 표준 헤더가 있다면 그것을 사용할 것

커스텀 헤더를 만들기 전에, 동일한 용도의 표준 헤더가 이미 있는지 확인한다.

| 용도 | 표준 헤더 사용 | 커스텀 헤더 (불필요) |
|------|---------------|---------------------|
| 인증 토큰 | `Authorization: Bearer ...` | `X-Auth-Token` |
| 콘텐츠 협상 | `Accept: application/json` | `X-Response-Format` |
| 캐시 제어 | `Cache-Control: no-cache` | `X-No-Cache: true` |
| 원본 프로토콜 | `Forwarded: proto=https` | `X-Forwarded-Proto` (레거시) |

---

## 정리

| 분류 | 대표 헤더 | 핵심 용도 |
|------|-----------|-----------|
| 요청 추적 | `X-Request-ID`, `X-Correlation-ID` | 분산 시스템 로그 추적 |
| 프록시 | `X-Forwarded-For`, `X-Forwarded-Proto` | 원본 클라이언트 정보 전달 |
| 클라이언트 정보 | `X-Client-Version`, `X-Platform` | 기능 분기, 통계 |
| 인증/보안 | `X-API-Key`, `Idempotency-Key` | API 인증, 멱등성 보장 |
| Rate Limiting | `X-RateLimit-Limit`, `X-RateLimit-Remaining` | 사용량 제어 |
| 캐시/성능 | `X-Cache`, `X-Response-Time` | CDN 디버깅, 모니터링 |

커스텀 헤더는 단순해 보이지만, CORS 설정(`allowedHeaders`, `exposedHeaders`)과 함께 관리해야 프론트엔드-백엔드 연동에서 문제가 생기지 않는다. 새로운 커스텀 헤더를 정의할 때는 **표준 헤더 확인 → 의미 있는 이름 → CORS 설정 반영** 순서로 진행하자.
