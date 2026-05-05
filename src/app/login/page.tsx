'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const LoginForm = dynamic(() => import('./login-form'), { ssr: false })

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50"><p className="text-slate-400">Зареждане...</p></div>}>
      <LoginForm />
    </Suspense>
  )
}
