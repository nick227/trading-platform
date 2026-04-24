import prisma from '../loaders/prisma.js';
import metricsService from '../services/metricsService.js';

export async function runBackfillReconciler() {
  console.log('🔧 Backfill Reconciler - Finding Missing TradeMetricFacts');
  console.log('========================================================');
  
  try {
    // Step 1: Find all filled executions that should have TradeMetricFacts
    const filledExecutions = await prisma.execution.findMany({
      where: {
        status: 'filled',
        filledAt: { not: null }
      },
      select: {
        id: true,
        userId: true,
        portfolioId: true,
        botId: true,
        ticker: true,
        direction: true,
        quantity: true,
        price: true,
        filledPrice: true,
        filledQuantity: true,
        pnl: true,
        sourceType: true,
        sourceId: true,
        isManual: true,
        commission: true,
        fees: true,
        filledAt: true,
        submittedAt: true
      }
    });
    
    console.log(`\n📊 Found ${filledExecutions.length} filled executions total`);
    
    // Step 2: Find all executions that already have TradeMetricFacts
    const existingFacts = await prisma.tradeMetricFact.findMany({
      where: {
        eventType: 'fill'
      },
      select: {
        sourceExecutionId: true
      }
    });
    
    const executionIdsWithFacts = new Set(existingFacts.map(f => f.sourceExecutionId));
    console.log(`📊 Found ${existingFacts.length} existing TradeMetricFacts`);
    
    // Step 3: Find executions missing TradeMetricFacts
    const missingExecutions = filledExecutions.filter(
      exec => !executionIdsWithFacts.has(exec.id)
    );
    
    console.log(`\n🎯 Found ${missingExecutions.length} executions missing TradeMetricFacts:`);
    console.log('================================================================');
    
    if (missingExecutions.length === 0) {
      console.log('✅ All executions have TradeMetricFacts - no backfill needed');
      return;
    }
    
    missingExecutions.forEach((exec, index) => {
      console.log(`🔹 ${index + 1}. ${exec.id}: ${exec.ticker} ${exec.direction} $${exec.pnl} (User: ${exec.userId || 'NULL'})`);
    });
    
    // Step 4: Attempt to reprocess missing executions
    console.log('\n🔄 Attempting to reprocess missing executions...');
    console.log('=====================================================');
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (const exec of missingExecutions) {
      try {
        await metricsService.processExecutionFill(exec);
        console.log(`✅ Reprocessed: ${exec.id} (${exec.ticker} ${exec.direction})`);
        successCount++;
      } catch (error) {
        if (error.message.includes('missing required userId') || error.message.includes('Missing userId')) {
          console.log(`⚠️  Skipped: ${exec.id} - missing userId (expected for losing trade)`);
          skipCount++;
        } else {
          console.error(`❌ Failed: ${exec.id} - ${error.message}`);
          errorCount++;
        }
      }
    }
    
    // Step 5: Verify results
    console.log('\n📋 Backfill Summary:');
    console.log('===================');
    console.log(`Total executions processed: ${missingExecutions.length}`);
    console.log(`✅ Successfully reprocessed: ${successCount}`);
    console.log(`⚠️  Skipped (missing userId): ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    
    // Step 6: Final verification - check for remaining gaps
    const finalCheck = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_executions,
        COUNT(DISTINCT tmf.sourceExecutionId) as executions_with_facts,
        COUNT(*) - COUNT(DISTINCT tmf.sourceExecutionId) as missing_facts
      FROM Execution e
      LEFT JOIN TradeMetricFact tmf ON e.id = tmf.sourceExecutionId 
      WHERE e.status = 'filled' AND e.filledAt IS NOT NULL
    `;
    
    const stats = finalCheck[0];
    console.log('\n🔍 Final Verification:');
    console.log('=====================');
    console.log(`Total filled executions: ${stats.total_executions}`);
    console.log(`Executions with TradeMetricFacts: ${stats.executions_with_facts}`);
    console.log(`Still missing facts: ${stats.missing_facts}`);
    
    if (stats.missing_facts === 0) {
      console.log('\n🎉 SUCCESS: All executions now have TradeMetricFacts!');
    } else {
      console.log(`\n⚠️  WARNING: ${stats.missing_facts} executions still missing TradeMetricFacts`);
      console.log('   These likely require manual intervention or userId fixes');
    }
    
  } catch (error) {
    console.error('❌ Backfill reconciler failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}
