/**
 * Role-Based Access Control (RBAC) Middleware for Administrative Routes
 * 
 * Verifies that the authenticated user possesses an administrative role ('admin' or 'operator').
 * Rejects unauthorized users with 403 Forbidden and unauthenticated requests with 401 Unauthorized.
 */
import { authenticate } from './authenticate.js'

export async function requireAdmin(request, reply) {
  // Ensure user is authenticated first
  if (!request.user) {
    await authenticate(request, reply)
    if (reply.sent) return
  }

  const role = request.user?.role || 'user'
  if (role !== 'admin' && role !== 'operator') {
    request.log?.warn?.({ userId: request.user?.id, role }, 'admin_access_denied')
    return reply.code(403).send({
      error: 'Admin authorization required',
      code: 'FORBIDDEN'
    })
  }
}

/**
 * Higher-order middleware factory for specific allowed roles (e.g. ['admin']).
 */
export function requireRole(allowedRoles = ['admin']) {
  return async function roleGuard(request, reply) {
    if (!request.user) {
      await authenticate(request, reply)
      if (reply.sent) return
    }

    const userRole = request.user?.role || 'user'
    if (!allowedRoles.includes(userRole)) {
      request.log?.warn?.({ userId: request.user?.id, role: userRole, allowedRoles }, 'role_access_denied')
      return reply.code(403).send({
        error: `Requires one of roles: ${allowedRoles.join(', ')}`,
        code: 'FORBIDDEN'
      })
    }
  }
}
