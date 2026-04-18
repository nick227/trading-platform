import { createContext, useContext, useReducer } from 'react'
import { mockAssets, mockBots, mockOrders, mockTrades } from '../mock/data'

const AppCtx = createContext()

const initial = {
  assets: mockAssets,
  bots: mockBots,
  orders: mockOrders,
  trades: mockTrades,
  selectedAsset: 'NVDA',
  selectedBotId: null,
  selectedOrderId: null
}

function reducer(state, action){
  switch(action.type){
    case 'SELECT_ASSET':
      return { ...state, selectedAsset: action.payload }
    case 'SELECT_BOT':
      return { ...state, selectedBotId: action.payload }
    case 'SELECT_ORDER':
      return { ...state, selectedOrderId: action.payload }
    default:
      return state
  }
}

export function AppProvider({ children }){
  const [state, dispatch] = useReducer(reducer, initial)
  return <AppCtx.Provider value={{state, dispatch}}>{children}</AppCtx.Provider>
}

export const useApp = ()=>useContext(AppCtx)
