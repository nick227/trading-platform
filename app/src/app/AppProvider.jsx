import { createContext, useContext, useReducer } from 'react'

const AppCtx = createContext()

const initial = {
  selectedAsset:   'NVDA',
  selectedBotId:   null,
  selectedOrderId: null,
  // Timestamp set whenever an execution reaches FILLED status.
  // Subscribers (e.g. Portfolio) watch this to trigger cache invalidation.
  lastFilledAt: null,
}

function reducer(state, action){
  switch(action.type){
    case 'SELECT_ASSET':
      return { ...state, selectedAsset: action.payload }
    case 'SELECT_BOT':
      return { ...state, selectedBotId: action.payload }
    case 'SELECT_ORDER':
      return { ...state, selectedOrderId: action.payload }
    case 'ORDER_FILLED':
      return { ...state, lastFilledAt: action.payload ?? Date.now() }
    default:
      return state
  }
}

export function AppProvider({ children }){
  const [state, dispatch] = useReducer(reducer, initial)

  return (
    <AppCtx.Provider value={{ state, dispatch }}>
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
