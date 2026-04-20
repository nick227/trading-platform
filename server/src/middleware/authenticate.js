import prisma from '../loaders/prisma.js'

export async function authenticate(request, reply) {
  try {
    // Debug: Log cookie presence
    console.log('Auth middleware - cookies:', request.cookies)
    console.log('Auth middleware - headers:', Object.keys(request.headers))
    
    await request.jwtVerify()
    console.log('Auth middleware - JWT verified, user ID:', request.user.sub)
    
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      include: { subscription: true }
    })
    
    if (!user) {
      console.log('Auth middleware - User not found:', request.user.sub)
      return reply.code(401).send({ error: 'User not found' })
    }
    
    if (user.subscription?.status !== 'ACTIVE') {
      console.log('Auth middleware - Inactive subscription:', user.subscription?.status)
      return reply.code(401).send({ error: 'Subscription not active' })
    }
    
    console.log('Auth middleware - Success for user:', user.email)
    request.user = user
  } catch (error) {
    console.log('Auth middleware - Error:', error.message)
    return reply.code(401).send({ error: 'Authentication failed' })
  }
}
