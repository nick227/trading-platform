import prisma from './src/loaders/prisma.js';
import { STUB_USER_ID } from './src/utils/auth.js';

async function createLosingTrade() {
  console.log('🔴 Creating Losing Trade Test');
  console.log('=============================');
  
  try {
    // Get existing portfolio
    const portfolio = await prisma.portfolio.findFirst({
      where: { userId: STUB_USER_ID }
    });
    
    if (!portfolio) {
      console.error('❌ No portfolio found for user');
      return;
    }
    
    console.log('Using portfolio:', portfolio.id);
    
    // Create a losing execution
    const execution = await prisma.execution.create({
      data: {
        id: 'exec_losing_' + Date.now(),
        userId: STUB_USER_ID,
        portfolioId: portfolio.id,
        ticker: 'TSLA',
        direction: 'buy',
        quantity: 10,
        price: 200.00, // Entry price
        filledPrice: 185.00, // Exit price (loss)
        filledQuantity: 10,
        status: 'filled',
        pnl: -150.00, // $15 loss per share * 10 shares
        filledAt: new Date(),
        submittedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
        sourceType: 'MANUAL',
        isManual: true,
        commission: 0.00,
        fees: 0.00
      }
    });
    
    console.log('✅ Created losing execution:', execution.id);
    console.log(`   PnL: $${execution.pnl} (loss)`);
    console.log(`   Entry: $${execution.price}`);
    console.log(`   Exit: $${execution.filledPrice}`);
    
    // Process metrics for this execution
    const metricsService = await import('./src/services/metricsService.js');
    
    await metricsService.default.processExecutionFill(execution);
    console.log('✅ Processed metrics for losing trade');
    
    // Check updated portfolio summary
    const response = await fetch('http://localhost:3001/api/metrics/portfolio/summary');
    const summary = await response.json();
    
    console.log('\n📊 Updated Portfolio Summary:');
    console.log(`   Total PnL: $${summary.totalPnl}`);
    console.log(`   Win Rate: ${summary.winRate}%`);
    console.log(`   Total Trades: ${summary.totalTrades}`);
    
    // Verify the loss is reflected
    if (summary.totalPnl < 10) { // Should be less than previous $10
      console.log('✅ Losing trade correctly reflected in portfolio metrics');
    } else {
      console.log('❌ Losing trade NOT reflected in portfolio metrics');
    }
    
  } catch (error) {
    console.error('❌ Error creating losing trade:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createLosingTrade();
