import { updateBasicInfo } from "@/api/users";
import { ChevronRight, Lock } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useColorScheme } from "@/lib/useColorScheme";
import type { User } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable, View } from "react-native";

/** e.g. "New User" -> "NU" */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars =
    parts.length > 1
      ? [parts[0][0], parts[parts.length - 1][0]]
      : [parts[0]?.[0]];
  return chars.join("").toUpperCase() || "?";
}

/** e.g. "alice@zenflow.com" -> "a••••@zenflow.com" */
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain || local.length <= 1) return email;
  return `${local[0]}${"•".repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

const AVATAR_GRADIENT = {
  light: ["#FF8E3E", "#F0B101", "#D8F998"],
  dark: ["#FF7A24", "#F6B915", "#CBED86"],
};

/**
 * Profile card: avatar + name + masked email, tapping through to an "Edit
 * profile" bottom sheet (mockups/settings.html). Only the name is editable —
 * email doubles as the OTP sign-in identity, so it's shown locked.
 */
export function ProfileRow({
  user,
  onUpdated,
}: {
  user: User;
  onUpdated: (user: User) => void;
}) {
  const { toast } = useToast();
  const { isDarkColorScheme } = useColorScheme();
  const bottomSheet = useBottomSheet();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user.name) {
      bottomSheet.close();
      return;
    }
    setSaving(true);
    try {
      const updated = await updateBasicInfo({ name: trimmed });
      onUpdated(updated);
      toast("Profile updated", "success");
      bottomSheet.close();
    } catch (error) {
      const message =
        (isAxiosError(error) && error.response?.data?.message) ||
        "Failed to update profile";
      toast(message, "destructive");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild>
        <Pressable
          onPress={() => setName(user.name)}
          className="flex-row items-center gap-[13px] px-4 py-3.5"
        >
          <LinearGradient
            colors={
              (isDarkColorScheme
                ? AVATAR_GRADIENT.dark
                : AVATAR_GRADIENT.light) as [string, string, string]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              height: 46,
              width: 46,
              borderRadius: 23,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text className="text-base font-bold tracking-tight text-primary-foreground">
              {initials(user.name)}
            </Text>
          </LinearGradient>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">{user.name}</Text>
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              {maskEmail(user.email)}
            </Text>
          </View>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        <BottomSheetView className="px-0" hadHeader={false}>
          <View className="px-5">
            <Text className="text-[19px] font-bold tracking-tight">
              Edit profile
            </Text>
            <Text className="mt-[3px] text-[13px] text-muted-foreground">
              Update how your name appears in Zenflow.
            </Text>
          </View>
          <View className="mt-4 gap-[18px] px-5">
            <View>
              <Text className="mb-2 text-[14px] font-semibold">Name</Text>
              <Input
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            </View>
            <View>
              <Text className="mb-2 text-[14px] font-semibold">Email</Text>
              <View className="h-[50px] w-full flex-row items-center justify-between rounded-xl border border-input bg-muted/50 px-4">
                <Text className="text-base text-muted-foreground">
                  {user.email}
                </Text>
                <Lock size={16} className="shrink-0 text-muted-foreground" />
              </View>
              <Text className="mt-[7px] text-[13px] leading-snug text-muted-foreground">
                Email is your sign-in identity and can't be changed here.
              </Text>
            </View>
          </View>
          <View className="px-5 pt-3.5">
            <Button className="w-full" disabled={saving} onPress={save}>
              <Text className="font-semibold text-primary-foreground">
                {saving ? "Saving…" : "Save changes"}
              </Text>
            </Button>
          </View>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
}
