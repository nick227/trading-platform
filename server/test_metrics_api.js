// Metrics API Smoke Test
import http from 'http';

const BASE_URL = 'http://localhost:3001';

async function testEndpoint(path, description) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`✅ ${description}`);
        console.log(`   Status: ${res.statusCode}`);
        console.log(`   Response: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`);
        console.log('');
        resolve({ path, status: res.statusCode, success: res.statusCode === 200 });
      });
    });
    req.on('error', (err) => {
      console.log(`❌ ${description}`);
      console.log(`   Error: ${err.message}`);
      console.log('');
      resolve({ path, status: 0, success: false, error: err.message });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      console.log(`❌ ${description}`);
      console.log(`   Error: Timeout`);
      console.log('');
      resolve({ path, status: 0, success: false, error: 'Timeout' });
    });
  });
}

async function runTests() {
  console.log('🚀 Metrics API Smoke Test');
  console.log('========================');
  console.log('');

  const tests = [
    ['/api/metrics/portfolio/summary', 'Portfolio Summary'],
    ['/api/metrics/portfolio/attribution', 'Portfolio Attribution'],
    ['/api/metrics/templates/tmpl_momentum_buy', 'Template Metrics (Non-existent)']
  ];

  const results = [];
  for (const [path, desc] of tests) {
    const result = await testEndpoint(path, desc);
    results.push(result);
  }

  console.log('📊 Test Results Summary');
  console.log('=======================');
  const passed = results.filter(r => r.success).length;
  const failed = results.length - passed;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / results.length) * 100)}%`);
  
  if (failed > 0) {
    console.log('');
    console.log('❌ Failed Tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.path}: ${r.error || 'HTTP ' + r.status}`);
    });
  }
}

runTests().catch(console.error);
