import prisma from './src/loaders/prisma.js';
import metricsService from './src/services/metricsService.js';

async function createTestExecution() {
  try {
    // Create a test manual execution (simulating a filled trade)
    const execution = await prisma.execution.create({
      data: {
        id: 'exec_test_verify_' + Date.now(),
        userId: 'usr_stub_demo',
        portfolioId: 'prt_1776746938510_660fa2e4',
        ticker: 'AAPL',
        direction: 'buy',
        quantity: 10,
        price: 150.00,
        filledPrice: 150.50,
        filledQuantity: 10,
        filledAt: new Date(),
        status: 'filled',
        origin: 'manual',
        commission: 1.00,
        fees: 0.50,
        pnl: 5.00, // Small profit: (150.50 - 150.00) * 10 - 1.00 - 0.50 = 5.00
        sourceType: 'MANUAL',
        sourceId: null,
        isManual: true
      }
    });

    console.log('✅ Created test execution:', execution.id);
    console.log('   Details:', {
      ticker: execution.ticker,
      direction: execution.direction,
      quantity: execution.quantity,
      filledPrice: execution.filledPrice,
      pnl: execution.pnl,
      sourceType: execution.sourceType
    });

    // Test metrics processing
    console.log('🔄 Processing metrics for execution...');
    await metricsService.processExecutionFill(execution);
    console.log('✅ Metrics processing completed');

    // Check if TradeMetricFact was created
    const tradeFact = await prisma.tradeMetricFact.findFirst({
      where: { sourceExecutionId: execution.id }
    });

    if (tradeFact) {
      console.log('✅ TradeMetricFact created:', {
        date: tradeFact.date,
        sourceType: tradeFact.sourceType,
        pnl: tradeFact.pnl,
        isWin: tradeFact.isWin
      });
    } else {
      console.log('❌ TradeMetricFact not found - metrics processing may have failed');
    }

    return execution;
  } catch (error) {
    console.error('❌ Error creating test execution:', error);
    throw error;
  }
}

createTestExecution()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
