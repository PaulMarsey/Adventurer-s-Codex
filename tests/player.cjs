const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');
const ts = require('typescript');

const database = new DatabaseSync(':memory:');
database.exec(fs.readFileSync('drizzle/0000_broad_vertigo.sql', 'utf8'));
const DB = {
  prepare(sql) {
    const statement = database.prepare(sql);
    return { bind(...values) {
      return {
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
    } };
  },
  async batch(statements) {
    database.exec('BEGIN');
    try {
      const result = await Promise.all(statements.map(statement => statement.run()));
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};

let viewer = null;
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, Response, Request, URL, crypto, console, TextEncoder,
    require(id) {
      if (id === 'cloudflare:workers') return { env: { DB } };
      if (id.endsWith('chatgpt-auth')) return { getChatGPTUser: async () => viewer };
      return load(path.join(path.dirname(file), id + '.ts'));
    },
  });
  return module.exports;
}

const route = load('app/api/player/route.ts');
const url = 'https://codex.test/api/player';
const signIn = userId => { viewer = { userId, fullName: 'Player Example' }; };
const post = (action, value, origin = 'https://codex.test') => route.POST(new Request(url, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ action, value }),
}));
async function expectPost(action, value, status = 200) {
  const response = await post(action, value);
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

function legacyCampaign(id, role) {
  database.prepare('INSERT INTO campaigns (id, owner, title, data, updated) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'one', id, JSON.stringify({ role, description: 'SECRET CAMPAIGN PREP' }), '2026-11-24');
}

function legacyEntry(id, campaign, kind, visibility, data) {
  database.prepare('INSERT INTO entries (id, campaign, owner, title, kind, visibility, data, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, campaign, 'one', id, kind, visibility, JSON.stringify(data), '2026-11-24');
}

(async () => {
  assert.equal((await route.GET()).status, 401);
  assert.equal((await post('sample')).status, 401);
  signIn('one');
  assert.equal((await post('sample', {}, 'https://other.test')).status, 403);
  const { campaign: first } = await expectPost('saveCampaign', { title: 'Campaign One', system: 'D&D 5e' });
  const { campaign: second } = await expectPost('saveCampaign', { title: 'Campaign Two' });
  const { entry: character } = await expectPost('saveEntry', {
    kind: 'Character', campaign: first.id, title: 'Player Character', ancestry: 'Elf', className: 'Ranger', level: '3',
  });
  const { entry: session } = await expectPost('saveEntry', {
    kind: 'Session', campaign: first.id, title: 'Session one', status: 'At the table', date: '2026-11-24',
    location: 'Harbour', body: 'Public recap', prep: 'SECRET REQUEST FIELD',
  });
  await expectPost('saveEntry', {
    kind: 'Session', campaign: first.id, title: 'Invalid date', date: '2026-02-31',
  }, 400);
  const { entry: note } = await expectPost('saveEntry', {
    kind: 'Note', campaign: first.id, title: 'Quick note', body: 'Seven bells',
    sessionId: session.id, characterId: character.id,
  });
  await expectPost('saveEntry', {
    kind: 'Journal', campaign: second.id, title: 'Wrong campaign', sessionId: session.id,
  }, 404);
  const { entry: journal } = await expectPost('saveEntry', {
    kind: 'Journal', campaign: first.id, title: 'Session chronicle', body: 'Follow the lanterns', sessionId: session.id,
  });
  await expectPost('saveEntry', { ...journal, body: 'Edited chronicle' });
  await expectPost('saveEntry', { ...journal, body: 'Stale copy' }, 409);
  const { entry: handout } = await expectPost('saveEntry', {
    kind: 'Handout', campaign: first.id, title: 'Letter', body: 'Open the letter', sessionId: session.id,
  });
  await expectPost('saveEntry', { ...handout, url: 'javascript:alert(1)' }, 400);
  const { entry: readHandout } = await expectPost('markHandout', { id: handout.id, campaign: first.id, read: true });
  assert.ok(readHandout.readAt);
  const { entry: unreadHandout } = await expectPost('markHandout', { id: handout.id, campaign: first.id, read: false });
  assert.equal(unreadHandout.readAt, '');

  legacyCampaign('legacy-dm', 'DM');
  legacyCampaign('legacy-both', 'Both');
  legacyEntry('dm-clue', first.id, 'Note', 'dm', { body: 'SECRET DM CLUE' });
  legacyEntry('legacy-session', first.id, 'Session', 'private', {
    body: 'SECRET OLD SESSION BODY', prep: ['SECRET PREP'], date: '2026-11-19',
  });
  legacyEntry('unreleased', first.id, 'Handout', 'private', { player: { delivery: 'draft', body: 'SECRET HANDOUT' } });
  legacyEntry('unclassified-both', 'legacy-both', 'Note', 'private', { body: 'SECRET MIXED CAMPAIGN NOTE' });
  await expectPost('saveEntry', { kind: 'Note', campaign: 'legacy-both', title: 'A new player note' });
  let state = await (await route.GET()).json();
  assert(!JSON.stringify(state).includes('SECRET'));
  assert.ok(!state.campaigns.some(item => item.id === 'legacy-dm'));
  assert.ok(state.campaigns.some(item => item.id === 'legacy-both'));
  assert.ok(state.entries.some(item => item.title === 'A new player note'));
  assert.ok(!state.entries.some(item => item.id === 'unreleased'));
  assert.equal(state.entries.find(item => item.id === 'legacy-session').canEdit, false);
  assert.equal(state.entries.find(item => item.id === journal.id).body, 'Edited chronicle');
  assert.equal(state.entries.find(item => item.id === note.id).sessionId, session.id);
  assert.equal(state.entries.find(item => item.id === session.id).body, 'Public recap');
  await expectPost('saveEntry', { kind: 'Note', id: 'dm-clue', title: 'Reveal', campaign: first.id }, 404);
  await expectPost('markHandout', { id: 'unreleased', campaign: first.id }, 404);

  const { campaign: example } = await expectPost('sample');
  assert.equal((await expectPost('sample')).campaign.id, example.id);
  state = await (await route.GET()).json();
  assert.equal(state.entries.filter(item => item.campaign === example.id).length, 6);

  signIn('two');
  state = await (await route.GET()).json();
  assert.equal(state.campaigns.length, 0);
  assert.equal(state.entries.length, 0);
  await expectPost('saveEntry', { ...note, body: 'Another player' }, 404);
  await expectPost('markHandout', { id: handout.id, campaign: first.id }, 404);
  await expectPost('deleteEntry', note, 404);

  signIn('one');
  await expectPost('deleteEntry', note);
  assert.ok(!(await (await route.GET()).json()).entries.some(item => item.id === note.id));
  console.log('PASS: signed-in campaign and character flows, session scope, journal and notes, received handouts, read status, fixture setup, private projections, ownership and stale writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
