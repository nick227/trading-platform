import { createContext, useContext, useReducer, useEffect } from 'react'
import executionsService from '../api/services/executionsService.js'
import predictionsService from '../api/services/predictionsService.js'
import portfoliosService from '../api/services/portfoliosService.js'
import strategiesService from '../api/services/strategiesService.js'

const AppCtx = createContext()

const initial = {
  assets: [],
  bots: [],
  orders: [],
  trades: [],
  executions: [],
  predictions: [],
  portfolios: [],
  strategies: [],
  selectedAsset: 'NVDA',
  selectedBotId: null,
  selectedOrderId: null,
  loading: false,
  error: null
}

function reducer(state, action){
  switch(action.type){
    case 'SELECT_ASSET':
      return { ...state, selectedAsset: action.payload }
    case 'SELECT_BOT':
      return { ...state, selectedBotId: action.payload }
    case 'SELECT_ORDER':
      return { ...state, selectedOrderId: action.payload }
    case 'SET_LOADING':
      return { ...state, loading: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'SET_EXECUTIONS':
      return { ...state, executions: action.payload }
    case 'SET_PREDICTIONS':
      return { ...state, predictions: action.payload }
    case 'SET_PORTFOLIOS':
      return { ...state, portfolios: action.payload }
    case 'SET_STRATEGIES':
      return { ...state, strategies: action.payload }
    case 'ADD_EXECUTION':
      return { ...state, executions: [action.payload, ...state.executions] }
    default:
      return state
  }
}

export function AppProvider({ children }){
  const [state, dispatch] = useReducer(reducer, initial)

  // Data fetching methods
  const fetchData = async () => {
    dispatch({ type: 'SET_LOADING', payload: true })
    try {
      const [executions, predictions, portfolios, strategies] = await Promise.all([
        executionsService.getAll(),
        predictionsService.getAll(),
        portfoliosService.getAll(),
        strategiesService.getAll()
      ])

      dispatch({ type: 'SET_EXECUTIONS', payload: executions })
      dispatch({ type: 'SET_PREDICTIONS', payload: predictions })
      dispatch({ type: 'SET_PORTFOLIOS', payload: portfolios })
      dispatch({ type: 'SET_STRATEGIES', payload: strategies })
      dispatch({ type: 'SET_ERROR', payload: null })
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error.message })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const createExecution = async (executionData) => {
    try {
      const execution = await executionsService.create(executionData)
      dispatch({ type: 'ADD_EXECUTION', payload: execution })
      return execution
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error.message })
      throw error
    }
  }

  // Initial data fetch
  useEffect(() => {
    fetchData()
  }, [])

  return (
    <AppCtx.Provider value={{ 
      state, 
      dispatch, 
      fetchData, 
      createExecution 
    }}>
      {children}
    </AppCtx.Provider>
  )
}

export const useApp = () => {
  const context = useContext(AppCtx)
  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}
