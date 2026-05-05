/**
 * Converts a Google Docs/Sheets/Slides/Drive URL to its embeddable /preview form.
 * Non-Google URLs are returned unchanged.
 *
 * Examples:
 *   …/document/d/ID/edit       → …/document/d/ID/preview
 *   …/spreadsheets/d/ID/edit   → …/spreadsheets/d/ID/preview
 *   …/presentation/d/ID/edit   → …/presentation/d/ID/preview
 *   …/file/d/ID/view           → …/file/d/ID/preview
 */
export function toEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('google.com')) return url

    // Strip any query string and trailing slash, then replace the last segment
    const path = parsed.pathname.replace(/\/$/, '')
    const lastSegment = path.split('/').pop() ?? ''

    // If it's already /preview (or /embed for Sheets), leave it
    if (lastSegment === 'preview' || lastSegment === 'embed') return url

    // Replace known action segments; also handle bare IDs with no action segment
    const actionSegments = new Set(['edit', 'view', 'pub', 'copy', 'htmlview'])
    let newPath: string
    if (actionSegments.has(lastSegment)) {
      newPath = path.slice(0, path.lastIndexOf('/')) + '/preview'
    } else {
      newPath = path + '/preview'
    }

    parsed.pathname = newPath
    parsed.search = ''
    return parsed.toString()
  } catch {
    return url
  }
}
