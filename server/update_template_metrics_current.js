import prisma from './src/loaders/prisma.js';

async function updateTemplateMetricsCurrent() {
  console.log('🔄 Updating TemplateMetricCurrent with Real Data');
  console.log('===============================================');
  
  try {
    const templateId = 'template_test_123';
    
    // Calculate metrics from TradeMetricFacts
    const templateFacts = await prisma.tradeMetricFact.findMany({
      where: { 
        templateId,
        eventType: 'fill'
      }
    });
    
    console.log(`\n📊 Found ${templateFacts.length} TradeMetricFacts for template ${templateId}:`);
    console.log('================================================================');
    
    templateFacts.forEach((fact, index) => {
      console.log(`🔹 Trade ${index + 1}: $${fact.pnl} (${fact.ticker} ${fact.direction})`);
    });
    
    const totalTrades = templateFacts.length;
    const totalPnl = templateFacts.reduce((sum, f) => sum + Number(f.pnl || 0), 0);
    const winningTrades = templateFacts.filter(f => Number(f.pnl || 0) > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    
    console.log(`\n📈 Calculated Metrics:`);
    console.log(`   Total Trades: ${totalTrades}`);
    console.log(`   Total PnL: $${totalPnl}`);
    console.log(`   Winning Trades: ${winningTrades}`);
    console.log(`   Win Rate: ${winRate.toFixed(1)}%`);
    
    // Update or create TemplateMetricCurrent record
    const existingMetrics = await prisma.templateMetricCurrent.findUnique({
      where: { templateId }
    });
    
    if (existingMetrics) {
      // Update existing record
      await prisma.templateMetricCurrent.update({
        where: { templateId },
        data: {
          totalTrades: totalTrades,
          winningTrades: winningTrades,
          totalPnl: totalPnl,
          winRate: winRate,
          annualReturn: 0, // TODO: Calculate properly based on time-weighted returns
          maxDrawdown: 0, // TODO: Calculate properly
          sharpeRatio: 0, // TODO: Calculate properly
          dataQuality: totalTrades >= 10 ? 'sufficient' : 'sample_size_low',
          lastUpdated: new Date()
        }
      });
      console.log(`\n✅ Updated existing TemplateMetricCurrent record`);
    } else {
      // Create new record
      await prisma.templateMetricCurrent.create({
        data: {
          templateId: templateId,
          totalTrades: totalTrades,
          winningTrades: winningTrades,
          totalPnl: totalPnl,
          winRate: winRate,
          annualReturn: 0, // TODO: Calculate properly based on time-weighted returns
          maxDrawdown: 0, // TODO: Calculate properly
          sharpeRatio: 0, // TODO: Calculate properly
          dataQuality: totalTrades >= 10 ? 'sufficient' : 'sample_size_low',
          lastUpdated: new Date()
        }
      });
      console.log(`\n✅ Created new TemplateMetricCurrent record`);
    }
    
    // Test the template metrics API
    console.log('\n\n🌐 Testing Template Metrics API:');
    console.log('===================================');
    
    try {
      const response = await fetch(`http://localhost:3001/api/metrics/templates/${templateId}`);
      const apiData = await response.json();
      
      console.log('✅ Template Metrics API Response:');
      console.log(`   Template ID: ${apiData.templateId}`);
      console.log(`   Total Trades: ${apiData.metrics?.totalTrades || 'N/A'}`);
      console.log(`   Win Rate: ${apiData.metrics?.winRate ? apiData.metrics.winRate.toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Total PnL: $${apiData.metrics?.totalPnl || 'N/A'}`);
      console.log(`   Annual Return: ${apiData.metrics?.annualReturn ? '$' + apiData.metrics.annualReturn : 'N/A'}`);
      console.log(`   Data Quality: ${apiData.dataQuality || 'N/A'}`);
      
      if (apiData.message) {
        console.log(`   Message: ${apiData.message}`);
      }
      
      // Success check
      if (apiData.metrics?.totalTrades === totalTrades && 
          apiData.metrics?.totalPnl === totalPnl &&
          apiData.metrics?.winRate === winRate) {
        console.log('\n🎉 SUCCESS: Template metrics API now returning real data!');
      } else {
        console.log('\n❌ ISSUE: API data does not match calculated metrics');
        console.log(`   Expected: ${totalTrades} trades, $${totalPnl} PnL, ${winRate.toFixed(1)}% WR`);
        console.log(`   Got: ${apiData.metrics?.totalTrades} trades, $${apiData.metrics?.totalPnl} PnL, ${apiData.metrics?.winRate}% WR`);
      }
      
    } catch (error) {
      console.error('❌ Template Metrics API failed:', error.message);
    }
    
    console.log('\n🎉 Template metrics update complete!');
    
  } catch (error) {
    console.error('❌ Error updating template metrics:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateTemplateMetricsCurrent();
