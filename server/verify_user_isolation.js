import prisma from './src/loaders/prisma.js';

async function verifyUserIsolation() {
  console.log('🔍 Verifying User Isolation');
  console.log('==========================');
  
  try {
    const users = ['usr_test_user_1', 'usr_test_user_2', 'usr_stub_demo'];
    
    for (const userId of users) {
      console.log(`\n👤 User: ${userId}`);
      
      // Check executions
      const executions = await prisma.execution.findMany({
        where: { userId },
        select: { id: true, pnl: true, ticker: true }
      });
      
      console.log(`   Executions: ${executions.length}`);
      executions.forEach(e => console.log(`     - ${e.id}: ${e.ticker} $${e.pnl}`));
      
      // Check TradeMetricFacts
      const facts = await prisma.tradeMetricFact.findMany({
        where: { userId },
        select: { id: true, sourceExecutionId: true, pnl: true, ticker: true }
      });
      
      console.log(`   TradeMetricFacts: ${facts.length}`);
      facts.forEach(f => console.log(`     - ${f.id}: ${f.ticker} $${f.pnl} -> ${f.sourceExecutionId}`));
      
      // Verify 1:1 mapping
      const executionIds = executions.map(e => e.id);
      const factExecutionIds = facts.map(f => f.sourceExecutionId);
      
      const missingFacts = executionIds.filter(id => !factExecutionIds.includes(id));
      const extraFacts = factExecutionIds.filter(id => !executionIds.includes(id));
      
      if (missingFacts.length === 0 && extraFacts.length === 0) {
        console.log(`   ✅ Perfect 1:1 execution-to-fact mapping`);
      } else {
        console.log(`   ❌ Mapping issues - Missing: ${missingFacts.length}, Extra: ${extraFacts.length}`);
      }
      
      // Check for cross-user contamination
      const otherUserFacts = await prisma.tradeMetricFact.findMany({
        where: { userId: { not: userId } }
      });
      
      const crossContamination = facts.some(fact => 
        otherUserFacts.some(other => fact.sourceExecutionId === other.sourceExecutionId)
      );
      
      if (crossContamination) {
        console.log(`   ❌ CROSS-CONTAMINATION DETECTED`);
      } else {
        console.log(`   ✅ No cross-user contamination`);
      }
    }
    
    // Summary
    console.log('\n📊 Isolation Summary:');
    let totalIssues = 0;
    
    for (const userId of users) {
      const executions = await prisma.execution.findMany({ where: { userId } });
      const facts = await prisma.tradeMetricFact.findMany({ where: { userId } });
      
      const hasIssues = executions.length !== facts.length;
      if (hasIssues) totalIssues++;
      
      console.log(`   ${userId}: ${executions.length} executions, ${facts.length} facts ${hasIssues ? '❌' : '✅'}`);
    }
    
    if (totalIssues === 0) {
      console.log('\n✅ USER ISOLATION WORKING PERFECTLY');
    } else {
      console.log(`\n❌ ${totalIssues} users have isolation issues`);
    }
    
  } catch (error) {
    console.error('❌ Error verifying isolation:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyUserIsolation();
