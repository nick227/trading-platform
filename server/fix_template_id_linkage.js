import prisma from './src/loaders/prisma.js';
import metricsService from './src/services/metricsService.js';

async function fixTemplateIdLinkage() {
  console.log('🔧 Fixing TemplateId Linkage in TradeMetricFact');
  console.log('=============================================');
  
  try {
    // Find all executions that should have templateId populated
    const executions = await prisma.execution.findMany({
      where: {
        sourceType: 'TEMPLATE',
        sourceId: 'template_test_123'
      },
      select: {
        id: true,
        botId: true,
        userId: true,
        pnl: true,
        sourceType: true,
        sourceId: true,
        ticker: true,
        direction: true,
        quantity: true,
        price: true,
        filledPrice: true,
        filledAt: true,
        submittedAt: true
      }
    });
    
    console.log(`\n📊 Found ${executions.length} executions to reprocess:`);
    console.log('================================================');
    
    // Delete existing TradeMetricFacts for these executions
    for (const exec of executions) {
      const deleted = await prisma.tradeMetricFact.deleteMany({
        where: { sourceExecutionId: exec.id }
      });
      console.log(`🗑️  Deleted ${deleted.count} existing facts for execution: ${exec.id}`);
    }
    
    // Reprocess each execution with the fixed MetricsService
    for (const exec of executions) {
      try {
        await metricsService.processExecutionFill(exec);
        console.log(`✅ Reprocessed execution: ${exec.id} ($${exec.pnl})`);
      } catch (error) {
        console.error(`❌ Failed to reprocess ${exec.id}:`, error.message);
      }
    }
    
    // Verify the fix worked
    console.log('\n\n🔍 Verifying TemplateId Linkage Fix:');
    console.log('=======================================');
    
    const facts = await prisma.tradeMetricFact.findMany({
      where: { 
        sourceType: 'TEMPLATE',
        sourceId: 'template_test_123'
      },
      select: {
        id: true,
        templateId: true,
        sourceExecutionId: true,
        pnl: true,
        sourceType: true,
        sourceId: true
      }
    });
    
    console.log(`\n📊 Found ${facts.length} TradeMetricFact records after fix:`);
    console.log('================================================================');
    
    facts.forEach((fact, index) => {
      console.log(`\n🔹 Record ${index + 1}:`);
      console.log(`   ID: ${fact.id}`);
      console.log(`   TemplateId: ${fact.templateId || 'STILL NULL - FIX FAILED!'}`);
      console.log(`   SourceExecutionId: ${fact.sourceExecutionId}`);
      console.log(`   PnL: $${fact.pnl}`);
      console.log(`   SourceType: ${fact.sourceType}`);
      console.log(`   SourceId: ${fact.sourceId}`);
    });
    
    // Test the template metrics API
    console.log('\n\n🌐 Testing Template Metrics API:');
    console.log('===================================');
    
    try {
      const response = await fetch(`http://localhost:3001/api/metrics/templates/template_test_123`);
      const apiData = await response.json();
      
      console.log('✅ Template Metrics API Response:');
      console.log(`   Template ID: ${apiData.templateId}`);
      console.log(`   Total Trades: ${apiData.metrics?.totalTrades || 'N/A'}`);
      console.log(`   Win Rate: ${apiData.metrics?.winRate ? apiData.metrics.winRate.toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Total PnL: $${apiData.metrics?.totalPnl || 'N/A'}`);
      console.log(`   Data Quality: ${apiData.dataQuality || 'N/A'}`);
      
      if (apiData.message) {
        console.log(`   Message: ${apiData.message}`);
      }
      
    } catch (error) {
      console.error('❌ Template Metrics API failed:', error.message);
    }
    
    console.log('\n🎉 TemplateId linkage fix complete!');
    
  } catch (error) {
    console.error('❌ Error fixing template linkage:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixTemplateIdLinkage();
