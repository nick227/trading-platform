/**
 * Centralized route handler wrapper to eliminate repetitive try-catch blocks
 */
export const route = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply)
  } catch (error) {
    req.log.error({ err: error }, 'Route handler failed')
    reply.code(500)
    return { success: false, error: error.message }
  }
}

/**
 * Route wrapper for endpoints that should not hard-fail (e.g., legacy services)
 */
export const softRoute = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply)
  } catch (error) {
    req.log.warn({ err: error }, 'Route handler failed (soft failure)')
    return {
      success: true,
      data: {},
      degraded: true,
      degradedReason: 'SERVICE_UNREACHABLE',
      error: error.message
    }
  }
}
