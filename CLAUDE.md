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
  - Part 2+ of a series: link to the previous post — `[이전 글](/blog/…)` / `[previous post](/en/blog/…)`.
  - **Internal link URLs are NOT the source path.** EN posts live at `src/content/blog/en/<slug>.md` but are served at **`/en/blog/<slug>/`** (the `en` and `blog` segments swap). Always link EN posts as `/en/blog/<slug>` — never `/blog/en/<slug>`, which 404s. KO posts link as `/blog/<slug>`. Run `npm run check:links` to catch broken internal links.

---

## TL;DR
  - 3–5 bullets, each 1–2 short lines.
  - Captures the whole post's thesis. A reader who reads only this and stops should walk away with the gist.
  - **No undefined acronyms or jargon here.** The TL;DR is the post's front door — a reader hits it before any definition exists. Write it in plain language: spell the concept out instead of using the acronym (e.g. "방향성 비순환 그래프" not "DAG"), or rephrase to avoid the term entirely. Introduce the acronym later, in the body, with its one-line definition on first use.
    - **Exception — proper-noun brand/product/service names stay as-is.** Names whose expansion nobody actually uses function as proper nouns, not "decode-me" acronyms: AWS service brands (S3, EC2, RDS, EKS, ECS, SQS, SNS, KMS, IAM, ALB, NLB, NAT Gateway, CloudFront, DynamoDB, Transit Gateway), protocol/model names with obscure expansions (OSI, SAML), and code identifiers/class names. Keep these. The rule targets *descriptive* acronyms whose plain form aids comprehension (DAG, NAT-the-concept aside, AZ → 가용 영역, SG → 보안 그룹, IGW → 인터넷 게이트웨이, ENI, NACL, CIDR, HA, SLA, SLO, ISMS, PCI-DSS, DIP, CDC, CTE, ETL, DORA, JTBD, …) and generic acronyms a junior won't recognize. When unsure: if the expansion is the name people actually say, keep the acronym; if the expansion explains what the thing *does*, spell it out.

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
- **TL;DR stays acronym-free.** Acronyms and jargon must not appear in the TL;DR, because it precedes every definition in the post. Spell the concept out in plain words or rephrase around it; reserve the acronym (and its first-use definition) for the body. See the TL;DR note in the skeleton above.
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

Run these before committing a new or edited post. Expect all of these to come back clean (or the TL;DR to be present) before pushing.

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

# 7. Glossary coverage — every acronym/jargon term in the body should be in the appendix glossary
#    (or defined inline at first appearance). Run this Python check to spot missing ones.
python3 <<'PY'
import re
with open("$FILE") as f:
    content = f.read()
# Body = everything before the appendix
body = re.split(r'^## (?:부록|Appendix)', content, maxsplit=1, flags=re.MULTILINE)[0]
appendix = content[len(body):]
# Heuristic acronym extraction: 2+ letter all-caps tokens, or known jargon
candidates = set(re.findall(r'\b[A-Z][A-Z0-9]{1,}\b', body))
# Also include common lowercase jargon
for term in ['mTLS', 'gRPC', 'IPsec', 'IPv4', 'IPv6', 'Lambda', 'CloudFront',
             'PrivateLink', 'WebSocket', 'OpenAPI', 'Cognito', '온프렘', '온프레미스']:
    if term in body:
        candidates.add(term)
# Filter out trivial ones
skip = {'A','D','I','S','M','URL','TL','DR','HTTP','HTTPS','JSON','YAML','SQL','XML',
        'AWS','OS','PR','CI','CD','UI','API','REST','DB','RPS','IT','SDK','NOC',
        'AZ','RT','SG','GA','TG','DX','DR','TLS','TCP','UDP','IP','IPS','MAC','EU','US','PoC'}
missing = sorted(c for c in candidates - skip if c not in appendix and len(c) >= 2)
if missing:
    print("MISSING from glossary (verify each is defined inline or add to appendix):")
    for m in missing:
        print(f"  - {m}")
else:
    print("Glossary coverage: OK")
PY

