
/** Bounded user research instructions; no tool permissions or execution authority. */
export class ResearchPartnerInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ResearchPartnerInputError'
    this.statusCode = 400
  }
}
const fail = field => { throw new ResearchPartnerInputError('Invalid research partner field: ' + field) }
function record(v, field) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(field)
  return v
}
function keys(v, allowed, field) {
  for (const key of Object.keys(v)) if (!allowed.includes(key)) fail(field + '.' + key)
}
function text(v, field, max) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(field)
  return v.trim()
}
function list(v, field, maxItems, maxChars) {
  if (!Array.isArray(v) || v.length > maxItems) fail(field)
  const values = v.map(item => text(item, field, maxChars))
  if (new Set(values.map(s => s.toLowerCase())).size !== values.length) fail(field + '.duplicates')
  return values
}
export const validatePartnerName = v => text(v, 'name', 120)
export const validateResearchQuestion = v => text(v, 'question', 6000)
export function validateMandate(value) {
  const data = record(value, 'mandate')
  keys(data, ['objective', 'interests', 'watchlist', 'hypotheses', 'preferences', 'exclusions'], 'mandate')
  const pref = record(data.preferences, 'preferences')
  keys(pref, ['horizon', 'researchDepth'], 'preferences')
  if (!['short', 'medium', 'long'].includes(pref.horizon)) fail('preferences.horizon')
  if (!['brief', 'standard', 'deep'].includes(pref.researchDepth)) fail('preferences.researchDepth')
  const watchlist = list(data.watchlist, 'watchlist', 40, 16).map(s => s.toUpperCase())
  if (watchlist.some(s => !/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(s))) fail('watchlist.symbol')
  return Object.freeze({
    objective: text(data.objective, 'objective', 2000),
    interests: list(data.interests, 'interests', 30, 120),
    watchlist,
    hypotheses: list(data.hypotheses, 'hypotheses', 20, 600),
    preferences: Object.freeze({ horizon: pref.horizon, researchDepth: pref.researchDepth }),
    exclusions: list(data.exclusions, 'exclusions', 30, 120)
  })
}
export function defaultMandate(objective) {
  return validateMandate({
    objective, interests: [], watchlist: [], hypotheses: [],
    preferences: { horizon: 'medium', researchDepth: 'standard' },
    exclusions: []
  })
}
