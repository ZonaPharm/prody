// src/components/ui/header.tsx

'use client'

import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SwitchRoleButton } from '@/components/admin/switch-role-button'

interface HeaderProps {
  title?: string
  showRoleSwitch?: boolean
  onMenuClick?: () => void
}

export function Header({ title, showRoleSwitch, onMenuClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-white px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden -ml-2"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Меню</span>
      </Button>

      <span className="font-bold text-lg tracking-tight">Prody</span>

      {title && (
        <span className="text-sm text-muted-foreground hidden sm:block">/ {title}</span>
      )}

      <div className="flex-1" />

      {showRoleSwitch && <SwitchRoleButton />}
    </header>
  )
}
