import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

// Dashboard.jsx と同じ月次データ形状・チャート構成での recharts v3 描画スモークテスト
// happy-dom では ResponsiveContainer がサイズ 0 になるため固定サイズで描画する
const monthlyData = [
  {
    month: '1月',
    forecastSales: 1200000,
    actualSales: 1150000,
    plannedCost: 300000,
    actualCost: 310000,
    plannedProfit: 900000,
    actualProfit: 840000,
    laborCostRatePlanned: 25,
    laborCostRateActual: 27,
  },
  {
    month: '2月',
    forecastSales: 1300000,
    actualSales: null,
    plannedCost: 320000,
    actualCost: null,
    plannedProfit: 980000,
    actualProfit: null,
    laborCostRatePlanned: 24.6,
    laborCostRateActual: null,
  },
]

describe('Dashboard charts (recharts v3 smoke test)', () => {
  it('renders the sales AreaChart with forecast and actual series', () => {
    const { container, getByText } = render(
      <AreaChart width={800} height={350} data={monthlyData}>
        <defs>
          <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" stroke="#64748b" />
        <YAxis tickFormatter={value => `¥${(value / 1000).toLocaleString()}k`} />
        <Tooltip formatter={value => `¥${value?.toLocaleString() || 0}`} />
        <Legend />
        <Area
          type="monotone"
          dataKey="forecastSales"
          stroke="#94a3b8"
          fill="url(#colorForecast)"
          name="予測売上"
        />
        <Area
          type="monotone"
          dataKey="actualSales"
          stroke="#475569"
          name="実績売上"
          connectNulls={false}
        />
      </AreaChart>
    )

    expect(container.querySelector('svg.recharts-surface')).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-area').length).toBe(2)
    expect(getByText('予測売上')).toBeInTheDocument()
    expect(getByText('実績売上')).toBeInTheDocument()
    expect(getByText('1月')).toBeInTheDocument()
  })

  it('renders the labor cost BarChart with planned and actual series', () => {
    const { container, getByText } = render(
      <BarChart width={800} height={350} data={monthlyData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" stroke="#64748b" />
        <YAxis tickFormatter={value => `¥${(value / 1000).toLocaleString()}k`} />
        <Tooltip formatter={value => `¥${value?.toLocaleString() || 0}`} />
        <Legend />
        <Bar dataKey="plannedCost" fill="#cbd5e1" name="計画人件費" radius={[4, 4, 0, 0]} />
        <Bar dataKey="actualCost" fill="#64748b" name="実績人件費" radius={[4, 4, 0, 0]} />
      </BarChart>
    )

    expect(container.querySelector('svg.recharts-surface')).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-bar').length).toBe(2)
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0)
    expect(getByText('計画人件費')).toBeInTheDocument()
    expect(getByText('実績人件費')).toBeInTheDocument()
  })

  it('renders the profit LineChart with null values (connectNulls=false)', () => {
    const { container, getByText } = render(
      <LineChart width={600} height={300} data={monthlyData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" stroke="#64748b" />
        <YAxis tickFormatter={value => `¥${(value / 1000).toLocaleString()}k`} />
        <Tooltip
          formatter={value => (value !== null ? `¥${value?.toLocaleString()}` : 'データなし')}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="plannedProfit"
          stroke="#94a3b8"
          name="計画利益"
          dot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="actualProfit"
          stroke="#475569"
          name="実績利益"
          dot={{ r: 4, fill: '#475569' }}
          connectNulls={false}
        />
      </LineChart>
    )

    expect(container.querySelector('svg.recharts-surface')).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-line').length).toBe(2)
    expect(getByText('計画利益')).toBeInTheDocument()
    expect(getByText('実績利益')).toBeInTheDocument()
  })
})
