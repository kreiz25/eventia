export type EventStatus = 'upcoming' | 'completed' | 'cancelled'

export interface CategoryRecord {
  id: string
  name: string
  color: string
  icon?: string
  builtIn: boolean
}

export interface EventRecord {
  id: string
  title: string
  categoryId: string
  description: string
  startDate: string
  startTime: string
  endDate?: string
  endTime: string
  venue: string
  address: string
  city: string
  latitude?: number
  longitude?: number
  companions: string
  notes: string
  price: string
  link: string
  observations: string
  status: EventStatus
  createdAt: string
  updatedAt: string
  cover?: Blob
  coverName?: string
  coverType?: string
  thumbnail?: Blob
}

export interface AttachmentRecord {
  id: string
  eventId: string
  name: string
  type: string
  size: number
  createdAt: string
  blob: Blob
}

export interface ReminderRecord {
  id: string
  eventId: string
  kind: '7-days' | '1-day' | '2-hours' | 'custom'
  dateTime?: string
  enabled: boolean
}

export interface SettingRecord {
  key: string
  value: unknown
}

export type EventBackupRecord = Omit<EventRecord, 'cover' | 'thumbnail'> & { cover?: string; thumbnail?: string }
export type AttachmentBackupRecord = Omit<AttachmentRecord, 'blob'> & { blob: string }

export interface BackupFile {
  app: 'Eventia'
  formatVersion: 1
  createdAt: string
  events: EventBackupRecord[]
  categories: CategoryRecord[]
  attachments: AttachmentBackupRecord[]
  reminders: ReminderRecord[]
  settings: SettingRecord[]
}

export interface RestorableBackup extends Omit<BackupFile, 'events' | 'attachments'> {
  events: EventRecord[]
  attachments: AttachmentRecord[]
}

export const DEFAULT_CATEGORIES: CategoryRecord[] = [
  { id: 'cat-concertos', name: 'Concertos', color: '#FF5B45', icon: 'music', builtIn: true },
  { id: 'cat-cine', name: 'Cine', color: '#F06A9B', icon: 'film', builtIn: true },
  { id: 'cat-teatro', name: 'Teatro', color: '#24232B', icon: 'drama', builtIn: true },
  { id: 'cat-exposicions', name: 'Exposicións', color: '#8C62D6', icon: 'palette', builtIn: true },
  { id: 'cat-viaxes', name: 'Viaxes', color: '#FFB547', icon: 'plane', builtIn: true },
  { id: 'cat-gastronomia', name: 'Gastronomía', color: '#21A7A1', icon: 'utensils', builtIn: true },
  { id: 'cat-familia', name: 'Familia', color: '#EF8D45', icon: 'users', builtIn: true },
  { id: 'cat-deportes', name: 'Deportes', color: '#4B82CF', icon: 'trophy', builtIn: true },
  { id: 'cat-outros', name: 'Outros', color: '#85818B', icon: 'sparkles', builtIn: true },
]

export function localDateString(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
