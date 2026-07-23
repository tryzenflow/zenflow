import { Textarea } from "@/components/ui/textarea";
import { View } from "react-native";

export function DescriptionField(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return <DescriptionFieldEditor {...props} />;
}

function DescriptionFieldEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-1.5">
      <Textarea
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        placeholder="Write some notes here…"
        numberOfLines={15}
        className="max-h-[220px] min-h-[110px] text-sm"
      />
    </View>
  );
}
