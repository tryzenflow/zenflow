// Unique address per run: /auth/otp/request is rate limited per email.
output.email = "e2e-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + "@example.com";
