import type { CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

export interface CategoryDef {
	slug: string;
	ko: string;
	en: string;
	tags: string[];
}

export const CATEGORIES: CategoryDef[] = [
	{
		slug: 'aws-cloud',
		ko: 'AWS · 클라우드 인프라',
		en: 'AWS & Cloud Infrastructure',
		tags: [
			'AWS', 'VPC', 'EC2', 'EKS', 'ECR', 'Lambda',
			'ALB', 'NLB', 'NAT Gateway', 'Route 53', 'CloudFront',
			'API Gateway', 'Global Accelerator', 'GA',
			'Transit Gateway', 'VPC Peering', 'VPC Endpoint', 'PrivateLink',
			'IGW', 'Security Group', 'NACL', 'Subnet', 'Route Table',
			'Private Subnet', 'Direct Connect', 'Session Manager', 'SSM',
			'Bastion', 'EBS', 'S3', 'Cloud Map', 'Savings Plans', 'Well-Architected',
		],
	},
	{
		slug: 'backend-spring',
		ko: 'Backend (Spring)',
		en: 'Backend (Spring)',
		tags: [
			'Spring Boot', 'JPA', 'Spring Security', 'REST API',
			'사전과제', 'Backend', 'Hibernate', 'Querydsl', 'Swagger',
		],
	},
	{
		slug: 'database',
		ko: '데이터베이스',
		en: 'Database',
		tags: [
			'RDB', 'Database', 'PostgreSQL', 'MySQL',
			'Schema Design', 'Normalization', 'Relationships',
			'Index', 'Query Optimization', 'Temporal Data', 'Soft Delete',
			'DML', 'DDL',
		],
	},
	{
		slug: 'architecture',
		ko: '시스템 설계 · 아키텍처',
		en: 'System Design & Architecture',
		tags: [
			'System Design', 'Architecture', 'Patterns', 'Performance',
			'Load Testing', 'k6', 'First-Come-First-Served',
			'Cache', 'Redis', 'Queue', 'Reverse Proxy', 'OSI',
		],
	},
	{
		slug: 'devops-security',
		ko: 'DevOps · 보안',
		en: 'DevOps & Security',
		tags: [
			'GitHub Actions', 'Terraform', 'Testing',
			'OIDC', 'Token', 'Security', 'mTLS', 'IAM',
			'STS', 'TLS', 'JWT', 'OAuth', 'SAML', 'Authentication',
		],
	},
];

export interface CategoryBucket {
	slug: string;
	ko: string;
	en: string;
	posts: BlogPost[];
}

export function collectCategories(posts: BlogPost[]): CategoryBucket[] {
	const buckets: CategoryBucket[] = CATEGORIES.map((cat) => ({
		slug: cat.slug,
		ko: cat.ko,
		en: cat.en,
		posts: [],
	}));

	for (const post of posts) {
		const postTagsLower = (post.data.tags ?? []).map((t) => t.toLowerCase());
		for (let i = 0; i < CATEGORIES.length; i++) {
			const catTagsLower = CATEGORIES[i].tags.map((t) => t.toLowerCase());
			if (postTagsLower.some((t) => catTagsLower.includes(t))) {
				buckets[i].posts.push(post);
			}
		}
	}

	for (const bucket of buckets) {
		bucket.posts.sort(
			(a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
		);
	}

	return buckets;
}

export function getCategoryBySlug(slug: string): CategoryDef | undefined {
	return CATEGORIES.find((c) => c.slug === slug);
}
