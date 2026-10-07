#!/usr/bin/env node
/**
 * OTP Retrieval Helper for Maestro E2E Tests
 * Polls MailHog API for the latest OTP sent to the test email
 * Usage: node scripts/get-otp.js <email> [timeoutMs]
 */

const MAILHOG_URL = process.env.MAILHOG_URL || 'http://localhost:8025';
const TIMEOUT_MS = parseInt(process.argv[3]) || 60000; // Default 60s
const POLL_INTERVAL_MS = 2000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMessages(email) {
  const url = `${MAILHOG_URL}/api/v2/messages?limit=50`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MailHog API error: ${response.status}`);
  }
  const data = await response.json();
  return data.items || [];
}

function extractOtp(html) {
  // Look for 6-digit code in the HTML
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
  return null;
}

async function getOtp(email) {
  const startTime = Date.now();
  console.log(`[get-otp] Polling MailHog at ${MAILHOG_URL} for email: ${email}`);

  while (Date.now() - startTime < TIMEOUT_MS) {
    try {
      const messages = await fetchMessages(email);

      // Collect every message for our email (check To header). More than
      // one means MailHog was not reset before this run — picking any of
      // them risks a stale OTP (the classic silent-wrong-code failure),
      // so fail loudly instead of guessing.
      const ours = messages.filter((msg) => {
        const to = msg.To || [];
        return to.some(t => t.Mailbox + '@' + t.Domain === email);
      });
      if (ours.length > 1) {
        throw new Error(
          `Expected 1 message for ${email}, found ${ours.length} — MailHog was not reset (run reset-test-data.js first)`,
        );
      }
      for (const msg of ours) {
        const html = msg.Content.Body || '';
        const otp = extractOtp(html);
        if (otp) {
          console.log(`[get-otp] Found OTP: ${otp}`);
          return otp;
        }
      }
    } catch (error) {
      console.error(`[get-otp] Error polling: ${error.message}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timeout: No OTP found for ${email} within ${TIMEOUT_MS}ms`);
}

// CLI usage
const email = process.argv[2];
if (!email) {
  console.error('Usage: node get-otp.js <email> [timeoutMs]');
  process.exit(1);
}

getOtp(email)
  .then(otp => {
    console.log(otp); // Print only the OTP for shell capture
    process.exit(0);
  })
  .catch(err => {
    console.error(`[get-otp] ${err.message}`);
    process.exit(1);
  });