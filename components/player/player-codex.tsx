'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BookOpen, CalendarDays, Check, ChevronDown, Compass, Feather, FileText, Landmark,
  LibraryBig, LockKeyhole, MapPin, Plus, ScrollText, Search, Settings2, Shield, Users,
} from 'lucide-react';
import { dayLabel, fieldLimits, todayInLondon, type PlayerCampaign, type PlayerEntry, type PlayerMutation, type PlayerWorkspace } from '../../lib/player';
import { HandoutDialog, PlayerDialog, PlayerEditor, type EditorState } from './player-editor';
import './player.css';

const tabs = [
  { label: 'Campaigns', short: 'Campaigns', icon: LibraryBig },
  { label: 'At the Table', short: 'Table', icon: Compass },
  { label: 'Characters', short: 'Characters', icon: Users },
  { label: 'Journal', short: 'Journal', icon: Feather },
  { label: 'Handouts', short: 'Handouts', icon: ScrollText },
] as const;
type Tab = typeof tabs[number]['label'];
const selectorKey = 'codex-player-selection:';

async function getWorkspace() {
  const response = await fetch('/api/player', { cache: 'no-store' });
  if (response.status === 401) throw new Error('sign-in');
  if (!response.ok) throw new Error('The Codex could not load. Please try again.');
  return await response.json() as PlayerWorkspace;
}

async function change(action: string, value: Record<string, unknown> = {}) {
  const response = await fetch('/api/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, value }),
  });
  if (response.status === 401) throw new Error('Your sign-in expired. Sign in again to save.');
  const result = await response.json() as PlayerMutation & { error?: string };
  if (!response.ok) throw new Error(result.error || 'The Codex could not save this change.');
  return result;
}

function preference(key: string, value?: string) {
  try {
    if (value !== undefined) window.localStorage.setItem(selectorKey + key, value);
    return window.localStorage.getItem(selectorKey + key) || '';
  } catch { return ''; }
}

function firstCampaign(campaigns: PlayerCampaign[]) {
  return campaigns.find(campaign => campaign.status === 'Active') ?? campaigns[0];
}

function defaultSession(sessions: PlayerEntry[]) {
  return sessions.find(session => session.status === 'At the table') ??
    [...sessions].filter(session => session.status === 'Upcoming')
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0] ??
    [...sessions].sort((a, b) => (b.date || b.updated).localeCompare(a.date || a.updated))[0];
}

const descriptions: Record<Tab, string> = {
  Campaigns: 'Choose a campaign to open its characters, notes and handouts.',
  'At the Table': 'Open the session, record a quick note and check what’s been revealed.',
  Characters: 'Keep the adventurers you play in this campaign close to hand.',
  Journal: 'Read and organise your own notes and session chronicles.',
  Handouts: 'Find letters, maps and clues you’ve received during play.',
};

function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="pc-empty"><p>{children}</p>{action}</div>;
}

