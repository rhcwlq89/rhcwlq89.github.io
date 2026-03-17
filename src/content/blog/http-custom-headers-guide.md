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

#### 실무 사례: 장애 상황에서의 요청 추적

금요일 오후, 모니터링 대시보드에 주문 서비스의 500 에러가 급증한다. 어디서 문제가 생긴 걸까?

`X-Request-ID`가 없다면 수백만 줄의 로그에서 특정 요청을 찾아야 한다. 하지만 `X-Request-ID`가 있으면:

```
# 1. 에러 로그에서 Request ID 확인
[ERROR] [req-550e8400] OrderService - 주문 생성 실패: PaymentService timeout

# 2. 같은 ID로 다른 서비스 로그 검색
$ grep "550e8400" payment-service.log
[WARN] [req-550e8400] PaymentService - PG사 응답 지연: 30초 초과

# 3. 원인 파악: PG사 응답 지연 → 주문 서비스 타임아웃
```

Datadog, Grafana Loki 같은 로그 수집 도구에서 `X-Request-ID`로 검색하면 해당 요청이 거쳐간 모든 서비스의 로그를 한눈에 볼 수 있다.

#### 실무 사례: MSA에서 X-Correlation-ID의 흐름

사용자가 "주문하기" 버튼을 클릭하면 내부적으로 여러 API가 호출된다:

```
사용자 → API Gateway → 주문 서비스 → 결제 서비스 → 재고 서비스 → 알림 서비스

X-Correlation-ID: order-user42-20260316  (전체 흐름에서 동일)

X-Request-ID: req-001  (Gateway → 주문)
X-Request-ID: req-002  (주문 → 결제)
X-Request-ID: req-003  (주문 → 재고)
X-Request-ID: req-004  (주문 → 알림)
```

나중에 "user42의 3월 16일 주문에서 뭐가 문제였지?"라고 할 때, `X-Correlation-ID: order-user42-20260316`으로 검색하면 관련된 모든 서비스의 로그를 한번에 조회할 수 있다.

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

#### 실무 사례: IP 기반 Rate Limiting에서의 함정

서비스에 IP 기반 Rate Limiting을 적용했는데, 모든 요청이 같은 IP(`10.0.0.1`)로 찍혀서 전체 사용자가 한꺼번에 차단당하는 사고가 발생할 수 있다. 이유는? **로드밸런서의 IP를 클라이언트 IP로 인식**했기 때문이다.

```
# 잘못된 설정: 모든 요청의 IP가 ALB IP로 기록됨
요청 1: remoteAddr=10.0.0.1  (실제: 203.0.113.50)
요청 2: remoteAddr=10.0.0.1  (실제: 198.51.100.23)

# 올바른 설정: X-Forwarded-For의 첫 번째 IP 사용
요청 1: remoteAddr=203.0.113.50
요청 2: remoteAddr=198.51.100.23
```

#### 실무 사례: HTTPS 리다이렉트 무한 루프

프록시 뒤에 있는 서버가 `X-Forwarded-Proto`를 확인하지 않으면, 무한 리다이렉트가 발생할 수 있다:

```
1. 클라이언트 → (HTTPS) → ALB → (HTTP) → 서버
2. 서버: "HTTP 요청이네? HTTPS로 리다이렉트!"
3. 클라이언트 → (HTTPS) → ALB → (HTTP) → 서버
4. 서버: "또 HTTP? 또 리다이렉트!" → 무한 반복
```

`X-Forwarded-Proto: https`를 확인하면 이 문제를 해결할 수 있다:

```java
@Component
public class HttpsRedirectFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String proto = request.getHeader("X-Forwarded-Proto");

        // 프록시가 알려준 원본 프로토콜이 HTTPS면 리다이렉트 불필요
        if ("https".equals(proto) || request.isSecure()) {
            filterChain.doFilter(request, response);
            return;
        }

        // 실제로 HTTP로 접근한 경우만 리다이렉트
        String redirectUrl = "https://" + request.getServerName() + request.getRequestURI();
        response.sendRedirect(redirectUrl);
    }
}
```

