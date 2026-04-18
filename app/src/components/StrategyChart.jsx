import React from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

// Mock data for strategy vs Dow comparison
const generateMockData = () => {
  const dates = []
  const strategyReturns = []
  const dowReturns = []
  const predictions = []
  
  // Generate 60 days of data
  let strategyValue = 100000
  let dowValue = 100000
  const today = new Date()
  
  for (let i = 59; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    dates.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    
    // Simulate strategy outperformance
    const dailyReturn = 0.0008 + (Math.random() - 0.5) * 0.02
    const dowDailyReturn = 0.0003 + (Math.random() - 0.5) * 0.015
    
    strategyValue *= (1 + dailyReturn)
    dowValue *= (1 + dowDailyReturn)
    
    strategyReturns.push(strategyValue)
    dowReturns.push(dowValue)
    
  }
  
  return { dates, strategyReturns, dowReturns, predictions }
}

const { dates, strategyReturns, dowReturns, predictions } = generateMockData()

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false,
  },
  plugins: {
    legend: {
      position: 'top',
      labels: {
        usePointStyle: true,
        padding: 20
      }
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      padding: 12,
      titleColor: '#fff',
      bodyColor: '#fff',
      borderColor: '#333',
      borderWidth: 1,
      displayColors: true,
      callbacks: {
        afterLabel: function(context) {
          const prediction = predictions.find(p => p.index === context.dataIndex)
          if (prediction) {
            return [
              `🎯 ${prediction.type}: ${prediction.symbol}`,
              `💰 Price: $${prediction.price.toFixed(2)}`,
              `🎲 Confidence: ${(prediction.confidence * 100).toFixed(0)}%`
            ]
          }
          return ''
        }
      }
    }
  },
  scales: {
    x: {
      grid: {
        display: false
      },
      ticks: {
        maxTicksLimit: 8
      }
    },
    y: {
      position: 'right',
      grid: {
        color: 'rgba(0, 0, 0, 0.05)'
      },
      ticks: {
        callback: function(value) {
          return '$' + (value / 1000).toFixed(0) + 'k'
        }
      }
    }
  }
}

const chartData = {
  labels: dates,
  datasets: [
    {
      label: 'Alpha Engine Strategy',
      data: strategyReturns,
      borderColor: '#1f8a4c',
      backgroundColor: 'rgba(31, 138, 76, 0.1)',
      borderWidth: 2,
      fill: true,
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 4
    },
    {
      label: 'DOW Jones Average',
      data: dowReturns,
      borderColor: '#7a7a7a',
      backgroundColor: 'rgba(122, 122, 122, 0.1)',
      borderWidth: 2,
      fill: false,
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderDash: [5, 5]
    }
  ]
}

// Add prediction points as a separate dataset
const predictionData = predictions.map(pred => ({
  x: pred.date,
  y: pred.price,
  type: pred.type,
  symbol: pred.symbol,
  confidence: pred.confidence
}))

export default function StrategyChart() {
  return (
    <div style={{ width: '100%', height: '400px', position: 'relative' }}>
      <Line data={chartData} options={chartOptions} />
      
      {/* Custom prediction markers */}
      <div style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        pointerEvents: 'none',
        zIndex: 10
      }}>
        {predictions.map((pred, index) => {
          const xPosition = (pred.index / (dates.length - 1)) * 100
          const yPosition = ((100000 - pred.price) / (Math.max(...strategyReturns) - Math.min(...strategyReturns))) * 100
          
          return (
            <div
              key={index}
              style={{
                position: 'absolute',
                left: `${xPosition}%`,
                top: `${yPosition}%`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'auto'
              }}
              title={`${pred.type}: ${pred.symbol} - Confidence: ${(pred.confidence * 100).toFixed(0)}%`}
            >
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: pred.type === 'ENTRY' ? '#1f8a4c' : '#c0392b',
                border: '2px solid white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                fontSize: '10px',
                fontWeight: 'bold',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}>
                {pred.type === 'ENTRY' ? 'E' : 'X'}
              </div>
            </div>
          )
        })}
      </div>
      
    </div>
  )
}
