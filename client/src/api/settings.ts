const BASE = '/api/settings'

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({})) as { error?: string; message?: string }
    if (typeof data.error === 'string' && data.error.trim()) return data.error
    if (typeof data.message === 'string' && data.message.trim()) return data.message
  } else {
    const text = await res.text().catch(() => '')
    if (text.trim()) return text.trim()
  }

  return `${fallback} (HTTP ${res.status})`
}

export async function getPublicSetting(key: string): Promise<string> {
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`)
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, 'Failed to load setting'))
  }
  const data = await res.json() as { value: string }
  return data.value
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const token = localStorage.getItem('dcp-token')
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, 'Failed to save setting'))
  }
}
