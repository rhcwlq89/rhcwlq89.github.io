---
title: "A Practical Guide to HTTP Custom Headers in Production"
description: "A comprehensive guide to commonly used HTTP custom headers like X-Request-ID and X-Forwarded-For. Covers the history of the X- prefix convention, CORS implications, and Spring Boot implementation."
pubDate: 2026-03-16T14:00:00+09:00
tags: ["HTTP", "Custom Header", "Spring Boot", "CORS", "Web"]
heroImage: "../../../assets/HttpCustomHeadersGuide.png"
---

## Introduction

HTTP headers are the primary mechanism for passing metadata between clients and servers. Beyond standard headers like `Content-Type` and `Authorization`, it's extremely common in production to define and use **custom headers** tailored to project requirements.

This guide covers what custom headers are, naming conventions, and the most frequently used custom headers organized by purpose.

---

## 1. What Is a Custom Header?

A **custom header** is any HTTP header not defined in the HTTP specification, created by an application for its own use.

```
GET /api/users HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGci...        ← Standard header
X-Request-ID: 550e8400-e29b-41d4-a716    ← Custom header
X-Client-Version: 2.4.1                  ← Custom header
```

Standard headers are those registered in the [IANA HTTP Field Name Registry](https://www.iana.org/assignments/http-fields/http-fields.xhtml). Everything else is a custom header.

---

## 2. The History of the `X-` Prefix

### 2.1 How It Started

Historically, the convention was to prefix custom headers with `X-` to signal that they are non-standard.

```
X-Forwarded-For: 203.0.113.50
X-Request-ID: abc-123
X-Custom-Auth: my-token
```

### 2.2 RFC 6648 — Deprecation of the `X-` Prefix

[RFC 6648](https://datatracker.ietf.org/doc/html/rfc6648), published in 2012, recommended **against using the `X-` prefix**.

The reasons were clear:

| Problem | Description |
|---------|-------------|
| **Name changes on standardization** | If `X-Forwarded-For` becomes a standard, it should become `Forwarded`, but the widely-adopted name can't be changed |
| **Dual support burden** | Servers must support both `X-Forwarded-For` and `Forwarded` |
| **Confusion** | The `X-` prefix alone doesn't reliably indicate standard vs. non-standard (`X-Forwarded-For` is effectively a standard) |

### 2.3 The Reality in Practice

Despite RFC 6648's recommendation, **the `X-` prefix remains widely used in practice.**

```
# De facto standards — too late to remove X-
X-Forwarded-For
X-Forwarded-Proto
X-Request-ID

# Recently defined standards — registered without X-
Forwarded          (RFC 7239, official successor to X-Forwarded-For)
Origin-Agent-Cluster
```

**Practical recommendation**: When defining new custom headers, use meaningful names without `X-`. For existing widely-adopted `X-` headers, continue using them as-is.

---

## 3. Commonly Used Custom Headers in Production

### 3.1 Request Tracing (Observability)

In distributed systems where a single request passes through multiple services, tracing headers are essential.

| Header | Purpose | Notes |
|--------|---------|-------|
| `X-Request-ID` | Unique identifier per request | Typically a UUID |
| `X-Correlation-ID` | Cross-service transaction tracking | Propagated across services |
| `traceparent` | W3C Trace Context standard | Used by OpenTelemetry |

```
# Client → API Gateway → Service A → Service B
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
X-Correlation-ID: txn-20260316-001
```

> **X-Request-ID vs X-Correlation-ID**
>
> - `X-Request-ID` identifies an individual HTTP request. When Service A calls Service B, a new `X-Request-ID` is generated.
> - `X-Correlation-ID` groups all requests from a single user action (e.g., placing an order). It remains the same throughout the entire flow.

#### Handling X-Request-ID in Spring Boot

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

        // Store in MDC → automatically included in logs
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

Include the MDC value in your `logback-spring.xml` pattern for easy log tracing:

```xml
<pattern>%d{HH:mm:ss.SSS} [%X{requestId}] %-5level %logger{36} - %msg%n</pattern>
```

#### Real-World Case: Tracing a Production Incident

It's Friday afternoon. The monitoring dashboard shows a spike in 500 errors from the order service. Where is the problem?

Without `X-Request-ID`, you'd have to search through millions of log lines to find the relevant request. With `X-Request-ID`:

```
# 1. Find the Request ID in the error log
[ERROR] [req-550e8400] OrderService - Order creation failed: PaymentService timeout

# 2. Search other service logs with the same ID
$ grep "550e8400" payment-service.log
[WARN] [req-550e8400] PaymentService - PG response delayed: exceeded 30s

# 3. Root cause: PG response delay → order service timeout
```

With log aggregation tools like Datadog or Grafana Loki, searching by `X-Request-ID` shows all logs from every service that request touched, in a single view.

#### Real-World Case: X-Correlation-ID Flow in Microservices

When a user clicks "Place Order," multiple internal APIs are called:

```
User → API Gateway → Order Service → Payment Service → Inventory Service → Notification Service

X-Correlation-ID: order-user42-20260316  (same throughout the entire flow)

X-Request-ID: req-001  (Gateway → Order)
X-Request-ID: req-002  (Order → Payment)
X-Request-ID: req-003  (Order → Inventory)
X-Request-ID: req-004  (Order → Notification)
```

Later, when someone asks "What went wrong with user42's order on March 16?", searching for `X-Correlation-ID: order-user42-20260316` pulls up all related logs across every service at once.

---

### 3.2 Proxy / Load Balancer Headers

These headers are used by reverse proxies (Nginx, AWS ALB, etc.) to forward original request information to backend servers.

| Header | Purpose | Example Value |
|--------|---------|---------------|
| `X-Forwarded-For` | Original client IP | `203.0.113.50, 70.41.3.18` |
| `X-Forwarded-Proto` | Original protocol | `https` |
| `X-Forwarded-Host` | Original Host | `www.example.com` |
| `X-Forwarded-Port` | Original port | `443` |
| `X-Real-IP` | Actual client IP (Nginx) | `203.0.113.50` |

```
# Client(203.0.113.50) → ALB(10.0.0.1) → Server
X-Forwarded-For: 203.0.113.50, 10.0.0.1
X-Forwarded-Proto: https
```

> **Warning: X-Forwarded-For Spoofing**
>
> Clients can forge the `X-Forwarded-For` header. To trust this header, you must configure a **trusted proxy list**.

#### Handling Proxy Headers in Spring Boot

```yaml
# application.yml
server:
  forward-headers-strategy: native   # Tomcat processes X-Forwarded-*
  tomcat:
    remoteip:
      internal-proxies: 10\\.0\\.\\d{1,3}\\.\\d{1,3}  # Trusted proxy IPs
```

With `forward-headers-strategy: native`, `request.getRemoteAddr()` returns the first IP from `X-Forwarded-For`.

#### Real-World Case: The IP-Based Rate Limiting Trap

You've implemented IP-based rate limiting, but every request shows the same IP (`10.0.0.1`), causing all users to be blocked at once. Why? The server is treating the **load balancer's IP as the client IP**.

```
# Wrong config: all requests recorded with ALB IP
Request 1: remoteAddr=10.0.0.1  (actual: 203.0.113.50)
Request 2: remoteAddr=10.0.0.1  (actual: 198.51.100.23)

# Correct config: using first IP from X-Forwarded-For
Request 1: remoteAddr=203.0.113.50
Request 2: remoteAddr=198.51.100.23
```

#### Real-World Case: The HTTPS Redirect Infinite Loop

When a server behind a proxy doesn't check `X-Forwarded-Proto`, an infinite redirect loop occurs:

```
1. Client → (HTTPS) → ALB → (HTTP) → Server
2. Server: "HTTP request? Redirect to HTTPS!"
3. Client → (HTTPS) → ALB → (HTTP) → Server
4. Server: "HTTP again? Redirect again!" → infinite loop
```

Checking `X-Forwarded-Proto: https` solves this:

```java
@Component
public class HttpsRedirectFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String proto = request.getHeader("X-Forwarded-Proto");

        // If the proxy reports HTTPS, no redirect needed
        if ("https".equals(proto) || request.isSecure()) {
            filterChain.doFilter(request, response);
            return;
        }

        // Only redirect when actually accessed via HTTP
        String redirectUrl = "https://" + request.getServerName() + request.getRequestURI();
        response.sendRedirect(redirectUrl);
    }
}
```

#### Real-World Case: X-Forwarded-For in Multi-Proxy Environments

In production, requests often pass through multiple proxies:

```
Client(203.0.113.50) → CDN(54.230.1.1) → ALB(10.0.0.1) → Nginx(10.0.1.1) → App

X-Forwarded-For: 203.0.113.50, 54.230.1.1, 10.0.0.1
```

The **leftmost** IP is the actual client. But if an attacker sends `X-Forwarded-For: 1.2.3.4` from the start:

```
X-Forwarded-For: 1.2.3.4, 203.0.113.50, 54.230.1.1, 10.0.0.1
```

The leftmost IP is now fake. The safe approach is to **strip trusted proxy IPs from the right** and use the rightmost remaining IP.

---

### 3.3 Client Information

Headers used by the server to identify the client's version, platform, and device information.

| Header | Purpose | Example Value |
|--------|---------|---------------|
| `X-Client-Version` | App version | `2.4.1` |
| `X-Platform` | Platform type | `iOS`, `Android`, `Web` |
| `X-Device-ID` | Device unique identifier | `device-abc-123` |
| `X-App-Name` | App name | `MyApp-iOS` |

```
GET /api/config HTTP/1.1
X-Client-Version: 2.4.1
X-Platform: iOS
X-Device-ID: 5A3F2B1C-...
```

These headers are useful for **server-side feature flags**:

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

#### Real-World Case: Force Update

When a critical security vulnerability is discovered in the app, you need to block usage of versions below a threshold:

```java
@GetMapping("/api/health")
public ResponseEntity<?> healthCheck(
        @RequestHeader(value = "X-Client-Version", required = false) String version,
        @RequestHeader(value = "X-Platform", required = false) String platform) {

    if (version != null && isVersionBelow(version, "3.0.0")) {
        return ResponseEntity.status(HttpStatus.UPGRADE_REQUIRED)  // 426
            .body(Map.of(
                "message", "Security update required",
                "minVersion", "3.0.0",
                "storeUrl", "iOS".equals(platform)
                    ? "https://apps.apple.com/app/myapp"
                    : "https://play.google.com/store/apps/details?id=com.myapp"
            ));
    }
    return ResponseEntity.ok(Map.of("status", "ok"));
}
```

#### Real-World Case: Platform-Specific Responses

Same API, different image formats for iOS and Android:

```java
@GetMapping("/api/banners")
public ResponseEntity<List<Banner>> getBanners(
        @RequestHeader(value = "X-Platform", required = false) String platform) {

    String imageFormat = "Android".equals(platform) ? "webp" : "png";
    List<Banner> banners = bannerService.getBanners(imageFormat);
    return ResponseEntity.ok(banners);
}
```

#### Real-World Case: Tracking Non-Logged-In Users with Device ID

Even without login, `X-Device-ID` enables behavior analysis. For example, sending push notifications to users who "added to cart but didn't check out":

```
GET /api/recommendations HTTP/1.1
X-Device-ID: 5A3F2B1C-8D7E-4A9B-B2C1-3E5F6A7B8C9D
X-Platform: iOS
X-Client-Version: 4.2.0
```

> **Privacy note**: `X-Device-ID` must be handled carefully under privacy regulations. If GDPR or similar laws apply, tracking without user consent is not permitted.

---

### 3.4 Authentication / Security

| Header | Purpose | Notes |
|--------|---------|-------|
| `X-API-Key` | API key authentication | Used as an alternative to `Authorization` |
| `X-CSRF-Token` | CSRF token delivery | Used in form-based authentication |
| `X-Forwarded-User` | Authenticated user info from proxy | Reverse proxy authentication |
| `Idempotency-Key` | Idempotency guarantee | Prevents duplicate processing in payment APIs |

#### X-API-Key in Practice

For public-facing APIs, `X-API-Key` is the most common authentication method. Major API providers like Google Maps, Stripe, and Twilio all support it.

```
# Google Maps API example
GET /maps/api/geocode/json?address=Seoul HTTP/1.1
Host: maps.googleapis.com
X-API-Key: AIzaSyD...your-key
```

```java
// Spring Boot API Key validation filter
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
        // Skip API key validation for public endpoints
        return request.getRequestURI().startsWith("/api/public/");
    }
}
```

> **`Authorization` vs `X-API-Key`**: OAuth2 tokens go in `Authorization: Bearer ...`, while simple API keys go in `X-API-Key`. Some services use both simultaneously — API key for app identification + Bearer token for user authentication.

#### X-CSRF-Token in Practice

The most common CSRF defense pattern in SPAs (Single Page Applications):

```
# 1. Server sends CSRF token as a cookie on page load
Set-Cookie: XSRF-TOKEN=abc123; Path=/; SameSite=Lax

# 2. Client includes token in header for state-changing requests
POST /api/transfer HTTP/1.1
X-CSRF-Token: abc123
Cookie: XSRF-TOKEN=abc123; SESSION=xyz789
```

The server verifies that the cookie token matches the header token (Double Submit Cookie pattern). Attackers can trigger automatic cookie submission, but cannot set custom headers from a different origin — blocking CSRF attacks.

```java
// Spring Security handles CSRF tokens automatically
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            // withHttpOnlyFalse(): allows JS to read the cookie and set the header
        );
        return http.build();
    }
}
```

#### Idempotency-Key Example

Prevents duplicate processing from network retries in critical operations like payments or transfers.

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

    // Check if this key was already processed
    Optional<PaymentResult> existing = paymentRepository.findByIdempotencyKey(idempotencyKey);
    if (existing.isPresent()) {
        return ResponseEntity.ok(existing.get());  // Return existing result
    }

    PaymentResult result = paymentService.process(request, idempotencyKey);
    return ResponseEntity.status(HttpStatus.CREATED).body(result);
}
```

#### Why Idempotency-Key Is Essential in Production

Consider this scenario: you call a payment API but never receive a response. The client has no way of knowing whether the payment went through. Retrying risks a double charge; not retrying risks a missed payment. `Idempotency-Key` solves this — **multiple requests with the same key are processed exactly once.**

#### How Real Services Use Idempotency-Key

**Stripe** — the most well-known example. All POST requests support the `Idempotency-Key` header.

```bash
curl https://api.stripe.com/v1/charges \
  -H "Idempotency-Key: order-12345-attempt-1" \
  -d amount=5000 \
  -d currency=usd
```

Stripe stores keys for **24 hours** and returns the original response for duplicate requests. However, sending a different payload with the same key returns `400 Bad Request`.

**Toss Payments** (Korean PG) — the payment confirmation API uses `orderId` as the idempotency key.

```bash
curl https://api.tosspayments.com/v1/payments/confirm \
  -H "Idempotency-Key: order-20260316-abc789"
```

**PayPal** — uses the `PayPal-Request-Id` header for idempotency in order creation and payment capture.

```bash
curl https://api.paypal.com/v2/checkout/orders \
  -H "PayPal-Request-Id: order-unique-id-123"
```

#### Beyond Payments: Other Use Cases

`Idempotency-Key` is not just for payments. It applies to **any important state-changing POST request**.

| Scenario | Problem If Duplicated | Key Generation Strategy |
|----------|----------------------|------------------------|
| Payments/Transfers | Double charge, double withdrawal | `pay-{orderId}-{timestamp}` |
| Order creation | Duplicate orders | `order-{userId}-{cartHash}` |
| Messaging (SMS/Email) | Message sent twice | `msg-{templateId}-{recipientId}-{date}` |
| Points/Coupon issuance | Double reward | `reward-{eventId}-{userId}` |
| External API integration (webhooks) | Event processed twice | Use the provider's `event_id` |

#### Implementation Considerations

**1. Key generation is the client's responsibility**

If the server generates the key, it defeats the purpose. The client must create the key before the request so the same key can be sent on retry.

```javascript
// Frontend — generate key when the order button is clicked
const idempotencyKey = `order-${orderId}-${Date.now()}`;

async function placeOrder() {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,  // Same key on retry
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderData),
  });
}
```

**2. Set a TTL on keys**

Storing keys forever means unbounded storage growth. Typically **24–48 hours** is appropriate. Stripe uses 24 hours; some financial APIs use 72 hours.

```java
// TTL management with Redis — auto-expires after 24 hours
redisTemplate.opsForValue().set(
    "idempotency:" + key,
    result,
    Duration.ofHours(24)
);
```

**3. Handle concurrent requests (race conditions)**

What if two requests with the same key arrive simultaneously? One should be processed and the other should wait or receive `409 Conflict`.

```java
// Distributed lock with Redis SETNX
Boolean acquired = redisTemplate.opsForValue()
    .setIfAbsent("lock:idempotency:" + key, "1", Duration.ofSeconds(30));

