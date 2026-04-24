import prisma from './src/loaders/prisma.js';

async function findMissingFact() {
  console.log('🔍 Finding Missing TradeMetricFact');
  console.log('===================================');
  
  try {
    const userId = 'usr_stub_demo';
    
    // Get all executions for stub user
    const executions = await prisma.execution.findMany({
      where: { userId },
      select: { id: true, pnl: true, ticker: true, filledAt: true },
      orderBy: { filledAt: 'desc' }
    });
    
    // Get all TradeMetricFacts for stub user
    const facts = await prisma.tradeMetricFact.findMany({
      where: { userId },
      select: { id: true, sourceExecutionId: true, pnl: true, ticker: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`\n👤 User: ${userId}`);
    console.log(`Executions: ${executions.length}`);
    console.log(`TradeMetricFacts: ${facts.length}`);
    
    console.log('\n📋 All Executions:');
    executions.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.ticker} $${e.pnl} (${e.filledAt})`);
    });
    
    console.log('\n📋 All TradeMetricFacts:');
    facts.forEach((f, i) => {
      console.log(`${i + 1}. ${f.id}: ${f.ticker} $${f.pnl} -> ${f.sourceExecutionId} (${f.createdAt})`);
    });
    
    // Find missing execution
    const executionIds = executions.map(e => e.id);
    const factExecutionIds = facts.map(f => f.sourceExecutionId);
    
    const missingFacts = executionIds.filter(id => !factExecutionIds.includes(id));
    
    if (missingFacts.length > 0) {
      console.log('\n❌ Missing TradeMetricFacts for executions:');
      missingFacts.forEach(id => {
        const exec = executions.find(e => e.id === id);
        console.log(`   - ${id}: ${exec.ticker} $${exec.pnl}`);
      });
      
      // Try to process the missing execution
      console.log('\n🔧 Attempting to process missing execution...');
      const missingExec = executions.find(e => e.id === missingFacts[0]);
      
      if (missingExec) {
        const metricsService = await import('./src/services/metricsService.js');
        await metricsService.default.processExecutionFill(missingExec);
        console.log('✅ Processed missing execution');
        
        // Verify it was created
        const updatedFacts = await prisma.tradeMetricFact.findMany({
          where: { userId },
          select: { id: true, sourceExecutionId: true }
        });
        
        console.log(`Updated TradeMetricFacts count: ${updatedFacts.length}`);
        
        if (updatedFacts.length === executions.length) {
          console.log('✅ All executions now have corresponding TradeMetricFacts');
        } else {
          console.log('❌ Still missing TradeMetricFacts');
        }
      }
    } else {
      console.log('\n✅ All executions have corresponding TradeMetricFacts');
    }
    
  } catch (error) {
    console.error('❌ Error finding missing fact:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findMissingFact();
