# Metrics Integration Guide

## Overview
This document outlines the unified metrics pipeline integration across the trading platform frontend and backend systems.

## API Endpoints

### Portfolio Summary
- **Endpoint**: `/api/metrics/portfolio/summary`
- **Method**: GET
- **Response**:
```json
{
  "portfolioReturn": 0.33333333333333337,
  "totalPnl": 10,
  "winRate": 100,
  "sharpeRatio": null,
  "maxDrawdown": null,
  "totalTrades": 2,
  "activeBots": 0,
  "lastUpdated": "2026-04-23T19:49:36.372Z"
}
```

### Portfolio Attribution
- **Endpoint**: `/api/metrics/portfolio/attribution`
- **Method**: GET
- **Response**:
```json
{
  "attribution": [
    {
      "name": "Manual Trades",
      "value": 100,
      "pnl": 10,
      "trades": 2,
      "winRate": 100
    }
  ],
  "totalReturn": 0,
  "hasUnknownData": false,
  "unknownPnl": 0,
  "message": null
}
```

### Template Metrics
- **Endpoint**: `/api/metrics/templates/:templateId`
- **Method**: GET
- **Response**: Template-specific performance metrics

## Frontend Integration Points

### 1. PortfolioHeader Component
- **File**: `app/src/features/portfolio/PortfolioHeader.jsx`
- **Purpose**: Displays portfolio-level metrics in the main header
- **API Calls**: `/api/metrics/portfolio/summary`
- **Display**: Portfolio PnL, Win Rate, Trade Count
- **Error Handling**: Graceful fallback to original stats

### 2. Asset Component - Personal Performance
- **File**: `app/src/features/Asset.jsx`
- **Purpose**: Shows user's personal performance for specific assets
- **API Calls**: `/api/metrics/portfolio/attribution`
- **Display**: PnL, Win Rate, Trade Count per ticker
- **Conditional Rendering**: Only shows if user has traded the asset

### 3. Asset Component - Template Performance
- **File**: `app/src/features/Asset.jsx`
- **Purpose**: Displays top performing templates for each asset
- **API Calls**: Mock data (ready for real template API)
- **Display**: Template name, win rate, trade count, average return
- **Future**: Replace mock with `/api/metrics/templates/by-ticker/:symbol`

### 4. AssetsIndex Component - Market Context
- **File**: `app/src/features/AssetsIndex.jsx`
- **Purpose**: Shows portfolio performance alongside market benchmarks
- **API Calls**: `/api/metrics/portfolio/summary`
- **Display**: Portfolio PnL, Win Rate, Trade Count vs SPY/QQQ/IWM
- **Integration**: Added to existing market context section

## Data Flow Architecture

```
Trade Execution → TradeMetricFact → Metrics Processing → API Endpoints → Frontend Components
     ↓                    ↓                    ↓                ↓                  ↓
  Attribution          Database           Calculations      Live Data          User Display
```

## Error Handling Strategy

### Frontend
- **Loading States**: All components show loading indicators
- **Graceful Degradation**: Fallback to original data when metrics fail
- **User Feedback**: Console errors for debugging, no user-facing errors
- **Null Safety**: Optional chaining throughout component logic

### Backend
- **API Error Codes**: Standard HTTP status codes
- **Error Responses**: JSON with error messages
- **Database Errors**: Proper logging and error propagation

## Performance Considerations

### API Optimization
- **Caching**: Metrics calculated and cached in database
- **Efficient Queries**: Optimized database queries with proper indexing
- **Response Size**: Minimal JSON responses

### Frontend Optimization
- **Component Memoization**: React.memo for expensive calculations
- **Debounced Calls**: Prevent excessive API calls
- **Cancellation**: Proper cleanup in useEffect hooks

## Testing Strategy

### Backend Tests
- **API Smoke Tests**: `server/test_metrics_api.js`
- **Database Verification**: TradeMetricFact creation verification
- **Data Accuracy**: Cross-check calculations with raw data

### Frontend Tests
- **Integration Tests**: `app/test_metrics_frontend.js`
- **Component Rendering**: Verify metrics display correctly
- **Error States**: Test loading and error conditions

## Deployment Notes

### Environment Variables
- **API Base URL**: Configurable for different environments
- **CORS Settings**: Properly configured for frontend domain

### Database Requirements
- **Prisma Client**: Generated and up-to-date
- **Schema**: Latest metrics schema applied
- **Indexes**: Performance indexes on TradeMetricFact table

## Future Enhancements

### Phase 3 Opportunities
1. **Asset Cards Enhancement**: Personal metrics in asset listings
2. **Detailed Attribution**: Per-asset attribution breakdowns
3. **Real-time Updates**: WebSocket integration for live metrics
4. **Historical Trends**: Time-series metrics visualization

### API Extensions
1. **Template-Specific Metrics**: `/api/metrics/templates/by-ticker/:symbol`
2. **Asset-Specific Metrics**: `/api/metrics/assets/:symbol`
3. **Time-Range Metrics**: `/api/metrics/portfolio/summary?period=30d`

## Troubleshooting

### Common Issues
1. **Metrics Not Displaying**: Check API endpoint availability
2. **Incorrect Calculations**: Verify TradeMetricFact data integrity
3. **Performance Issues**: Check database query performance
4. **CORS Errors**: Verify frontend-backend configuration

### Debug Commands
```bash
# Backend API testing
cd server && node test_metrics_api.js

# Frontend integration testing  
cd app && node test_metrics_frontend.js

# Database verification
cd server && node check_trade_facts.js
```

## Security Considerations

- **Authentication**: All metrics endpoints respect user context
- **Data Privacy**: Personal metrics isolated per user
- **Rate Limiting**: Consider API rate limiting for production
- **Input Validation**: Proper validation of API parameters

## Monitoring and Analytics

### Key Metrics
- **API Response Times**: Monitor endpoint performance
- **Error Rates**: Track failed API calls
- **User Engagement**: Monitor metrics feature usage
- **Data Freshness**: Ensure metrics are up-to-date

### Logging
- **API Access Logs**: Track metrics API usage
- **Error Logging**: Comprehensive error tracking
- **Performance Logs**: Database query performance
- **User Actions**: Frontend metrics interactions