if (Boolean.FALSE.equals(acquired)) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body("Request is already being processed");
}
```

**4. Store the full response, not just the key**

Storing only the key is not enough. You must store the **complete response (status code + body)** to return an identical response on retry.

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

### 3.5 Rate Limiting

**Response headers** that inform clients about API rate limiting status.

| Header | Purpose | Example Value |
|--------|---------|---------------|
| `X-RateLimit-Limit` | Maximum allowed requests | `1000` |
| `X-RateLimit-Remaining` | Remaining requests | `742` |
| `X-RateLimit-Reset` | Limit reset time (Unix timestamp) | `1742108400` |
| `Retry-After` | Retry time (standard header) | `60` (seconds) |

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 742
X-RateLimit-Reset: 1742108400
```

When the rate limit is exceeded, return `429 Too Many Requests` with a `Retry-After` header:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Remaining: 0
```

> **Note**: Standardization of `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (without `X-`) is in progress ([draft-ietf-httpapi-ratelimit-headers](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)).

#### Real-World Case: GitHub API Rate Limiting

GitHub's API is a textbook example of rate limit headers:

```bash
$ curl -I https://api.github.com/users/octocat

HTTP/2 200
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 56
X-RateLimit-Reset: 1742108400
X-RateLimit-Used: 4
X-RateLimit-Resource: core
```

