import { Toggle } from "@/components/ui/toggle";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Paperclip,
  Underline,
} from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function NoteEditor({ value, onChange, disabled }: NoteEditorProps) {
  return (
    <div className="border rounded-md">
      <div className="flex items-center gap-1 p-2 border-b">
        <Toggle size="sm" aria-label="Toggle bold">
          <Bold className="h-4 w-4" />
        </Toggle>
        <Toggle size="sm" aria-label="Toggle italic">
          <Italic className="h-4 w-4" />
        </Toggle>
        <Toggle size="sm" aria-label="Toggle underline">
          <Underline className="h-4 w-4" />
        </Toggle>
        <Toggle size="sm" aria-label="Toggle unordered list">
          <List className="h-4 w-4" />
        </Toggle>
        <Toggle size="sm" aria-label="Toggle ordered list">
          <ListOrdered className="h-4 w-4" />
        </Toggle>
        <Button variant="ghost" size="icon" aria-label="Upload attachments">
          <Paperclip className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
