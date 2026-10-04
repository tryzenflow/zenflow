import { Check } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetScrollView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import {
  type ForwardedRef,
  type ReactElement,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Pressable, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ROW_HEIGHT = 52;
const HANDLE_AND_HEADER = 72;

export interface OptionSheetHandle {
  open: () => void;
  close: () => void;
}

interface OptionSheetProps<T extends string | number> {
  title: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
}

function OptionSheetInner<T extends string | number>(
  { title, options, value, onSelect }: OptionSheetProps<T>,
  ref: ForwardedRef<OptionSheetHandle>,
) {
  const sheet = useBottomSheet();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Dynamic sizing under-measures a header + scroll view (the last row gets
  // clipped), so size explicitly: header + rows + bottom padding, capped just
  // below the status bar so long lists (timezones) scroll instead.
  const maxHeight = Math.round(height - insets.top - 24);
  const contentHeight =
    HANDLE_AND_HEADER + options.length * ROW_HEIGHT + insets.bottom;
  const sheetHeight = Math.min(contentHeight, maxHeight);
  useImperativeHandle(ref, () => ({ open: sheet.open, close: sheet.close }), [
    sheet.open,
    sheet.close,
  ]);

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref} enableDynamicSizing={false}
        snapPoints={[sheetHeight]}>
        <BottomSheetHeader className="bg-background">
          <Text className="pb-1 text-xl font-bold text-foreground">
            {title}
          </Text>
        </BottomSheetHeader>
        {/* Scrollable: the timezone list is taller than a dynamic sheet. */}
        <BottomSheetScrollView contentContainerClassName="px-4 pb-8">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onSelect(option.value);
                  sheet.close();
                }}
                role="radio"
                aria-checked={selected}
                accessibilityState={{ checked: selected }}
                className="flex-row items-center justify-between py-3.5"
              >
                <Text
                  className={cn(
                    "text-[15px]",
                    selected ? "font-semibold text-primary" : "text-foreground",
                  )}
                >
                  {option.label}
                </Text>
                {selected && <Check size={18} className="text-primary" />}
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheetContent>
    </BottomSheet>
  );
}

/**
 * Single-choice bottom sheet for the settings rows: lists `options`,
 * highlights `value`, and closes after `onSelect`. Opened imperatively via ref.
 */
export const OptionSheet = forwardRef(OptionSheetInner) as <
  T extends string | number,
>(
  props: OptionSheetProps<T> & { ref?: ForwardedRef<OptionSheetHandle> },
) => ReactElement;
