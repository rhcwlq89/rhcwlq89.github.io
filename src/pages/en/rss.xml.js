import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_TITLE } from '../../consts';

export async function GET(context) {
	const posts = (await getCollection('blog')).filter(
		(post) => post.id.startsWith('en/')
	);
	return rss({
		title: `${SITE_TITLE} (EN)`,
		description: 'A practical tech blog about Spring Boot, Backend development, and technical interview prep.',
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/en/blog/${post.id.replace('en/', '')}/`,
		})),
	});
}