Unauthenticated requests get 60/hour; token-authenticated requests get 5,000/hour. `X-RateLimit-Resource` indicates which limit category applies (core, search, graphql, etc.).

#### Real-World Case: Client-Side Rate Limit Handling

When the server sends rate limit headers, clients can intelligently throttle their requests:

```javascript
async function fetchWithRateLimit(url) {
  const response = await fetch(url);

  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining'));
  const resetTime = parseInt(response.headers.get('X-RateLimit-Reset'));

  if (remaining === 0) {
    const waitMs = (resetTime * 1000) - Date.now();
    console.log(`Rate limit reached. Retrying in ${Math.ceil(waitMs / 1000)}s`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return fetchWithRateLimit(url);  // retry
  }

  if (remaining < 10) {
    console.warn(`Rate limit warning: ${remaining} remaining`);
  }

  return response;
}
```

#### Implementing Rate Limiting in Spring Boot (Bucket4j)

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

### 3.6 Cache / Performance

| Header | Purpose | Notes |
|--------|---------|-------|
| `X-Cache` | Cache hit status | Added by CDN to responses |
| `X-Cache-TTL` | Cache TTL | For debugging |
| `X-Response-Time` | Server response time | For monitoring |

```
HTTP/1.1 200 OK
X-Cache: HIT from edge-server-tokyo
X-Response-Time: 45ms
```

