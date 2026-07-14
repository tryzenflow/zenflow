import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { CircleAlert } from 'lucide-react-native';
import * as React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = 'idle' | 'loading' | 'sent';

// Stage 1 of the 2-stage OTP login (mobile/mockups/login.html) — collects
// the email and requests a code. CLAUDE.md §7: OTP + Redis sessions, no
// passwords/JWT. Stage 2 (6-digit code entry) lands with the API client.
export default function LoginScreen() {
  const [email, setEmail] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [status, setStatus] = React.useState<Status>('idle');

  const isValid = EMAIL_PATTERN.test(email.trim());
  const showError = touched && email.length > 0 && !isValid;

  function handleSubmit() {
    setTouched(true);
    if (!isValid || status === 'loading') return;

    setStatus('loading');
    setTimeout(() => setStatus('sent'), 900);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: 'padding', default: undefined })}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-8"
          keyboardShouldPersistTaps="handled">
          <View className="items-center gap-3.5 pb-[26px] pt-[30px]">
            <Logo size={60} />
            <View className="items-center gap-1">
              <Text className="text-center text-[22px] font-bold tracking-[-0.02em]">
                Login to Zenflow
              </Text>
              <Text className="text-muted-foreground text-center text-[13.5px]">
                A focus-first planner that schedules for you.
              </Text>
            </View>
          </View>

          <View className="mb-[18px]">
            <Label nativeID="email-label" className="mb-2 text-[13.5px] font-semibold">
              Email
            </Label>
            <Input
              aria-labelledby="email-label"
              className="h-[50px] rounded-xl text-base"
              placeholder="m@example.com"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (status === 'sent') setStatus('idle');
              }}
              onBlur={() => setTouched(true)}
              editable={status !== 'loading'}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={handleSubmit}
            />
            {showError && (
              <View className="mt-2 flex-row items-center gap-1.5">
                <Icon as={CircleAlert} className="text-destructive size-[15px]" />
                <Text className="text-destructive text-[13px] font-medium">
                  Invalid email address.
                </Text>
              </View>
            )}
          </View>

          <Button
            className="h-[52px] rounded-xl"
            disabled={status === 'loading'}
            onPress={handleSubmit}>
            {status === 'loading' ? (
              <>
                <ActivityIndicator size="small" />
                <Text className="text-primary-foreground/70 text-base font-semibold">
                  Sending…
                </Text>
              </>
            ) : (
              <Text className="text-base font-semibold">Send OTP</Text>
            )}
          </Button>

          {status === 'sent' && (
            <Text className="text-success mt-3 text-center text-[13px] font-medium">
              Code sent to {email}
            </Text>
          )}

          <Text className="text-muted-foreground mt-[22px] px-2.5 text-center text-[11.5px] leading-normal">
            By continuing, you agree to our{' '}
            <Text className="text-foreground text-[11.5px]">Terms of Service</Text> and{' '}
            <Text className="text-foreground text-[11.5px]">Privacy Policy</Text>.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
