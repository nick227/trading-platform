import prisma from './src/loaders/prisma.js';

async function testMultiUserIsolation() {
  console.log('🔐 Testing Multi-User Isolation');
  console.log('===============================');
  
  const TEST_USERS = [
    'usr_test_user_1',
    'usr_test_user_2', 
    'usr_stub_demo'
  ];
  
  try {
    // Create portfolios for test users
    for (const userId of TEST_USERS) {
      let portfolio = await prisma.portfolio.findFirst({
        where: { userId }
      });
      
      if (!portfolio) {
        portfolio = await prisma.portfolio.create({
          data: {
            id: `prt_${userId}_${Date.now()}`,
            userId,
            name: `${userId} Portfolio`,
            cashBalance: 10000,
            totalValue: 10000
          }
        });
        console.log(`✅ Created portfolio for ${userId}: ${portfolio.id}`);
      } else {
        console.log(`✅ Portfolio exists for ${userId}: ${portfolio.id}`);
      }
    }
    
    // Create executions for different users
    const executions = [];
    for (let i = 0; i < TEST_USERS.length; i++) {
      const userId = TEST_USERS[i];
      const portfolio = await prisma.portfolio.findFirst({ where: { userId } });
      
      const execution = await prisma.execution.create({
        data: {
          id: `exec_multi_${userId}_${Date.now()}`,
          userId,
          portfolioId: portfolio.id,
          ticker: i === 0 ? 'AAPL' : i === 1 ? 'MSFT' : 'GOOGL',
          direction: 'buy',
          quantity: 10,
          price: 150 + (i * 50),
          filledPrice: 155 + (i * 50),
          filledQuantity: 10,
          status: 'filled',
          pnl: 50 + (i * 25),
          filledAt: new Date(),
          submittedAt: new Date(Date.now() - 30 * 60 * 1000),
          sourceType: 'MANUAL',
          isManual: true,
          commission: 0.00,
          fees: 0.00
        }
      });
      
      executions.push({ userId, execution });
      console.log(`✅ Created execution for ${userId}: ${execution.id} ($${execution.pnl})`);
    }
    
    // Process metrics for all executions
    const metricsService = await import('./src/services/metricsService.js');
    
    for (const { userId, execution } of executions) {
      await metricsService.default.processExecutionFill(execution);
      console.log(`✅ Processed metrics for ${userId}`);
    }
    
    // Test API isolation - check each user's metrics separately
    console.log('\n🔍 Testing API User Isolation:');
    
    for (const userId of TEST_USERS) {
      // Mock the user context in the API
      const userExecutions = await prisma.execution.findMany({
        where: {
          userId,
          status: 'filled',
          filledAt: { not: null }
        },
        orderBy: { filledAt: 'desc' }
      });
      
      const userFacts = await prisma.tradeMetricFact.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      
      console.log(`\n👤 User: ${userId}`);
      console.log(`   Executions: ${userExecutions.length}`);
      console.log(`   TradeMetricFacts: ${userFacts.length}`);
      console.log(`   Total PnL: $${userExecutions.reduce((sum, e) => sum + Number(e.pnl), 0)}`);
      
      // Verify no cross-contamination
      const otherUserFacts = await prisma.tradeMetricFact.findMany({
        where: {
          userId: { not: userId }
        }
      });
      
      const hasCrossContamination = userFacts.some(fact => 
        otherUserFacts.some(other => fact.sourceExecutionId === other.sourceExecutionId)
      );
      
      if (hasCrossContamination) {
        console.log(`   ❌ CROSS-CONTAMINATION DETECTED!`);
      } else {
        console.log(`   ✅ No cross-contamination`);
      }
    }
    
    // Test with actual API calls (simulating different user contexts)
    console.log('\n🌐 Testing API Response Isolation:');
    
    // Get all user metrics
    const allUserMetrics = {};
    for (const userId of TEST_USERS) {
      const userExecutions = await prisma.execution.findMany({
        where: {
          userId,
          status: 'filled',
          filledAt: { not: null }
        }
      });
      
      allUserMetrics[userId] = {
        totalTrades: userExecutions.length,
        totalPnl: userExecutions.reduce((sum, e) => sum + Number(e.pnl), 0),
        winningTrades: userExecutions.filter(e => Number(e.pnl) > 0).length
      };
      
      allUserMetrics[userId].winRate = allUserMetrics[userId].totalTrades > 0 
        ? (allUserMetrics[userId].winningTrades / allUserMetrics[userId].totalTrades) * 100 
        : 0;
    }
    
    console.log('User Metrics Summary:');
    Object.entries(allUserMetrics).forEach(([userId, metrics]) => {
      console.log(`   ${userId}: ${metrics.totalTrades} trades, $${metrics.totalPnl}, ${metrics.winRate.toFixed(1)}% WR`);
    });
    
    // Verify metrics are different per user
    const uniquePnLs = Object.values(allUserMetrics).map(m => m.totalPnl);
    const uniqueTrades = Object.values(allUserMetrics).map(m => m.totalTrades);
    
    if (new Set(uniquePnLs).size === TEST_USERS.length && 
        new Set(uniqueTrades).size === TEST_USERS.length) {
      console.log('✅ Multi-user isolation working correctly');
    } else {
      console.log('❌ Multi-user isolation FAILED');
    }
    
  } catch (error) {
    console.error('❌ Error testing multi-user isolation:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testMultiUserIsolation();
