/**
 * Centralized route handler wrapper to eliminate repetitive try-catch blocks
 */
export const route = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply)
  } catch (error) {
    req.log.error({ err: error }, 'Route handler failed')

    const candidateStatus =
      (Number.isInteger(error?.statusCode) && error.statusCode) ||
      (Number.isInteger(error?.status) && error.status) ||
      500
    const status = candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500

    reply.code(status)
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
