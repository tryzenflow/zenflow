#!/usr/bin/env node
/**
 * Seed Test Task Helper for Maestro E2E Tests
 * Creates a task via the backend API for edit/calendar flows
 * Usage: node scripts/seed-task.js <title> <type> <deadlineISO> <durationMinutes> [sessionCount] [scheduledStartISO]
 *
 * Types: TASK, DND, ASSIGNMENT, EXAM, LECTURE (backend SessionType enum).
 * Pass scheduledStartISO to pin the session to a deterministic calendar
 * slot — required for any task a calendar flow asserts on, since seeded
 * rows bypass the placement engine.
 */

const API_URL = process.env.E2E_API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const MAILHOG_URL = process.env.MAILHOG_URL || 'http://localhost:8025';
const EMAIL = process.env.E2E_EMAIL;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestOtp(email) {
  const response = await fetch(`${API_URL}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(`Failed to request OTP: ${data.message}`);
  }
  console.log('[seed-task] OTP requested for:', email);
}

async function getOtpFromMailHog(email, timeoutMs = 60000) {
  const startTime = Date.now();
  const pollIntervalMs = 2000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${MAILHOG_URL}/api/v2/messages?limit=50`);
      const data = await response.json();
      const messages = data.items || [];

      for (const msg of messages) {
        const to = msg.To || [];
        if (to.some(t => t.Mailbox + '@' + t.Domain === email)) {
          const html = msg.Content.Body || '';
          const patterns = [
            /<strong[^>]*>(\d{6})<\/strong>/i,
            /code[^>]*>(\d{6})</i,
            />\s*(\d{6})\s*</i,
            /\b(\d{6})\b/,
          ];
          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[1];
          }
        }
      }
    } catch (error) {
      console.warn(`[seed-task] MailHog poll error: ${error.message}`);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timeout: No OTP found for ${email} within ${timeoutMs}ms`);
}

async function verifyOtp(email, otp) {
  const response = await fetch(`${API_URL}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, providedOtp: otp }),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(`OTP verification failed: ${data.message}`);
  }
  // Extract session cookie from response headers
  const cookies = response.headers.get('set-cookie') || '';
  console.log('[seed-task] OTP verified, session established');
  return cookies;
}

async function seedTask(cookie, title, type, deadline, durationMinutes, sessionCount = 1, scheduledStartTime) {
  const response = await fetch(`${API_URL}/test/seed-task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      title,
      type,
      deadline,
      durationMinutes,
      sessionCount,
      ...(scheduledStartTime ? { scheduledStartTime } : {}),
    }),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(`Failed to seed task: ${data.message}`);
  }
  console.log('[seed-task] Task seeded:', JSON.stringify(data.data, null, 2));
  return data.data;
}

async function main() {
  const [title, type, date, durationMinutes, sessionCount, scheduledStart] = process.argv.slice(2);
  if (!title || !type || !date || !durationMinutes) {
    console.error('Usage: node seed-task.js <title> <type> <deadlineISO> <durationMinutes> [sessionCount] [scheduledStartISO]');
    console.error('Types: TASK, DND, ASSIGNMENT, EXAM, LECTURE');
    process.exit(1);
  }

  if (!EMAIL) {
    console.error('[seed-task] E2E_EMAIL environment variable is required');
    process.exit(1);
  }

  try {
    console.log('[seed-task] Starting task seeding...');
    console.log('[seed-task] Email:', EMAIL);

    // 1. Request OTP
    await requestOtp(EMAIL);

    // 2. Get OTP from MailHog
    console.log('[seed-task] Polling MailHog for OTP...');
    const otp = await getOtpFromMailHog(EMAIL);
    console.log('[seed-task] OTP received:', otp);

    // 3. Verify OTP and get session cookie
    const cookie = await verifyOtp(EMAIL, otp);

    // 4. Seed task
    const deadline = new Date(date).toISOString();
    const result = await seedTask(
      cookie,
      title,
      type,
      deadline,
      parseInt(durationMinutes),
      parseInt(sessionCount) || 1,
      scheduledStart ? new Date(scheduledStart).toISOString() : undefined,
    );

    // Output task ID for shell capture
    if (result.session) {
      console.log(result.session.id);
    } else if (result.sessions && result.sessions.length > 0) {
      console.log(result.sessions[0].id);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[seed-task] ${err.message}`);
    process.exit(1);
  }
}

main();