import { NextRequest, NextResponse } from 'next/server';
import {
  createIdentity,
  getIdentity,
  updateIdentity,
} from '../../services/social-content/rep-identity.service';
import {
  generateLaunchContent,
  generateDailyPost,
  submitForCfeReview,
} from '../../services/social-content/content.service';
import { SocialPlatform } from '../../types/social-content';

// POST /api/social — identity/create or generate
// GET  /api/social — identity or launch-kit
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'identity') {
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    }
    const identity = getIdentity(id);
    if (!identity) {
      return NextResponse.json({ error: 'Identity not found' }, { status: 404 });
    }
    return NextResponse.json({ identity });
  }

  if (action === 'launch-kit') {
    const identityId = searchParams.get('identityId');
    const repId = searchParams.get('repId');
    if (!identityId || !repId) {
      return NextResponse.json(
        { error: 'Missing identityId or repId' },
        { status: 400 },
      );
    }
    try {
      const posts = generateLaunchContent(repId, identityId);
      return NextResponse.json({ posts, count: posts.length });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: 'Unknown action. Use action=identity or action=launch-kit' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === 'identity/create') {
    const { repId, brandName, tagline, coreValues, brandDoctrine, socialCategories, platforms } = body;
    if (!repId || !brandName || !tagline || !coreValues || !brandDoctrine) {
      return NextResponse.json(
        { error: 'Missing required fields: repId, brandName, tagline, coreValues, brandDoctrine' },
        { status: 400 },
      );
    }
    try {
      const identity = createIdentity({
        repId,
        brandName,
        tagline,
        coreValues,
        brandDoctrine,
        socialCategories,
        platforms,
      });
      return NextResponse.json({ identity }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (action === 'generate') {
    const { repId, identityId, type, topic, platform } = body;
    if (!repId || !identityId) {
      return NextResponse.json(
        { error: 'Missing required fields: repId, identityId' },
        { status: 400 },
      );
    }
    const p = (platform as SocialPlatform) || SocialPlatform.INSTAGRAM;

    try {
      if (type === 'daily') {
        if (!topic) {
          return NextResponse.json({ error: 'Missing topic for daily post' }, { status: 400 });
        }
        const post = generateDailyPost(repId, identityId, topic, p);
        return NextResponse.json({ post }, { status: 201 });
      }

      // Default: launch kit
      const posts = generateLaunchContent(repId, identityId, p);
      return NextResponse.json({ posts, count: posts.length }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (action === 'cfe-review') {
    const { postId } = body;
    if (!postId) {
      return NextResponse.json({ error: 'Missing postId' }, { status: 400 });
    }
    try {
      const reviewed = submitForCfeReview(postId);
      return NextResponse.json({ post: reviewed });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 404 });
    }
  }

  return NextResponse.json(
    { error: 'Unknown action. Use identity/create, generate, or cfe-review' },
    { status: 400 },
  );
}