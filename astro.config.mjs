// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BLOG_DIR = './src/content/blog';

function loadBlogDates() {
	const map = new Map();
	function walk(dir, prefix = '') {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, prefix + entry.name + '/');
				continue;
			}
			if (!/\.mdx?$/.test(entry.name)) continue;
			const slug = (prefix + entry.name).replace(/\.mdx?$/, '');
			const fmMatch = readFileSync(full, 'utf-8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
			if (!fmMatch) continue;
			const pub = fmMatch[1].match(/^pubDate:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
			const upd = fmMatch[1].match(/^updatedDate:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
			const raw = upd || pub;
			if (!raw) continue;
			const date = new Date(raw);
			if (isNaN(date.getTime())) continue;
			const path = slug.startsWith('en/')
				? `/en/blog/${slug.slice(3)}/`
				: `/blog/${slug}/`;
			map.set(path, date.toISOString());
		}
	}
	walk(BLOG_DIR);
	return map;
}

const BLOG_LASTMOD = loadBlogDates();

// https://astro.build/config
export default defineConfig({
	site: 'https://rhcwlq89.github.io',
	trailingSlash: 'always',
	integrations: [
		mdx(),
		sitemap({
			i18n: {
				defaultLocale: 'ko',
				locales: {
					ko: 'ko',
					en: 'en',
				},
			},
			serialize(item) {
				const lastmod = BLOG_LASTMOD.get(new URL(item.url).pathname);
				if (lastmod) item.lastmod = lastmod;
				return item;
			},
		}),
	],
	i18n: {
		defaultLocale: 'ko',
		locales: ['ko', 'en'],
		routing: {
			prefixDefaultLocale: false,
		},
	},
	markdown: {
        shikiConfig: {
            theme: 'github-dark',
            excludeLangs: ['mermaid'],
        },
    },
});
