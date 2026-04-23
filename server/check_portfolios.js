import prisma from './src/loaders/prisma.js';

prisma.portfolio.findMany().then(portfolios => {
  console.log('Portfolios found:', portfolios.length);
  portfolios.forEach(p => console.log(`- ${p.id}: ${p.name} (user: ${p.userId})`));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
