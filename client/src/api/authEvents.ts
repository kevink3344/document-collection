const AUTH_EXPIRED_EVENT = 'dcp-auth-expired'

export function authHeaders(): HeadersInit {
  const token = localStorage.getItem('dcp-token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export function handleUnauthorizedResponse(res: Response): void {
  if (res.status !== 401) return

  localStorage.removeItem('dcp-user')
  localStorage.removeItem('dcp-token')
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

export { AUTH_EXPIRED_EVENT }