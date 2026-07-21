export function hideEmail(email: string) {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return "Invalid email";

  const username = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  let hiddenUsername: string;

  if (username.length <= 2) {
    if (username.length === 0) return "Invalid email";
    hiddenUsername = username[0] + "•".repeat(username.length - 1);
  } else {
    hiddenUsername =
      username[0] +
      "•".repeat(username.length - 2) +
      username[username.length - 1];
  }

  return `${hiddenUsername}@${domain}`;
}
