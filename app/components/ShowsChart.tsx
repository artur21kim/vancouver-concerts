'use client'

import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export default function ShowsChart({ data }: { data: any[] }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div style={{ width: '100%', height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Loading chart...
    </div>
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis 
        dataKey="year" 
       angle={-45} 
        textAnchor="end" 
        height={60}
        />
        <YAxis />
        <Tooltip />
        <Bar dataKey="show_count" fill="#3b82f6" />
      </BarChart>
    </ResponsiveContainer>
  )
}