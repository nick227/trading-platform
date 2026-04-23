import prisma from './src/loaders/prisma.js';

prisma.execution.findMany({
  where: { status: 'filled' },
  orderBy: { filledAt: 'desc' },
  take: 5
}).then(executions => {
  console.log('Recent filled executions:', executions.length);
  executions.forEach(e => {
    console.log(`- ${e.id}: ${e.ticker} ${e.direction} ${e.quantity} @ $${e.filledPrice || e.price}, PnL: $${e.pnl}`);
  });
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
