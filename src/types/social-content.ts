// WP06 — Social Content Types

export enum ContentCategory {
  LAUNCH = 'launch',
  DAILY = 'daily',
  PROMOTIONAL = 'promotional',
  EDUCATIONAL = 'educational',
  COMMUNITY = 'community',
}

export enum PostStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
}

export enum SocialCategory {
  PERSONAL_BRAND = 'personal_brand',
  BUSINESS_BRAND = 'business_brand',
  THOUGHT_LEADERSHIP = 'thought_leadership',
  LIFESTYLE = 'lifestyle',
}

export enum SocialPlatform {
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
  LINKEDIN = 'linkedin',
  TWITTER = 'twitter',
  TIKTOK = 'tiktok',
  YOUTUBE = 'youtube',
}

export interface RepIdentityAsset {
  id: string;
  repId: string;
  brandName: string;
  tagline: string;
  coreValues: string[];
  brandDoctrine: string;
  socialCategories: SocialCategory[];
  platforms: SocialPlatform[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentPost {
  id: string;
  repId: string;
  category: ContentCategory;
  status: PostStatus;
  platform: SocialPlatform;
  headline: string;
  body: string;
  cta: string;
  scheduledAt?: Date;
  cfeReviewed: boolean;
  createdAt: Date;
  updatedAt: Date;
}