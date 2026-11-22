export async function makeThumbnail(source: Blob, maxEdge = 560): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(source)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return source
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob || source), 'image/jpeg', 0.82))
  } catch {
    return source
  }
}
