'use client'

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-bold mb-2">Нещо се обърка</h2>
        <p className="text-muted-foreground mb-4">{error.message || 'Неочаквана грешка'}</p>
        <button
          onClick={reset}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          Опитай отново
        </button>
      </div>
    </div>
  )
}
