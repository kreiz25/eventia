import { db } from '../database/db'
import type { AttachmentRecord, BackupFile, CategoryRecord, EventRecord, ReminderRecord, RestorableBackup, SettingRecord } from '../types'

const FORMAT_VERSION = 1

async function blobToBase64(blob?: Blob): Promise<string | undefined> {
  if (!blob) return undefined
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function base64ToBlob(data: string, type = 'application/octet-stream'): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function createBackup(): Promise<BackupFile> {
  const [events, categories, attachments, reminders, settings] = await Promise.all([
    db.events.toArray(), db.categories.toArray(), db.attachments.toArray(), db.reminders.toArray(), db.settings.toArray(),
  ])
  const mediaSize = events.reduce((size, event) => size + (event.cover?.size || 0) + (event.thumbnail?.size || 0), 0)
    + attachments.reduce((size, attachment) => size + attachment.blob.size, 0)
  if (mediaSize > 200 * 1024 * 1024) throw new Error('Os ficheiros desta copia superan 200 MB. Fai copias máis pequenas ou elimina anexos que xa non precises.')
  const packedEvents = await Promise.all(events.map(async ({ cover, thumbnail, ...event }) => ({
    ...event,
    cover: await blobToBase64(cover),
    thumbnail: await blobToBase64(thumbnail),
  })))
  const packedAttachments = await Promise.all(attachments.map(async ({ blob, ...attachment }) => ({
    ...attachment,
    blob: (await blobToBase64(blob)) ?? '',
  })))
  return {
    app: 'Eventia', formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString(),
    events: packedEvents, categories, attachments: packedAttachments, reminders, settings,
  }
}

export async function downloadBackupFile(): Promise<{ file: File; counts: { events: number; attachments: number } }> {
  const backup = await createBackup()
  const date = backup.createdAt.slice(0, 10)
  const file = new File([JSON.stringify(backup)], `Eventia_copia_${date}.json`, { type: 'application/json' })
  return { file, counts: { events: backup.events.length, attachments: backup.attachments.length } }
}

function isString(v: unknown): v is string { return typeof v === 'string' }
function isBlobData(v: unknown): v is string | undefined {
  return v === undefined || (isString(v) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v))
}
function isLocalDate(value: unknown): value is string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}
function isOptionalText(value: unknown) { return value === undefined || isString(value) }