#### Real-World Case: CDN Cache Debugging

"I updated the image but it still shows the old one" — a common complaint when using CDNs. The `X-Cache` header reveals the cause instantly:

```bash
$ curl -I https://cdn.example.com/images/logo.png

X-Cache: HIT        # Served from CDN cache → still the old image
X-Cache-TTL: 3600   # Expires in 1 hour
Age: 2400           # Cached 40 minutes ago
```

CloudFront provides even more detail:

```
X-Cache: Hit from cloudfront
X-Amz-Cf-Pop: ICN54-C1          # Served from Seoul edge server
X-Amz-Cf-Id: abc123...          # Request ID for debugging
```

Common `X-Cache` values:

| Value | Meaning |
|-------|---------|
| `HIT` | Served from cache (no origin server call) |
| `MISS` | Not in cache, fetched from origin |
| `REFRESH HIT` | Cache expired, revalidated with origin, content unchanged |
| `ERROR` | Origin server error, served stale cache |

#### Real-World Case: SLO Monitoring with X-Response-Time

If your SLO (Service Level Objective) is "99th percentile API response time < 200ms," `X-Response-Time` is invaluable for monitoring:

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

        // Also record as Prometheus metric
        if (duration > 200) {
            log.warn("Slow API: {} {}ms", request.getRequestURI(), duration);
        }
    }
}
```

With this header, frontend developers can check server processing time right in the browser's Network tab, quickly answering "Is it slow because of the server or the network?"

---

## 4. Custom Headers and CORS

Custom headers have a close relationship with **CORS (Cross-Origin Resource Sharing)**. Without understanding this, you'll encounter errors when sending or reading custom headers from the frontend.

### 4.1 Preflight Trigger

Browsers send a Preflight (OPTIONS) request before any request that falls outside **Simple Request** conditions. Including a custom header violates Simple Request conditions, triggering a Preflight.

```
# Headers allowed in Simple Requests (custom headers NOT included)
Accept, Accept-Language, Content-Language, Content-Type (limited)
```

To send `X-Request-ID` from the frontend:

```javascript
// Frontend
fetch('https://api.example.com/users', {
  headers: {
    'X-Request-ID': crypto.randomUUID(),  // ← Triggers Preflight
  }
});
```

The server must allow the header:

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("https://frontend.example.com")
                .allowedHeaders("X-Request-ID", "X-Client-Version")  // Allow custom headers
                .exposedHeaders("X-Request-ID", "X-RateLimit-Remaining");  // Allow frontend to read
    }
}
```

