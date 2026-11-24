import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { object, PlayerError, playerStore } from '../../../lib/player-store';

export const dynamic = 'force-dynamic';

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function errorReply(error: unknown) {
  if (error instanceof PlayerError) return reply({ error: error.message }, error.status);
  console.error('Player Codex request failed', error instanceof Error ? error.message : error);
  return reply({ error: 'The Codex could not complete this request. Please try again.' }, 500);
}

async function context() {
  const user = await getChatGPTUser();
  if (!user) throw new PlayerError('Sign in to open the Codex.', 401);
  if (!env.DB) throw new PlayerError('The Codex is temporarily unavailable.', 503);
  return { user, store: playerStore(env.DB, user.userId) };
}

export async function GET() {
  try {
    const { user, store } = await context();
    return reply({ ...await store.list(), viewer: { id: user.userId, name: user.fullName?.split(' ')[0] || '' } });
  } catch (error) {
    return errorReply(error);
  }
}

export async function POST(request: Request) {
  try {
    const { store } = await context();
    const origin = request.headers.get('origin');
    if (origin !== new URL(request.url).origin)
      throw new PlayerError('This request must come from the Codex.', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new PlayerError('Unsupported request format.', 415);

    const raw = await request.text();
    if (raw.length > 50000) throw new PlayerError('This entry is too large.', 413);
    let payload;
    try { payload = object(JSON.parse(raw)); } catch { throw new PlayerError('Invalid request.', 400); }

    const value = object(payload.value);
    switch (payload.action) {
      case 'saveCampaign': return reply({ campaign: await store.saveCampaign(value) });
      case 'saveEntry': return reply({ entry: await store.saveEntry(value) });
      case 'markHandout': return reply({ entry: await store.markHandout(value) });
      case 'deleteEntry': return reply({ deletedId: await store.deleteEntry(value) });
      case 'sample': return reply({ campaign: await store.sample() });
      default: throw new PlayerError('Unknown action.', 400);
    }
  } catch (error) {
    return errorReply(error);
  }
}
