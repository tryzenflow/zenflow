#!/usr/bin/env node
/**
 * Seed Test Task Helper for Maestro E2E Tests
 * Creates a task via the backend API for edit/calendar flows
 * Usage: node scripts/seed-task.js <title> <type> <date> <durationMinutes>
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD; // Not used with OTP auth - would need session token

async function createTask(title, type, date, durationMinutes) {
  // This would need a valid session token from login
  // For now, this is a placeholder - the actual implementation
  // would use the backend API with proper auth
  console.log(`[seed-task] Would create task: ${title} (${type}) on ${date} for ${durationMinutes}min`);
  console.log('[seed-task] NOTE: Requires valid auth session - implement with backend test helper');

  // Placeholder: return a fake task ID for testing
  return `e2e-${title.toLowerCase().replace(/\s+/g, '-')}`;
}

// CLI usage
const [title, type, date, durationMinutes] = process.argv.slice(2);
if (!title || !type || !date || !durationMinutes) {
  console.error('Usage: node seed-task.js <title> <type> <date> <durationMinutes>');
  console.error('Types: FOCUS, ASSIGNMENT, EXAM, LECTURE, DND');
  process.exit(1);
}

createTask(title, type, date, parseInt(durationMinutes))
  .then(taskId => {
    console.log(taskId);
    process.exit(0);
  })
  .catch(err => {
    console.error(`[seed-task] ${err.message}`);
    process.exit(1);
  });