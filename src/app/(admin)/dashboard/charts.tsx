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
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
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

export function TopProductsChart({ data }: { data: { name: string; amount: number }[] }) {
  // Horizontal bar chart — much easier to read than pie for product names
  const sorted = [...data].sort((a, b) => a.amount - b.amount)

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, sorted.length * 42)}>
      <BarChart data={sorted} layout="vertical" margin={{ left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v} €`} />
        <YAxis
          dataKey="name"
          type="category"
          width={170}
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => truncateName(v, 24)}
        />
        <Tooltip
          formatter={(value: any) => [`${Number(value).toFixed(0)} €`, 'Общо']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
        />
        <Bar dataKey="amount" fill="#22c55e" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
