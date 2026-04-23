import prisma from '../loaders/prisma.js'

export async function authenticate(request, reply) {
  try {
    request.log.info({
      hasAuthCookie: Boolean(request.cookies?.pr_token),
      cookieCount: Object.keys(request.cookies ?? {}).length
    }, 'auth_check_start')
    
    await request.jwtVerify()
    
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      include: { subscription: true }
    })
    
    if (!user) {
      request.log.warn('auth_user_not_found')
      return reply.code(401).send({ error: 'User not found' })
    }
    
    if (user.subscription?.status !== 'ACTIVE') {
      request.log.warn({ subscriptionStatus: user.subscription?.status ?? null }, 'auth_subscription_inactive')
      return reply.code(401).send({ error: 'Subscription not active' })
    }
    
    request.user = user
  } catch (error) {
    request.log.warn({ error: error.message }, 'auth_failed')
    return reply.code(401).send({ error: 'Authentication failed' })
  }
}