#### 실무 사례: 다중 프록시 환경에서의 X-Forwarded-For

실제 운영 환경에서는 프록시가 여러 단계일 수 있다:

```
클라이언트(203.0.113.50) → CDN(54.230.1.1) → ALB(10.0.0.1) → Nginx(10.0.1.1) → WAS

X-Forwarded-For: 203.0.113.50, 54.230.1.1, 10.0.0.1
```

이때 **가장 왼쪽**이 실제 클라이언트 IP다. 하지만 공격자가 처음부터 `X-Forwarded-For: 1.2.3.4`를 넣어 보내면:

```
X-Forwarded-For: 1.2.3.4, 203.0.113.50, 54.230.1.1, 10.0.0.1
```

가장 왼쪽 IP가 가짜가 된다. 그래서 **신뢰할 수 있는 프록시 목록에서 오른쪽부터 제거**하고 남은 가장 오른쪽 IP를 사용하는 것이 안전하다.

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

#### 실무 사례: 강제 업데이트 (Force Update)

앱에 심각한 보안 취약점이 발견되었을 때, 특정 버전 이하의 앱 사용을 차단해야 한다:

```java
@GetMapping("/api/health")
public ResponseEntity<?> healthCheck(
        @RequestHeader(value = "X-Client-Version", required = false) String version,
        @RequestHeader(value = "X-Platform", required = false) String platform) {

    if (version != null && isVersionBelow(version, "3.0.0")) {
        return ResponseEntity.status(HttpStatus.UPGRADE_REQUIRED)  // 426
            .body(Map.of(
                "message", "보안 업데이트가 필요합니다",
                "minVersion", "3.0.0",
                "storeUrl", "iOS".equals(platform)
                    ? "https://apps.apple.com/app/myapp"
                    : "https://play.google.com/store/apps/details?id=com.myapp"
            ));
    }
    return ResponseEntity.ok(Map.of("status", "ok"));
}
```

#### 실무 사례: 플랫폼별 응답 분기

같은 API인데 iOS와 Android에서 다른 이미지 포맷을 내려줘야 하는 경우:

```java
@GetMapping("/api/banners")
public ResponseEntity<List<Banner>> getBanners(
        @RequestHeader(value = "X-Platform", required = false) String platform) {

    String imageFormat = "Android".equals(platform) ? "webp" : "png";
    List<Banner> banners = bannerService.getBanners(imageFormat);
    return ResponseEntity.ok(banners);
}
```

#### 실무 사례: 디바이스 ID를 이용한 비로그인 사용자 추적

로그인하지 않은 사용자도 `X-Device-ID`로 행동 패턴을 분석할 수 있다. 예를 들어 "장바구니에 담았지만 결제하지 않은 사용자"에게 푸시 알림을 보내는 시나리오에서 활용된다.

```
GET /api/recommendations HTTP/1.1
X-Device-ID: 5A3F2B1C-8D7E-4A9B-B2C1-3E5F6A7B8C9D
X-Platform: iOS
X-Client-Version: 4.2.0
```

> **주의**: `X-Device-ID`는 개인정보 보호법에 따라 주의해서 다뤄야 한다. GDPR/개인정보보호법 대상이라면 사용자 동의 없이 추적 목적으로 사용하면 안 된다.

---

### 3.4 인증 / 보안 관련

| 헤더 | 용도 | 비고 |
|------|------|------|
| `X-API-Key` | API 키 인증 | `Authorization` 대신 사용하는 경우 |
| `X-CSRF-Token` | CSRF 토큰 전달 | 폼 기반 인증에서 사용 |
| `X-Forwarded-User` | 프록시가 인증된 사용자 정보 전달 | 리버스 프록시 인증 |
| `Idempotency-Key` | 멱등성 보장 키 | 결제 API에서 중복 요청 방지 |

