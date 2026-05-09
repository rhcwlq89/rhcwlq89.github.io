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

### Cross-Section References

- **Korean posts: use the `N.M절` form, not `§N.M`.** The `§` symbol is an academic convention that doesn't read as "section" at a glance to a typical Korean reader, and these references are usually plain text (not anchor links) so there's no affordance to navigate.
  - ❌ `§4.3`, `2편 §6.1`, `§4–§5`, `§2~§4`
  - ✅ `4.3절`, `2편 6.1절`, `4–5절`, `2~4절`
  - Top-level reference: `3절` rather than `§3`.
- **English posts keep `§`** since it's a standard typographic convention for "section" in English documents.
- **Exception**: if the reference is genuinely a clickable anchor link (e.g. `[§4.3](#section-4-3)`), `§` is fine in either language — the rule is about plain-text references.

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

# 6. Stray § in KO posts — should be 'N.M절' instead (KO file only)
rg '§[0-9]' "$FILE"
```

Also run the same checks on the EN counterpart under `src/content/blog/en/<slug>.md` (checks 1, 4, and 6 mostly don't apply to English, but 2, 3, and 5 do).

## Hero Image Style Guide

This blog has a consistent visual identity across all hero images. Every hero image prompt MUST follow these specifications exactly.

### Dominant Visual Style (based on existing images: Docker Compose, Kubernetes, SAML, EKS, Terraform, TSDB, HTTP Headers guides)

**Background & Atmosphere:**
- Dark navy gradient background (#0a1628 at edges → #1a2744 at center)
- Subtle grid or network pattern visible in the deep background (like a tech floor or circuit board)
- Light particle effects scattered across the scene (small glowing dots, like stars or data particles)
- **Background must NOT be empty** — fill ambient space with faint clouds, distant translucent platforms, far-away node clusters, additional grid layers, or floating circuit fragments
- Overall feel: a dark, futuristic command center or data center environment

**Illustration Style:**
- Isometric / 2.5D perspective with depth — objects sit on floating platforms or raised surfaces
- Semi-realistic tech icons rendered in a polished, vector-like style (not flat, not fully 3D)
- Objects have subtle shadows, reflections, and glass-like transparency
- Items appear to float on or above dark surfaces with gentle elevation

**Density & Layering (CRITICAL — most-violated rule):**
- The composition MUST populate three depth layers — foreground, midground, background — none empty.
- <strong>Foreground</strong>: small auxiliary objects close to the camera (small server nodes, laptops, mobile devices, satellites, signal towers, drifting cubes/spheres, individual user icons)
- <strong>Midground</strong>: the main subject (central platform, hub, hexagonal slab) with its 3-5 supporting elements
- <strong>Background</strong>: clouds, distant network grids, floating data fragments, additional faint platforms/datacenters, particle fields, holographic UI panels
- <strong>Avoid empty corners</strong> — every quadrant of the image should contain at least secondary detail. Empty dark voids signal a sparse, weak composition.
- Smell test: if you mentally delete the central subject, the remaining canvas should still feel populated with ambient richness.
- Reference benchmarks for density: EKS Production Setup, Private EC2 Guide 1, Bastion Setting Guide — these are correctly populated. Aim for that level.

**Cluster Patterns (key technique for richness):**
- Server racks should be rendered as <strong>clusters of small cubes</strong> (5-15 stacked / arranged on a platform), not single monolithic boxes. This is what makes EKS / Kubernetes / Private EC2 hero images feel rich.
- Multiple small node-like cubes scattered on or near platforms suggest distributed systems and add visual texture.
- Vary cube colors within a cluster (mostly cyan, accented with green/orange/yellow cubes) to break monotony.
- For abstract concepts (gateways, services), still surround the main icon with a cluster of supporting cubes/spheres.

**Lighting & Glow:**
- Primary glow: Blue and cyan (#00b4d8, #48cae4) — used for connections, outlines, and ambient light
- Glow effects on key objects: soft halos, light rays, energy lines connecting elements
- Neon-style edge lighting on important elements (servers, shields, logos)

**Color Semantics (READ THIS FIRST — color must carry meaning):**
- <strong>Color is not decoration. Every color in the scene must encode a state, role, or argument from the post.</strong>
- Bad approach: "Each of the 5 candidates gets a different color so the image is varied." → produces an arbitrary rainbow that signals nothing. AI-generated flat.
- Good approach: "Cyan = baseline / unselected, amber = the active / selected path, coral = rejected / anti-pattern, gold = destination reached." → every color earns its place.
- Reference benchmarks: DB Deadlock uses orange/red specifically for the deadlock cycle, gold for the locks, red for timeout — each color tells a part of the story. Private EC2 Guide 1 uses red for attack vectors, gold for the protective shield — color encodes the threat-vs-defense narrative.
- <strong>Before picking colors, write down the post's narrative roles</strong> (what is "selected," what is "rejected," what is "in progress," what is "the goal," what is "warning"). Then map each role to a color from the palette.
- If you can't explain in one sentence what each color in the image MEANS, the palette is wrong.

**Color Diversity (CRITICAL — most-violated rule, alongside Density):**
- Cyan/blue alone makes images look flat and monotonous. Reference benchmark images (EKS Production Setup, Private EC2 Guide 1, DB Deadlock, Bastion) use <strong>3-4 distinct colors visibly across the scene</strong>, not "cyan plus one accent."
- Standard palette to draw from:
  - <strong>Cyan / blue</strong> (#00b4d8, #48cae4) — primary, always present
  - <strong>Amber / orange</strong> (#ff9500, #ffb84d) — warnings, on-prem, legacy, active/selected paths
  - <strong>Coral / red</strong> (#ef4444, #f87171) — threats, attacks, blocked traffic, alerts
  - <strong>Green / teal</strong> (#10b981, #14b8a6) — success, health checks, AWS-managed services, accepted state
  - <strong>Gold / yellow</strong> (#fbbf24, #fcd34d) — premium, tokens, status lights, static IP
  - <strong>Magenta / purple</strong> (#a855f7, #c084fc) — special states, edge/CDN, custom
- <strong>Mandatory color recipe</strong>: every image must blend at least <strong>three colors visibly</strong>:
  - Primary cyan/blue (60-70% of glow volume)
  - Strong secondary accent (20% — applied to a major element or path)
  - Tertiary accent (10% — particles, status lights, small details, individual cubes)
- <strong>Multi-colored cube clusters are mandatory</strong> — when rendering server racks or node groups as cube clusters, mix in green, orange, and yellow cubes alongside the dominant cyan ones. A monochromatic cyan cube cluster is the #1 cause of "flat / boring" hero images.
- Picking a palette per topic:
  - "Defense / security" → cyan + coral attack vectors + gold shield + green safe zone
  - "Cluster / distributed" → cyan + green status + amber + yellow node lights mixed in cube clusters
  - "Hybrid cloud" → cyan AWS + amber on-prem + green PrivateLink + gold accents
  - "Decision / routing" → cyan baseline + amber active path + green selected option + coral rejected option + yellow markers
  - "CDN / edge / global" → cyan + magenta edges + green hit-cache + amber miss
- Without 3+ visible colors the image looks weak and "AI-generated flat." Pick the palette first, then weave each color into specific elements before describing geometry.

**Common Elements (use as appropriate):**
- Server racks rendered as cube clusters, database cylinders, laptop screens showing code or dashboards
- Cloud icons, shield/lock icons, gear/cog icons, satellite/antenna shapes
- Arrows and flow lines showing data movement (glowing, directional, with traveling motion particles)
- Many small spheres or cubes representing data, users, or requests — scatter liberally for ambient richness
- Floating platforms at varying heights and sizes (multiple, not just one large central one)
- Holographic decorative elements (faint UI charts, network maps, world maps in background consoles)
- Side consoles or terminal monitors at the lower corners (NOC / command center feel)

**Composition:**
- Centered main subject with supporting elements arranged around it
- Clear visual hierarchy — one dominant element, 3-5 supporting elements, plus 5+ ambient/background elements for richness
- <strong>Use the full canvas — corner-to-corner detail.</strong> Save breathing room for between objects, not for empty void areas of the canvas.
- Professional and polished, suitable for a senior backend engineering blog

**Strict Rules:**
- NEVER use white or light backgrounds
- NEVER include text, labels, or watermarks in the image
- NEVER use flat/minimal style or cartoon style
- NEVER leave any quadrant of the image visually empty
- ALWAYS maintain the dark navy isometric aesthetic
- ALWAYS include at least one secondary accent color besides cyan/blue
- ALWAYS render server-rack-like elements as cube clusters, not single boxes

### Hero Image Prompt Requirements

When writing a hero image prompt for a blog post:
- The prompt must be at least <strong>8 lines (sentences) long</strong> to ensure all layers AND the color palette are described.
- <strong>Before writing the prompt, decide the color palette AND its semantics</strong> — pick 3 or 4 colors and assign each one a specific narrative role from the post (selected/rejected/baseline/destination/warning/etc.). If you can't articulate what each color MEANS in one sentence, the palette isn't ready. Then weave each color into specific elements as you describe geometry.
- Line 1: Overall scene and background atmosphere — set the dark navy stage with depth, ambient particles, faint grids
- Line 2: <strong>Background layer</strong> — distant clouds, faint grids, far-away platforms, particle fields, holographic UI panels, side consoles (with at least one secondary color in this layer)
- Line 3-4: <strong>Midground main subject</strong> — central platform/hub/hex slab and its visual treatment (glow, edge neon, glass transparency, surrounding multi-colored cube cluster — mix green, orange, yellow with cyan)
- Line 5: <strong>Supporting elements at midground</strong> — 3-5 secondary objects, each given its OWN distinctive accent color where the topic allows differentiation (e.g., one element amber, another magenta, another green)
- Line 6: <strong>Foreground layer</strong> — small auxiliary objects close to camera (laptops, mobile devices, small node cubes, satellites, towers, drifting spheres) with status-light accents in mixed colors
- Line 7: <strong>Motion and connections</strong> — flow arrows with motion particles, with active path glowing in one accent color (amber or gold) and rejected/inactive paths in another (coral or muted blue)
- Line 8: <strong>Color palette summary line</strong> — explicitly name the 3-4 colors and where they appear, e.g., "primary cyan glow on the central VPC, amber/orange highlights on the active path and on-prem rack, green status lights on the AWS service cluster, and warm yellow accents in cube clusters"
- Always end with: "Isometric 2.5D style, dark navy background, vibrant multi-color glow palette (cyan + [secondary] + [tertiary]), no text. Aspect ratio 3:2 (1536x1024)."
- Reference specific existing blog images if helpful — e.g., "similar density and color richness to the EKS Production Setup hero image, with multi-colored cube-cluster server racks"
