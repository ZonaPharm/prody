// Returns today's date in YYYY-MM-DD for Europe/Sofia timezone
// Use this instead of new Date().toISOString().split('T')[0]
export function sofiaToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' })
}

// Returns a date N days ago in YYYY-MM-DD for Europe/Sofia timezone
export function sofiaDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400000)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' })
}
