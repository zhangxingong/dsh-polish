/** Host/authority parsing helpers for the trust fence (official /api fence 同源移植)。 */

export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

export function parseAuthority(authority: string): { hostname: string; host: string } | undefined {
  try {
    const url = new URL(`http://${authority}`)
    return { hostname: url.hostname, host: url.host }
  } catch {
    return undefined
  }
}