export async function parseBackupFile(file: File): Promise<{ backup: RestorableBackup; counts: { events: number; attachments: number } }> {
  if (file.size > 300 * 1024 * 1024) throw new Error('A copia supera o límite de 300 MB que pode procesar Eventia neste dispositivo.')
  let parsed: unknown
  try { parsed = JSON.parse(await file.text()) } catch { throw new Error('O ficheiro non contén un JSON válido.') }
  const data = parsed as Partial<BackupFile>
  if (data.app !== 'Eventia' || data.formatVersion !== FORMAT_VERSION) throw new Error('A copia non é de Eventia ou usa unha versión non compatible.')
  if (!isString(data.createdAt) || Number.isNaN(Date.parse(data.createdAt)) || !Array.isArray(data.events) || !Array.isArray(data.categories) || !Array.isArray(data.attachments) || !Array.isArray(data.reminders) || !Array.isArray(data.settings)) {
    throw new Error('A estrutura da copia está incompleta ou danada.')
  }

  const ids = new Set<string>()
  for (const e of data.events) {
    const textFields = [e.title,e.description,e.startTime,e.endTime,e.venue,e.address,e.city,e.companions,e.notes,e.price,e.link,e.observations,e.createdAt,e.updatedAt]
    const isTime = (value: unknown) => isString(value) && (value === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    if (!isString(e.id) || !isString(e.title) || !e.title.trim() || !isString(e.categoryId) || !isLocalDate(e.startDate) || (e.endDate!==undefined&&!isLocalDate(e.endDate)) || textFields.some(v=>!isString(v)) || Number.isNaN(Date.parse(e.createdAt)) || Number.isNaN(Date.parse(e.updatedAt)) || (e.endDate&&e.endDate<e.startDate) || !isTime(e.startTime) || !isTime(e.endTime) || !isString(e.status) || !['upcoming', 'completed', 'cancelled'].includes(e.status) || !isBlobData(e.cover) || !isBlobData(e.thumbnail) || !isOptionalText(e.coverName) || !isOptionalText(e.coverType) || (e.latitude!==undefined&&(typeof e.latitude!=='number'||!Number.isFinite(e.latitude)||e.latitude < -90||e.latitude > 90)) || (e.longitude!==undefined&&(typeof e.longitude!=='number'||!Number.isFinite(e.longitude)||e.longitude < -180||e.longitude > 180))) throw new Error('A copia ten un evento con datos non válidos.')
    if (ids.has(e.id)) throw new Error('A copia contén identificadores de evento repetidos.')
    ids.add(e.id)
  }
  const categoryIds = new Set<string>()
  const categoryNames = new Set<string>()
  for (const c of data.categories) {
    if (!isString(c.id) || !isString(c.name) || !c.name.trim() || !/^#[0-9a-f]{6}$/i.test(c.color) || typeof c.builtIn!=='boolean' || !isOptionalText(c.icon)) throw new Error('A copia ten unha categoría non válida.')
    if (categoryIds.has(c.id)) throw new Error('A copia contén categorías repetidas.')
    const normalized = c.name.trim().toLocaleLowerCase('gl')
    if (categoryNames.has(normalized)) throw new Error('A copia contén categorías co mesmo nome.')
    categoryIds.add(c.id)
    categoryNames.add(normalized)
  }
  for (const e of data.events) if (!categoryIds.has(e.categoryId)) throw new Error('Un evento referencia unha categoría que non existe na copia.')
  const attachmentIds = new Set<string>()
  const eventIds = new Set(data.events.map(e => e.id))
  for (const a of data.attachments) {
    if (!isString(a.id) || !isString(a.eventId) || !eventIds.has(a.eventId) || !isString(a.name) || !isString(a.type) || !Number.isFinite(a.size) || a.size<0 || !isString(a.createdAt) || Number.isNaN(Date.parse(a.createdAt)) || !isString(a.blob)) throw new Error('A copia ten un anexo non válido ou sen evento asociado.')
    if (attachmentIds.has(a.id)) throw new Error('A copia contén anexos repetidos.')
    attachmentIds.add(a.id)
  }
  const reminderIds = new Set<string>()
  for (const reminder of data.reminders) {
    if (!isString(reminder.id) || !eventIds.has(reminder.eventId) || !['7-days','1-day','2-hours','custom'].includes(reminder.kind) || typeof reminder.enabled!=='boolean' || (reminder.kind==='custom'&&(!isString(reminder.dateTime)||Number.isNaN(Date.parse(reminder.dateTime))))) throw new Error('A copia ten un recordatorio non válido ou sen evento asociado.')
    if (reminderIds.has(reminder.id)) throw new Error('A copia contén recordatorios repetidos.')
    reminderIds.add(reminder.id)
  }
  const settingKeys = new Set<string>()
  for (const setting of data.settings) {
    if (!isString(setting.key)) throw new Error('A copia ten unha configuración non válida.')
    if (settingKeys.has(setting.key)) throw new Error('A copia contén configuracións repetidas.')
    settingKeys.add(setting.key)
  }

  // Decode every embedded file before enabling the import so corrupt media never causes a partial restore.
  const decodedEvents = await Promise.all(data.events.map(async event => ({
    ...event,
    cover: event.cover ? base64ToBlob(event.cover, event.coverType || 'application/octet-stream') : undefined,
    thumbnail: event.thumbnail ? base64ToBlob(event.thumbnail, 'image/jpeg') : undefined,
  })))
  const decodedAttachments = data.attachments.map(a => ({ ...a, blob: base64ToBlob(a.blob, a.type) }))
  for (let i=0;i<data.attachments.length;i++) if (decodedAttachments[i].blob.size !== data.attachments[i].size) throw new Error('Un anexo da copia non supera a comprobación de tamaño.')
  const backup = {
    ...data,
    events: decodedEvents as EventRecord[],
    categories: data.categories as CategoryRecord[],
    attachments: decodedAttachments as AttachmentRecord[],
    reminders: data.reminders as ReminderRecord[],
    settings: data.settings as SettingRecord[],
  } as RestorableBackup
  return { backup, counts: { events: backup.events.length, attachments: backup.attachments.length } }
}

export async function inspectConflicts(backup: RestorableBackup) {
  const currentEvents = await db.events.toArray()
  const currentAttachments = await db.attachments.toArray()
  const currentCategories = await db.categories.toArray()
  const currentEventIds = new Set(currentEvents.map(e => e.id))
  const currentAttachmentIds = new Set(currentAttachments.map(a => a.id))
  const currentCategoryIds = new Set(currentCategories.map(c => c.id))
  return {
    newEvents: backup.events.filter(e => !currentEventIds.has(e.id)).length,
    matchingEvents: backup.events.filter(e => currentEventIds.has(e.id)).length,
    newAttachments: backup.attachments.filter(a => !currentAttachmentIds.has(a.id)).length,
    newCategories: backup.categories.filter(c => !currentCategoryIds.has(c.id)).length,
  }
}

export async function restoreBackup(backup: RestorableBackup, mode: 'merge' | 'replace', conflicts: 'keep' | 'replace') {
  await db.transaction('rw', db.events, db.categories, db.attachments, db.reminders, db.settings, async () => {
    if (mode === 'replace') {
      await Promise.all([db.events.clear(), db.categories.clear(), db.attachments.clear(), db.reminders.clear(), db.settings.clear()])
      await Promise.all([
        db.events.bulkPut(backup.events), db.categories.bulkPut(backup.categories),
        db.attachments.bulkPut(backup.attachments), db.reminders.bulkPut(backup.reminders), db.settings.bulkPut(backup.settings),
      ])
      return
    }
    const [events, categories, attachments, reminders, settings] = await Promise.all([
      db.events.toArray(), db.categories.toArray(), db.attachments.toArray(), db.reminders.toArray(), db.settings.toArray(),
    ])
    const categoryByName = new Map(categories.map(c => [c.name.trim().toLocaleLowerCase('gl'), c]))
    const categoryIds = new Map<string, string>()
    const categoryRows: CategoryRecord[] = []
    for (const incoming of backup.categories) {
      const existingById = categories.find(c => c.id === incoming.id)
      const existingByName = categoryByName.get(incoming.name.trim().toLocaleLowerCase('gl'))
      const match = existingById || existingByName
      if (match) {
        categoryIds.set(incoming.id, match.id)
        if (conflicts === 'replace') categoryRows.push({ ...incoming, id:match.id })
      }
      else { categoryIds.set(incoming.id, incoming.id); categoryRows.push(incoming) }
    }
    const eventRows = backup.events.map(event => ({ ...event, categoryId: categoryIds.get(event.categoryId) || event.categoryId }))
    const mergeById = <T extends { id: string }>(incoming: T[], existing: T[]) => {
      const ids = new Set(existing.map(row => row.id))
      return incoming.filter(row => !ids.has(row.id) || conflicts === 'replace')
    }
    await Promise.all([
      db.events.bulkPut(mergeById(eventRows, events)),
      db.categories.bulkPut(categoryRows),
      db.attachments.bulkPut(mergeById(backup.attachments, attachments)),
      db.reminders.bulkPut(mergeById(backup.reminders, reminders)),
      db.settings.bulkPut(backup.settings.filter(s => conflicts === 'replace' || !settings.some(current => current.key === s.key))),
    ])
  })
}
