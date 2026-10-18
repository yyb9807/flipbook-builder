/** Reference links are user content. Never turn another scheme or credentials into a link. */
export function safeReferenceUrl(value: string): string | null {
  if (!value || value.length > 2000 || /[\s\\]|\p{C}/u.test(value) || !/^https?:\/\//i.test(value)) return null
  const authority = value.match(/^https?:\/\/([^/?#]+)/i)?.[1]
  if (!authority || /[@%]/.test(authority)) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.port === '0') return null
    if (!url.hostname.startsWith('[')) {
      const hostname = url.hostname.replace(/\.$/, '')
      if (hostname.length > 253 || hostname.split('.').some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null
    }
    return url.href
  } catch { return null }
}
