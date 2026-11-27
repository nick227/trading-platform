// Presentation-only statuses. Server-side permissions are never inferred from these values.
export const AGENT_STATES = Object.freeze({
  needs_direction: ['Needs direction','Set a research objective to begin.','neutral'],
  ready: ['Ready to investigate','Awaiting a research question.','neutral'],
  question_saved: ['Ready for research','A question was saved; research has not started.','neutral'],
  investigating: ['Investigating','Research is in progress.','progress'],
  working: ['Processing request','An action is in progress.','progress'],
  findings_available: ['Findings available','Review the latest completed investigation.','success'],
  needs_attention: ['Needs attention','An action failed or requires review.','warning'],
  loading: ['Loading status','Checking recorded agent activity.','neutral'],
  unavailable: ['Status unavailable','Agent activity could not be loaded.','warning'],
  not_initialized: ['Awaiting initialization','No verified paper-trading activity is available.','neutral'],
  enabled: ['Paper mode enabled','Paper operations are permitted; this does not mean a job is running.','success'],
  paused: ['Paused','Paper trading is not currently enabled.','neutral']
})
export function researchAgentStatus({partner,selected,busy=false,error=''}={}) {
  if(error)return 'needs_attention'
  if(busy)return 'working'
  if(!partner)return 'needs_direction'
  if(selected?.status==='failed')return 'needs_attention'
  if(selected?.status==='completed'&&selected.report)return 'findings_available'
  if(selected?.status==='queued')return 'question_saved'
  return 'ready'
}
export function traderAgentStatus({requestStatus,dataStatus}={}) {
  if(requestStatus==='loading')return 'loading'
  if(requestStatus==='error')return 'unavailable'
  if(dataStatus==='enabled'||dataStatus==='paused')return dataStatus
  return 'not_initialized'
}
