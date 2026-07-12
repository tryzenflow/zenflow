import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { sanitizeContent } from "@/utils/sanitizer";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Video } from "@/components/common/editor/video-block";
import { CustomLink } from "@/components/common/editor/custom-link";
import { Audio } from "@/components/common/editor/audio-block";

interface ContentEditor {
  content?: string;
  onChange: (newValue: string) => void;
  editable?: boolean;
}

export const useContentEditor = ({
  content,
  onChange,
  editable,
}: ContentEditor) => {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ codeBlock: false, link: false, underline: false }),
        CustomLink,
        Image,
        Highlight,
        Underline,
        Video,
        Audio,
      ],
      editable,
      content,
      editorProps: {
        attributes: {
          class:
            "relative break-words text-sm min-h-64 px-3 py-2 focus:outline-none overflow-hidden rounded-lg markdown",
        },
      },
      onUpdate({ editor }) {
        const newContent = sanitizeContent(editor.getHTML());
        onChange(newContent);
      },
    },
    [editable],
  );
  return editor;
};