### 4.2 `Access-Control-Expose-Headers`

By default, frontend JavaScript can only read **CORS-safelisted response headers**:

```
Cache-Control, Content-Language, Content-Length,
Content-Type, Expires, Last-Modified, Pragma
```

For the frontend to read custom response headers like `X-RateLimit-Remaining`, they must be specified in `Access-Control-Expose-Headers`:

```
Access-Control-Expose-Headers: X-RateLimit-Remaining, X-Request-ID
```

Without this, `response.headers.get('X-RateLimit-Remaining')` returns `null`.

> **Full CORS guide**: [Understanding CORS: From Browser Security Policy to Spring Boot Configuration](/blog/en/cors-understanding-guide)

---

## 5. Custom Header Naming Guide

### 5.1 Principles for Good Names

| Principle | Good Example | Bad Example |
|-----------|-------------|-------------|
| Purpose should be clear | `X-Request-ID` | `X-ID` |
| Consistent naming convention | `X-Client-Version` | `x_client_ver` |
| Avoid collisions | `MyApp-Trace-ID` | `Trace-ID` (may conflict with other systems) |
| Work case-insensitively | — | HTTP headers are case-insensitive |

### 5.2 Organization-Specific Prefixes

Instead of `X-`, use **organization/project prefixes** to prevent collisions:

