import { Editor } from "@/components/common/editor";
import { useContentEditor } from "@/hooks/use-editor";
import { useEffect } from "react";

interface NoteEditorProps {
  initialValue?: string;
  value: string;
  onChange: (value: string) => void;
  newUploadsRef?: React.RefObject<string[]>;
  disabled?: boolean;
}

export function NoteEditor({
  initialValue,
  value,
  onChange,
  disabled,
  newUploadsRef,
}: NoteEditorProps) {
  const editor = useContentEditor({
    content: value,
    onChange: (newValue) => onChange(newValue),
    editable: !disabled,
  });

  useEffect(() => {
    editor.commands.setContent(initialValue || "");
  }, [initialValue, editor]);

  return <Editor editor={editor} newUploadsRef={newUploadsRef} />;
}
