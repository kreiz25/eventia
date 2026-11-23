import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Archive, ArrowDownUp, ArrowUpRight, CalendarDays, Check, Clock3, Compass, Download, ExternalLink, FileImage, FileText, Heart, Home, List, MapPin, Paperclip, Plus, Search, Share2, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { db, requestPersistentStorage } from './database/db'
import { archiveExpiredEvents } from './services/archive'
import { downloadBackupFile, inspectConflicts, parseBackupFile, restoreBackup } from './services/backup'
import { makeThumbnail } from './services/images'
import { generateEventPDF, shareEventPDF } from './services/pdf'
import { consumeForegroundReminders } from './services/reminders'
import { exportEventsCSV } from './services/csv'
import { localDateString, type AttachmentRecord, type CategoryRecord, type EventRecord, type EventStatus, type ReminderRecord } from './types'

const dayFmt = new Intl.DateTimeFormat('gl-ES', { day: '2-digit' })
const monthFmt = new Intl.DateTimeFormat('gl-ES', { month: 'short' })
const weekdayFmt = new Intl.DateTimeFormat('gl-ES', { weekday: 'long' })
const fullFmt = new Intl.DateTimeFormat('gl-ES', { day: 'numeric', month: 'long', year: 'numeric' })
const dateObj = (s: string) => new Date(`${s}T12:00:00`)
const artFor = (catId: string) => ({ 'cat-concertos':'atlantic', 'cat-exposicions':'city', 'cat-gastronomia':'table', 'cat-cine':'film', 'cat-viaxes':'clouds', 'cat-teatro':'stage' }[catId] || 'stage')

type EventItem = EventRecord & { category: CategoryRecord }
type Draft = Omit<EventRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'cover' | 'thumbnail'> & { id?: string; status?: EventStatus; createdAt?: string; cover?: Blob; coverName?: string; coverType?: string }
const emptyDraft = (categoryId: string): Draft => {
  const today = localDateString()
  return { title:'', categoryId, description:'', startDate:today, startTime:'', endDate:today, endTime:'', venue:'', address:'', city:'', companions:'', notes:'', price:'', link:'', observations:'' }
}