export function PlayerCodex() {
  const [workspace, setWorkspace] = useState<PlayerWorkspace>();
  const [tab, setTab] = useState<Tab>('Campaigns');
  const [campaignId, setCampaignId] = useState('');
  const [sessionChoice, setSessionChoice] = useState('');
  const [characterChoice, setCharacterChoice] = useState('');
  const [editor, setEditor] = useState<EditorState>();
  const [openHandoutId, setOpenHandoutId] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const [handoutError, setHandoutError] = useState('');
  const [sampleBusy, setSampleBusy] = useState(false);
  const [journalFilter, setJournalFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [quickError, setQuickError] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const quickInput = useRef<HTMLTextAreaElement>(null);

  async function load() {
    setError('');
    try {
      const data = await getWorkspace();
      setWorkspace(data);
      const remembered = preference(data.viewer.id + ':campaign');
      const campaign = data.campaigns.find(item => item.id === remembered) ?? firstCampaign(data.campaigns);
      if (campaign) {
        selectCampaign(campaign.id, data.viewer.id);
        const initialTab = preference(data.viewer.id + ':view');
        setTab(tabs.find(item => item.label === initialTab)?.label ?? 'At the Table');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The Codex could not load.');
    }
  }

  useEffect(() => {
    void load();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  const campaigns = workspace?.campaigns ?? [];
  const campaign = campaigns.find(item => item.id === campaignId);
  const records = workspace?.entries.filter(item => item.campaign === campaignId) ?? [];
  const characters = records.filter(item => item.kind === 'Character');
  const sessions = records.filter(item => item.kind === 'Session');
  const handouts = records.filter(item => item.kind === 'Handout');
  const journal = records.filter(item => item.kind === 'Note' || item.kind === 'Journal');
  const activeSession = sessions.find(item => item.id === sessionChoice) ?? defaultSession(sessions);
  const activeCharacter = characters.find(item => item.id === characterChoice) ?? characters[0];
  const openHandout = handouts.find(item => item.id === openHandoutId);
  const sessionHandouts = handouts.filter(item => !item.sessionId || item.sessionId === activeSession?.id);
  const recentNotes = journal.filter(item => item.sessionId === (activeSession?.id ?? '')).slice(0, 3);
  const filteredJournal = journal.filter(item =>
    (journalFilter === 'All' || item.kind === journalFilter) &&
    (item.title + ' ' + item.body).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const scopeKey = workspace && campaignId ? workspace.viewer.id + ':' + campaignId : '';
  const quickKey = scopeKey ? scopeKey + ':quick:' + (activeSession?.id || 'campaign') : '';
  const disabled = !workspace;

  useEffect(() => {
    setQuickText(quickKey ? preference(quickKey) : '');
    setQuickError('');
  }, [quickKey]);

  useEffect(() => {
    if (quickOpen) quickInput.current?.focus();
  }, [quickOpen]);

  function navigate(page: Tab) {
    if (page !== 'Campaigns' && !campaign) return;
    setTab(page);
    setQuery('');
    setAnnouncement('');
    if (workspace) preference(workspace.viewer.id + ':view', page);
  }

  function selectCampaign(id: string, userId = workspace?.viewer.id ?? '') {
    setCampaignId(id);
    setSessionChoice(preference(userId + ':' + id + ':session'));
    setCharacterChoice(preference(userId + ':' + id + ':character'));
    setQuickOpen(false);
    setOpenHandoutId('');
    preference(userId + ':campaign', id);
  }

  function openCampaign(id: string) {
    selectCampaign(id);
    setTab('At the Table');
    if (workspace) preference(workspace.viewer.id + ':view', 'At the Table');
  }

  function selectSession(id: string) {
    setSessionChoice(id);
    preference(scopeKey + ':session', id);
  }

  function selectCharacter(id: string) {
    setCharacterChoice(id);
    preference(scopeKey + ':character', id);
  }

  function apply(result: PlayerMutation) {
    setWorkspace(previous => {
      if (!previous) return previous;
      const { entry, campaign: saved, deletedId } = result;
      return {
        ...previous,
        campaigns: saved ? [saved, ...previous.campaigns.filter(item => item.id !== saved.id)] : previous.campaigns,
        entries: entry
          ? [entry, ...previous.entries.filter(item => item.id !== entry.id)].sort((a, b) => b.updated.localeCompare(a.updated))
          : previous.entries.filter(item => item.id !== deletedId),
      };
    });
  }

  async function addSample() {
    setSampleBusy(true);
    setAnnouncement('');
    try {
      const result = await change('sample');
      const data = await getWorkspace();
      setWorkspace(data);
      if (result.campaign) openCampaign(result.campaign.id);
      setAnnouncement('Example campaign opened.');
    } catch (failure) {
      setAnnouncement(failure instanceof Error ? failure.message : 'The example could not be added.');
    } finally { setSampleBusy(false); }
  }

  async function saveEditor(values: Record<string, unknown>) {
    if (!editor) return;
    const result = await change(editor.kind === 'Campaign' ? 'saveCampaign' : 'saveEntry',
      editor.kind === 'Campaign' ? values : { ...values, kind: editor.kind, campaign: campaignId });
    apply(result);
    if (result.campaign && !editor.item) openCampaign(result.campaign.id);
    if (result.entry?.kind === 'Session') selectSession(result.entry.id);
    if (result.entry?.kind === 'Character') selectCharacter(result.entry.id);
    setEditor(undefined);
    setAnnouncement(editor.kind === 'Campaign' ? 'Campaign saved.' : 'Entry saved.');
  }

  async function deleteEntry(item: PlayerEntry) {
    const result = await change('deleteEntry', item);
    apply(result);
    setEditor(undefined);
    setAnnouncement('Entry deleted.');
  }

  function showHandout(item: PlayerEntry) {
    setHandoutError('');
    setOpenHandoutId(item.id);
  }

  async function markHandout(item: PlayerEntry) {
    setBusy(true);
    setHandoutError('');
    try {
      const result = await change('markHandout', { campaign: item.campaign, id: item.id, read: !item.readAt });
      apply(result);
      setAnnouncement(item.readAt ? 'Handout marked as unread.' : 'Handout marked as read.');
    } catch (failure) {
      setHandoutError(failure instanceof Error ? failure.message : 'Could not update handout.');
    } finally { setBusy(false); }
  }

  async function saveQuickNote(event: FormEvent) {
    event.preventDefault();
    const text = quickText.trim();
    if (!text || !campaignId || quickBusy) return;
    setQuickBusy(true);
    setQuickError('');
    try {
      const result = await change('saveEntry', {
        campaign: campaignId, kind: 'Note', title: text.split('\n')[0].slice(0, fieldLimits.title), body: text,
        sessionId: activeSession?.id, characterId: activeCharacter?.id, date: todayInLondon(),
      });
      apply(result);
      preference(quickKey, '');
      setQuickText('');
      setAnnouncement('Quick note saved to your journal.');
      setQuickOpen(false);
    } catch (failure) {
      setQuickError(failure instanceof Error ? failure.message : 'Could not save note.');
    } finally { setQuickBusy(false); }
  }

  const journalButton = (item: PlayerEntry) => <button type="button" className="pc-record-row" key={item.id}
    onClick={() => setEditor({ kind: item.kind, item })}>
    <span className="pc-record-icon">{item.kind === 'Journal' ? <BookOpen size={19} /> : <Feather size={19} />}</span>
    <span className="pc-row-label"><strong>{item.title}</strong><small>
      {[item.kind === 'Journal' ? 'Journal entry' : 'Note',
        sessions.find(s => s.id === item.sessionId)?.title, dayLabel(item.date)].filter(Boolean).join(' · ')}
    </small>{item.body && <span className="pc-row-preview">{item.body}</span>}</span>
  </button>;

  const handoutButton = (item: PlayerEntry) => <button type="button" className="pc-record-row" key={item.id}
    onClick={() => showHandout(item)}>
    <span className="pc-record-icon"><ScrollText size={19} /></span>
    <span className="pc-row-label"><strong>{item.title}</strong><small>
      {[item.handoutType, sessions.find(s => s.id === item.sessionId)?.title].filter(Boolean).join(' · ')}
    </small></span>
    {item.readAt ? <Check size={17} aria-label="Read" className="pc-read-check" /> : <span className="pc-status pc-status-new">Unread</span>}
  </button>;

  return <div className="pc-app">
    <a className="pc-skip" href="#pc-main">Skip to content</a>
    <aside className="pc-sidebar" aria-label="Codex navigation">
      <button className="pc-brand" onClick={() => navigate('Campaigns')}>
        <span className="pc-brand-mark"><BookOpen size={23} strokeWidth={1.6} /></span>
        <span>The Adventurer’s<strong>Codex</strong></span>
      </button>
      <div className="pc-campaign-picker">
        <label htmlFor="pc-campaign">Campaign</label>
        <div className="pc-select-wrap"><select id="pc-campaign" disabled={disabled || !campaigns.length} value={campaign?.id || ''}
          onChange={event => openCampaign(event.target.value)}>
          {!campaign && <option value="">Choose a campaign</option>}
          {campaigns.map(item => <option key={item.id} value={item.id}>{item.title}{item.sample ? ' (example)' : ''}</option>)}
        </select><ChevronDown size={16} aria-hidden="true" /></div>
      </div>
      <nav className="pc-nav" aria-label="Player workspace">
        {tabs.map(({ label, short, icon: Icon }) => <button key={label} disabled={label !== 'Campaigns' && !campaign}
          type="button" aria-current={tab === label ? 'page' : undefined} onClick={() => navigate(label)}>
          <Icon size={20} strokeWidth={1.65} aria-hidden="true" />
          <span className="pc-wide-label">{label}</span><span className="pc-short-label">{short}</span>
        </button>)}
      </nav>
      <div className="pc-sidebar-footer">
        <span className="pc-record-icon"><Shield size={18} /></span>
        <span>Player workspace<small>Private account</small></span>
      </div>
    </aside>

    <main className="pc-main" id="pc-main">
      <header className="pc-top">
        <div className="pc-trail"><span>{tab === 'Campaigns' ? 'Player workspace' : campaign?.title}</span>
          {tab !== 'Campaigns' && <><span className="pc-slash" aria-hidden="true">/</span><span>{tab}</span></>}</div>
        <span className="pc-privacy"><LockKeyhole size={15} aria-hidden="true" /> Private</span>
      </header>
      <div className="pc-content">
        <div role="status" className={announcement ? 'pc-announcement' : 'pc-sr-only'}>{announcement}</div>
        {!workspace && !error && <p className="pc-loading" role="status">Opening your Codex…</p>}
        {error === 'sign-in' && <div className="pc-panel pc-load-error"><h1>Open your Codex</h1>
          <p>Sign in to access your campaigns and notes.</p>
          <a className="pc-button pc-primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in</a>
        </div>}
        {error && error !== 'sign-in' && <div className="pc-panel pc-load-error"><h1>Couldn’t open the Codex</h1>
          <p role="alert">{error}</p><button className="pc-button pc-secondary" onClick={() => void load()}>Try again</button>
        </div>}
        {workspace && tab === 'Campaigns' && <>
          <div className="pc-hero pc-library-hero">
            <div className="pc-hero-content">
              <h1>Your Campaigns</h1><p>{descriptions.Campaigns}</p>
              <div className="pc-actions">
                <button className="pc-button pc-primary" onClick={() => setEditor({ kind: 'Campaign' })}><Plus size={19} /> New campaign</button>
                {!campaigns.some(item => item.sample) && <button className="pc-button pc-secondary" disabled={sampleBusy}
                  onClick={() => void addSample()}>{sampleBusy ? 'Opening…' : 'Try an example'}</button>}
              </div>
            </div>
          </div>
          <div className="pc-section-heading"><h2>Campaign library</h2></div>
          {campaigns.length ? <div className="pc-campaign-grid">
            {campaigns.map(item => <button type="button" className="pc-panel pc-campaign-card" key={item.id} onClick={() => openCampaign(item.id)}>
              <span className="pc-record-icon"><Landmark size={22} /></span>
              <span className="pc-status">{item.sample ? 'Example' : item.status}</span>
              <strong>{item.title}</strong><small>{item.system || 'Tabletop RPG'}</small>
              {item.description && <span className="pc-campaign-description">{item.description}</span>}
            </button>)}
          </div> : <Empty>Add a campaign to start your own journal, or open the Lantern Coast example.</Empty>}
        </>}

        {workspace && campaign && tab === 'At the Table' && <>
          <div className="pc-hero pc-table-hero">
            <div className="pc-hero-content">
              <div className="pc-hero-meta">
                <span className="pc-kicker"><Compass size={17} aria-hidden="true" /> At the Table</span>
                {activeSession && <span className="pc-status">{activeSession.status}</span>}
                {campaign.sample && <span className="pc-status">Example campaign</span>}
              </div>
              <h1>{activeSession?.title ?? campaign.title}</h1>
              <p>{activeSession ? [activeSession.location, dayLabel(activeSession.date)].filter(Boolean).join(' · ') || campaign.title
                : campaign.description || 'Add a session to start keeping track of play.'}</p>
              <div className="pc-actions">
                <button className="pc-button pc-primary" onClick={() => setQuickOpen(true)}><Feather size={18} /> Quick note</button>
                <button className="pc-button pc-secondary" onClick={() => setEditor({ kind: 'Session' })}><Plus size={18} /> New session</button>
                {campaign.canEdit && <button className="pc-icon-button pc-hero-settings" aria-label="Edit campaign"
                  onClick={() => setEditor({ kind: 'Campaign', item: campaign })}><Settings2 size={21} /></button>}
              </div>
            </div>
          </div>
          <div className="pc-table-grid">
            <div className="pc-stack">
              <section className="pc-panel">
                <div className="pc-section-heading"><h2><CalendarDays size={20} /> Session</h2>
                  {activeSession?.canEdit && <button className="pc-text-button" onClick={() => setEditor({ kind: 'Session', item: activeSession })}>Edit session</button>}
                </div>
                {sessions.length > 0 && <label className="pc-switcher">Current session
                  <span className="pc-select-wrap"><select value={activeSession?.id || ''} onChange={event => selectSession(event.target.value)}>
                    {sessions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select><ChevronDown size={16} aria-hidden="true" /></span>
                </label>}
                {activeSession?.location && <p className="pc-location"><MapPin size={16} /> {activeSession.location}</p>}
                <p className={activeSession?.body ? 'pc-preserve pc-recap' : 'pc-muted pc-recap'}>
                  {activeSession?.body || (activeSession ? 'No player recap has been recorded.' : 'There are no sessions in this campaign yet.')}
                </p>
              </section>
              <section className="pc-panel">
                <div className="pc-section-heading"><h2><Feather size={20} /> Recent notes</h2>
                  <button className="pc-text-button" onClick={() => navigate('Journal')}>Open journal</button></div>
                {recentNotes.length ? <div className="pc-record-list">{recentNotes.map(journalButton)}</div>
                  : <Empty>Quick notes for this session will appear here.</Empty>}
              </section>
            </div>
            <div className="pc-stack">
              <section className="pc-panel">
                <div className="pc-section-heading"><h2><Users size={20} /> Playing as</h2>
                  <button className="pc-text-button" onClick={() => navigate('Characters')}>Characters</button></div>
                {activeCharacter ? <>
                  <label className="pc-sr-only" htmlFor="pc-playing">Active character</label>
                  <div className="pc-select-wrap"><select id="pc-playing" value={activeCharacter.id} onChange={event => selectCharacter(event.target.value)}>
                    {characters.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
                  </select><ChevronDown size={16} aria-hidden="true" /></div>
                  <p className="pc-muted pc-character-line">{[activeCharacter.ancestry, activeCharacter.className,
                    activeCharacter.level && 'Level or rank ' + activeCharacter.level].filter(Boolean).join(' · ') || 'Character details can be added in Characters.'}</p>
                </> : <Empty action={<button className="pc-text-button" onClick={() => setEditor({ kind: 'Character' })}>Add a character</button>}>
                  Choose who you’re playing.
                </Empty>}
              </section>
              <section className="pc-panel">
                <div className="pc-section-heading"><h2><ScrollText size={20} /> Handouts</h2>
                  <button className="pc-text-button" onClick={() => navigate('Handouts')}>View all</button></div>
                {sessionHandouts.length ? <div className="pc-record-list">{sessionHandouts.slice(0, 4).map(handoutButton)}</div>
                  : <Empty>Handouts saved for this campaign or session will appear here.</Empty>}
              </section>
            </div>
          </div>
        </>}

        {workspace && campaign && tab === 'Characters' && <>
          <div className="pc-page-head"><div><h1>Characters</h1><p>{descriptions.Characters}</p></div>
            <button className="pc-button pc-primary" onClick={() => setEditor({ kind: 'Character' })}><Plus size={18} /> New character</button>
          </div>
          {characters.length ? <div className="pc-campaign-grid">{characters.map(item =>
            <article className="pc-panel pc-character-card" key={item.id}>
              <div className="pc-section-heading"><span className="pc-record-icon"><Shield size={21} /></span>
                {item.id === activeCharacter?.id && <span className="pc-status pc-status-new">Playing as</span>}</div>
              <h2>{item.title}</h2><p className="pc-muted">{[item.ancestry, item.className, item.level && 'Level or rank ' + item.level].filter(Boolean).join(' · ')}</p>
              {item.body && <p className="pc-character-body">{item.body}</p>}
              <div className="pc-actions">
                <button className="pc-button pc-secondary" onClick={() => setEditor({ kind: 'Character', item })}>Open profile</button>
                {item.id !== activeCharacter?.id && <button className="pc-text-button" onClick={() => { selectCharacter(item.id); setAnnouncement('Now playing as ' + item.title + '.'); }}>Play as</button>}
              </div>
            </article>)}</div> : <Empty>Your character library is empty. Add a character to link it to your notes and sessions.</Empty>}
        </>}

        {workspace && campaign && tab === 'Journal' && <>
          <div className="pc-page-head"><div><h1>Journal</h1><p>{descriptions.Journal}</p></div>
            <div className="pc-actions">
              <button className="pc-button pc-secondary" onClick={() => setEditor({ kind: 'Note', characterId: activeCharacter?.id })}><Plus size={18} /> New note</button>
              <button className="pc-button pc-primary" onClick={() => setEditor({ kind: 'Journal', sessionId: activeSession?.id, characterId: activeCharacter?.id })}><Feather size={18} /> New journal entry</button>
            </div>
          </div>
          <section className="pc-panel">
            <div className="pc-tools">
              <div className="pc-filters" aria-label="Filter journal">
                {[['All', 'All'], ['Note', 'Notes'], ['Journal', 'Journal entries']].map(([value, label]) =>
                  <button key={value} className="pc-button pc-filter" aria-pressed={journalFilter === value}
                    onClick={() => setJournalFilter(value)}>{label}</button>)}
              </div>
              <label className="pc-search"><Search size={18} aria-hidden="true" /><span className="pc-sr-only">Search journal</span>
                <input type="search" placeholder="Search journal" value={query} onChange={event => setQuery(event.target.value)} /></label>
            </div>
            {filteredJournal.length ? <div className="pc-record-list">{filteredJournal.map(journalButton)}</div>
              : <Empty>{journal.length ? 'No entries match your search.' : 'Your notes and journal entries will appear here.'}</Empty>}
          </section>
        </>}

        {workspace && campaign && tab === 'Handouts' && <>
          <div className="pc-page-head"><div><h1>Handouts</h1><p>{descriptions.Handouts}</p></div>
            <button className="pc-button pc-primary" onClick={() => setEditor({ kind: 'Handout', sessionId: activeSession?.id })}><Plus size={18} /> Save handout</button>
          </div>
          <section className="pc-panel">
            <div className="pc-section-heading"><h2><FileText size={20} /> Received handouts</h2></div>
            {handouts.length ? <div className="pc-record-list">{handouts.map(handoutButton)}</div>
              : <Empty>Save a handout here when your GM shares its text or a link.</Empty>}
          </section>
        </>}
      </div>
    </main>

    {editor && <PlayerEditor edit={editor} sessions={sessions} characters={characters} onClose={() => setEditor(undefined)}
      onSave={saveEditor} onDelete={deleteEntry} />}
    {openHandout && <HandoutDialog entry={openHandout} sessionTitle={sessions.find(item => item.id === openHandout.sessionId)?.title}
      busy={busy} error={handoutError} onClose={() => setOpenHandoutId('')} onMark={() => void markHandout(openHandout)}
      onEdit={() => { setOpenHandoutId(''); setEditor({ kind: 'Handout', item: openHandout }); }} />}
    {quickOpen && <PlayerDialog title="Quick note" onClose={() => setQuickOpen(false)} busy={quickBusy}>
      <form className="pc-form" onSubmit={saveQuickNote}>
        <p className="pc-muted">{activeSession?.title || campaign?.title}{activeCharacter ? ' · ' + activeCharacter.title : ''}</p>
        <label>Your note<textarea ref={quickInput} required maxLength={fieldLimits.body} rows={6} value={quickText} disabled={quickBusy}
          placeholder="A name, a clue, or something to ask next time…" onChange={event => {
            setQuickText(event.target.value); preference(quickKey, event.target.value);
          }} /></label>
        {quickError && <p role="alert" className="pc-error">{quickError}</p>}
        <footer className="pc-dialog-actions">
          <button type="button" className="pc-button pc-secondary" disabled={quickBusy} onClick={() => setQuickOpen(false)}>Close</button>
          <button className="pc-button pc-primary" disabled={quickBusy || !quickText.trim()}>{quickBusy ? 'Saving…' : 'Save note'}</button>
        </footer>
      </form>
    </PlayerDialog>}
  </div>;
}
