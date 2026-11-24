import {
  campaignStatuses, fieldLimits, handoutTypes, playerKinds, sessionStatuses,
  type PlayerCampaign, type PlayerEntry, type PlayerKind,
} from './player';

type Json = Record<string, unknown>;
type CampaignRow = { id: string; title: string; data: string; version: number };
type EntryRow = CampaignRow & { campaign: string; kind: PlayerKind; updated: string };

export class PlayerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function object(data: unknown): Json {
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Json : {};
}

function decode(data: string) {
  return object(JSON.parse(data));
}

function stored(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function text(value: unknown, limit: number, label: string) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > limit)
    throw new PlayerError(label + ' must be ' + limit + ' characters or fewer.', 400);
  return value.trim();
}

function title(value: unknown, label: string) {
  const name = text(value, fieldLimits.title, label);
  if (!name) throw new PlayerError(label + ' is required.', 400);
  return name;
}

function dateOnly(value: unknown) {
  const date = text(value, 10, 'Date');
  if (!date) return '';
  const parsed = new Date(date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== date)
    throw new PlayerError('Enter a valid date.', 400);
  return date;
}

function webUrl(value: unknown) {
  const uri = text(value, fieldLimits.url, 'Handout link');
  if (!uri) return '';
  try {
    const link = new URL(uri);
    if (['https:', 'http:'].includes(link.protocol) && !link.username && !link.password) return link.href;
  } catch {
    // Use the same validation message for invalid and unsupported links.
  }
  throw new PlayerError('Enter a valid HTTPS or HTTP link.', 400);
}

function versionMatches(existing: CampaignRow, version: unknown) {
  if (existing.version !== version)
    throw new PlayerError('This record changed elsewhere. Refresh and try again.', 409);
}

const belongsInWorkbench = "(json_extract(data, '$.player.managed') = 1 OR campaign IN (SELECT id FROM campaigns WHERE json_extract(campaigns.data, '$.role') = 'Player'))";
const allowedKinds = playerKinds.map(kind => "'" + kind + "'").join(', ');
const campaignScope = "owner = ? AND json_extract(data, '$.role') IN ('Player', 'Both')";
const entryScope = "owner = ? AND visibility = 'private' AND kind IN (" + allowedKinds + ") AND (kind <> 'Handout' OR json_extract(data, '$.player.delivery') = 'received') AND " + belongsInWorkbench;

function campaignView(row: CampaignRow): PlayerCampaign {
  const data = decode(row.data);
  const canEdit = data.role === 'Player';
  const status = canEdit ? data.status : data.playerStatus;
  return {
    id: row.id,
    title: row.title,
    system: stored(data.system),
    description: stored(canEdit ? data.description : data.playerDescription),
    status: campaignStatuses.find(option => option === status) ?? 'Active',
    canEdit,
    sample: data.playerSample === true,
    version: row.version,
  };
}

function entryView(row: EntryRow): PlayerEntry {
  const data = decode(row.data);
  const player = object(data.player);
  const character = object(data.fields);
  const session = row.kind === 'Session';
  const handout = row.kind === 'Handout';
  // Legacy Session bodies, prep, links and reviews are never sent to the player client.
  const sessionStatus = stored(player.status) ||
    ({ Completed: 'Completed', 'In progress': 'At the table' } as Record<string, string>)[stored(data.status)] ||
    'Upcoming';
  let url = '';
  if (handout) {
    try { url = webUrl(player.url); } catch { /* Older links may use unsupported schemes. */ }
  }
  return {
    id: row.id,
    title: row.title,
    campaign: row.campaign,
    kind: row.kind,
    date: stored(player.date ?? data.date),
    body: stored(session || handout ? player.body : data.body),
    updated: row.updated,
    version: row.version,
    sessionId: stored(player.sessionId),
    characterId: stored(player.characterId),
    className: row.kind === 'Character' ? stored(player.className ?? character['Classes & subclasses']) : '',
    ancestry: row.kind === 'Character' ? stored(player.ancestry ?? character.Species) : '',
    level: row.kind === 'Character' ? stored(player.level ?? character.Level) : '',
    location: session ? stored(player.location) : '',
    status: session ? sessionStatus : '',
    url,
    handoutType: handout ? stored(player.handoutType) || 'Document' : '',
    readAt: handout ? stored(player.readAt) : '',
    canEdit: !session || player.managed === true,
  };
}

