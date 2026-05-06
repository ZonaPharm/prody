'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']

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

export function TopProductsChart({ data }: { data: { name: string; amount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
          dataKey="amount"
          nameKey="name"
          label={({ name }: any) => (name || '').length > 15 ? (name || '').slice(0, 15) + '...' : (name || '')}
          labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: any) => [`${Number(value).toFixed(0)} €`, 'Общо']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
