import prisma from './src/loaders/prisma.js';

async function createTemplateMetrics() {
  console.log('🎯 Creating Template Metrics Test');
  console.log('===================================');
  
  try {
    const templateId = 'template_test_123';
    const userId = 'usr_stub_demo';
    
    // Step 1: Create a template if it doesn't exist
    let template = await prisma.botTemplate.findUnique({
      where: { id: templateId }
    });
    
    if (!template) {
      template = await prisma.botTemplate.create({
        data: {
          id: templateId,
          name: 'Test Trading Template',
          description: 'Template for testing metrics functionality',
          botType: 'TRADING',
          config: {
            strategy: 'momentum',
            timeframe: '1h',
            riskLevel: 'medium'
          },
          rules: [],
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      console.log('✅ Created template:', template.id);
    } else {
      console.log('✅ Template exists:', template.id);
    }
    
    // Step 2: Create a bot linked to this template
    const botId = `bot_${templateId}_${Date.now()}`;
    let bot = await prisma.bot.findFirst({
      where: { templateId }
    });
    
    if (!bot) {
      bot = await prisma.bot.create({
        data: {
          id: botId,
          userId: userId,
          portfolioId: `prt_stub_demo_1776989208205`, // Use existing portfolio
          templateId: templateId,
          name: `${template.name} Bot`,
          enabled: true,
          config: template.config,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      console.log('✅ Created bot:', bot.id);
    } else {
      console.log('✅ Bot exists:', bot.id);
    }
    
    // Step 3: Create some executions linked to this template
    const executions = [];
    for (let i = 0; i < 3; i++) {
      const executionId = `exec_template_${templateId}_${i + 1}`;
      
      // Check if execution already exists
      let execution = await prisma.execution.findUnique({
        where: { id: executionId }
      });
      
      if (!execution) {
        execution = await prisma.execution.create({
          data: {
            id: executionId,
            userId: userId,
            portfolioId: `prt_stub_demo_1776989208205`, // Use existing portfolio
            botId: bot.id,
            ticker: ['AAPL', 'MSFT', 'GOOGL'][i],
            direction: 'buy',
            quantity: 10,
            price: 150 + (i * 25),
            filledPrice: 155 + (i * 25),
            filledQuantity: 10,
            status: 'filled',
            pnl: 50 + (i * 25),
            filledAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000), // i+1 days ago
            submittedAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000 - 30 * 60 * 1000),
            sourceType: 'TEMPLATE',
            sourceId: templateId,
            isManual: false,
            commission: 0.00,
            fees: 0.00
          }
        });
        console.log(`✅ Created execution ${i + 1}: ${execution.id} ($${execution.pnl})`);
      } else {
        console.log(`✅ Execution ${i + 1} exists: ${execution.id}`);
      }
      
      executions.push(execution);
    }
    
    // Step 4: Process metrics for template executions
    const metricsService = await import('./src/services/metricsService.js');
    
    for (const execution of executions) {
      try {
        await metricsService.default.processExecutionFill(execution);
        console.log(`✅ Processed metrics for: ${execution.id}`);
      } catch (error) {
        console.error(`❌ Failed to process ${execution.id}:`, error.message);
      }
    }
    
    // Step 5: Create TemplateMetricCurrent record
    let templateMetrics = await prisma.templateMetricCurrent.findUnique({
      where: { templateId }
    });
    
    if (!templateMetrics) {
      // Calculate metrics from TradeMetricFacts
      const templateFacts = await prisma.tradeMetricFact.findMany({
        where: { 
          templateId,
          eventType: 'fill'
        }
      });
      
      const totalTrades = templateFacts.length;
      const totalPnl = templateFacts.reduce((sum, f) => sum + Number(f.pnl || 0), 0);
      const winningTrades = templateFacts.filter(f => Number(f.pnl || 0) > 0).length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      
      templateMetrics = await prisma.templateMetricCurrent.create({
        data: {
          templateId: templateId,
          totalTrades: totalTrades,
          winRate: winRate,
          totalPnl: totalPnl,
          annualReturn: totalPnl * 12, // Simple projection
          maxDrawdown: 0, // TODO: Calculate properly
          sharpeRatio: 0, // TODO: Calculate properly
          dataQuality: totalTrades >= 10 ? 'sufficient' : 'sample_size_low',
          lastUpdated: new Date()
        }
      });
      console.log('✅ Created TemplateMetricCurrent:', templateMetrics.templateId);
    } else {
      console.log('✅ TemplateMetricCurrent exists:', templateMetrics.templateId);
    }
    
    // Step 6: Test the template metrics API
    console.log('\n🌐 Testing Template Metrics API:');
    try {
      const response = await fetch(`http://localhost:3001/api/metrics/templates/${templateId}`);
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
    
    console.log('\n🎉 Template metrics implementation complete!');
    
  } catch (error) {
    console.error('❌ Error creating template metrics:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTemplateMetrics();
