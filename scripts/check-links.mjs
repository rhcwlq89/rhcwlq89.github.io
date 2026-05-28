#!/usr/bin/env node
// Validates root-relative internal links in blog content against the routes
// Astro actually generates. Catches the class of bug where EN posts linked to
// `/blog/en/<slug>` (which 404s) instead of `/en/blog/<slug>`.
//
// Routes are reconstructed from source (no build needed):
//   - KO post  src/content/blog/<id>.md       -> /blog/<id>/
//   - EN post  src/content/blog/en/<id>.md     -> /en/blog/<id>/
//     (only posts whose pubDate <= now are published, matching utils/posts.ts)
//   - static pages from src/pages/**, excluding dynamic ([...]) routes
//
// Usage: node scripts/check-links.mjs   (exits 1 if any broken link is found)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BLOG_DIR = join(ROOT, 'src/content/blog');
const PAGES_DIR = join(ROOT, 'src/pages');
const NOW = new Date();

function walk(dir, test) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full, test));
		else if (test(entry.name)) out.push(full);
	}
	return out;
}

function normalize(p) {
	let s = p.split('#')[0].split('?')[0];
	if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
	return s;
}

// --- Build the set of valid routes -----------------------------------------

const validRoutes = new Set(); // published + reachable
const allPostRoutes = new Set(); // includes future-dated, for diagnostics

function postIdToRoute(id) {
	return id.startsWith('en/') ? `/en/blog/${id.slice(3)}` : `/blog/${id}`;
}

for (const file of walk(BLOG_DIR, (n) => /\.mdx?$/.test(n))) {
	const id = relative(BLOG_DIR, file).replace(/\.mdx?$/, '');
	const route = normalize(postIdToRoute(id));
	allPostRoutes.add(route);
	const fm = readFileSync(file, 'utf-8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const raw = fm?.[1].match(/^pubDate:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
	const pub = raw ? new Date(raw) : null;
	if (pub && !isNaN(pub) && pub <= NOW) validRoutes.add(route);
}

for (const file of walk(PAGES_DIR, (n) => /\.(astro|js|ts)$/.test(n))) {
	const rel = relative(PAGES_DIR, file);
	if (rel.includes('[')) continue; // dynamic routes handled via content collection
	let r = rel.replace(/\.(astro|js|ts)$/, '');
	if (r === 'index') r = '';
	else if (r.endsWith('/index')) r = r.slice(0, -'/index'.length);
	validRoutes.add(normalize('/' + r) || '/');
}
validRoutes.add('/');

// --- Scan content for internal links ---------------------------------------

const LINK_RE = /\]\((\/[^)\s]+)\)|href=["'](\/[^"']+)["']/g;
const broken = [];

for (const file of walk(BLOG_DIR, (n) => /\.mdx?$/.test(n))) {
	const rel = relative(ROOT, file);
	const lines = readFileSync(file, 'utf-8').split('\n');
	lines.forEach((line, i) => {
		let m;
		LINK_RE.lastIndex = 0;
		while ((m = LINK_RE.exec(line)) !== null) {
			const target = normalize(m[1] || m[2]);
			if (validRoutes.has(target)) continue;
			let reason = 'no such page';
			if (allPostRoutes.has(target)) reason = 'target post is unpublished (future pubDate)';
			broken.push({ file: rel, line: i + 1, target, reason });
		}
	});
}

// --- Report -----------------------------------------------------------------

if (broken.length === 0) {
	console.log(`OK: all internal links resolve (${validRoutes.size} routes known).`);
	process.exit(0);
}

const byFile = new Map();
for (const b of broken) {
	if (!byFile.has(b.file)) byFile.set(b.file, []);
	byFile.get(b.file).push(b);
}
console.error(`BROKEN internal links: ${broken.length} in ${byFile.size} file(s)\n`);
for (const [file, items] of [...byFile].sort()) {
	console.error(file);
	for (const it of items) console.error(`  L${it.line}  ${it.target}  (${it.reason})`);
	console.error('');
}
process.exit(1);
