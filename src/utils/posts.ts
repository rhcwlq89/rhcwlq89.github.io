import type { CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

export function isPublished(post: BlogPost, now = new Date()): boolean {
	return post.data.pubDate.valueOf() <= now.valueOf();
}
