# Project Settings

## Blog Writing Rules

- `pubDate` must always include the time (e.g., `2026-02-03T15:30:00+09:00`)
- Every blog post must be written in both Korean and English versions
- **NEVER remove bold formatting** from blog content. If bold renders incorrectly, fix the structure — do NOT strip the bold.
- **Use the HTML `<strong>` tag for bold, not Markdown `**...**`** — Astro/remark has a recurring parser bug where the closing `**` fails to register when it comes right after `)` and is immediately followed by a Korean particle (e.g. `**락(lock)**이다`). The common workaround of pulling the particle inside the bold (`**락(lock)이다**`) silently extends the emphasis onto the particle, which is wrong. In new posts, write `<strong>락(lock)</strong>이다` so the emphasis ends exactly before the particle. Leave existing posts alone unless they actually render broken.
  - ❌ `**락(lock)**이다` (parser bug), `**락(lock)이다**` (emphasis scope drifts onto the particle)
  - ✅ `<strong>락(lock)</strong>이다`
  - Pre-commit scan: `rg '\)\*\*[가-힣]'`.
- **Do NOT use GFM alert syntax (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, etc.)** — Astro's default Markdown parser doesn't implement this GitHub extension, so `[!NOTE]` ends up as literal text in the rendered post. Follow the existing convention across other posts: a plain blockquote with a bold label, e.g. `> <strong>참고</strong>: body` (or `<strong>주의</strong>`, `<strong>결론</strong>`, `<strong>핵심</strong>`, etc. — pick a label that fits the content).
  - ❌ `> [!NOTE]\n> body`
  - ✅ `> <strong>참고</strong>: body`
  - Pre-commit scan: `rg '\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]'`.
- **Diagrams (architecture, flow, trees) must use `\`\`\`mermaid` fenced blocks** — the `mermaid` package and rendering in `src/layouts/BlogPost.astro` are already wired up, and existing posts (terraform, saml, deadlock, sso, etc.) all use Mermaid. Do NOT fall back to `\`\`\`text` with ASCII box art (`┌─┐│└┘`): it breaks depending on font and CJK character width, and reads poorly in dark mode.
  - ❌ ASCII boxes inside `\`\`\`text`
  - ✅ `\`\`\`mermaid` with `flowchart TB` / `LR` / `TD`, `sequenceDiagram`, etc.
  - Match the Mermaid style of existing posts for consistency.

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
