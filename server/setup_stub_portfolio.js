import prisma from './src/loaders/prisma.js';
import { STUB_USER_ID } from './src/utils/auth.js';

async function setupStubPortfolio() {
  console.log('🔧 Setting up Stub User Portfolio');
  console.log('=================================');
  
  try {
    // Check if portfolio exists
    let portfolio = await prisma.portfolio.findFirst({
      where: { userId: STUB_USER_ID }
    });
    
    if (!portfolio) {
      console.log('Creating portfolio for stub user...');
      portfolio = await prisma.portfolio.create({
        data: {
          id: 'prt_stub_demo_' + Date.now(),
          userId: STUB_USER_ID,
          name: 'Demo Portfolio',
          cashBalance: 10000,
          totalValue: 10000
        }
      });
      console.log('✅ Created portfolio:', portfolio.id);
    } else {
      console.log('✅ Portfolio already exists:', portfolio.id);
    }
    
    console.log(`   Cash Balance: $${portfolio.cashBalance}`);
    console.log(`   Total Value: $${portfolio.totalValue}`);
    
  } catch (error) {
    console.error('❌ Error setting up portfolio:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupStubPortfolio();
