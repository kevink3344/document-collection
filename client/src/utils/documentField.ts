import { toEmbedUrl } from './docPreviewUrl'

export type DocumentFieldKind = 'google_doc' | 'pdf'

export interface DocumentFieldConfig {
  kind: DocumentFieldKind
  url: string
}

export function parseDocumentFieldConfig(options?: string[] | null): DocumentFieldConfig {
  const [kindRaw, urlRaw] = options ?? []

  return {
    kind: kindRaw === 'pdf' ? 'pdf' : 'google_doc',
    url: String(urlRaw ?? '').trim(),
  }
}

export function serialiseDocumentFieldConfig(config: DocumentFieldConfig): string[] {
  const url = config.url.trim()
  return url ? [config.kind, url] : [config.kind]
}

export function isValidDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function getDocumentEmbedUrl(config: DocumentFieldConfig): string | null {
  if (!config.url || !isValidDocumentUrl(config.url)) {
    return null
  }

  return config.kind === 'google_doc' ? toEmbedUrl(config.url) : config.url
}