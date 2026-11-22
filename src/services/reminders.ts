import { db } from '../database/db'
import { eventStartDate, archiveExpiredEvents } from './archive'

const offset: Record<'7-days'|'1-day'|'2-hours', (date:Date)=>void> = {
  '7-days': date => date.setDate(date.getDate() - 7),
  '1-day': date => date.setDate(date.getDate() - 1),
  '2-hours': date => date.setHours(date.getHours() - 2),
}

function triggerDate(kind:string, dateTime:string|undefined, eventDate:Date) {
  if (kind === 'custom') return dateTime ? new Date(dateTime) : null
  const when = new Date(eventDate)
  offset[kind as keyof typeof offset]?.(when)
  return when
}

export async function consumeForegroundReminders(now = new Date()): Promise<string[]> {
  await archiveExpiredEvents(now)
  const [allReminders, events] = await Promise.all([db.reminders.toArray(), db.events.toArray()])
  const reminders = allReminders.filter(reminder => reminder.enabled)
  const eventById = new Map(events.map(event => [event.id, event]))
  const due: string[] = []
  const consumed: string[] = []
  for (const reminder of reminders) {
    const event = eventById.get(reminder.eventId)
    if (!event || event.status !== 'upcoming') { consumed.push(reminder.id); continue }
    const target = triggerDate(reminder.kind, reminder.dateTime, eventStartDate(event))
    if (!target || Number.isNaN(target.getTime()) || target.getTime() > now.getTime()) continue
    const grace = reminder.kind === '7-days' ? 48*60*60*1000 : reminder.kind === '1-day' ? 12*60*60*1000 : reminder.kind === '2-hours' ? 2*60*60*1000 : 24*60*60*1000
    if (now.getTime() - target.getTime() <= grace) due.push(event.title)
    consumed.push(reminder.id)
  }
  if (consumed.length) {
    const rows = await db.reminders.bulkGet(consumed)
    await db.reminders.bulkPut(rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).map(row => ({ ...row, enabled:false })))
    window.dispatchEvent(new Event('eventia-reminders-changed'))
  }
  return due
}
