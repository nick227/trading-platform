import fs from 'fs';
import path from 'path';

const stylesDir = '/home/administrator/web/alpha-trading-platform/tp-research/app/src/styles';
const cssFiles = fs.readdirSync(stylesDir).filter(f => f.endsWith('.css'));

console.log('=== CSS Files Size & Token Usage ===');
for (const file of cssFiles) {
  const content = fs.readFileSync(path.join(stylesDir, file), 'utf8');
  const lines = content.split('\n').length;
  const varUsages = (content.match(/var\(--[^)]+\)/g) || []).length;
  const hardcodedHex = (content.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  const hardcodedRgb = (content.match(/rgba?\([^)]+\)/g) || []).length;
  console.log(`${file.padEnd(20)}: ${lines} lines, ${varUsages} var() calls, ${hardcodedHex} hex colors, ${hardcodedRgb} rgb() colors`);
}

const tokensDir = path.join(stylesDir, 'tokens');
if (fs.existsSync(tokensDir)) {
  console.log('\n=== Token Definitions in styles/tokens ===');
  for (const f of fs.readdirSync(tokensDir)) {
    console.log(`--- ${f} ---`);
    console.log(fs.readFileSync(path.join(tokensDir, f), 'utf8').trim());
  }
}
