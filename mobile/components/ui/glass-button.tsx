import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { NAV_THEME } from "@/lib/constants";
import * as Haptics from "expo-haptics";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/** Visible glass size: 40px round, the design's compact control. */
export const GLASS_SIZE = 40;
/** Touch target: 44pt, the floor in docs/mobile/design.md. */
export const GLASS_HIT_SIZE = 44;

export type GlassIcon = ComponentType<{ size?: number; color: string }>;

const CIRCLE_RADIUS = GLASS_SIZE / 2;
/** Deep slate ink on the solid sky primary. */
const PRIMARY_INK = "#16232B";

/** Inner 1px highlight that sits just inside the glass edge. */
function InnerHighlight({ dark, radius }: { dark: boolean; radius: number }) {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: dark
            ? "rgba(159, 180, 190, 0.16)"
            : "rgba(255, 255, 255, 0.7)",
        },
      ]}
    />
  );
}

/**
 * Floating glass control. Icon-only is a 40px circle; with children it is a
 * pill with a 40px height. Either way the touch target is at least 44pt.
 * Only for secondary and floating controls over content: primary actions stay
 * solid, and content is never glass (docs/mobile/design.md).
 */
export function GlassButton({
  accessibilityLabel,
  icon: Icon,
  children,
  badge,
  onPress,
  disabled = false,
  testID,
  style,
  accessibilityState,
  haptic = true,
}: {
  /** Required: icon-only buttons have no visible text. */
  accessibilityLabel: string;
  /** Icon-only when `children` is omitted; otherwise shown beside the label. */
  icon?: GlassIcon;
  children?: ReactNode;
  /** Small dot or count pinned to the top-right corner of the glass. */
  badge?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  /** Placement only (position, margins). The glass look is fixed. */
  style?: ComponentProps<typeof View>["style"];
  accessibilityState?: { selected?: boolean; expanded?: boolean };
  /** Selection haptic on press. Turn off when the parent already fires one. */
  haptic?: boolean;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const iconOnly = children == null;

  return (
    <View style={style}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ ...accessibilityState, disabled }}
        disabled={disabled}
        onPress={() => {
          if (haptic) Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        style={({ pressed }) => ({
          minWidth: GLASS_HIT_SIZE,
          minHeight: GLASS_HIT_SIZE,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}
      >
        <View
          style={{
            borderRadius: CIRCLE_RADIUS,
            shadowColor: "#000",
            shadowOpacity: isDarkColorScheme ? 0.35 : 0.12,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Glass
            radius={CIRCLE_RADIUS}
            clear
            intensity={40}
            style={
              iconOnly
                ? {
                    width: GLASS_SIZE,
                    height: GLASS_SIZE,
                    alignItems: "center",
                    justifyContent: "center",
                  }
                : {
                    height: GLASS_SIZE,
                    minWidth: GLASS_SIZE,
                    paddingHorizontal: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }
            }
          >
            {Icon ? <Icon size={18} color={theme.text} /> : null}
            {iconOnly ? null : typeof children === "string" ? (
              <Text className="text-[13px] font-semibold">{children}</Text>
            ) : (
              children
            )}
            <InnerHighlight dark={isDarkColorScheme} radius={CIRCLE_RADIUS} />
          </Glass>
        </View>
        {badge ? (
          <View pointerEvents="none" style={{ position: "absolute", right: 2, top: 2 }}>
            {badge}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

export type GlassSegment<T extends string> = {
  value: T;
  accessibilityLabel: string;
  icon: GlassIcon;
  testID?: string;
};

/**
 * Segmented glass control: one glass track, one active segment filled solid.
 * Each segment has a 44pt touch target around a 40px pill.
 */
export function GlassSegmented<T extends string>({
  segments,
  value,
  onValueChange,
  testID,
}: {
  segments: GlassSegment<T>[];
  value: T;
  onValueChange: (value: T) => void;
  testID?: string;
}) {
  const { isDarkColorScheme } = useColorScheme();
  return (
    <Glass
      radius={GLASS_HIT_SIZE / 2}
      intensity={30}
      style={{ padding: 3, flexDirection: "row" }}
    >
      {segments.map(({ value: segValue, accessibilityLabel, icon: Icon, testID: segTestID }) => {
        const active = segValue === value;
        return (
          <Pressable
            key={segValue}
            testID={segTestID ?? testID}
            accessibilityRole="tab"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected: active }}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onValueChange(segValue);
            }}
            style={({ pressed }) => ({
              width: GLASS_HIT_SIZE,
              height: GLASS_HIT_SIZE,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <View
              style={{
                width: GLASS_SIZE - 6,
                height: GLASS_SIZE - 6,
                borderRadius: (GLASS_SIZE - 6) / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: active ? (isDarkColorScheme ? NAV_THEME.dark.primary : NAV_THEME.light.primary) : "transparent",
              }}
            >
              <Icon
                size={18}
                color={
                  active
                    ? PRIMARY_INK
                    : isDarkColorScheme
                      ? NAV_THEME.dark.mutedForeground
                      : NAV_THEME.light.mutedForeground
                }
              />
            </View>
          </Pressable>
        );
      })}
    </Glass>
  );
}