# 8. Internal links resolve to real routes (repo-wide, not per-FILE).
#    Catches the EN /blog/en/ vs /en/blog/ path-swap bug and typo'd slugs.
npm run check:links
```

Also run the same checks on the EN counterpart under `src/content/blog/en/<slug>.md` (checks 1, 4, and 6 mostly don't apply to English, but 2, 3, 5, and 7 do).

The glossary check above is a heuristic — it flags candidates, but you should manually verify each: either it has an inline definition at first appearance, or it deserves a glossary entry. The goal is "no acronym/jargon term used without a one-sentence definition somewhere accessible to a junior reader."

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

**Focal Hierarchy & Depth (CRITICAL):**
- ONE dominant focal element that the eye lands on first — an unmistakable visual anchor.
- 3-5 supporting elements with clear visual hierarchy (smaller / less saturated than the focal).
- Foreground should be MINIMAL — at most 1-2 small grounding objects, or none. Avoid stuffing laptops + mobiles + satellites + dishes + drifting cubes; that pile becomes clutter without narrative.
- Detail comes from <strong>cluster density within elements</strong> (multi-colored cube clusters per element) and color semantics, NOT from adding more distinct element types.
- Smell test: every element should answer "why is this here, narratively?" in one sentence. If it can't, it's clutter.
- Reference benchmarks: DB Deadlock has ~6-8 distinct elements with empty navy corners (just grid + particles). Private EC2 Guide 1 has corners with only clouds/grids, no console monitors. Aim for that focal clarity, not maximum element count.

**Ambient Depth ≠ Clutter (the key distinction):**
- "Empty navy corners" doesn't mean "literally flat black." Corners and background should still feel ATMOSPHERIC — depth lives there, just not new element types.
- <strong>Ambient depth (good — adds richness)</strong>:
  - Glowing hexagonal grid floor whose lines fade into the distance
  - Soft volumetric mist / atmospheric haze in subtle accent colors
  - Sparse drifting particles in the air (not swarms, but enough to suggest atmosphere)
  - A few very faint distant cube clusters at low opacity in the deep background, hinting "more workloads exist" without competing for attention
  - Strong glow halos around focal elements that bleed into the surrounding navy
  - Soft glow rays emitting from focal elements upward into the void
  - Floor reflections of the focal elements
- <strong>Clutter (bad — adds noise)</strong>:
  - Console monitors at corners
  - Decorative world maps
  - Multiple holograms hovering above the scene
  - Foreground laptop / mobile / satellite / dish pile-ups
  - Many drifting cubes scattered close to the camera
  - Repeating the focal concept (e.g., main decision tree + a hovering decision-tree hologram)
- The trick: when the scene feels too sparse, add ambient depth (atmosphere, glow, faint distant hints), NOT new element types.

**Cluster Patterns (key technique for richness without clutter):**
- Server racks should be rendered as <strong>clusters of small cubes</strong> (5-15 stacked / arranged on a platform), not single monolithic boxes. This is what makes EKS / Kubernetes / Private EC2 hero images feel rich while staying clean — the richness lives INSIDE one element, not across many element types.
- Vary cube colors within a cluster (mostly cyan, accented with green/orange/yellow cubes) to break monotony — multi-color cube clusters are the main richness device.
- For abstract concepts (gateways, services), still surround the main icon with a cluster of supporting cubes/spheres rather than adding new element types.

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

**Common Elements (use sparingly — pick only what the narrative needs):**
- Server racks rendered as cube clusters, database cylinders
- Cloud icons, shield/lock icons, gear/cog icons
- Arrows and flow lines showing data movement (glowing, directional, with traveling motion particles)
- A few small spheres or cubes scattered as ambient depth (sparse, not a swarm)
- Floating platforms at varying heights (not too many — usually 1 central + 3-5 supporting)
- Avoid: console monitors at corners, decorative world maps, multiple top-of-frame holograms, foreground laptop/mobile/satellite piles — these clutter without earning their narrative slot.

**Composition:**
- Centered main subject with supporting elements arranged around it
- Clear visual hierarchy — one dominant element, 3-5 supporting elements
- <strong>Empty navy corners with grid lines and particles are fine.</strong> Don't pile elements in corners; let the focal breathe.
- Professional and polished, suitable for a senior backend engineering blog

**Strict Rules:**
- NEVER use white or light backgrounds
- NEVER include text, labels, or watermarks in the image
- NEVER use flat/minimal style or cartoon style
- ALWAYS maintain the dark navy isometric aesthetic
- ALWAYS include at least one secondary accent color besides cyan/blue
- ALWAYS render server-rack-like elements as cube clusters, not single boxes
- LIMIT total distinct element types — pile-ups become clutter, not richness

### Hero Image Prompt Requirements

When writing a hero image prompt for a blog post:
- The prompt should be <strong>5-6 lines (sentences) long</strong> — long enough to describe the focal, the supporting cast, and the color semantics; short enough that the AI doesn't pile on extra elements.
- <strong>Before writing the prompt, decide the color palette AND its narrative semantics</strong> — pick 3 or 4 colors and assign each one a specific narrative role from the post (selected/rejected/baseline/destination/warning/etc.). If you can't articulate what each color MEANS in one sentence, the palette isn't ready.
- Line 1: Scene atmosphere — dark navy gradient, subtle grid, sparse ambient particles. Keep the background simple and uncluttered.
- Line 2: <strong>The dominant focal element</strong> — what the eye lands on first, with its visual treatment (glow, edge neon, glass transparency, surrounding multi-colored cube cluster of cyan + green + yellow + orange to add richness).
- Line 3: <strong>3-5 supporting elements</strong> arranged around the focal — each rendered cleanly, not cluttered. Where the topic allows differentiation, give each a distinct accent color tied to its narrative role.
- Line 4: <strong>Motion and connections</strong> — flow arrows with motion particles, with active/successful paths glowing in one accent color (amber or gold) and rejected/blocked paths in another (coral with X-marks).
- Line 5: <strong>Color palette summary</strong> — explicitly name the 3-4 colors and the narrative role of each, e.g., "cyan = baseline candidates, amber = the selected path, coral with X-marks = rejected anti-patterns, gold = destination reached."
- Optional Line 6: a single small foreground or background grounding detail IF it adds narrative (e.g., "a small floating tile in the lower foreground with a debugger's highlight beam"). Skip this if not needed.
- Always end with: "Isometric 2.5D style, dark navy background, multi-color narrative palette (cyan + [secondary] + [tertiary]), no text. Aspect ratio 3:2 (1536x1024)."
- Reference benchmarks for clarity — e.g., "similar focal clarity to the DB Deadlock hero image where every color tells a specific part of the story, with empty navy corners and depth from particles rather than corner clutter."
