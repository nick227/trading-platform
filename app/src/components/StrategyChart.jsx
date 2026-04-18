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

// Strategy chart will accept real data props
const defaultData = {
  dates: [],
  strategyReturns: [],
  dowReturns: [],
  predictions: []
}

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
  labels: defaultData.dates,
  datasets: [
    {
      label: 'Alpha Engine Strategy',
      data: defaultData.strategyReturns,
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
      data: defaultData.dowReturns,
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

// Add prediction points as a separate dataset (empty for now)
const predictionData = []

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
        {defaultData.predictions.map((pred, index) => {
          const xPosition = defaultData.dates.length > 1 
            ? (pred.x / (defaultData.dates.length - 1)) * 100 
            : 50
          const yPosition = defaultData.strategyReturns.length > 0 
            ? ((100000 - pred.y) / (Math.max(...defaultData.strategyReturns) - Math.min(...defaultData.strategyReturns))) * 100
            : 50
          
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
