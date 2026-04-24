# Project Settings

## Blog Writing Rules

### Frontmatter

- `pubDate` must always include the time (e.g., `2026-02-03T15:30:00+09:00`).
- Every post must be written in both Korean and English: KO in `src/content/blog/<slug>.md`, EN in `src/content/blog/en/<slug>.md`.
- Hero image path: KO uses `../../assets/...`, EN uses `../../../assets/...`.
- EN frontmatter must include `lang: en`. KO uses YAML list form for `tags:`; EN uses the inline array form (match existing posts).

### Post Structure (mandatory skeleton)

Every post follows this skeleton. No deviations without a concrete reason. The canonical reference is `src/content/blog/aws-private-ec2-guide-1.md` (KO) and `src/content/blog/en/aws-private-ec2-guide-1.md` (EN) — new posts should match their shape.

```
---
frontmatter
---

## 서론 / Introduction
  - 3–5 short paragraphs: hook, context, target reader.
  - Series posts: include the full series nav as a bullet list with the current part bolded.
  - Part 2+ of a series: link to the previous post — `[이전 글](/blog/…)` / `[previous post](/blog/en/…)`.

---

## TL;DR
  - 3–5 bullets, each 1–2 short lines.
  - Captures the whole post's thesis. A reader who reads only this and stops should walk away with the gist.

---

## 1. [First major H2 section]
  ### 1.1 ...
  ### 1.2 ...
  # Aside sections use `### N.X 참고: ...` / `### N.X Aside: ...` placed
  # immediately after the H2 where the concept first appears.

---

## [More H2 sections, numbered 2, 3, 4, …]

---

## 정리 / Recap
  - 3–5 key takeaways as bullets, each bolded core idea + one sentence of context.
  - End with a next-post teaser paragraph for series posts.

---

## 부록 / Appendix (optional)
  - Glossary tables, external references, cheat-sheets — content the reader
    consults after reading, not while reading.
```

**Do not** insert a one-line summary at the top of every H2 section. The global TL;DR covers that role.

Terminology-heavy reference material (glossary tables, acronym lists, external links) belongs in the Appendix at the end, not in Section 1. Keep the opening of the post about the actual subject.

### Prose Density Rules

The most common readability failure is wall-of-text prose. Enforce the following when drafting and when editing:

- **Korean sentence length cap: ~200 characters.** If a sentence crosses this, split into 2–3 short sentences and strip filler ("~에 대해서", "~라는 점에서", "~할 수 있다는 점").
- **At most 3 consecutive prose paragraphs.** After 3, break the rhythm with a table, list, diagram, callout, or `<details>` block.
- **Comparisons of 3+ items always use a table.** Never render a comparison as a sequence of `<strong>Label</strong>: description` paragraphs.
- **Bullet format**: prefer `- <strong>Core phrase</strong> — one-line elaboration.` over multi-sentence bullets. Each bullet should be scannable in about 2 seconds.
- **Lead with the definition.** When introducing a term or acronym, open with a one-sentence definition (`**X = Y**` or `<strong>X는 …</strong>이다`) before elaborating. Do not bury the definition at the end of a paragraph.
- **No `<strong>Label</strong>:` walls.** If you find yourself writing 4+ back-to-back `<strong>Label</strong>: body.` paragraphs, that's a signal — convert the block into a table or a tight bullet list instead.

### Bold Formatting

- **NEVER remove bold formatting** from blog content. If it renders incorrectly, fix the structure, do NOT strip the bold.
- **Use the HTML `<strong>` tag for bold, not Markdown `**...**`.** Astro/remark has a recurring parser bug where the closing `**` fails to register when it comes right after `)` and is immediately followed by a Korean particle (e.g. `**락(lock)**이다` leaks literal `**`). The workaround of pulling the particle inside the bold (`**락(lock)이다**`) silently extends the emphasis onto the particle, which is wrong. New posts must use `<strong>락(lock)</strong>이다` so the emphasis ends exactly before the particle. Leave existing posts alone unless they actually render broken.
  - ❌ `**락(lock)**이다` (parser bug), `**락(lock)이다**` (emphasis drifts onto the particle)
  - ✅ `<strong>락(lock)</strong>이다`

### Callouts & Notes

- **Do NOT use GFM alert syntax** (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!IMPORTANT]`, `[!CAUTION]`). Astro's default Markdown parser doesn't implement this GitHub extension, so the tag leaks as literal text.
- Use plain blockquote with a bold label: `> <strong>참고</strong>: body` / `> <strong>Note</strong>: body`. Match the label to the content's tone — typical labels include `참고 / Note`, `주의 / Caution`, `핵심 / Key`, `결론 / Bottom line`.

### Diagrams

- **All diagrams — architecture, flow, sequence, ER, state, timeline — must use `\`\`\`mermaid` fenced blocks.** The `mermaid` package and rendering in `src/layouts/BlogPost.astro` are already wired up and existing posts (terraform, saml, deadlock, sso, etc.) all use Mermaid.
- **Never draw topology or flow in `\`\`\`text` with ASCII box art** (`┌─┐│└┘`). ASCII breaks on font changes and CJK width, and reads poorly in dark mode. If you catch yourself starting a box in `\`\`\`text`, stop and switch to Mermaid.
- Allowed Mermaid types: `flowchart TB/LR/TD`, `sequenceDiagram`, `classDiagram`, `erDiagram`, `stateDiagram`, `gantt`.
- `\`\`\`text` is still fine for **non-diagram content**: CLI output, file trees, log snippets, config examples — anything that is real monospaced text rather than hand-drawn art.

### Collapsible Content (`<details>`)

Use `<details><summary>…</summary>…</details>` to keep the main flow short without losing depth. Astro passes raw HTML through, so this works in both KO and EN posts.

- **✅ Fold**: "더 자세히 / More detail" branches of an aside, advanced edge cases, long derivations, reinforcing examples a first-time reader can skip.
- **❌ Do not fold**: the TL;DR, tables, diagrams, the main argument of a section, anything a first-time reader must see.
- Summary text should preview what's inside and invite the click (e.g. `<summary><strong>More detail — AZ failure behavior, why not one ALB per AZ</strong></summary>`).

### Series Posts

- Title format: `"<Series Title> Part N: <Topic>"` (or the Korean equivalent). Keep the same series title verbatim across all parts.
- The Introduction must include a full series nav bullet list, with the current part bolded: `<strong>Part 1 — … (이 글)</strong>`.
- Recap ends with a next-post teaser paragraph that names the topic of the next post and previews what the reader will learn or build.
- Part 2+ links back to the previous post in the intro.

### Pre-publish Self-check

Run these before committing a new or edited post. Expect all five to come back clean (or the TL;DR to be present) before pushing.

```bash
FILE=src/content/blog/<slug>.md

# 1. Bold parser bug — closing ** followed by a Korean particle
rg '\)\*\*[가-힣]' "$FILE"

# 2. GFM alert leakage
rg '\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]' "$FILE"

# 3. ASCII box art leaking into text code blocks (diagrams should be Mermaid)
awk '/^```text/{t=1; next} /^```/{t=0} t && /[┌└│─┐┘]/{print NR": "$0}' "$FILE"

# 4. Overlong Korean sentences (>200 chars) — candidates for splitting
awk 'length > 200 {print NR": "length" chars"}' "$FILE"

# 5. Structural sanity — TL;DR section present
rg -q '^## TL;DR' "$FILE" || echo "MISSING: TL;DR section"
```

Also run the same checks on the EN counterpart under `src/content/blog/en/<slug>.md` (checks 1 and 4 mostly don't apply to English, but 2, 3, and 5 do).

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
