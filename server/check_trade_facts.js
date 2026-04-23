import prisma from './src/loaders/prisma.js';

prisma.tradeMetricFact.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5
}).then(facts => {
  console.log('TradeMetricFact records:', facts.length);
  facts.forEach(f => {
    console.log(`- ${f.sourceExecutionId}: ${f.sourceType} ${f.ticker} ${f.direction}, PnL: $${f.pnl}, Win: ${f.isWin}`);
  });
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
