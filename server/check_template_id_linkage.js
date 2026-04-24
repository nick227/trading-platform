import prisma from './src/loaders/prisma.js';

async function checkTemplateIdLinkage() {
  console.log('🔍 Checking TemplateId Linkage in TradeMetricFact');
  console.log('================================================');
  
  try {
    // Check all TradeMetricFacts for our template
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
        sourceId: true,
        userId: true
      }
    });
    
    console.log(`\n📊 Found ${facts.length} TradeMetricFact records for template_test_123:`);
    console.log('================================================================');
    
    facts.forEach((fact, index) => {
      console.log(`\n🔹 Record ${index + 1}:`);
      console.log(`   ID: ${fact.id}`);
      console.log(`   TemplateId: ${fact.templateId || 'NULL - THIS IS THE PROBLEM!'}`);
      console.log(`   SourceExecutionId: ${fact.sourceExecutionId}`);
      console.log(`   PnL: $${fact.pnl}`);
      console.log(`   SourceType: ${fact.sourceType}`);
      console.log(`   SourceId: ${fact.sourceId}`);
      console.log(`   UserId: ${fact.userId}`);
    });
    
    // Also check the executions to see their botId linkage
    console.log('\n\n🔍 Checking Executions for template_test_123:');
    console.log('================================================');
    
    const executions = await prisma.execution.findMany({
      where: {
        sourceType: 'TEMPLATE',
        sourceId: 'template_test_123'
      },
      select: {
        id: true,
        botId: true,
        templateId: true,
        pnl: true,
        sourceType: true,
        sourceId: true
      }
    });
    
    console.log(`\n📊 Found ${executions.length} Execution records for template_test_123:`);
    console.log('================================================================');
    
    executions.forEach((exec, index) => {
      console.log(`\n🔹 Execution ${index + 1}:`);
      console.log(`   ID: ${exec.id}`);
      console.log(`   BotId: ${exec.botId}`);
      console.log(`   TemplateId: ${exec.templateId || 'NULL (executions dont have this field)'}`);
      console.log(`   PnL: $${exec.pnl}`);
      console.log(`   SourceType: ${exec.sourceType}`);
      console.log(`   SourceId: ${exec.sourceId}`);
    });
    
    // Check the bot to see its templateId
    console.log('\n\n🔍 Checking Bot linkage:');
    console.log('================================================');
    
    const bot = await prisma.bot.findFirst({
      where: {
        templateId: 'template_test_123'
      },
      select: {
        id: true,
        templateId: true,
        userId: true,
        name: true
      }
    });
    
    if (bot) {
      console.log(`\n🤖 Found Bot:`);
      console.log(`   ID: ${bot.id}`);
      console.log(`   TemplateId: ${bot.templateId}`);
      console.log(`   UserId: ${bot.userId}`);
      console.log(`   Name: ${bot.name}`);
    } else {
      console.log('\n❌ No bot found with templateId = template_test_123');
    }
    
    // Summary
    console.log('\n\n📋 SUMMARY:');
    console.log('===========');
    if (facts.length === 0) {
      console.log('❌ No TradeMetricFacts found - pipeline never ran');
    } else {
      const nullTemplateIds = facts.filter(f => !f.templateId).length;
      if (nullTemplateIds > 0) {
        console.log(`❌ ISSUE: ${nullTemplateIds}/${facts.length} TradeMetricFacts have NULL templateId`);
        console.log('🔧 Root cause: MetricsService.processExecutionFill not looking up bot.templateId');
      } else {
        console.log('✅ All TradeMetricFacts have templateId populated');
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking template linkage:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTemplateIdLinkage();