function Poster({ item, large = false }: { item: EventItem; large?: boolean }) {
  const [coverUrl, setCoverUrl] = useState('')
  const image = large ? item.cover : item.thumbnail || item.cover
  useEffect(() => {
    if (!image) { setCoverUrl(''); return }
    const url = URL.createObjectURL(image)
    setCoverUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [image])
  return <div className={`poster art-${artFor(item.categoryId)}${large ? ' poster-large' : ''}${coverUrl ? ' has-cover' : ''}`} style={{ '--accent': item.category.color } as React.CSSProperties}>
    {coverUrl && <img className="cover-artwork" src={coverUrl} alt="" />}
    <div className="poster-grain"/><div className="poster-art" aria-hidden="true">
      {artFor(item.categoryId)==='atlantic'&&<><span className="sun"/><span className="hill hill-a"/><span className="hill hill-b"/><span className="figure">♫</span><span className="line line-a"/><span className="line line-b"/></>}
      {artFor(item.categoryId)==='city'&&<><span className="city-orb"/><span className="tower t1"/><span className="tower t2"/><span className="tower t3"/><span className="city-grid"/></>}
      {artFor(item.categoryId)==='table'&&<><span className="plate plate-a"/><span className="plate plate-b"/><span className="leaf leaf-a"/><span className="leaf leaf-b"/><span className="tableline"/></>}
      {artFor(item.categoryId)==='film'&&<><span className="film-circle"/><span className="film-cut cut-a"/><span className="film-cut cut-b"/><span className="film-star">✳</span></>}
      {artFor(item.categoryId)==='clouds'&&<><span className="mountain m1"/><span className="mountain m2"/><span className="mountain m3"/><span className="cloud">☁</span></>}
      {artFor(item.categoryId)==='stage'&&<><span className="curtain c1"/><span className="curtain c2"/><span className="spotlight"/><span className="stage-star">✦</span></>}
    </div>
    <span className="poster-kicker">EVENTIA / EVENTOS</span><span className="poster-title">{item.title || 'Novo evento'}</span>
    <span className="poster-date">{dayFmt.format(dateObj(item.startDate))} <i>{monthFmt.format(dateObj(item.startDate)).replace('.','')}</i></span>
  </div>
}

function App() {
  const [tab, setTab] = useState('inicio')
  const [view, setView] = useState<'gallery'|'list'>('gallery')
  const [period, setPeriod] = useState('Todos')
  const [category, setCategory] = useState('Todos')
  const [archiveYear, setArchiveYear] = useState('Todos')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<EventItem|null>(null)
  const [editing, setEditing] = useState<EventItem|null>(null)
  const [adding, setAdding] = useState(false)
  const [favorite, setFavorite] = useState<string[]>([])
  const [items, setItems] = useState<EventItem[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState('')
  const [persisted, setPersisted] = useState<boolean|null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryColor, setCategoryColor] = useState('#8C62D6')
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [editingCategoryColor, setEditingCategoryColor] = useState('#8C62D6')
  const [backupPreview, setBackupPreview] = useState<Awaited<ReturnType<typeof parseBackupFile>>|null>(null)
  const [backupConflicts, setBackupConflicts] = useState<{newEvents:number;matchingEvents:number;newAttachments:number;newCategories:number}|null>(null)
  const [backupMode, setBackupMode] = useState<'merge'|'replace'>('merge')
  const [conflictMode, setConflictMode] = useState<'keep'|'replace'>('keep')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      await db.open()
      await archiveExpiredEvents()
      const [rows, cats] = await Promise.all([db.events.toArray(), db.categories.toArray()])
      const byId = new Map(cats.map(c => [c.id, c]))
      setCategories(cats.sort((a,b) => a.name.localeCompare(b.name, 'gl')))
      setItems(rows.map(e => ({ ...e, category: byId.get(e.categoryId) || { id:e.categoryId, name:'Sen categoría', color:'#85818B', builtIn:false } })).sort((a,b)=>a.startDate.localeCompare(b.startDate)))
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Non se puideron ler os datos locais.')
    }
  }, [])
  useEffect(() => {
    void refresh()
    void requestPersistentStorage().then(setPersisted)
    void db.settings.get('favorites').then(setting => {
      if (setting && Array.isArray(setting.value)) setFavorite(setting.value.filter((id): id is string => typeof id === 'string'))
    })
    const checkReminders = async () => {
      const due = await consumeForegroundReminders()
      if (due.length) setToast(`Recordatorio: ${due.join(', ')}`)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') { void refresh(); void checkReminders() } }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void checkReminders() }, 60_000)
    void checkReminders()
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(timer) }
  }, [refresh])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(''), 5000); return () => clearTimeout(id) }, [toast])

  const visible = useMemo(() => {
    const today = localDateString()
    const end = new Date(); end.setDate(end.getDate() + (period === '7 días' ? 7 : 30))
    const endDay = localDateString(end)
    return items.filter(e => e.status === 'upcoming' && e.title.toLocaleLowerCase('gl').includes(search.toLocaleLowerCase('gl')) && (category === 'Todos' || e.categoryId === category) && (period === 'Todos' || (e.startDate >= today && e.startDate <= endDay)))
  }, [items, search, category, period])
  const archived = useMemo(() => items.filter(e => e.status !== 'upcoming' && e.title.toLocaleLowerCase('gl').includes(search.toLocaleLowerCase('gl')) && (category === 'Todos' || e.categoryId === category)), [items, search, category])
  const archiveYears = useMemo(() => [...new Set(archived.map(e => (e.endDate || e.startDate).slice(0,4)))].sort((a,b)=>b.localeCompare(a)), [archived])
  const archiveItems = useMemo(() => archived.filter(e => archiveYear === 'Todos' || (e.endDate || e.startDate).startsWith(archiveYear)), [archived, archiveYear])
  const upcoming = useMemo(() => items.filter(e => e.status === 'upcoming').sort((a,b)=>a.startDate.localeCompare(b.startDate)), [items])
  const switchTab = (id: string) => { setTab(id); setSelected(null); if (id === 'engadir') openCreate() }
  const openCreate = () => { setEditing(null); setAdding(true) }
  const notify = (message: string) => setToast(message)
  const toggleFavorite = (id: string) => setFavorite(current => {
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    void db.settings.put({ key:'favorites', value:next })
    return next
  })

  async function saveEvent(draft: Draft) {
    const now = new Date().toISOString()
    const old = draft.id ? await db.events.get(draft.id) : undefined
    const cover = draft.cover ?? old?.cover
    const thumbnail = draft.cover ? await makeThumbnail(draft.cover) : old?.thumbnail
    const event: EventRecord = {
      id:draft.id || crypto.randomUUID(), title:draft.title, categoryId:draft.categoryId,
      description:draft.description, startDate:draft.startDate, startTime:draft.startTime,
      endDate:draft.endDate || undefined, endTime:draft.endTime, venue:draft.venue, address:draft.address,
      city:draft.city, latitude:draft.latitude, longitude:draft.longitude, companions:draft.companions,
      notes:draft.notes, price:draft.price, link:draft.link, observations:draft.observations,
      status:draft.status || 'upcoming',
      createdAt:draft.createdAt || now, updatedAt:now,
      cover, thumbnail,
      coverName:draft.coverName ?? old?.coverName, coverType:draft.coverType ?? old?.coverType,
    }
    await db.events.put(event)
    setAdding(false); setEditing(null); setSelected(null)
    await refresh()
    notify('Evento gardado neste dispositivo.')
  }
  async function setStatus(event: EventItem, status: EventStatus) {
    await db.events.update(event.id, { status, updatedAt:new Date().toISOString() })
    setSelected(null); await refresh()
    notify(status==='completed'?'Evento movido ao arquivo.':status==='cancelled'?'Evento marcado como cancelado.':'Evento recuperado para Próximos.')
  }
  async function deleteEvent(event: EventItem) {
    if (!window.confirm(`Eliminar «${event.title}» e os seus anexos deste dispositivo?`)) return
    await db.transaction('rw', db.events, db.attachments, db.reminders, async () => {
      await db.events.delete(event.id)
      await db.attachments.where('eventId').equals(event.id).delete()
      await db.reminders.where('eventId').equals(event.id).delete()
    })
    setSelected(null); await refresh(); notify('Evento eliminado.')
  }
  async function addCategory(e: FormEvent) {
    e.preventDefault()
    const name = categoryName.trim()
    if (!name || categories.some(c => c.name.toLocaleLowerCase('gl') === name.toLocaleLowerCase('gl'))) return notify('Introduce un nome novo para a categoría.')
    await db.categories.add({ id:crypto.randomUUID(), name, color:categoryColor, builtIn:false })
    setCategoryName(''); await refresh(); notify('Categoría creada.')
  }
  async function deleteCategory(category: CategoryRecord) {
    if (categories.length <= 1) return notify('Debe quedar polo menos unha categoría para crear eventos.')
    if (items.some(e=>e.categoryId===category.id)) return notify('Non se pode eliminar: hai eventos que usan esta categoría.')
    if (!window.confirm(`Eliminar a categoría «${category.name}»?`)) return
    await db.categories.delete(category.id); await refresh(); notify('Categoría eliminada.')
  }
  function startCategoryEdit(category: CategoryRecord) {
    setEditingCategoryId(category.id); setEditingCategoryName(category.name); setEditingCategoryColor(category.color)
  }
  async function saveCategoryEdit(category: CategoryRecord) {
    const name = editingCategoryName.trim()
    if (!name || categories.some(c => c.id !== category.id && c.name.toLocaleLowerCase('gl') === name.toLocaleLowerCase('gl'))) return notify('O nome está baleiro ou xa existe.')
    await db.categories.update(category.id, { name, color:editingCategoryColor })
    setEditingCategoryId(''); await refresh(); notify('Categoría actualizada.')
  }

  async function exportBackup() {
    setBusy(true)
    try {
      const {file, counts} = await downloadBackupFile()
      if (navigator.canShare?.({ files:[file] }) && navigator.share) {
        try {
          await navigator.share({ files:[file], title:'Copia de Eventia', text:'Copia manual dos teus datos de Eventia.' })
          notify(`Copia JSON compartida. ${counts.events} eventos e ${counts.attachments} anexos.`)
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') notify('Compartición cancelada; a copia non se enviou.')
          else {
            const url = URL.createObjectURL(file)
            const a = document.createElement('a'); a.href=url; a.download=file.name; a.click()
            window.setTimeout(()=>URL.revokeObjectURL(url), 5000)
            notify('A folla de compartir non estaba dispoñible; a descarga JSON está preparada.')
          }
        }
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a'); a.href=url; a.download=file.name; a.click()
        window.setTimeout(()=>URL.revokeObjectURL(url), 5000)
        notify(`Descarga preparada: ${counts.events} eventos e ${counts.attachments} anexos. Escolle onde gardar a copia.`)
      }
    } catch (error) {
      notify(error instanceof Error ? `Non se puido crear a copia: ${error.message}` : 'Non se puido crear a copia.')
    } finally { setBusy(false) }
  }
  async function exportCSV() {
    try { await exportEventsCSV(); notify('Ficheiro CSV preparado para gardar.') }
    catch(error) { notify(error instanceof Error?`Non se puido exportar o CSV: ${error.message}`:'Non se puido exportar o CSV.') }
  }
  async function chooseBackup(file?: File) {
    if (!file) return
    setBusy(true)
    try {
      const parsed = await parseBackupFile(file)
      setBackupPreview(parsed); setBackupConflicts(await inspectConflicts(parsed.backup)); setBackupMode('merge'); setConflictMode('keep')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Non se puido ler a copia.')
    } finally { setBusy(false) }
  }
  async function applyBackup() {
    if (!backupPreview || !backupConflicts) return
    if (backupMode === 'replace' && !window.confirm('Substituír todos os datos deste dispositivo polos da copia? A acción non se pode desfacer.')) return
    setBusy(true)
    try {
      await restoreBackup(backupPreview.backup, backupMode, conflictMode)
      const count = backupPreview.counts.events
      setBackupPreview(null); setBackupConflicts(null); await refresh()
      notify(backupMode==='replace'?`Copia restaurada: ${count} eventos.`:'Copia fusionada; os datos deste dispositivo mantivéronse segundo a opción escollida.')
    } catch (error) {
      notify(error instanceof Error ? `Restauración cancelada: ${error.message}` : 'Non se puido restaurar a copia.')
    } finally { setBusy(false) }
  }

  return <div className="app-shell">
    <header className="topbar"><button className="wordmark" onClick={()=>switchTab('inicio')}><span className="brand-mark">E</span><span>EVENTIA<span className="brand-dot">.</span></span></button><div className="avatar" aria-hidden="true"><span>XR</span></div></header>
    <main className="main-content">
      {tab==='inicio'&&<>
        <div className="eyebrow"><span className="eyebrow-dot"/> A TÚA TEMPADA, EN PRIMEIRA FILA</div>
        <section className="hero"><div><h1>Algo bo<br/><em>está por vir.</em></h1><p>Plans que merecen un lugar na memoria.</p></div><div className="hero-stamp"><Sparkles size={17}/><span>A TÚA<br/>HISTORIA</span></div></section>
        {loadError&&<div className="error-note">{loadError}</div>}
        <div className="section-head"><div><div className="section-label">A TÚA COLECCIÓN</div><h2>Por vivir <span className="count">{visible.length.toString().padStart(2,'0')}</span></h2></div><span className="sort-label"><ArrowDownUp size={14}/>DATA</span></div>
        <div className="search-row"><div className="searchbox"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Busca un plan…"/></div></div>
        <div className="filter-line"><div className="period-pills">{['Todos','7 días','30 días'].map(p=><button className={period===p?'active':''} key={p} onClick={()=>setPeriod(p)}>{p==='7 días'?'7 días':p==='30 días'?'30 días':'Todo'}</button>)}</div><div className="view-toggle"><button className={view==='gallery'?'selected':''} onClick={()=>setView('gallery')} aria-label="Galería"><span className="grid-icon">▦</span></button><button className={view==='list'?'selected':''} onClick={()=>setView('list')} aria-label="Lista"><List size={17}/></button></div></div>
        <div className="category-scroller"><button onClick={()=>setCategory('Todos')} className={`cat-filter ${category==='Todos'?'chosen':''}`}>Todos</button>{categories.map(c=><button key={c.id} onClick={()=>setCategory(c.id)} className={`cat-filter ${category===c.id?'chosen':''}`}><span style={{background:c.color}}/>{c.name}</button>)}</div>
        {view==='gallery'?<div className="event-grid">{visible.map(item=><article className="event-card" key={item.id}><button className="poster-button" onClick={()=>setSelected(item)} aria-label={`Abrir ${item.title}`}><Poster item={item}/></button><button className={`heart-button ${favorite.includes(item.id)?'liked':''}`} onClick={()=>toggleFavorite(item.id)} aria-label="Gardar favorito"><Heart size={16} fill={favorite.includes(item.id)?'currentColor':'none'}/></button><div className="card-meta"><span className="card-category" style={{'--tag':item.category.color} as React.CSSProperties}>{item.category.name}</span><span className="card-date">{weekdayFmt.format(dateObj(item.startDate)).slice(0,3)} · {dayFmt.format(dateObj(item.startDate))} {monthFmt.format(dateObj(item.startDate)).replace('.','')}</span></div><button className="card-title" onClick={()=>setSelected(item)}>{item.title}</button><div className="card-place">{item.city&&<><MapPin size={12}/>{item.city}</>}</div></article>)}</div>:<div className="event-list">{visible.map(item=><button className="list-event" key={item.id} onClick={()=>setSelected(item)}><div className="list-thumb"><Poster item={item}/></div><div><div className="card-category" style={{'--tag':item.category.color} as React.CSSProperties}>{item.category.name}</div><strong>{item.title}</strong><span>{weekdayFmt.format(dateObj(item.startDate))} · {dayFmt.format(dateObj(item.startDate))} {monthFmt.format(dateObj(item.startDate))}</span><small>{item.city&&<><MapPin size={12}/>{item.city}</>}</small></div><ArrowUpRight size={17}/></button>)}</div>}
        {!visible.length&&<div className="empty-state"><span>◌</span><h3>{search||category!=='Todos'?'Non hai plans con estes filtros':'A túa próxima historia está por escribir.'}</h3><p>{search||category!=='Todos'?'Proba con outro filtro ou engade un evento.':'Engade un plan para comezar a túa colección.'}</p>{!items.length&&<button className="empty-add" onClick={openCreate}><Plus size={16}/> Engadir o primeiro plan</button>}</div>}
        <div className="offline-note"><span className="offline-led"/> Os teus datos viven aquí <span>·</span> Só neste dispositivo</div>
      </>}
      {tab==='axenda'&&<><div className="eyebrow"><span className="eyebrow-dot teal"/> O QUE VÉN DESPOIS</div><section className="page-intro"><h1>Axenda<span className="brand-dot">.</span></h1><p>Unha ollada rápida ao que está no horizonte.</p></section><div className="agenda-today"><span>A TÚA COLECCIÓN</span><strong>Plans por diante</strong><div>{upcoming.length} eventos agardando por ti</div></div>{upcoming.length?<Agenda items={upcoming} open={setSelected}/>:<div className="empty-state"><h3>A axenda está despexada.</h3><p>Cando engadas plans, aparecerán aquí por orde de data.</p></div>}</>}
      {tab==='arquivo'&&<><div className="eyebrow"><span className="eyebrow-dot violet"/> TODO O QUE XA VIVICHES</div><section className="page-intro"><h1>Arquivo<span className="brand-dot">.</span></h1><p>Os bos plans tamén merecen quedar.</p></section><div className="archive-banner"><Archive size={22}/><div><strong>A túa historia persoal</strong><span>Os eventos completados ou cancelados quedan gardados aquí.</span></div></div><div className="archive-filter"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Busca no arquivo…"/><select value={archiveYear} onChange={e=>setArchiveYear(e.target.value)} aria-label="Filtrar por ano"><option>Todos</option>{archiveYears.map(year=><option key={year}>{year}</option>)}</select></div><div className="category-scroller"><button onClick={()=>setCategory('Todos')} className={`cat-filter ${category==='Todos'?'chosen':''}`}>Todas</button>{categories.map(c=><button key={c.id} onClick={()=>setCategory(c.id)} className={`cat-filter ${category===c.id?'chosen':''}`}><span style={{background:c.color}}/>{c.name}</button>)}</div>{archiveItems.length?<div className="event-grid">{archiveItems.map(item=><article className="event-card" key={item.id}><button className="poster-button" onClick={()=>setSelected(item)}><Poster item={item}/></button><div className="card-meta"><span className="card-category" style={{'--tag':item.category.color} as React.CSSProperties}>{item.status==='cancelled'?'Cancelado':item.category.name}</span><span className="card-date">{fullFmt.format(dateObj(item.endDate||item.startDate))}</span></div><button className="card-title" onClick={()=>setSelected(item)}>{item.title}</button></article>)}</div>:<div className="archive-empty"><div className="archive-sun">✳</div><h2>Aínda non hai recordos.</h2><p>Podes arquivar manualmente un evento desde a súa ficha.</p></div>}</>}
      {tab==='axustes'&&<>
        <div className="eyebrow"><span className="eyebrow-dot yellow"/> O TEU ESPAZO PERSOAL</div><section className="page-intro"><h1>Axustes<span className="brand-dot">.</span></h1><p>Todo ao teu xeito, sempre no teu dispositivo.</p></section>
        <div className="settings-card"><div className="settings-avatar">E</div><div><b>O teu Eventia</b><span>Colección persoal · local</span></div><span className="local-pill"><i/> {persisted===true?'PROTEXIDA':'LOCAL'}</span></div>
        <section className="backup-panel"><div className="backup-title"><div className="setting-icon violet"><Archive size={18}/></div><div><b>Copia manual para iPhone e Mac</b><span>Exporta un JSON completo e impórtao no outro dispositivo.</span></div></div><button className="primary-btn backup-export" onClick={()=>void exportBackup()} disabled={busy}><Download size={16}/>{busy?'Preparando…':'Exportar copia JSON completa'}</button><label className="file-button"><Upload size={16}/> Importar copia JSON<input type="file" accept="application/json,.json" onChange={e=>void chooseBackup(e.target.files?.[0])} disabled={busy}/></label><button className="secondary-btn csv-export" onClick={()=>void exportCSV()}><Download size={15}/> Exportar eventos CSV</button><p className="fine-print">Non hai sincronización. Pasa o ficheiro manualmente por AirDrop, cable ou o destino que ti escollas.{persisted===false?' O navegador non confirmou a persistencia: garda copias externas con regularidade.':''}</p></section>
        {backupPreview&&backupConflicts&&<section className="import-preview"><div className="section-heading"><div><span className="eyebrow">VISTA PREVIA DA COPIA</span><h2>Revisa antes de importar</h2></div><button className="icon-btn" onClick={()=>{setBackupPreview(null);setBackupConflicts(null)}}><X size={17}/></button></div><div className="preview-facts"><span><b>{fullFmt.format(dateObj(backupPreview.backup.createdAt.slice(0,10)))}</b>Data da copia</span><span><b>{backupPreview.counts.events}</b>Eventos</span><span><b>{backupPreview.counts.attachments}</b>Anexos</span><span><b>{backupConflicts.newEvents}</b>Novos</span><span><b>{backupConflicts.matchingEvents}</b>Coinciden por ID</span></div><div className="import-options"><label><input type="radio" checked={backupMode==='merge'} onChange={()=>setBackupMode('merge')}/> Fusionar coa colección deste dispositivo</label><label><input type="radio" checked={backupMode==='replace'} onChange={()=>setBackupMode('replace')}/> Substituír todos os datos deste dispositivo</label></div>{backupMode==='merge'&&backupConflicts.matchingEvents>0&&<div className="conflict-choice"><b>{backupConflicts.matchingEvents} eventos xa existen.</b><label><input type="radio" checked={conflictMode==='keep'} onChange={()=>setConflictMode('keep')}/> Manter a versión deste dispositivo</label><label><input type="radio" checked={conflictMode==='replace'} onChange={()=>setConflictMode('replace')}/> Substituír pola versión da copia</label></div>}<button className={backupMode==='replace'?'danger-btn':'primary-btn'} onClick={()=>void applyBackup()} disabled={busy}>{busy?'Restaurando…':backupMode==='replace'?'Substituír e restaurar':'Importar copia'}</button><p className="fine-print">A importación valida o ficheiro e aplica os cambios nunha única transacción local.</p></section>}
        <div className="category-settings"><div className="settings-subhead"><div><span className="section-label">A TÚA COLECCIÓN</span><h2>Categorías</h2></div></div><form className="category-create" onSubmit={e=>void addCategory(e)}><input value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="Nova categoría" aria-label="Nome da nova categoría"/><input type="color" value={categoryColor} onChange={e=>setCategoryColor(e.target.value)} aria-label="Cor da categoría"/><button className="small-add" type="submit" aria-label="Crear categoría"><Plus size={18}/></button></form><div className="category-manage-list">{categories.map(c=><div key={c.id} className={editingCategoryId===c.id?'category-editing':''}>{editingCategoryId===c.id?<><input className="category-name-edit" value={editingCategoryName} onChange={e=>setEditingCategoryName(e.target.value)} aria-label="Novo nome da categoría"/><input type="color" value={editingCategoryColor} onChange={e=>setEditingCategoryColor(e.target.value)} aria-label="Nova cor da categoría"/><button onClick={()=>void saveCategoryEdit(c)} aria-label="Gardar categoría"><Check size={14}/></button><button onClick={()=>setEditingCategoryId('')} aria-label="Cancelar"><X size={14}/></button></>:<><span className="category-dot" style={{background:c.color}}/><b>{c.name}</b><button onClick={()=>startCategoryEdit(c)} aria-label={`Editar ${c.name}`}>Editar</button><button onClick={()=>void deleteCategory(c)} aria-label={`Eliminar ${c.name}`}><Trash2 size={14}/></button></>}</div>)}</div></div>
        <div className="privacy-box"><span>🔒</span><div><b>Os teus plans son só teus.</b><p>Eventia non ten contas nin backend. A copia só sae do dispositivo cando ti exportas o ficheiro.</p></div></div><p className="version-label">EVENTIA · EDICIÓN PERSOAL 0.2</p>
      </>}
    </main>
    <nav className="bottom-nav" aria-label="Navegación principal">
      <button className={tab==='inicio'?'nav-active':''} onClick={()=>switchTab('inicio')}><Home size={19}/><span>Inicio</span></button><button className={tab==='axenda'?'nav-active':''} onClick={()=>switchTab('axenda')}><CalendarDays size={19}/><span>Axenda</span></button><button className="nav-add" onClick={openCreate} aria-label="Engadir evento"><span><Plus size={23}/></span><small>Engadir</small></button><button className={tab==='arquivo'?'nav-active':''} onClick={()=>switchTab('arquivo')}><Archive size={19}/><span>Arquivo</span></button><button className={tab==='axustes'?'nav-active':''} onClick={()=>switchTab('axustes')}><Compass size={19}/><span>Axustes</span></button>
    </nav>
    {selected&&<div className="overlay" onClick={()=>setSelected(null)}><section className="detail-sheet" onClick={e=>e.stopPropagation()}><div className="sheet-handle"/><button className="close-button" onClick={()=>setSelected(null)} aria-label="Pechar"><X size={19}/></button><Poster item={selected} large/><div className="detail-body"><div className="detail-topline"><span className="card-category" style={{'--tag':selected.category.color} as React.CSSProperties}>{selected.category.name}</span><span className="detail-date">{fullFmt.format(dateObj(selected.startDate))}{selected.startTime?` · ${selected.startTime}`:''}</span></div><h2>{selected.title}</h2>{selected.description&&<p className="detail-description">{selected.description}</p>}{selected.endDate&&<div className="detail-row"><span className="detail-icon"><CalendarDays size={17}/></span><div><b>{fullFmt.format(dateObj(selected.endDate))}{selected.endTime?` · ${selected.endTime}`:''}</b><span>Data de finalización</span></div></div>}{(selected.venue||selected.city||selected.address)&&<div className="detail-row"><span className="detail-icon"><MapPin size={17}/></span><div><b>{selected.venue||selected.city}</b><span>{[selected.address,selected.city].filter(Boolean).join(' · ')}</span></div></div>}{(selected.latitude!==undefined&&selected.longitude!==undefined||selected.address||selected.city||selected.venue)&&<MapActions event={selected}/ >}{selected.companions&&<DetailText icon="♥" title="Acompañantes" body={selected.companions}/ >}{selected.price&&<DetailText icon="€" title="Prezo" body={selected.price}/ >}{selected.notes&&<DetailText icon="✎" title="Notas" body={selected.notes}/ >}{selected.observations&&<DetailText icon="✳" title="Observacións" body={selected.observations}/ >}{selected.link&&<a className="event-link" href={selected.link} target="_blank" rel="noreferrer">Abrir ligazón do evento <ExternalLink size={14}/></a>}<ReminderManager event={selected} notify={notify}/><AttachmentManager eventId={selected.id} notify={notify}/><div className="detail-actions"><button className="secondary-btn" onClick={()=>{setEditing(selected);setAdding(true);setSelected(null)}}>Editar evento</button>{selected.status==='upcoming'?<><button className="secondary-btn" onClick={()=>void setStatus(selected,'completed')}>Arquivar agora</button><button className="secondary-btn" onClick={()=>void setStatus(selected,'cancelled')}>Marcar cancelado</button></>:<button className="secondary-btn" onClick={()=>void setStatus(selected,'upcoming')}>Recuperar evento</button>}<button className="delete-btn" onClick={()=>void deleteEvent(selected)} aria-label="Eliminar evento"><Trash2 size={17}/></button></div><PDFShare event={selected} notify={notify}/></div></section></div>}
    {adding&&<EventEditor categories={categories} initial={editing} onClose={()=>{setAdding(false);setEditing(null)}} onSave={saveEvent}/>}
    {toast&&<div role="status" className="toast"><Check size={16}/>{toast}<button onClick={()=>setToast('')} aria-label="Pechar aviso"><X size={15}/></button></div>}
  </div>
}

