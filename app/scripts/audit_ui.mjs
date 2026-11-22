import fs from 'fs';
import path from 'path';

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!full.includes('node_modules') && !full.includes('dist')) {
        results = results.concat(getFiles(full));
      }
    } else if (/\.(jsx|js|tsx|ts)$/.test(file)) {
      results.push(full);
    }
  }
  return results;
}

const root = '/home/administrator/web/alpha-trading-platform/tp-research/app/src';
const allFiles = getFiles(root);
const compFiles = allFiles.filter(f => f.includes('/components') || f.includes('/ui/'));

console.log('=== Component Usage Inventory ===');
for (const comp of compFiles) {
  if (comp.includes('__tests__')) continue;
  const rel = path.relative(root, comp);
  const name = path.basename(comp, path.extname(comp));
  let refs = [];
  for (const f of allFiles) {
    if (f === comp) continue;
    const content = fs.readFileSync(f, 'utf8');
    // Look for import or usage
    if (content.includes(name)) {
      refs.push(path.relative(root, f));
    }
  }
  console.log(`${rel} [${name}]: ${refs.length} refs -> ${refs.slice(0, 3).join(', ')}${refs.length > 3 ? '...' : ''}`);
}

console.log('\n=== Features Inventory ===');
const featureFiles = fs.readdirSync(path.join(root, 'features'));
for (const f of featureFiles) {
  const full = path.join(root, 'features', f);
  const stat = fs.statSync(full);
  const name = f.replace(/\.(jsx|js)$/, '');
  let refs = [];
  for (const other of allFiles) {
    if (other === full) continue;
    const content = fs.readFileSync(other, 'utf8');
    if (content.includes(name)) {
      refs.push(path.relative(root, other));
    }
  }
  console.log(`${stat.isDirectory() ? '[DIR]' : '[FILE]'} features/${f}: ${refs.length} refs -> ${refs.slice(0, 2).join(', ')}`);
}
