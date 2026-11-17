'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

export function SalesChart({ data }: { data: { date: string; amount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v} €`} />
        <Tooltip
          formatter={(value: any) => [`${Number(value).toFixed(0)} €`, 'Продажби']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
        />
        <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function truncateName(name: string, max: number = 20): string {
  return name.length > max ? name.slice(0, max) + '...' : name
}

const STORE_COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899']

export function StoreSalesChart({ data, stores }: { data: any[]; stores: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v} €`} />
        <Tooltip
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
        />
        {stores.map((store, i) => (
          <Bar
            key={store}
            dataKey={store}
            fill={STORE_COLORS[i % STORE_COLORS.length]}
            radius={[4, 4, 0, 0]}
            name={store}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TopProductsChart({ data }: { data: { name: string; amount: number }[] }) {
  // A list with a bar under each name: the full name stays readable on a phone,
  // where a chart axis would leave no room for the bars.
  const sorted = [...data].sort((a, b) => b.amount - a.amount)
  const max = Math.max(1, ...sorted.map(d => d.amount))
  return (
    <ol className="space-y-2.5">
      {sorted.map((d, i) => (
        <li key={d.name} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate"><span className="mr-1.5 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>{d.name}</span>
            <span className="shrink-0 font-semibold tabular-nums">{Number(d.amount).toFixed(0)} €</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(d.amount / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}
