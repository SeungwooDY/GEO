// Browser downloads. JSZip is loaded on demand so it isn't in the main bundle.

const MIME = { text: 'text/plain', xml: 'application/xml', html: 'text/html', markdown: 'text/markdown' }

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadFile(file) {
  saveBlob(new Blob([file.content], { type: `${MIME[file.kind] ?? 'text/plain'};charset=utf-8` }), file.name)
}

export async function downloadZip(files, siteName = 'site') {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.content)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const slug = siteName.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'site'
  saveBlob(blob, `aperture-${slug}-files.zip`)
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
