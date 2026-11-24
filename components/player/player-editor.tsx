'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, Trash2, X } from 'lucide-react';
import {
  campaignStatuses, dayLabel, fieldLimits, handoutTypes, sessionStatuses, todayInLondon,
  type PlayerCampaign, type PlayerEntry, type PlayerKind,
} from '../../lib/player';

export type EditorState =
  | { kind: 'Campaign'; item?: PlayerCampaign }
  | { kind: PlayerKind; item?: PlayerEntry; sessionId?: string; characterId?: string };

export function PlayerDialog({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return <dialog ref={ref} className="pc-dialog" aria-labelledby="pc-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="pc-dialog-head">
      <h2 id="pc-dialog-title">{title}</h2>
      <button type="button" className="pc-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={22} /></button>
    </header>
    {children}
  </dialog>;
}

export function PlayerEditor({ edit, sessions, characters, onClose, onSave, onDelete }: {
  edit: EditorState;
  sessions: PlayerEntry[];
  characters: PlayerEntry[];
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onDelete: (item: PlayerEntry) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isCampaign = edit.kind === 'Campaign';
  const record = edit.kind === 'Campaign' ? undefined : edit.item;
  const campaign = edit.kind === 'Campaign' ? edit.item : undefined;
  const session = edit.kind === 'Session';
  const character = edit.kind === 'Character';
  const handout = edit.kind === 'Handout';
  const dated = session || handout || edit.kind === 'Journal' || edit.kind === 'Note';
  const tiedToSession = handout || edit.kind === 'Journal' || edit.kind === 'Note';
  const item = edit.item;
  const heading = item ? 'Edit ' + edit.kind.toLowerCase() : handout ? 'Save a handout' :
    edit.kind === 'Journal' ? 'New journal entry' : 'New ' + edit.kind.toLowerCase();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.');
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(() => onSave({ ...values, id: item?.id, version: item?.version }));
  }

  return <PlayerDialog title={heading} onClose={onClose} busy={busy}>
    <form className="pc-form" onSubmit={submit}>
      {handout && <p className="pc-muted">Save text or a link your GM has already shared with you.</p>}
      <label>{isCampaign ? 'Campaign name' : character ? 'Character name' : 'Title'}
        <input name="title" required maxLength={fieldLimits.title} autoFocus defaultValue={item?.title} />
      </label>
      {isCampaign && <div className="pc-form-row">
        <label>Game system<input name="system" maxLength={fieldLimits.short} defaultValue={campaign?.system || ''}
          placeholder="D&D 5e, Pathfinder…" /></label>
        <label>Status<select name="status" defaultValue={campaign?.status ?? 'Active'}>
          {campaignStatuses.map(status => <option key={status}>{status}</option>)}
        </select></label>
      </div>}
      {isCampaign && <label>Description<textarea name="description" rows={3} maxLength={fieldLimits.description}
        defaultValue={campaign?.description} /></label>}
      {character && <div className="pc-form-row pc-form-row-three">
        <label>Ancestry<input name="ancestry" maxLength={fieldLimits.short} defaultValue={record?.ancestry} /></label>
        <label>Class or role<input name="className" maxLength={fieldLimits.short} defaultValue={record?.className} /></label>
        <label>Level or rank<input name="level" maxLength={20} defaultValue={record?.level} /></label>
      </div>}
      {dated && <div className="pc-form-row">
        <label>Date<input name="date" type="date" defaultValue={record?.date || (!record && !session ? todayInLondon() : '')} /></label>
        {session && <label>Status<select name="status" defaultValue={record?.status ?? 'Upcoming'}>
          {sessionStatuses.map(status => <option key={status}>{status}</option>)}
        </select></label>}
        {handout && <label>Type<select name="handoutType" defaultValue={record?.handoutType ?? 'Document'}>
          {handoutTypes.map(type => <option key={type}>{type}</option>)}
        </select></label>}
      </div>}
      {session && <label>Location<input name="location" maxLength={fieldLimits.short} defaultValue={record?.location} /></label>}
      {tiedToSession && <div className="pc-form-row">
        <label>Session<select name="sessionId" defaultValue={record?.sessionId || edit.sessionId || ''}>
          <option value="">Campaign-wide</option>
          {sessions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        {!handout && <label>Character<select name="characterId" defaultValue={record?.characterId || edit.characterId || ''}>
          <option value="">All characters</option>
          {characters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>}
      </div>}
      {handout && <label>Handout link<input name="url" type="url" maxLength={fieldLimits.url}
        defaultValue={record?.url} placeholder="https://…" /></label>}
      {!isCampaign && <label>{session ? 'Player recap' : character ? 'Character notes' : handout ? 'Handout text' : 'Notes'}
        <textarea name="body" rows={5} maxLength={fieldLimits.body} defaultValue={record?.body}
          placeholder={session ? 'The party’s recap, location or next steps…' : undefined} />
      </label>}
      {error && <p className="pc-error" role="alert">{error}</p>}
      {confirmDelete && record && <div className="pc-delete-check">
        <p>Delete “{record.title}” permanently?</p>
        <button className="pc-button pc-danger" type="button" disabled={busy} onClick={() => void run(() => onDelete(record))}>Delete entry</button>
        <button className="pc-button pc-secondary" type="button" onClick={() => setConfirmDelete(false)}>Keep entry</button>
      </div>}
      <footer className="pc-dialog-actions">
        {record && !confirmDelete && <button type="button" className="pc-icon-button pc-delete-button" aria-label="Delete entry"
          disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={19} /></button>}
        <button type="button" className="pc-button pc-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="pc-button pc-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </footer>
    </form>
  </PlayerDialog>;
}

export function HandoutDialog({ entry, sessionTitle, busy, error, onClose, onMark, onEdit }: {
  entry: PlayerEntry; sessionTitle?: string; busy: boolean; error: string;
  onClose: () => void; onMark: () => void; onEdit: () => void;
}) {
  return <PlayerDialog title={entry.title} onClose={onClose} busy={busy}>
    <div className="pc-handout-detail">
      <p className="pc-muted">{[entry.handoutType, sessionTitle, dayLabel(entry.date)].filter(Boolean).join(' · ')}</p>
      {entry.body && <p className="pc-preserve">{entry.body}</p>}
      {entry.url && <a className="pc-button pc-secondary" href={entry.url} target="_blank" rel="noreferrer">Open handout <ExternalLink size={16} /></a>}
      {error && <p role="alert" className="pc-error">{error}</p>}
    </div>
    <footer className="pc-dialog-actions">
      {entry.canEdit && <button type="button" className="pc-button pc-secondary" onClick={onEdit} disabled={busy}>Edit</button>}
      <button type="button" className="pc-button pc-primary" onClick={onMark} disabled={busy}>
        {busy ? 'Saving…' : entry.readAt ? 'Mark as unread' : 'Mark as read'}
      </button>
    </footer>
  </PlayerDialog>;
}
