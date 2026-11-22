import { db } from '../database/db'
import { localDateString, type EventRecord } from '../types'

export async function archiveExpiredEvents(now = new Date()): Promise<number> {
  const today = localDateString(now)
  return db.transaction('rw', db.events, async () => {
    const expired = await db.events.filter(event => event.status === 'upcoming' && (event.endDate || event.startDate) < today).toArray()
    if (!expired.length) return 0
    await db.events.bulkPut(expired.map(event => ({ ...event, status:'completed' as const, updatedAt:now.toISOString() })))
    return expired.length
  })
}

export function eventStartDate(event: Pick<EventRecord, 'startDate'|'startTime'>): Date {
  return new Date(`${event.startDate}T${event.startTime || '09:00'}:00`)
}
