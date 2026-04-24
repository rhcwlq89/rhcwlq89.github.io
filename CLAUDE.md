# Project Settings

## Blog Writing Rules

- `pubDate` must always include the time (e.g., `2026-02-03T15:30:00+09:00`)
- Every blog post must be written in both Korean and English versions
- **NEVER remove bold formatting** from blog content. If bold renders incorrectly, fix the structure — do NOT strip the bold.
- **Bold는 HTML `<strong>` 태그로 작성** — 마크다운 `**...**`은 Astro/remark에서 `)` 다음에 한글 조사가 붙을 때(`**락(lock)**이다` 등) 닫는 `**`이 인식되지 않는 재발성 버그가 있다. 조사를 bold 안으로 넣는 우회법(`**락(lock)이다**`)은 강조 범위가 어긋나므로, 새 글에서는 `<strong>락(lock)</strong>이다` 형태로 작성해 강조 범위를 조사 앞까지로 정확히 유지한다. 기존 글은 렌더링이 깨지지 않는 한 그대로 둔다.
  - ❌ `**락(lock)**이다` (파서 버그), `**락(lock)이다**` (강조 범위 어긋남)
  - ✅ `<strong>락(lock)</strong>이다`
  - 깨진 곳 점검: `rg '\)\*\*[가-힣]'` — 새 글 커밋 전 실행 권장.

## Hero Image Style Guide

This blog has a consistent visual identity across all hero images. Every hero image prompt MUST follow these specifications exactly.

### Dominant Visual Style (based on existing images: Docker Compose, Kubernetes, SAML, EKS, Terraform, TSDB, HTTP Headers guides)

**Background & Atmosphere:**
- Dark navy gradient background (#0a1628 at edges → #1a2744 at center)
- Subtle grid or network pattern visible in the deep background (like a tech floor or circuit board)
- Light particle effects scattered across the scene (small glowing dots, like stars or data particles)
- Overall feel: a dark, futuristic command center or data center environment

**Illustration Style:**
- Isometric / 2.5D perspective with depth — objects sit on floating platforms or raised surfaces
- Semi-realistic tech icons rendered in a polished, vector-like style (not flat, not fully 3D)
- Objects have subtle shadows, reflections, and glass-like transparency
- Items appear to float on or above dark surfaces with gentle elevation

**Lighting & Glow:**
- Primary glow: Blue and cyan (#00b4d8, #48cae4) — used for connections, outlines, and ambient light
- Secondary glow: Depends on context (red/coral for danger, gold for premium/tokens, green/teal for success, orange for warnings)
- Glow effects on key objects: soft halos, light rays, or energy lines connecting elements
- Neon-style edge lighting on important elements (servers, shields, logos)

**Common Elements (use as appropriate):**
- Server racks, database cylinders, laptop screens showing code or dashboards
- Cloud icons, shield/lock icons, gear/cog icons
- Arrows and flow lines showing data movement (glowing, directional)
- Small spheres or cubes representing data, users, or requests
- Floating platforms that objects rest on

**Composition:**
- Centered main subject with supporting elements arranged around it
- Clear visual hierarchy — one dominant element, 3-5 supporting elements
- Not overly crowded — maintain breathing room between elements
- Professional and polished, suitable for a senior backend engineering blog

**Strict Rules:**
- NEVER use white or light backgrounds
- NEVER include text, labels, or watermarks in the image
- NEVER use flat/minimal style or cartoon style
- ALWAYS maintain the dark navy isometric aesthetic

### Hero Image Prompt Requirements

When writing a hero image prompt for a blog post:
- The prompt must be at least 5 lines (sentences) long
- Line 1: Describe the overall scene and background atmosphere
- Line 2-3: Describe the main subject and its visual treatment (glow, color, position)
- Line 4: Describe supporting elements and their arrangement around the main subject
- Line 5+: Describe lighting, flow/movement, and any contextual details that convey the post's topic
- Always end with: "Isometric 2.5D style, dark navy background, blue/cyan glow effects, no text. Aspect ratio 3:2 (1536x1024)."
- Reference specific existing blog images if helpful (e.g., "similar composition to the SAML guide image")
