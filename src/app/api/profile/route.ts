import { handleRouteError, jsonError } from '@/lib/api';
import { mutateStore } from '@/lib/store';
import type { Profile } from '@/types/cv';

/** Replaces the owner's Profile (general information, apart from any CV). */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { profile?: Profile };
    const p = body.profile;
    if (!p || typeof p !== 'object' || !p.personal || !Array.isArray(p.entries) || typeof p.about !== 'string') {
      return jsonError('That is not a profile.');
    }
    if (JSON.stringify(p).length > 400_000) return jsonError('Your profile has grown too large to save. Trim some entries.');
    const kinds = new Set(['projects', 'experience', 'achievements']);
    const profile: Profile = {
      personal: p.personal,
      about: p.about,
      entries: p.entries.filter((e) => kinds.has(e.sectionId)),
    };
    const { store } = await mutateStore((s) => {
      s.profile = profile;
    });
    return Response.json({ profile: store.profile });
  } catch (err) {
    return handleRouteError(err);
  }
}
