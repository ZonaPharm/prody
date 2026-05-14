const TZ = 'Europe/Sofia'

// Returns today's date in YYYY-MM-DD for Europe/Sofia timezone
export function sofiaToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
}

// Returns a date N days ago in YYYY-MM-DD for Europe/Sofia timezone
export function sofiaDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400000)
  return d.toLocaleDateString('sv-SE', { timeZone: TZ })
}

// Format a date/time in Sofia timezone
export function sofiaTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('bg-BG', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

export function sofiaDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('bg-BG', { timeZone: TZ })
}

export function sofiaDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('bg-BG', { timeZone: TZ })
}
