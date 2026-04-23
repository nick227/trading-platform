import prisma from './src/loaders/prisma.js';

prisma.templateMetricCurrent.findMany().then(metrics => {
  console.log('Template metrics found:', metrics.length);
  metrics.forEach(m => console.log(`- ${m.templateId}: ${m.totalTrades} trades, $${m.totalPnl} PnL`));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
