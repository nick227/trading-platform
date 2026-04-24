import cron from 'node-cron';

class ScheduledBackfillService {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.schedule = '0 2 * * *'; // Run daily at 2 AM
  }

  start() {
    console.log('🕐 Starting Scheduled Backfill Service');
    console.log(`📅 Schedule: ${this.schedule} (daily at 2 AM)`);
    
    // Run immediately on startup
    this.runOnce();
    
    // Schedule daily runs
    cron.schedule(this.schedule, () => {
      this.runOnce();
    });
  }

  async runOnce() {
    if (this.isRunning) {
      console.log('⚠️  Backfill already running, skipping this run');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      console.log(`\n🔄 Starting scheduled backfill reconciler (${new Date().toISOString()})`);
      console.log('='.repeat(60));
      
      // Import and run the reconciler
      const { backfillReconciler } = await import('./backfill_reconciler.js');
      await backfillReconciler();
      
      this.lastRun = new Date();
      const duration = Date.now() - startTime;
      
      console.log(`\n✅ Scheduled backfill completed in ${duration}ms`);
      console.log(`🕐 Next run: ${this.getNextRunTime()}`);
      
    } catch (error) {
      console.error('❌ Scheduled backfill failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  getNextRunTime() {
    // Simple calculation for next 2 AM
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0);
    
    return tomorrow.toISOString();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: this.getNextRunTime(),
      schedule: this.schedule
    };
  }
}

// Create singleton instance
const scheduledBackfill = new ScheduledBackfillService();

export default scheduledBackfill;

// Auto-start if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  scheduledBackfill.start();
}
