const BASE = '/api/settings'

export async function getPublicSetting(key: string): Promise<string> {
  const res = await fetch(`${BASE}/${key}`)
  if (!res.ok) throw new Error('Failed to load setting')
  const data = await res.json() as { value: string }
  return data.value
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const token = localStorage.getItem('dcp-token')
  const res = await fetch(`${BASE}/${key}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Failed to save setting')
  }
}