#### X-API-Key 실무 사례

외부에 공개하는 Open API에서 `X-API-Key`는 가장 흔한 인증 방식이다. 카카오, 네이버, 공공데이터포털 등 대부분의 한국 API가 이 방식을 사용한다.

```
# 공공데이터포털 API 호출 예시
GET /api/15012690/openapi/service/cctv HTTP/1.1
Host: api.odcloud.kr
X-API-Key: your-api-key-here
```

```java
// Spring Boot에서 X-API-Key 검증 필터
@Component
public class ApiKeyFilter extends OncePerRequestFilter {

    @Value("${api.valid-keys}")
    private List<String> validKeys;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String apiKey = request.getHeader("X-API-Key");

        if (apiKey == null || !validKeys.contains(apiKey)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.getWriter().write("{\"error\": \"Invalid API Key\"}");
            return;
        }

        filterChain.doFilter(request, response);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // 공개 엔드포인트는 API Key 검증 제외
        return request.getRequestURI().startsWith("/api/public/");
    }
}
```

> **`Authorization` vs `X-API-Key`**: OAuth2 토큰은 `Authorization: Bearer ...`에, 단순 API 키는 `X-API-Key`에 넣는 것이 일반적인 관례다. API 키와 Bearer 토큰을 동시에 사용하는 서비스도 있다 (예: API 키로 앱 식별 + Bearer 토큰으로 사용자 인증).

#### X-CSRF-Token 실무 사례

SPA(Single Page Application)에서 CSRF 공격을 방어하는 가장 흔한 패턴이다:

```
# 1. 페이지 로드 시 서버가 CSRF 토큰을 쿠키로 전달
Set-Cookie: XSRF-TOKEN=abc123; Path=/; SameSite=Lax

# 2. 클라이언트가 상태 변경 요청 시 헤더에 토큰 포함
POST /api/transfer HTTP/1.1
X-CSRF-Token: abc123
Cookie: XSRF-TOKEN=abc123; SESSION=xyz789
```

서버는 쿠키의 토큰과 헤더의 토큰이 일치하는지 확인한다 (Double Submit Cookie 패턴). 공격자는 쿠키는 자동 전송되지만 헤더에 토큰을 넣을 수는 없으므로 CSRF 공격이 차단된다.

```java
// Spring Security 기본 설정으로 CSRF 토큰이 자동 관리된다
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            // withHttpOnlyFalse(): JS에서 쿠키를 읽어 헤더에 넣을 수 있도록
        );
        return http.build();
    }
}
```

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

#### 실무에서 Idempotency-Key가 필수인 이유

결제 API를 호출했는데 응답을 못 받은 상황을 생각해보자. 클라이언트는 결제가 됐는지 안 됐는지 알 수 없다. 재시도하면 이중 결제가 될 수 있고, 안 하면 결제가 누락될 수 있다. `Idempotency-Key`는 이 문제를 해결한다 — **같은 키로 여러 번 요청해도 한 번만 처리된다.**

#### 실제 서비스들의 Idempotency-Key 사용

**Stripe** — 가장 대표적인 사례다. 모든 POST 요청에 `Idempotency-Key` 헤더를 지원한다.

```bash
curl https://api.stripe.com/v1/charges \
  -H "Idempotency-Key: order-12345-attempt-1" \
  -d amount=5000 \
  -d currency=usd
```

Stripe는 키를 **24시간 동안 보관**하며, 같은 키로 재요청하면 원래 응답을 그대로 돌려준다. 단, 같은 키에 다른 파라미터로 요청하면 `400 Bad Request`를 반환한다.

**토스페이먼츠** — 결제 승인 API에서 `orderId`가 멱등성 키 역할을 한다.

