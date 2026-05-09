// src/components/ui/header.tsx

'use client'

import Image from 'next/image'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SwitchRoleButton } from '@/components/admin/switch-role-button'

interface HeaderProps {
  onMenuClick?: () => void
  sticky?: boolean
}

export function Header({ onMenuClick, sticky = true }: HeaderProps) {
  return (
    <header className={`${sticky ? 'sticky top-0 z-40' : ''} flex h-14 items-center gap-4 border-b bg-white px-4 lg:px-6`}>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden -ml-2"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Меню</span>
      </Button>

      <Image
        src="/logo.png"
        alt="Prody"
        width={100}
        height={21}
        className="h-14 w-auto"
        priority
      />

      <div className="flex-1" />
    </header>
  )
}
