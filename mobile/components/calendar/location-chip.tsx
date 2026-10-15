import { Globe, MapPin } from "@/components/Icons";
import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { isOnlineLocation } from "@zenflow/core";
import { View } from "react-native";

/** Where a session is held: a pin and the room, or a globe and "Online" for a link. */
export function LocationChip({
  location,
  compact = false,
}: {
  location: string;
  compact?: boolean;
}) {
  const online = isOnlineLocation(location);
  const Icon = online ? Globe : MapPin;
  return (
    <View className={compact ? "self-start" : "mt-1 self-start"}>
      <Glass radius={999} frosted>
        <View
          className={
            compact
              ? "max-w-[200px] flex-row items-center gap-1 px-2 py-0.5"
              : "max-w-[260px] flex-row items-center gap-1.5 px-2.5 py-1"
          }
        >
          <Icon size={compact ? 10 : 12} className="text-muted-foreground" />
          <Text
            numberOfLines={1}
            className={
              compact
                ? "shrink text-[11px] font-medium leading-[14px] text-muted-foreground"
                : "shrink text-[12px] font-medium text-muted-foreground"
            }
          >
            {online ? t("Online") : location}
          </Text>
        </View>
      </Glass>
    </View>
  );
}
