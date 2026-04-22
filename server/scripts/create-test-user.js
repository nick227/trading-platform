import bcrypt from 'bcryptjs'
import prisma from '../src/loaders/prisma.js'

async function createTestUser() {
  try {
    const email = 'test@example.com'
    const password = 'testpassword123'
    const fullName = 'Test User'

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      console.log('Test user already exists:', email)
      return existing
    }

    // Create test user
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        subscription: {
          create: {
            status: 'ACTIVE',
            plan: 'BASIC',
            endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
          }
        }
      }
    })

    // Create test portfolio
    await prisma.portfolio.create({
      data: {
        id: 'prt_test_demo',
        name: 'Test Portfolio',
        userId: user.id
      }
    })

    console.log('Test user created successfully:')
    console.log('Email:', email)
    console.log('Password:', password)
    console.log('User ID:', user.id)
    
    return user
  } catch (error) {
    console.error('Error creating test user:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

createTestUser()
