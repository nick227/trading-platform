import prisma from './src/loaders/prisma.js';

prisma.botTemplate.findMany().then(templates => {
  console.log('Templates found:', templates.length);
  templates.forEach(t => console.log(`- ${t.id}: ${t.name}`));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
