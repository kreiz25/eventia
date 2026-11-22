import { db } from '../database/db'

function csvCell(value:unknown) {
  let text=String(value??'')
  if(/^[\s]*[=+@\-]/.test(text))text=`'${text}`
  return `"${text.replace(/"/g,'""')}"`
}
export async function exportEventsCSV() {
  const [events,categories]=await Promise.all([db.events.toArray(),db.categories.toArray()])
  const categoryById=new Map(categories.map(category=>[category.id,category.name]))
  const fields=['id','title','category','status','startDate','startTime','endDate','endTime','venue','address','city','latitude','longitude','description','companions','notes','price','link','observations','coverName','createdAt','updatedAt'] as const
  const rows=events.map(event=>[event.id,event.title,categoryById.get(event.categoryId)||'',event.status,event.startDate,event.startTime,event.endDate,event.endTime,event.venue,event.address,event.city,event.latitude,event.longitude,event.description,event.companions,event.notes,event.price,event.link,event.observations,event.coverName,event.createdAt,event.updatedAt])
  const csv='\uFEFF'+[fields.map(csvCell).join(';'),...rows.map(row=>row.map(csvCell).join(';'))].join('\r\n')
  const file=new Blob([csv],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=`Eventia_eventos_${new Date().toISOString().slice(0,10)}.csv`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),60_000)
}