function DetailText({icon,title,body}:{icon:string;title:string;body:string}) { return <div className="detail-row"><span className="detail-icon detail-symbol">{icon}</span><div><b>{title}</b><span>{body}</span></div></div> }

function MapActions({event}:{event:EventItem}) {
  const query = [event.venue,event.address,event.city].filter(Boolean).join(', ') || (event.latitude !== undefined && event.longitude !== undefined ? `${event.latitude},${event.longitude}` : '')
  if (!query) return null
  return <div className="map-actions"><a href={appleMapsURL(query)} target="_blank" rel="noreferrer"><MapPin size={14}/> Apple Maps <ExternalLink size={12}/></a><a href={googleMapsURL(query)} target="_blank" rel="noreferrer"><MapPin size={14}/> Google Maps <ExternalLink size={12}/></a></div>
}

function appleMapsURL(query:string) { return `https://maps.apple.com/?q=${encodeURIComponent(query)}` }
function googleMapsURL(query:string) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` }

const reminderOptions: {kind:ReminderRecord['kind'];label:string}[] = [
  {kind:'7-days',label:'7 días antes'}, {kind:'1-day',label:'1 día antes'}, {kind:'2-hours',label:'2 horas antes'},
]
function localDateTimeInput(date = new Date()) {
  return `${localDateString(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
}
function ReminderManager({event,notify}:{event:EventItem;notify:(message:string)=>void}) {
  const [rows,setRows]=useState<ReminderRecord[]>([])
  const [custom,setCustom]=useState(localDateTimeInput())
  const reload=useCallback(()=>{void db.reminders.where('eventId').equals(event.id).toArray().then(setRows)},[event.id])
  useEffect(()=>{reload();window.addEventListener('eventia-reminders-changed',reload);return()=>window.removeEventListener('eventia-reminders-changed',reload)},[reload])
  async function toggle(kind:ReminderRecord['kind']) {
    const row=rows.find(r=>r.kind===kind)
    if(row) await db.reminders.delete(row.id)
    else await db.reminders.put({id:`${event.id}-${kind}`,eventId:event.id,kind,enabled:true})
    reload()
  }
  async function addCustom() {
    if(!custom||Number.isNaN(new Date(custom).getTime()))return notify('Escolle unha data e hora válidas.')
    await db.reminders.put({id:crypto.randomUUID(),eventId:event.id,kind:'custom',dateTime:custom,enabled:true})
    reload();notify('Recordatorio engadido.')
  }
  return <section className="reminder-panel"><div className="panel-heading"><Clock3 size={16}/><b>Recordatorios</b></div><div className="reminder-options">{reminderOptions.map(o=><label key={o.kind}><input type="checkbox" checked={rows.some(r=>r.kind===o.kind&&r.enabled)} onChange={()=>void toggle(o.kind)}/>{o.label}</label>)}</div><div className="custom-reminder"><input type="datetime-local" value={custom} onChange={e=>setCustom(e.target.value)} aria-label="Data e hora do recordatorio personalizado"/><button className="small-add" onClick={()=>void addCustom()} aria-label="Engadir recordatorio personalizado"><Plus size={16}/></button></div>{rows.filter(r=>r.kind==='custom'&&r.enabled).map(r=><div className="custom-reminder-row" key={r.id}><span>{r.dateTime?.replace('T',' · ')}</span><button onClick={()=>void db.reminders.delete(r.id).then(reload)} aria-label="Eliminar recordatorio"><X size={14}/></button></div>)}<p>Avisos só dentro de Eventia mentres está aberta. iOS non garante que unha PWA os entregue pechada.</p></section>
}

function AttachmentManager({eventId,notify}:{eventId:string;notify:(message:string)=>void}) {
  const [files,setFiles]=useState<AttachmentRecord[]>([])
  const [busy,setBusy]=useState(false)
  const reload=useCallback(()=>{void db.attachments.where('eventId').equals(eventId).toArray().then(rows=>setFiles(rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))))},[eventId])
  useEffect(()=>{reload()},[reload])
  async function addFiles(list:FileList|null) {
    if(!list?.length)return
    setBusy(true)
    try {
      const rows:AttachmentRecord[]=Array.from(list).map(file=>({id:crypto.randomUUID(),eventId,name:file.name,type:file.type||'application/octet-stream',size:file.size,createdAt:new Date().toISOString(),blob:file}))
      await db.attachments.bulkAdd(rows);reload();notify(`${rows.length} ficheiro${rows.length===1?' gardado':'s gardados'} no dispositivo.`)
    } catch (error) { notify(error instanceof Error?`Non se puido gardar o ficheiro: ${error.message}`:'Non se puideron gardar os ficheiros.') }
    finally {setBusy(false)}
  }
  async function openFile(file:AttachmentRecord) {
    const url=URL.createObjectURL(file.blob)
    if(file.type==='application/pdf'||file.type.startsWith('image/')) { window.open(url,'_blank','noopener,noreferrer');window.setTimeout(()=>URL.revokeObjectURL(url),120_000) }
    else {const a=document.createElement('a');a.href=url;a.download=file.name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),10_000)}
  }
  async function shareFile(file:AttachmentRecord) {
    const item=new File([file.blob],file.name,{type:file.type})
    if(navigator.canShare?.({files:[item]})&&navigator.share) {
      try { await navigator.share({files:[item],title:file.name});notify('A folla de compartir pechouse.') }
      catch(error) {if(error instanceof DOMException&&error.name==='AbortError')notify('Compartición cancelada.');else notify('Non se puido compartir este ficheiro.')}
    } else await openFile(file)
  }
  async function removeFile(file:AttachmentRecord) {
    if(!window.confirm(`Eliminar «${file.name}» deste evento?`))return
    await db.attachments.delete(file.id);reload();notify('Anexo eliminado.')
  }
  return <section className="attachments-panel"><div className="panel-heading"><Paperclip size={16}/><b>Documentos e entradas</b><span>{files.length}</span></div><label className="attachment-add"><Plus size={15}/>{busy?'Gardando…':'Engadir ficheiros'}<input type="file" multiple accept=".pdf,image/*,.doc,.docx,.txt,.rtf,.xls,.xlsx,.ppt,.pptx,.zip,.heic,.webp" onChange={e=>{void addFiles(e.target.files);e.currentTarget.value=''}} disabled={busy}/></label>{files.length>0&&<div className="attachment-list">{files.map(file=><div className="attachment-row" key={file.id}><span className="attachment-icon">{file.type.startsWith('image/')?<FileImage size={16}/>:<FileText size={16}/>}</span><button className="attachment-name" onClick={()=>void openFile(file)}><b>{file.name}</b><small>{file.type||'Documento'} · {formatBytes(file.size)}</small></button><button onClick={()=>void shareFile(file)} aria-label={`Compartir ${file.name}`}><Share2 size={15}/></button><button onClick={()=>void removeFile(file)} aria-label={`Eliminar ${file.name}`}><Trash2 size={15}/></button></div>)}</div>}<p>Os anexos son locais e non se inclúen no PDF do evento.</p></section>
}
function formatBytes(bytes:number) { if(bytes<1024)return `${bytes} B`; if(bytes<1024*1024)return `${(bytes/1024).toFixed(0)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB` }

