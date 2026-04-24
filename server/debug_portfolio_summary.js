import prisma from './src/loaders/prisma.js';
import { STUB_USER_ID } from './src/utils/auth.js';

async function debugPortfolioSummary() {
  console.log('🔍 Debugging Portfolio Summary API Logic');
  console.log('=======================================');
  
  const userId = STUB_USER_ID;
  console.log('User ID:', userId);
  
  // Get user's executions (same as API)
  const executions = await prisma.execution.findMany({
    where: {
      userId,
      status: 'filled',
      filledAt: { not: null }
    },
    orderBy: { filledAt: 'desc' }
  });
  
  console.log('Executions found:', executions.length);
  
  executions.forEach((exec, index) => {
    console.log(`${index + 1}. ${exec.id}`);
    console.log(`   Status: ${exec.status}`);
    console.log(`   PnL: $${exec.pnl}`);
    console.log(`   Filled: ${exec.filledAt}`);
    console.log(`   Ticker: ${exec.ticker}`);
    console.log('');
  });
  
  // Check TradeMetricFact records for this user
  const facts = await prisma.tradeMetricFact.findMany({
    where: {
      userId
    },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log('TradeMetricFact records for user:', facts.length);
  
  facts.forEach((fact, index) => {
    console.log(`${index + 1}. ${fact.id}`);
    console.log(`   Execution: ${fact.sourceExecutionId}`);
    console.log(`   PnL: $${fact.pnl}`);
    console.log(`   Processed: ${fact.processed}`);
    console.log('');
  });
  
  // Check if all executions have corresponding facts
  const executionIds = executions.map(e => e.id);
  const factExecutionIds = facts.map(f => f.sourceExecutionId);
  
  const missingFacts = executionIds.filter(id => !factExecutionIds.includes(id));
  const extraFacts = factExecutionIds.filter(id => !executionIds.includes(id));
  
  console.log('Executions without TradeMetricFact:', missingFacts.length);
  if (missingFacts.length > 0) {
    console.log('Missing:', missingFacts);
  }
  
  console.log('TradeMetricFact without matching execution:', extraFacts.length);
  if (extraFacts.length > 0) {
    console.log('Extra:', extraFacts);
  }
  
  await prisma.$disconnect();
}

debugPortfolioSummary().catch(console.error);
