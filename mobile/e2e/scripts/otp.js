// Reads the 6-digit login code for EMAIL from Mailpit (SMTP :1025, API :8025).
// Polls: the mail arrives asynchronously.
var base = MAILPIT_URL || "http://localhost:8025";

function fromMailpit() {
  var list = json(http.get(base + "/api/v1/search?query=" + encodeURIComponent("to:" + EMAIL)).body);
  if (!list.messages || list.messages.length === 0) return null;
  var msg = json(http.get(base + "/api/v1/message/" + list.messages[0].ID).body);
  var body = String(msg.HTML || msg.Text || "");
  var m = body.match(/otp-box">\s*(\d{6})\s*</) || body.match(/\b(\d{6})\b/);
  return m ? m[1] : null;
}

var code = null;
for (var attempt = 0; attempt < 20 && !code; attempt++) {
  try {
    code = fromMailpit();
  } catch (e) {
    code = null; // Mailpit not answering yet
  }
  if (!code) {
    var until = Date.now() + 1000;
    while (Date.now() < until) {} // no sleep() in Maestro's JS runtime
  }
}

if (!code) throw new Error("No OTP email found for " + EMAIL);
output.otp = code;
