import { Editor as TiptapEditor, EditorContent } from "@tiptap/react";
import { Toolbar } from "./toolbar";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useRef, useState } from "react";
import { useFileUploads } from "../../../hooks/use-file-uploads";
import { FilePlus } from "lucide-react";

interface EditorProps {
  editor: TiptapEditor;
  newUploadsRef?: React.RefObject<string[]>;
}

export const Editor = ({ editor, newUploadsRef }: EditorProps) => {
  const { onFileChange } = useFileUploads({
    value: editor.getHTML(),
    onChange: (value) => editor.commands.setContent(value),
    newUploadsRef,
  });
  useEffect(() => {
    if (!editor) return;
    const renderDocs = ({ editor }: { editor: TiptapEditor }) => {
      const { from, to } = editor.state.selection;
      editor.state.doc.nodesBetween(from, to, (node) => {
        if (node.type.name === "customLink") {
          const href = node.attrs.href;
          editor.commands.fetchFileMetadata(href);
        }
      });
    };
    editor.on("transaction", renderDocs);
    return () => {
      editor.off("transaction", renderDocs);
    };
  }, [editor]);
  const [isDragging, setIsDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Drag handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const hasFiles = Array.from(e.dataTransfer.items).some(
      (item) => item.kind === "file"
    );

    setIsDragging(hasFiles);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    onFileChange(e);
  };

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
    <div
      ref={dropRef}
      className="relative flex flex-col gap-y-2 divide-y divide-border border border-border rounded-lg w-full overflow-x-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Toolbar editor={editor} newUploadsRef={newUploadsRef} />

      <EditorContent editor={editor} />
      {isDragging && (
        <div className="absolute inset-0 z-50 flex backdrop-blur-md flex-col items-center justify-center p-6 bg-primary/30 border border-dashed border-white pointer-events-none transition-opacity">
          <FilePlus className="w-5 h-5 text-white animate-bounce" />
          <p className="font-medium text-white">Drop files here</p>
          <p className="text-sm text-white/80">
            Supports PDFs, images, documents…
          </p>
        </div>
      )}
    </div>
  );
};