export function playerStore(db: D1Database, owner: string) {
  const campaign = (id: string) => db.prepare('SELECT id, title, data, version FROM campaigns WHERE id = ? AND ' + campaignScope)
    .bind(id, owner).first<CampaignRow>();
  const entry = (id: string, campaignId: string) => db.prepare(
    'SELECT id, title, data, version, campaign, kind, updated FROM entries WHERE id = ? AND campaign = ? AND ' + entryScope,
  ).bind(id, campaignId, owner).first<EntryRow>();

  async function requireCampaign(id: string) {
    const row = await campaign(id);
    if (!row) throw new PlayerError('Campaign not found.', 404);
    return row;
  }

  function insertCampaign(id: string, name: string, data: Json, now: string, ignore = false) {
    return db.prepare('INSERT ' + (ignore ? 'OR IGNORE ' : '') +
      'INTO campaigns (id, owner, title, data, updated) VALUES (?, ?, ?, ?, ?)')
      .bind(id, owner, name, JSON.stringify(data), now);
  }

  function insertEntry(id: string, campaignId: string, kind: PlayerKind, name: string, data: Json, now: string, ignore = false) {
    return db.prepare('INSERT ' + (ignore ? 'OR IGNORE ' : '') +
      "INTO entries (id, campaign, owner, kind, title, visibility, data, updated) VALUES (?, ?, ?, ?, ?, 'private', ?, ?)")
      .bind(id, campaignId, owner, kind, name, JSON.stringify(data), now);
  }

  async function reference(id: unknown, campaignId: string, kind: PlayerKind) {
    const value = text(id, 100, kind);
    if (!value) return '';
    if ((await entry(value, campaignId))?.kind !== kind)
      throw new PlayerError(kind + ' not found in this campaign.', 404);
    return value;
  }

  return {
    async list() {
      const [campaigns, entries] = await Promise.all([
        db.prepare('SELECT id, title, data, version FROM campaigns WHERE ' + campaignScope +
          ' ORDER BY updated DESC, id').bind(owner).all<CampaignRow>(),
        db.prepare('SELECT id, title, data, version, campaign, kind, updated FROM entries WHERE ' + entryScope +
          ' AND campaign IN (SELECT id FROM campaigns WHERE ' + campaignScope + ')' +
          ' ORDER BY updated DESC, id').bind(owner, owner).all<EntryRow>(),
      ]);
      return { campaigns: campaigns.results.map(campaignView), entries: entries.results.map(entryView) };
    },

    async saveCampaign(value: Json) {
      const id = text(value.id, 100, 'Campaign');
      const name = title(value.title, 'Campaign name');
      const status = campaignStatuses.find(option => option === value.status) ?? 'Active';
      const system = text(value.system, fieldLimits.short, 'Game system');
      const description = text(value.description, fieldLimits.description, 'Campaign description');
      const now = new Date().toISOString();
      if (!id) {
        const newId = crypto.randomUUID();
        const data = { role: 'Player', system, status, description, tone: 'forest' };
        await insertCampaign(newId, name, data, now).run();
        return campaignView({ id: newId, title: name, version: 1, data: JSON.stringify(data) });
      }

      const old = await requireCampaign(id);
      if (!campaignView(old).canEdit) throw new PlayerError('This campaign is managed in the library.', 403);
      versionMatches(old, value.version);
      const data = JSON.stringify({ ...decode(old.data), system, status, description });
      const result = await db.prepare(
        'UPDATE campaigns SET title = ?, data = ?, updated = ?, version = version + 1 WHERE id = ? AND owner = ? AND version = ?',
      ).bind(name, data, now, id, owner, old.version).run();
      if (!result.meta.changes) throw new PlayerError('The campaign changed elsewhere.', 409);
      return campaignView({ id, title: name, data, version: old.version + 1 });
    },

    async saveEntry(value: Json) {
      const kind = playerKinds.find(option => option === value.kind);
      if (!kind) throw new PlayerError('Choose a supported entry type.', 400);
      const campaignId = text(value.campaign, 100, 'Campaign');
      await requireCampaign(campaignId);
      const id = text(value.id, 100, 'Entry');
      const old = id ? await entry(id, campaignId) : null;
      if (id && (!old || old.kind !== kind)) throw new PlayerError('Entry not found.', 404);
      if (old) {
        if (!entryView(old).canEdit) throw new PlayerError('This session is read-only in the player workspace.', 403);
        versionMatches(old, value.version);
      }

      const name = title(value.title, 'Title');
      const body = text(value.body, fieldLimits.body, 'Notes');
      const date = dateOnly(value.date);
      const originalData = old ? decode(old.data) : {};
      const player = { ...object(originalData.player), managed: true } as Json;
      if (kind === 'Session') {
        Object.assign(player, {
          managed: true,
          body,
          date,
          location: text(value.location, fieldLimits.short, 'Location'),
          status: sessionStatuses.find(option => option === value.status) ?? 'Upcoming',
        });
      }
      if (kind === 'Character') {
        Object.assign(player, {
          className: text(value.className, fieldLimits.short, 'Class or role'),
          ancestry: text(value.ancestry, fieldLimits.short, 'Ancestry'),
          level: text(value.level, 20, 'Level'),
        });
      }
      if (kind === 'Note' || kind === 'Journal' || kind === 'Handout')
        player.sessionId = await reference(value.sessionId, campaignId, 'Session');
      if (kind === 'Note' || kind === 'Journal')
        player.characterId = await reference(value.characterId, campaignId, 'Character');
      if (kind === 'Handout') {
        Object.assign(player, { body, date, url: webUrl(value.url),
          handoutType: handoutTypes.find(option => option === value.handoutType) ?? 'Document',
          delivery: 'received',
        });
        if (!body && !player.url) throw new PlayerError('Add the handout text or a link.', 400);
      }

      const data = { ...originalData, date, player };
      if (kind !== 'Session' && kind !== 'Handout') Object.assign(data, { body });
      const now = new Date().toISOString();
      const savedId = old?.id ?? crypto.randomUUID();
      if (old) {
        const result = await db.prepare(
          "UPDATE entries SET title = ?, data = ?, updated = ?, version = version + 1 WHERE id = ? AND owner = ? AND visibility = 'private' AND version = ?",
        ).bind(name, JSON.stringify(data), now, old.id, owner, old.version).run();
        if (!result.meta.changes) throw new PlayerError('The entry changed elsewhere.', 409);
      } else {
        await insertEntry(savedId, campaignId, kind, name, data, now).run();
      }
      return entryView({
        id: savedId, campaign: campaignId, kind, title: name,
        data: JSON.stringify(data), updated: now, version: (old?.version ?? 0) + 1,
      });
    },

    async markHandout(value: Json) {
      const campaignId = text(value.campaign, 100, 'Campaign');
      await requireCampaign(campaignId);
      const id = text(value.id, 100, 'Handout');
      const old = await entry(id, campaignId);
      if (!old || old.kind !== 'Handout') throw new PlayerError('Handout not found.', 404);
      const readAt = value.read === false ? '' : new Date().toISOString();
      const result = await db.prepare(
        "UPDATE entries SET data = json_set(data, '$.player.readAt', ?), version = version + 1 WHERE id = ? AND owner = ? AND version = ? AND visibility = 'private' RETURNING id, title, data, campaign, kind, updated, version",
      ).bind(readAt, id, owner, old.version).first<EntryRow>();
      if (!result) throw new PlayerError('The handout changed elsewhere.', 409);
      return entryView(result);
    },

    async deleteEntry(value: Json) {
      const campaignId = text(value.campaign, 100, 'Campaign');
      await requireCampaign(campaignId);
      const id = text(value.id, 100, 'Entry');
      const old = await entry(id, campaignId);
      if (!old) throw new PlayerError('Entry not found.', 404);
      if (!entryView(old).canEdit) throw new PlayerError('This entry is read-only.', 403);
      versionMatches(old, value.version);
      const result = await db.prepare(
        "DELETE FROM entries WHERE id = ? AND owner = ? AND visibility = 'private' AND version = ?",
      ).bind(id, owner, old.version).run();
      if (!result.meta.changes) throw new PlayerError('The entry changed elsewhere.', 409);
      return id;
    },

    async sample() {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner)));
      const campaignId = 'player-sample-' + Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
      const existing = await campaign(campaignId);
      if (existing) return campaignView(existing);
      const now = new Date().toISOString();
      const campaignData = {
        role: 'Player', playerSample: true, system: 'D&D 5e', status: 'Active', tone: 'ocean',
        description: 'Ships are coming back to Saltglass Quay with empty decks. The guild wants to know where the crews went.',
      };
      const sessionId = campaignId + '-session';
      const characterId = campaignId + '-character';
      await db.batch([
        insertCampaign(campaignId, 'The Lantern Coast', campaignData, now, true),
        insertEntry(characterId, campaignId, 'Character', 'Rowan Vale', {
          body: 'Guild scout and occasional guide. Knows the coastal roads and is keeping an eye out for a missing friend.',
          player: { className: 'Ranger', ancestry: 'Human', level: '3' },
        }, now, true),
        insertEntry(sessionId, campaignId, 'Session', 'The Light Beneath the Waves', {
          player: { managed: true, status: 'At the table', location: 'Saltglass Quay',
            body: 'The old lighthouse has gone dark. At the quay, look for harbour keeper Mara Vell and ask about the last ship that came in.' },
        }, now, true),
        insertEntry(campaignId + '-note', campaignId, 'Note', 'Three rings from the harbour bell', {
          body: 'Ask Mara whether three rings means a ship is arriving or someone is in danger.',
          player: { sessionId, characterId },
        }, now, true),
        insertEntry(campaignId + '-journal', campaignId, 'Journal', 'Arrival at Saltglass Quay', {
          body: 'We reached the quay just as the tide turned. Rowan recognised the guild mark on a crate by the harbour road.',
          player: { sessionId, characterId },
        }, now, true),
        insertEntry(campaignId + '-letter', campaignId, 'Handout', 'Letter from the Harbour Keeper', {
          player: { sessionId, delivery: 'received', handoutType: 'Letter',
            body: 'Guild travellers,\n\nMeet me by the bronze bell when the tide turns. Bring a lantern and keep to the harbour road.\n\nMara Vell' },
        }, now, true),
        insertEntry(campaignId + '-clue', campaignId, 'Handout', 'Lighthouse Watch Log', {
          player: { sessionId, delivery: 'received', handoutType: 'Clue',
            body: 'Last watch: the beacon was lit at sunset. The west-facing window flashed twice a little after midnight.' },
        }, now, true),
      ]);
      return campaignView(await requireCampaign(campaignId));
    },
  };
}
