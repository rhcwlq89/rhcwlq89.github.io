// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://rhcwlq89.github.io',
	integrations: [mdx(), sitemap()],
	i18n: {
		defaultLocale: 'ko',
		locales: ['ko', 'en'],
		routing: {
			prefixDefaultLocale: false,
		},
	},
	markdown: {
        shikiConfig: {
            theme: 'github-dark'
        },
    },
});
