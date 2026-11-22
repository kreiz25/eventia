import type { EventRecord, CategoryRecord } from '../types'

type PDFEvent = EventRecord & { category: CategoryRecord }
const enc = new TextEncoder()
const pageW = 595.28
const pageH = 841.89
const margin = 48

function hexColor(value: string) {
  const hex = value.replace('#','')
  const n = Number.parseInt(hex.length === 3 ? hex.split('').map(v=>v+v).join('') : hex, 16)
  return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255] as const
}
function colorText(hex:string){return hexColor(hex).map(v=>v.toFixed(3)).join(' ')}
function cp1252(value:string):number {
  const c=value.codePointAt(0)??63
  if(c<=0xff)return c
  const special:Record<number,number>={0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f}
  return special[c]??63
}
function literal(value:string) {
  let result=''
  for(const char of value){const byte=cp1252(char);if(char==='('||char===')'||char==='\\')result+='\\'+char;else if(byte<32||byte>126)result+='\\'+byte.toString(8).padStart(3,'0');else result+=String.fromCharCode(byte)}
  return result
}
function wrap(text:string,max:number) {
  const words=text.replace(/\s+/g,' ').trim().split(' ')
  const lines:string[]=[];let line=''
  for(const word of words){if(!word)continue;if(line&&line.length+word.length+1>max){lines.push(line);line=word}else line+=(line?' ':'')+word}
  if(line)lines.push(line)
  return lines
}
function textCmd(text:string,size:number,x:number,y:number,color='#24232B',font='F1') {
  return `BT /${font} ${size} Tf ${colorText(color)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${literal(text)}) Tj ET\n`
}
function lineCmd(x1:number,y1:number,x2:number,y2:number,color='#E8E2DA',width=1) {
  return `${colorText(color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`
}
function rectCmd(x:number,y:number,w:number,h:number,color:string) {
  return `${colorText(color)} rg ${x} ${y} ${w} ${h} re f\n`
}
async function jpegCover(blob:Blob,width:number,height:number):Promise<{bytes:Uint8Array;width:number;height:number}|undefined> {
  try {
    const bitmap=await createImageBitmap(blob)
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const context=canvas.getContext('2d');if(!context){bitmap.close();return}
    const scale=Math.max(width/bitmap.width,height/bitmap.height)
    const sw=width/scale,sh=height/scale,sx=(bitmap.width-sw)/2,sy=(bitmap.height-sh)/2
    context.drawImage(bitmap,sx,sy,sw,sh,0,0,width,height);bitmap.close()
    const jpeg=await new Promise<Blob|undefined>(resolve=>canvas.toBlob(blob=>resolve(blob||undefined),'image/jpeg',0.88))
    if(!jpeg)return
    return {bytes:new Uint8Array(await jpeg.arrayBuffer()),width,height}
  } catch { return }
}
function joinBytes(parts:Uint8Array[]) {
  const length=parts.reduce((n,p)=>n+p.length,0),all=new Uint8Array(length);let offset=0
  for(const part of parts){all.set(part,offset);offset+=part.length}
  return all
}

