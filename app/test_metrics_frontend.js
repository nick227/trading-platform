// Frontend Metrics Integration Test
import http from 'http';

const FRONTEND_URL = 'http://localhost:5173';
const API_BASE = 'http://localhost:3001';

async function testFrontendIntegration() {
  console.log('🔗 Testing Frontend-Backend Integration');
  console.log('=====================================');
  console.log('');

  // Test 1: Verify frontend is accessible
  console.log('1. Testing frontend accessibility...');
  try {
    const response = await fetch(`${FRONTEND_URL}/`);
    console.log('✅ Frontend accessible:', response.status === 200 ? 'OK' : 'Failed');
  } catch (error) {
    console.log('❌ Frontend not accessible:', error.message);
    return;
  }

  // Test 2: Verify API endpoints work from frontend context
  console.log('\\n2. Testing API endpoints...');
  
  const endpoints = [
    '/api/metrics/portfolio/summary',
    '/api/metrics/portfolio/attribution'
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`);
      const data = await response.json();
      
      console.log(`✅ ${endpoint}:`, response.status === 200 ? 'Working' : 'Failed');
      if (response.status === 200) {
        console.log('   Sample data:', JSON.stringify(data).substring(0, 100) + '...');
      }
    } catch (error) {
      console.log(`❌ ${endpoint}:`, error.message);
    }
  }

  // Test 3: Verify CORS is working
  console.log('\\n3. Testing CORS configuration...');
  try {
    const response = await fetch(`${API_BASE}/api/metrics/portfolio/summary`, {
      method: 'OPTIONS',
      headers: {
        'Origin': FRONTEND_URL,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    const corsHeaders = {
      'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
      'access-control-allow-credentials': response.headers.get('access-control-allow-credentials')
    };
    
    console.log('✅ CORS Headers:', corsHeaders);
  } catch (error) {
    console.log('❌ CORS test failed:', error.message);
  }

  console.log('\\n📊 Frontend Integration Test Complete');
  console.log('===================================');
  console.log('Frontend URL:', FRONTEND_URL);
  console.log('Backend API:', API_BASE);
  console.log('\\nNext: Open browser to verify UI components display live data');
}

testFrontendIntegration().catch(console.error);