```bash
curl https://api.tosspayments.com/v1/payments/confirm \
  -H "Idempotency-Key: order-20260316-abc789"
```

**PayPal** — 주문 생성, 결제 캡처 등에 `PayPal-Request-Id` 헤더로 멱등성을 보장한다.

```bash
curl https://api.paypal.com/v2/checkout/orders \
  -H "PayPal-Request-Id: order-unique-id-123"
```

#### 결제 외의 실무 사례

`Idempotency-Key`는 결제에만 쓰는 게 아니다. **상태를 변경하는 중요한 POST 요청**에는 모두 적용할 수 있다.

| 시나리오 | 중복 시 문제 | 키 생성 전략 |
|----------|-------------|-------------|
| 결제/송금 | 이중 결제, 이중 출금 | `pay-{orderId}-{timestamp}` |
| 주문 생성 | 같은 주문이 2개 생성 | `order-{userId}-{cartHash}` |
| 메시지 발송 (SMS/이메일) | 같은 메시지 2번 발송 | `msg-{templateId}-{recipientId}-{date}` |
| 포인트/쿠폰 지급 | 포인트 이중 지급 | `reward-{eventId}-{userId}` |
| 외부 API 연동 (웹훅 등) | 같은 이벤트 2번 처리 | 웹훅 제공자가 주는 `event_id` 사용 |

#### Idempotency-Key 구현 시 주의사항

**1. 키 생성은 클라이언트 책임이다**

서버가 키를 생성하면 의미가 없다. 클라이언트가 요청 전에 키를 만들어야 재시도 시 같은 키를 보낼 수 있다.

```javascript
// 프론트엔드 — 주문 버튼 클릭 시 키를 미리 생성
const idempotencyKey = `order-${orderId}-${Date.now()}`;

async function placeOrder() {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,  // 재시도해도 같은 키
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderData),
  });
}
```

**2. 키에는 TTL을 설정해야 한다**

영구 보관하면 저장 공간이 무한히 늘어난다. 일반적으로 **24~48시간**이 적당하다. Stripe는 24시간, 일부 금융 API는 72시간을 사용한다.

```java
// Redis로 TTL 관리 — 24시간 후 자동 만료
redisTemplate.opsForValue().set(
    "idempotency:" + key,
    result,
    Duration.ofHours(24)
);
```

**3. 동시 요청(Race Condition)을 처리해야 한다**

같은 키로 동시에 2개의 요청이 들어오면? 하나만 처리하고 나머지는 대기시키거나 `409 Conflict`를 반환해야 한다.

```java
// Redis SETNX로 분산 락 구현
Boolean acquired = redisTemplate.opsForValue()
    .setIfAbsent("lock:idempotency:" + key, "1", Duration.ofSeconds(30));

if (Boolean.FALSE.equals(acquired)) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body("Request is already being processed");
}
```

**4. 응답을 함께 저장해야 한다**

키만 저장하면 안 된다. **응답 전체(상태 코드 + 바디)를 저장**해야 재시도 시 동일한 응답을 돌려줄 수 있다.

```java
@Data
@AllArgsConstructor
public class IdempotencyRecord {
    private int statusCode;
    private String responseBody;
    private LocalDateTime createdAt;
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

#### 실무 사례: GitHub API의 Rate Limiting

GitHub API는 Rate Limit 헤더의 교과서적인 사례다:

```bash
$ curl -I https://api.github.com/users/octocat

