import React, { useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { authService } from '../api/auth.service';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(Array(6).fill(''));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authService.sendOTP({ email });
      setStep('otp');
    } catch (err: any) {
      setError(err?.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = otp.join('').trim();
    if (code.length !== otp.length) return;
    setLoading(true);
    try {
      await authService.verifyOTP({ email, otp: code });
      onLoginSuccess();
    } catch (err: any) {
      setError(err?.message || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^[0-9]?$/.test(value)) return;

    const nextOtp = [...otp];
    nextOtp[index] = value;
    setOtp(nextOtp);

    if (value && index < otp.length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const nextOtp = [...otp];
      nextOtp[index - 1] = '';
      setOtp(nextOtp);
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    }
  };

  const maskedEmail = email
    ? email.replace(/(^.).*(@.*$)/, '$1***$2')
    : 'your email';

  return (
    <div className="min-h-screen bg-[#f8f8f8] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Card className="border border-gray-200 shadow-lg">
          <div className="p-8 space-y-8">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                {loading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-gray-900" />
                ) : (
                  <div className="w-8 h-8 rounded-full border-2 border-gray-300 border-t-gray-900 animate-spin" />
                )}
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-semibold text-gray-900">Log in to Zenflow</h1>
                <p className="text-sm text-gray-500">
                  {step === 'email'
                    ? 'Enter your email to continue'
                    : `Enter the OTP code sent to ${maskedEmail}`}
                </p>
                {error && (
                  <p className="text-sm text-red-600" role="alert">{error}</p>
                )}
              </div>
            </div>

            {step === 'email' ? (
              <form onSubmit={handleEmailSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium text-gray-700 uppercase tracking-wide">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="foo@bar.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 h-11 text-sm border-gray-300 focus:border-gray-900 focus:ring-gray-900"
                      required
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-11 text-sm font-medium bg-gray-900 hover:bg-black" disabled={loading}>
                  {loading ? 'Sending...' : 'Send OTP'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleOtpSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-700 uppercase tracking-wide">
                    OTP code
                  </Label>
                  <div className="flex justify-center gap-2">
                    {otp.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => {
                          inputRefs.current[index] = el;
                        }}
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(index, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                        className="w-10 h-11 rounded-md border border-gray-300 text-center text-base font-medium text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      />
                    ))}
                  </div>
                </div>
                <Button type="submit" className="w-full h-11 text-sm font-medium bg-gray-900 hover:bg-black" disabled={loading}>
                  {loading ? 'Logging in...' : 'Login'}
                </Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
