import type { CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

export function slugifyTag(tag: string): string {
	return tag
		.toLowerCase()
		.trim()
		.replace(/\++/g, '-plus')
		.replace(/[#]/g, '-sharp')
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
}

export interface TagBucket {
	tag: string;
	slug: string;
	posts: BlogPost[];
}

export function collectTags(posts: BlogPost[]): TagBucket[] {
	const buckets = new Map<string, TagBucket>();
	for (const post of posts) {
		for (const tag of post.data.tags ?? []) {
			const slug = slugifyTag(tag);
			if (!slug) continue;
			let bucket = buckets.get(slug);
			if (!bucket) {
				bucket = { tag, slug, posts: [] };
				buckets.set(slug, bucket);
			}
			bucket.posts.push(post);
		}
	}
	for (const bucket of buckets.values()) {
		bucket.posts.sort(
			(a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
		);
	}
	return [...buckets.values()].sort((a, b) =>
		a.tag.localeCompare(b.tag, 'ko'),
	);
}