HTTP/2 200
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 56
X-RateLimit-Reset: 1742108400
X-RateLimit-Used: 4
X-RateLimit-Resource: core
```

인증하지 않으면 시간당 60회, 토큰을 사용하면 시간당 5,000회까지 호출할 수 있다. `X-RateLimit-Resource`로 어떤 종류의 제한에 해당하는지도 알려준다 (core, search, graphql 등).

#### 실무 사례: 클라이언트에서 Rate Limit 헤더 활용

서버가 Rate Limit 헤더를 내려주면, 클라이언트는 이를 활용해 지능적으로 요청을 조절할 수 있다:

```javascript
async function fetchWithRateLimit(url) {
  const response = await fetch(url);

  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining'));
  const resetTime = parseInt(response.headers.get('X-RateLimit-Reset'));

  if (remaining === 0) {
    const waitMs = (resetTime * 1000) - Date.now();
    console.log(`Rate limit 도달. ${Math.ceil(waitMs / 1000)}초 후 재시도`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return fetchWithRateLimit(url);  // 재시도
  }

  if (remaining < 10) {
    console.warn(`Rate limit 주의: ${remaining}회 남음`);
  }

  return response;
}
```

#### Spring Boot에서 Rate Limiting 구현 (Bucket4j)

```java
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    private Bucket createBucket() {
        return Bucket.builder()
            .addLimit(Bandwidth.classic(100, Refill.intervally(100, Duration.ofHours(1))))
            .build();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String clientIp = request.getRemoteAddr();
        Bucket bucket = buckets.computeIfAbsent(clientIp, k -> createBucket());

        ConsumptionProbe probe = bucket.tryConsumeAndReturnRemaining(1);

        response.setHeader("X-RateLimit-Limit", "100");
        response.setHeader("X-RateLimit-Remaining", String.valueOf(probe.getRemainingTokens()));

        if (probe.isConsumed()) {
            filterChain.doFilter(request, response);
        } else {
            long waitSeconds = probe.getNanosToWaitForRefill() / 1_000_000_000;
            response.setHeader("Retry-After", String.valueOf(waitSeconds));
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.getWriter().write("{\"error\": \"Rate limit exceeded\"}");
        }
    }
}
```

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

#### 실무 사례: CDN 캐시 디버깅

"이미지를 업데이트했는데 안 바뀌어요" — CDN을 사용하면 자주 듣는 문의다. `X-Cache` 헤더로 즉시 원인을 파악할 수 있다:

```bash
$ curl -I https://cdn.example.com/images/logo.png

X-Cache: HIT        # CDN 캐시에서 응답 → 아직 이전 이미지
X-Cache-TTL: 3600   # 1시간 후 만료 예정
Age: 2400           # 캐시된 지 40분 경과
```

CloudFront에서는 더 상세한 정보를 제공한다:

```
X-Cache: Hit from cloudfront
X-Amz-Cf-Pop: ICN54-C1          # 서울 엣지 서버에서 응답
X-Amz-Cf-Id: abc123...          # 디버깅용 요청 ID
```

`X-Cache` 값의 의미:

| 값 | 의미 |
|----|------|
| `HIT` | 캐시에서 응답 (원본 서버 호출 없음) |
| `MISS` | 캐시에 없어서 원본 서버에서 가져옴 |
| `REFRESH HIT` | 캐시 만료 후 원본에서 재검증, 콘텐츠 동일 |
| `ERROR` | 원본 서버 에러, 이전 캐시로 응답 |

#### 실무 사례: X-Response-Time으로 SLO 모니터링

서비스의 SLO(Service Level Objective)가 "API 응답 시간 99%ile < 200ms"라면, `X-Response-Time`을 모니터링에 활용할 수 있다:

```java
@Component
public class ResponseTimeFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        long start = System.nanoTime();

        filterChain.doFilter(request, response);

        long duration = (System.nanoTime() - start) / 1_000_000;  // ms
        response.setHeader("X-Response-Time", duration + "ms");

        // Prometheus 메트릭으로도 기록
        if (duration > 200) {
            log.warn("Slow API: {} {}ms", request.getRequestURI(), duration);
        }
    }
}
```

이 헤더가 있으면 프론트엔드 개발자도 네트워크 탭에서 서버 처리 시간을 바로 확인할 수 있어, "느린 건 서버야 네트워크야?"를 빠르게 판단할 수 있다.

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
