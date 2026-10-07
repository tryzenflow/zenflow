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
    const data = await response.json();
    if (data.success) {
      console.log('[reset-test-data] Test database reset successfully');
    } else {
      console.warn('[reset-test-data] Reset failed:', data.message);
    }
  } catch (error) {
    console.error('[reset-test-data] Database reset error:', error.message);
    throw error;
  }
}

async function resetMailHog() {
  try {
    const response = await fetch(`${MAILHOG_URL}/api/v1/messages`, {
      method: 'DELETE',
    });
    if (response.ok) {
      console.log('[reset-test-data] MailHog cleared');
    } else {
      console.warn(`[reset-test-data] MailHog clear failed: ${response.status}`);
    }
  } catch (error) {
    console.warn(`[reset-test-data] MailHog clear error: ${error.message}`);
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