export async function generateEventPDF(event:PDFEvent,includeNotes=false):Promise<File> {
  const cover=event.cover?await jpegCover(event.cover,900,500):undefined
  const pageContents:string[]=[]
  let current=''
  let y=pageH-margin
  const newPage=()=>{
    if(current)pageContents.push(current)
    current='';y=pageH-margin
    current+=textCmd('EVENTIA',16,margin,y,'#FF5B45')
    current+=textCmd('FICHA DO EVENTO',8,pageW-margin-100,y+4,'#89848D')
    y-=24;current+=lineCmd(margin,y,pageW-margin,y)
    y-=26
  }
  current+=textCmd('EVENTIA',18,margin,y,'#FF5B45')
  current+=textCmd('PLANS POR VIVIR',8,pageW-margin-100,y+4,'#89848D')
  y-=26
  const posterY=y-255,posterX=margin,posterW=pageW-2*margin,posterH=255
  current+=rectCmd(posterX,posterY,posterW,posterH,event.category.color)
  if(cover)current+=`q ${posterW} 0 0 ${posterH} ${posterX} ${posterY} cm /Im0 Do Q\n`
  else {
    current+=rectCmd(posterX,posterY,posterW,posterH,event.category.color)
    current+=textCmd(event.category.name.toLocaleUpperCase('gl'),9,posterX+22,posterY+posterH-32,'#FFFFFF')
    const titleLines=wrap(event.title,28).slice(0,3)
    let ty=posterY+posterH-88
    for(const ln of titleLines){current+=textCmd(ln,26,posterX+22,ty,'#FFFFFF');ty-=32}
    current+=textCmd(`${event.startDate}${event.startTime?` · ${event.startTime}`:''}`,10,posterX+22,posterY+22,'#FFFFFF')
  }
  y=posterY-30
  current+=textCmd(event.title,23,margin,y,'#24232B');y-=22
  current+=textCmd(event.category.name.toLocaleUpperCase('gl'),8,margin,y,event.category.color);y-=22
  const endDate=event.endDate?` — ${event.endDate}${event.endTime?` · ${event.endTime}`:''}`:''
  current+=textCmd(`Data: ${event.startDate}${event.startTime?` · ${event.startTime}`:''}${endDate}`,10,margin,y);y-=17
  const location=[event.venue,event.address,event.city].filter(Boolean).join(', ')
  if(location){current+=textCmd('LUGAR',8,margin,y,'#89848D');y-=14;for(const l of wrap(location,88)){current+=textCmd(l,10,margin,y);y-=14}}
  if(event.latitude!==undefined&&event.longitude!==undefined) {
    current+=textCmd(`Coordenadas: ${event.latitude}, ${event.longitude}`,9,margin,y,'#5F5963');y-=15
  }
  if(location||event.latitude!==undefined&&event.longitude!==undefined){const maps=event.latitude!==undefined&&event.longitude!==undefined?`https://maps.apple.com/?q=${event.latitude},${event.longitude}`:`https://maps.apple.com/?q=${encodeURIComponent(location)}`;current+=textCmd(`Mapas: ${maps}`,8,margin,y,'#21A7A1');y-=15}
  if(event.link){current+=textCmd(`Ligazón: ${event.link}`,8,margin,y,'#21A7A1');y-=15}
  if(event.description){y-=3;current+=textCmd('DESCRICIÓN',8,margin,y,'#89848D');y-=14;for(const l of wrap(event.description,88)){if(y<60){newPage()}current+=textCmd(l,10,margin,y);y-=14}}
  if(includeNotes&&event.notes){y-=4;current+=textCmd('NOTAS PERSOAIS',8,margin,y,'#89848D');y-=14;for(const l of wrap(event.notes,88)){if(y<60){newPage()}current+=textCmd(l,10,margin,y);y-=14}}
  if(event.companions){y-=4;current+=textCmd(`Acompañantes: ${event.companions}`,9,margin,y);y-=15}
  if(event.price){current+=textCmd(`Prezo: ${event.price}`,9,margin,y);y-=15}
  if(y<42)newPage()
  current+=lineCmd(margin,34,pageW-margin,34,'#E8E2DA',0.7)
  current+=textCmd('Xerado localmente con EVENTIA',7,margin,22,'#89848D')
  pageContents.push(current)

  const objectParts:Uint8Array[]=[]
  const addObject=(id:number,body:Uint8Array)=>{objectParts[id]=joinBytes([enc.encode(`${id} 0 obj\n`),body,enc.encode('\nendobj\n')])}
  const fontId=3,imageId=cover?4:0,nextId=cover?5:4
  addObject(1,enc.encode('<< /Type /Catalog /Pages 2 0 R >>'))
  const pageObjectIds=pageContents.map((_,i)=>nextId+i*2)
  addObject(2,enc.encode(`<< /Type /Pages /Count ${pageContents.length} /Kids [${pageObjectIds.map(id=>`${id} 0 R`).join(' ')}] >>`))
  addObject(fontId,enc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  if(cover) {
    const prefix=enc.encode(`<< /Type /XObject /Subtype /Image /Width ${cover.width} /Height ${cover.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${cover.bytes.length} >>\nstream\n`)
    const suffix=enc.encode('\nendstream')
    addObject(imageId,joinBytes([prefix,cover.bytes,suffix]))
  }
  pageContents.forEach((content,index)=>{
    const pageId=pageObjectIds[index],contentId=pageId+1
    const imageResource=cover?' /XObject << /Im0 4 0 R >>':''
    addObject(pageId,enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${fontId} 0 R >>${imageResource} >> /Contents ${contentId} 0 R >>`))
    const bytes=enc.encode(content)
    addObject(contentId,joinBytes([enc.encode(`<< /Length ${bytes.length} >>\nstream\n`),bytes,enc.encode('endstream')]))
  })
  const header=new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10])
  const parts:Uint8Array<ArrayBufferLike>[]=[header];let offset=header.length;const offsets=[0]
  for(let id=1;id<objectParts.length;id++){offsets[id]=offset;parts.push(objectParts[id]);offset+=objectParts[id].length}
  const xrefOffset=offset
  let xref=`xref\n0 ${objectParts.length}\n0000000000 65535 f \n`
  for(let id=1;id<objectParts.length;id++)xref+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`
  xref+=`trailer\n<< /Size ${objectParts.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  parts.push(enc.encode(xref))
  const safe=event.title.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'evento'
  const bytes=joinBytes(parts)
  return new File([bytes.buffer as ArrayBuffer],`Eventia_${safe}.pdf`,{type:'application/pdf'})
}

export async function shareEventPDF(file:File):Promise<'shared'|'downloaded'|'cancelled'> {
  if(navigator.canShare?.({files:[file]})&&navigator.share) {
    try { await navigator.share({files:[file],title:file.name});return 'shared' }
    catch(error) { if(error instanceof DOMException&&error.name==='AbortError')return 'cancelled' }
  }
  const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),60_000)
  return 'downloaded'
}
