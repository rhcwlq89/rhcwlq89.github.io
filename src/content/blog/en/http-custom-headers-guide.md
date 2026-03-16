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

---

### 3.4 Authentication / Security

| Header | Purpose | Notes |
|--------|---------|-------|
| `X-API-Key` | API key authentication | Used as an alternative to `Authorization` |
| `X-CSRF-Token` | CSRF token delivery | Used in form-based authentication |
| `X-Forwarded-User` | Authenticated user info from proxy | Reverse proxy authentication |
| `Idempotency-Key` | Idempotency guarantee | Prevents duplicate processing in payment APIs |

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
