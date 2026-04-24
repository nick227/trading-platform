import prisma from './src/loaders/prisma.js';

async function investigateDiscrepancy() {
  console.log('🔍 Investigating TradeMetricFact vs API Summary Discrepancy');
  console.log('========================================================');
  
  // Get all TradeMetricFact records
  const facts = await prisma.tradeMetricFact.findMany({
    orderBy: { createdAt: 'desc' }
  });
  
  console.log('Total TradeMetricFact records:', facts.length);
  
  facts.forEach((fact, index) => {
    console.log(`${index + 1}. ID: ${fact.id}`);
    console.log(`   Execution: ${fact.sourceExecutionId}`);
    console.log(`   User: ${fact.userId}`);
    console.log(`   PnL: $${fact.pnl}`);
    console.log(`   Processed: ${fact.processed}`);
    console.log(`   Created: ${fact.createdAt}`);
    console.log('');
  });
  
  // Check for processed flags
  const processed = facts.filter(f => f.processed);
  const unprocessed = facts.filter(f => !f.processed);
  
  console.log('Processed records:', processed.length);
  console.log('Unprocessed records:', unprocessed.length);
  
  if (unprocessed.length > 0) {
    console.log('Unprocessed record IDs:', unprocessed.map(f => f.id));
  }
  
  // Check for duplicates by execution ID
  const executionGroups = {};
  facts.forEach(fact => {
    const execId = fact.sourceExecutionId;
    if (!executionGroups[execId]) {
      executionGroups[execId] = [];
    }
    executionGroups[execId].push(fact);
  });
  
  console.log('Execution ID groups:');
  Object.entries(executionGroups).forEach(([execId, records]) => {
    console.log(`  ${execId}: ${records.length} records`);
    records.forEach(r => console.log(`    - ${r.id} (${r.processed ? 'processed' : 'unprocessed'})`));
  });
  
  await prisma.$disconnect();
}

investigateDiscrepancy().catch(console.error);
