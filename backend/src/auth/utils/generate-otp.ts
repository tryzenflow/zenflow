export function generateOTP(length: number = 6) {
  let otpCode = "";
  while (otpCode.length < length) {
    otpCode += Math.round(Math.random() * 9);
  }
  return otpCode;
}
