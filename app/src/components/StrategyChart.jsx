import { useMemo } from 'react'
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
import { useAlphaSignals } from '../hooks/useAlphaEngine.js'

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

// Generate mock historical data for demonstration
function generateMockData(alphaSignals = []) {
  const dates = []
  const strategyReturns = []
  const dowReturns = []
  const predictions = []
  
  // Generate 30 days of historical data
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    dates.push(date.toLocaleDateString())
    
    // Mock strategy returns (starting at 100k)
    const baseReturn = 100000 + (Math.random() - 0.3) * 5000 + (29 - i) * 200
    strategyReturns.push(baseReturn)
    
    // Mock DOW returns (benchmark)
    const dowReturn = 100000 + (Math.random() - 0.4) * 3000 + (29 - i) * 150
    dowReturns.push(dowReturn)
  }
  
  // Add alpha engine signals as predictions
  alphaSignals.forEach((signal, index) => {
    if (index < 5) { // Limit to 5 most recent signals
      const dayIndex = Math.max(0, dates.length - 1 - index * 2)
      predictions.push({
        x: dayIndex,
        y: strategyReturns[dayIndex] || 100000,
        type: signal.type,
        symbol: signal.symbol,
        confidence: signal.confidence,
        score: signal.score,
        reasons: signal.reasons
      })
    }
  })
  
  return { dates, strategyReturns, dowReturns, predictions }
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
          const prediction = (context.chart._predictions || []).find(p => p.index === context.dataIndex)
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

export default function StrategyChart() {
  const { signals, loading, error } = useAlphaSignals({ refreshInterval: 30000 })
  
  // Generate chart data with alpha engine signals
  const chartData = useMemo(() => {
    const data = generateMockData(signals)
    
    return {
      labels: data.dates,
      datasets: [
        {
          label: 'Alpha Engine Strategy',
          data: data.strategyReturns,
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
          data: data.dowReturns,
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
  }, [signals])
  
  // Update tooltip callback to use current predictions
  const updatedChartOptions = useMemo(() => ({
    ...chartOptions,
    plugins: {
      ...chartOptions.plugins,
      tooltip: {
        ...chartOptions.plugins.tooltip,
        callbacks: {
          afterLabel: function(context) {
            const data = generateMockData(signals)
            const prediction = data.predictions.find(p => p.index === context.dataIndex)
            if (prediction) {
              return [
                `**${prediction.type}**: ${prediction.symbol}`,
                `Confidence: ${(prediction.confidence * 100).toFixed(0)}%`,
                `Score: ${prediction.score.toFixed(2)}`,
                ...prediction.reasons.slice(0, 2)
              ]
            }
            return ''
          }
        }
      }
    }
  }), [signals])
  
  if (error) {
    return (
      <div style={{ 
        width: '100%', 
        height: '400px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '8px',
        color: '#dc2626'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
            Alpha Engine Connection Error
          </div>
          <div style={{ fontSize: '14px' }}>
            {error}
          </div>
        </div>
      </div>
    )
  }
  
  if (loading) {
    return (
      <div style={{ 
        width: '100%', 
        height: '400px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: '#666'
      }}>
        Loading Alpha Engine data...
      </div>
    )
  }
  
  const currentData = generateMockData(signals)
  
  return (
    <div style={{ width: '100%', height: '400px', position: 'relative' }}>
      <Line data={chartData} options={updatedChartOptions} />
      
      {/* Alpha Engine Signal Markers */}
      <div style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        pointerEvents: 'none',
        zIndex: 10
      }}>
        {currentData.predictions.map((pred, index) => {
          const xPosition = currentData.dates.length > 1 
            ? (pred.x / (currentData.dates.length - 1)) * 100 
            : 50
          const yPosition = currentData.strategyReturns.length > 0 
            ? ((100000 - pred.y) / (Math.max(...currentData.strategyReturns) - Math.min(...currentData.strategyReturns))) * 100
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
              title={`${pred.type}: ${pred.symbol} - Confidence: ${(pred.confidence * 100).toFixed(0)}% - Score: ${pred.score.toFixed(2)}`}
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
      
      {/* Alpha Engine Status Indicator */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 600,
        color: signals.length > 0 ? '#1f8a4c' : '#666',
        zIndex: 20
      }}>
        {signals.length > 0 ? `${signals.length} Active Signals` : 'No Active Signals'}
      </div>
    </div>
  )
}
