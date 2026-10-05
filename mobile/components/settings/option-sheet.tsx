import { Check, Search } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetInput,
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
  useState,
} from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ROW_HEIGHT = 52;
const HANDLE_AND_HEADER = 72;
/** `pb-8` on the scroll content. */
const LIST_BOTTOM_PADDING = 32;

export interface OptionSheetHandle {
  open: () => void;
  close: () => void;
}

interface Option<T> {
  value: T;
  label: string;
  flag?: string;
}

interface OptionSheetProps<T extends string | number> {
  title: string;
  options: readonly Option<T>[];
  value: T;
  onSelect: (value: T) => void;
  /**
   * Makes the sheet searchable: a search field is shown and `options` is
   * ignored in favour of `search.results(query)`. `total` is the number of
   * matches before truncation — when it exceeds what's returned, a hint asks
   * the user to refine the search.
   */
  search?: {
    placeholder: string;
    results: (query: string) => {
      options: readonly Option<T>[];
      total?: number;
    };
  };
}

function OptionSheetInner<T extends string | number>(
  { title, options: staticOptions, value, onSelect, search }: OptionSheetProps<T>,
  ref: ForwardedRef<OptionSheetHandle>,
) {
  const sheet = useBottomSheet();
  const [query, setQuery] = useState("");
  const found = search?.results(query);
  const options = found?.options ?? staticOptions;
  const hiddenCount = found?.total ? found.total - options.length : 0;
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Dynamic sizing under-measures a header + scroll view (the last row gets
  // clipped), so size explicitly: header + rows + bottom padding, capped just
  // below the status bar so long lists (timezones) scroll instead.
  const maxHeight = Math.round(height - insets.top - 24);
  const contentHeight =
    HANDLE_AND_HEADER +
    options.length * ROW_HEIGHT +
    LIST_BOTTOM_PADDING +
    insets.bottom;
  // A searchable list changes length as you type; keep the sheet at full
  // height so it doesn't resize under the keyboard.
  const sheetHeight = search ? maxHeight : Math.min(contentHeight, maxHeight);
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setQuery("");
        sheet.open();
      },
      close: sheet.close,
    }),
    [sheet.open, sheet.close],
  );

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref} enableDynamicSizing={false}
        snapPoints={[sheetHeight]}>
        <BottomSheetHeader className="bg-background">
          <Text className="pb-1 text-xl font-bold text-foreground">
            {title}
          </Text>
        </BottomSheetHeader>
        {search ? (
          <View className="px-4 pb-3 pt-1">
            <BottomSheetInput
              value={query}
              onChangeText={setQuery}
              placeholder={search.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              rightElement={
                <Search size={18} className="text-muted-foreground" />
              }
            />
          </View>
        ) : null}
        {/* Scrollable: the timezone list is taller than a dynamic sheet. */}
        <BottomSheetScrollView
          contentContainerClassName="px-4 pb-8"
          keyboardShouldPersistTaps="handled"
        >
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
                <View className="flex-row items-center gap-3">
                  {option.flag ? (
                    <Text className="text-[22px] leading-[28px]">
                      {option.flag}
                    </Text>
                  ) : null}
                  <Text
                    className={cn(
                      "text-[15px]",
                      selected
                        ? "font-semibold text-primary"
                        : "text-foreground",
                    )}
                  >
                    {option.label}
                  </Text>
                </View>
                {selected && <Check size={18} className="text-primary" />}
              </Pressable>
            );
          })}
          {search && options.length === 0 ? (
            <Text className="py-6 text-center text-[14px] text-muted-foreground">
              No matches
            </Text>
          ) : null}
          {hiddenCount > 0 ? (
            <Text className="py-3 text-center text-[12.5px] text-muted-foreground">
              Showing {options.length} of {found?.total} — refine your search to
              see more
            </Text>
          ) : null}
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