function PDFShare({event,notify}:{event:EventItem;notify:(message:string)=>void}) {
  const [includeNotes,setIncludeNotes]=useState(false)
  const [busy,setBusy]=useState(false)
  async function share() {
    setBusy(true)
    try {
      const file=await generateEventPDF(event,includeNotes)
      const result=await shareEventPDF(file)
      if(result==='shared')notify('O PDF xerouse; a folla de compartir rematou.')
      else if(result==='downloaded')notify('O PDF xerouse e a descarga está preparada para gardalo.')
      else notify('Compartición cancelada; o PDF non se compartiu.')
    } catch(error) { notify(error instanceof Error?`Non se puido xerar o PDF: ${error.message}`:'Non se puido xerar o PDF.') }
    finally {setBusy(false)}
  }
  return <div className="pdf-share-block">{event.notes&&<label className="pdf-notes-choice"><input type="checkbox" checked={includeNotes} onChange={e=>setIncludeNotes(e.target.checked)}/>Incluír notas persoais</label>}<button className="share-button" onClick={()=>void share()} disabled={busy}>{busy?'XERANDO PDF…':'COMPARTIR EVENTO EN PDF'} {busy?<Clock3 size={15}/>:<ArrowUpRight size={15}/>}</button><p>As entradas e os anexos privados quedan fóra do PDF.</p></div>
}

