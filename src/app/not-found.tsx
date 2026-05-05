import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-bold mb-2">404 — Страницата не е намерена</h2>
        <p className="text-muted-foreground mb-4">Търсената страница не съществува.</p>
        <Link href="/" className="text-blue-600 hover:underline">
          Към началото
        </Link>
      </div>
    </div>
  )
}
