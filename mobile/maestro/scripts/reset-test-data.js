#!/usr/bin/env node
/**
 * Reset Test Data Helper for Maestro E2E Tests
 * Resets the test database and MailHog for a clean test run
 * Usage: node scripts/reset-test-data.js
 */

const API_URL = process.env.E2E_API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const MAILHOG_URL = process.env.MAILHOG_URL || 'http://localhost:8025';

async function resetDatabase() {
  try {
    const response = await fetch(`${API_URL}/test/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json().catch(() => ({}));
    // Throw instead of warning: a backend started without NODE_ENV=test
    // answers 404 here (the /test module is not mounted), and continuing
    // would seed/verify against data that was never cleared — the failure
    // would surface much later as a confusing login or seed error.
    if (!response.ok || data.success !== true) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    console.log('[reset-test-data] Test database reset successfully');
  } catch (error) {
    console.error('[reset-test-data] Database reset failed:', error.message);
    throw error;
  }
}

async function resetMailHog() {
  try {
    const response = await fetch(`${MAILHOG_URL}/api/v1/messages`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    console.log('[reset-test-data] MailHog cleared');
  } catch (error) {
    console.error('[reset-test-data] MailHog clear failed:', error.message);
    throw error;
  }
}

async function main() {
  console.log('[reset-test-data] Starting test data reset...');
  await resetDatabase();
  await resetMailHog();
  console.log('[reset-test-data] Reset complete');
}

main().catch(err => {
  console.error(`[reset-test-data] ${err.message}`);
  process.exit(1);
});