function EventEditor({categories,initial,onClose,onSave}:{categories:CategoryRecord[];initial:EventItem|null;onClose:()=>void;onSave:(draft:Draft)=>Promise<void>}) {
  const [draft,setDraft]=useState<Draft>(()=>initial?({id:initial.id,title:initial.title,categoryId:initial.categoryId,description:initial.description,startDate:initial.startDate,startTime:initial.startTime,endDate:initial.endDate||initial.startDate,endTime:initial.endTime,venue:initial.venue,address:initial.address,city:initial.city,latitude:initial.latitude,longitude:initial.longitude,companions:initial.companions,notes:initial.notes,price:initial.price,link:initial.link,observations:initial.observations,status:initial.status,createdAt:initial.createdAt,cover:initial.cover,coverName:initial.coverName,coverType:initial.coverType}):emptyDraft(categories[0]?.id||'cat-outros'))
  const [customEndDate,setCustomEndDate]=useState(()=>Boolean(initial?.endDate&&initial.endDate!==initial.startDate))
  const [coverFile,setCoverFile]=useState<File|null>(null)
  const [coverPreview,setCoverPreview]=useState('')
  const [storedCoverPreview,setStoredCoverPreview]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>{if(!coverFile){setCoverPreview('');return}const url=URL.createObjectURL(coverFile);setCoverPreview(url);return()=>URL.revokeObjectURL(url)},[coverFile])
  useEffect(()=>{if(!draft.cover){setStoredCoverPreview('');return}const url=URL.createObjectURL(draft.cover);setStoredCoverPreview(url);return()=>URL.revokeObjectURL(url)},[draft.cover])
  const set=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(prev=>({...prev,[key]:value}))
  const changeStartDate=(value:string)=>setDraft(prev=>({...prev,startDate:value,endDate:customEndDate?prev.endDate:value}))
  const changeEndDate=(value:string)=>{setCustomEndDate(Boolean(value&&value!==draft.startDate));set('endDate',value)}
  const locationQuery=[draft.venue,draft.address,draft.city].filter(Boolean).join(', ')
  async function submit(e:FormEvent) {
    e.preventDefault()
    if(!draft.title.trim()) return setError('O título é obrigatorio.')
    if(!draft.startDate) return setError('Escolle a data de inicio.')
    if(draft.endDate&&draft.endDate<draft.startDate) return setError('A data de fin non pode ser anterior á de inicio.')
    setError('')
    await onSave({...draft,title:draft.title.trim(),cover:coverFile||draft.cover,coverName:coverFile?.name||draft.coverName,coverType:coverFile?.type||draft.coverType})
  }
  return <div className="overlay" onClick={onClose}><section className="add-sheet event-editor" onClick={e=>e.stopPropagation()}><div className="sheet-handle"/><div className="add-head"><div><span className="section-label">{initial?'EDITAR EVENTO':'UN PLAN NOVO'}</span><h2>{initial?'Axusta os detalles':'Que tes na axenda?'}</h2></div><button className="close-button" onClick={onClose} aria-label="Pechar"><X size={19}/></button></div><form onSubmit={e=>void submit(e)}><label>Título *<input autoFocus value={draft.title} onChange={e=>set('title',e.target.value)} placeholder="p.ex. Concerto de verán" required/></label><div className="form-two"><label>Categoría<select value={draft.categoryId} onChange={e=>set('categoryId',e.target.value)}>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Data de inicio *<input value={draft.startDate} onChange={e=>changeStartDate(e.target.value)} type="date" required/></label></div><div className="form-two"><label>Hora de inicio<input value={draft.startTime} onChange={e=>set('startTime',e.target.value)} type="time"/></label><label>Data de fin<input value={draft.endDate||''} onChange={e=>changeEndDate(e.target.value)} type="date"/><small className="field-hint">Igual ao inicio ata que a cambies</small></label></div><div className="form-two"><label>Hora de fin<input value={draft.endTime} onChange={e=>set('endTime',e.target.value)} type="time"/></label><label>Prezo<input value={draft.price} onChange={e=>set('price',e.target.value)} placeholder="p.ex. 25 €"/></label></div><label>Recinto ou lugar<input value={draft.venue} onChange={e=>set('venue',e.target.value)} placeholder="Nome do local"/></label><label>Enderezo<input value={draft.address} onChange={e=>set('address',e.target.value)} placeholder="Rúa, número…"/></label><label>Localidade<input value={draft.city} onChange={e=>set('city',e.target.value)} placeholder="Cidade"/></label><MapSearchActions query={locationQuery}/><label>Descrición<textarea value={draft.description} onChange={e=>set('description',e.target.value)} rows={3} placeholder="Que che gustaría lembrar deste plan?"/></label><div className="form-two"><label>Acompañantes<input value={draft.companions} onChange={e=>set('companions',e.target.value)} placeholder="Con quen vas?"/></label><label>Ligazón externa<input value={draft.link} onChange={e=>set('link',e.target.value)} type="url" placeholder="https://…"/></label></div><label>Notas persoais<textarea value={draft.notes} onChange={e=>set('notes',e.target.value)} rows={2}/></label><label>Portada<input type="file" accept="image/*" onChange={e=>setCoverFile(e.target.files?.[0]||null)}/></label>{(coverPreview||storedCoverPreview)&&<div className="cover-preview"><img src={coverPreview||storedCoverPreview} alt="Vista previa da portada"/>{coverFile&&<button type="button" className="small-add" onClick={()=>setCoverFile(null)} aria-label="Quitar portada"><X size={16}/></button>}</div>}{error&&<div className="error-note">{error}</div>}<button className="create-button" type="submit">{initial?'Gardar cambios':'Anotar este plan'} <Check size={17}/></button></form></section></div>
}

