import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_CATEGORIES, type AttachmentRecord, type CategoryRecord, type EventRecord, type ReminderRecord, type SettingRecord } from '../types'

class EventiaDB extends Dexie {
  events!: EntityTable<EventRecord, 'id'>
  categories!: EntityTable<CategoryRecord, 'id'>
  attachments!: EntityTable<AttachmentRecord, 'id'>
  reminders!: EntityTable<ReminderRecord, 'id'>
  settings!: EntityTable<SettingRecord, 'key'>

  constructor() {
    super('Eventia')
    this.version(1).stores({
      events: 'id, title, categoryId, startDate, status, updatedAt',
      categories: 'id, &name, builtIn',
      attachments: 'id, eventId, createdAt',
      reminders: 'id, eventId, enabled',
      settings: 'key',
    })
    this.on('populate', async () => {
      await this.categories.bulkAdd(DEFAULT_CATEGORIES)
      await this.settings.bulkPut([
        { key: 'schemaFormat', value: 1 },
        { key: 'view', value: 'gallery' },
      ])
    })
  }
}

export const db = new EventiaDB()

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