```
MyApp-Request-ID: abc-123
MyApp-Client-Version: 2.4.1
MyApp-Tenant-ID: tenant-42
```

GitHub, AWS, and others use this pattern:

```
X-GitHub-Request-Id: ABCD:1234:5678
X-Amzn-Trace-Id: Root=1-5759e988-bd862e3fe1be46a994272793
```

---

## 6. Important Considerations

### 6.1 Never Put Sensitive Data in Headers

HTTP headers are easily logged and can be exposed through proxies. Never put passwords, social security numbers, or card numbers in custom headers.

```
# Never do this
X-User-Password: mySecret123
X-SSN: 900101-1234567
```

### 6.2 Header Size Limits

Most web servers and proxies have header size limits:

| Server/Proxy | Default Header Size Limit |
|--------------|--------------------------|
| Nginx | 4KB (single header), 8KB (total) |
| Apache | 8KB (total) |
| Tomcat | 8KB (total) |
| AWS ALB | 16KB (total) |

Putting large data (JSON objects, etc.) in headers can result in `431 Request Header Fields Too Large` errors. Large data should go in the request body.

### 6.3 Use Standard Headers When Available

Before creating a custom header, check if a standard header already serves the same purpose.

| Purpose | Use Standard Header | Custom Header (Unnecessary) |
|---------|--------------------|-----------------------------|
| Auth token | `Authorization: Bearer ...` | `X-Auth-Token` |
| Content negotiation | `Accept: application/json` | `X-Response-Format` |
| Cache control | `Cache-Control: no-cache` | `X-No-Cache: true` |
| Original protocol | `Forwarded: proto=https` | `X-Forwarded-Proto` (legacy) |

---

## Summary

| Category | Representative Headers | Key Purpose |
|----------|----------------------|-------------|
| Request Tracing | `X-Request-ID`, `X-Correlation-ID` | Distributed system log tracing |
| Proxy | `X-Forwarded-For`, `X-Forwarded-Proto` | Original client info forwarding |
| Client Info | `X-Client-Version`, `X-Platform` | Feature flags, analytics |
| Auth/Security | `X-API-Key`, `Idempotency-Key` | API auth, idempotency |
| Rate Limiting | `X-RateLimit-Limit`, `X-RateLimit-Remaining` | Usage control |
| Cache/Performance | `X-Cache`, `X-Response-Time` | CDN debugging, monitoring |

Custom headers may seem simple, but they must be managed alongside CORS configuration (`allowedHeaders`, `exposedHeaders`) to avoid frontend-backend integration issues. When defining a new custom header, follow this order: **check for standard headers → choose a meaningful name → update CORS configuration**.
