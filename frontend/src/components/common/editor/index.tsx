import { Editor as TiptapEditor, EditorContent } from "@tiptap/react";
import { Toolbar } from "./toolbar";
import { Skeleton } from "@/components/ui/skeleton";

interface EditorProps {
  editor: TiptapEditor | null;
  newUploadsRef?: React.RefObject<string[]>;
}

export const Editor = ({ editor, newUploadsRef }: EditorProps) => {
  if (!editor)
    return (
      <div className="flex flex-col gap-y-2">
        <div className="flex gap-x-4 flex-wrap">
          <Skeleton className="w-9 h-9" />
          <Skeleton className="w-9 h-9" />
          <Skeleton className="w-9 h-9" />
          <Skeleton className="w-9 h-9" />
          <Skeleton className="w-9 h-9" />
        </div>
        <div className="relative bg-background">
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-y-2 divide-y divide-border border border-border rounded-lg w-full overflow-x-hidden">
      <Toolbar editor={editor} newUploadsRef={newUploadsRef} />

      <EditorContent editor={editor} />
    </div>
  );
};