function MapSearchActions({query}:{query:string}) {
  const location=query.trim()
  if(!location)return null
  return <div className="map-search-block"><span>Buscar este lugar en:</span><div><a href={appleMapsURL(location)} target="_blank" rel="noreferrer"><MapPin size={14}/> Apple Maps <ExternalLink size={11}/></a><a href={googleMapsURL(location)} target="_blank" rel="noreferrer"><MapPin size={14}/> Google Maps <ExternalLink size={11}/></a></div><small>A busca ábrese no mapa; ao gardar, a ficha creará estes enlaces cos datos de localización.</small></div>
}

function Agenda({items,open}:{items:EventItem[];open:(e:EventItem)=>void}) {
  const today=localDateString();const tomorrowDate=new Date();tomorrowDate.setDate(tomorrowDate.getDate()+1);const tomorrow=localDateString(tomorrowDate);const weekEnd=new Date();weekEnd.setDate(weekEnd.getDate()+7);const nextWeekEnd=new Date();nextWeekEnd.setDate(nextWeekEnd.getDate()+28)
  const groups=new Map<string,EventItem[]>()
  for(const event of items){const key=event.startDate===today?'Hoxe':event.startDate===tomorrow?'Mañá':event.startDate<=localDateString(weekEnd)?'Esta semana':event.startDate<=localDateString(nextWeekEnd)?'Próximas semanas':new Intl.DateTimeFormat('gl-ES',{month:'long',year:'numeric'}).format(dateObj(event.startDate));groups.set(key,[...(groups.get(key)||[]),event])}
  return <div className="agenda-timeline">{[...groups.entries()].map(([month,events])=><section className="agenda-month" key={month}><div className="month-label">{month.toLocaleUpperCase('gl')} <span>{events.length} {events.length===1?'PLAN':'PLANS'}</span></div>{events.map(e=><button className="agenda-item" key={e.id} onClick={()=>open(e)}><div className="agenda-date"><b>{dayFmt.format(dateObj(e.startDate))}</b><span>{monthFmt.format(dateObj(e.startDate)).replace('.','')}</span></div><span className="agenda-line" style={{background:e.category.color}}/><div className="agenda-copy"><span className="card-category" style={{'--tag':e.category.color} as React.CSSProperties}>{e.category.name}</span><strong>{e.title}</strong><small>{e.startTime&&<><Clock3 size={12}/>{e.startTime}</>} {e.city&&<><MapPin size={12}/>{e.city}</>}</small></div><div className="agenda-poster"><Poster item={e}/></div></button>)}</section>)}</div>
}

export default App
