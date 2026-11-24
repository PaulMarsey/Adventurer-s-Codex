export const playerKinds = ['Character', 'Session', 'Note', 'Journal', 'Handout'] as const;
export type PlayerKind = typeof playerKinds[number];
export type CampaignStatus = 'Active' | 'Paused' | 'Completed' | 'Archived';

export type PlayerCampaign = {
  id: string;
  title: string;
  system: string;
  description: string;
  status: CampaignStatus;
  canEdit: boolean;
  sample: boolean;
  version: number;
};

export type PlayerEntry = {
  id: string;
  campaign: string;
  kind: PlayerKind;
  title: string;
  body: string;
  date: string;
  updated: string;
  version: number;
  sessionId: string;
  characterId: string;
  className: string;
  ancestry: string;
  level: string;
  location: string;
  status: string;
  url: string;
  handoutType: string;
  readAt: string;
  canEdit: boolean;
};

export type PlayerWorkspace = {
  campaigns: PlayerCampaign[];
  entries: PlayerEntry[];
  viewer: { id: string; name: string };
};

export type PlayerMutation = {
  campaign?: PlayerCampaign;
  entry?: PlayerEntry;
  deletedId?: string;
};

export const campaignStatuses = ['Active', 'Paused', 'Completed', 'Archived'] as const;
export const sessionStatuses = ['Upcoming', 'At the table', 'Completed'] as const;
export const handoutTypes = ['Document', 'Map', 'Letter', 'Clue', 'Image', 'Other'] as const;

export const fieldLimits = {
  title: 120,
  description: 600,
  body: 16000,
  short: 100,
  url: 2000,
} as const;

export function dayLabel(date: string) {
  const day = date ? new Date(date.length === 10 ? date + 'T12:00:00Z' : date) : null;
  return day && !Number.isNaN(day.getTime())
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(day)
    : '';
}

export function todayInLondon() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London',
  }).format(new Date());
}
