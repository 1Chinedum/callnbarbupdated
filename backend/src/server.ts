import { config } from './config.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';
import './db.js';

const app = createApp();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`CallNBarb API listening on :${config.port}  (payments: ${config.paymentMode}${config.paymentMode === 'demo' ? ' — DEMO, no real money' : ''})`);
});
startJobs();
