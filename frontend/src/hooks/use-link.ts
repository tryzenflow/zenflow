import { Editor } from "@tiptap/react";
import { useState, useEffect, ChangeEventHandler } from "react";

export const useLink = (editor: Editor) => {
  const [isOpen, setIsOpen] = useState(false);
  const [link, setLink] = useState("");

  const addLink = () => {
    setIsOpen(false);
    editor.chain().focus().toggleLink({ href: link }).run();
  };

  const onOpenChange = () => {
    if (!editor.isActive("link") || isOpen) setIsOpen(!isOpen);
    if (editor.isActive("link"))
      editor.chain().focus().toggleLink({ href: link }).run();
  };

  const onLinkChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setLink(e.target.value);
  };

  useEffect(() => {
    const insertOnEnter = (e: KeyboardEvent) => {
      if (isOpen && e.key === "Enter") {
        setIsOpen(false);
        addLink();
      }
    };
    window.addEventListener("keydown", insertOnEnter);
    return () => window.removeEventListener("keydown", insertOnEnter);
  }, [isOpen, link]);

  return { isOpen, addLink, link, onOpenChange, onLinkChange };
};
