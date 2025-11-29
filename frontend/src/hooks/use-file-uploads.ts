import { useCallback } from "react";
import { getData } from "../api";
import { FileMetadata } from "../types/files";

export function useFileUploads({
  value,
  onChange,
  newUploadsRef,
}: {
  value: string;
  onChange: (value: string) => void;
  newUploadsRef?: React.RefObject<string[]>;
}) {
  const onFileChange = useCallback(
    async (
      e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<Element>,
    ) => {
      e.preventDefault();
      const files = "dataTransfer" in e ? e.dataTransfer.files : e.target.files;
      if (!files || files.length === 0) return;

      const formData = new FormData();

      for (const file of files || []) {
        formData.append("files", file);
      }
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/files/upload`,
        {
          method: "POST",
          body: formData,
          credentials: "include",
        },
      );

      const { data }: { data: FileMetadata[] } = await response.json();
      let valueWithFile = value;

      for (const uploadedFile of data) {
        const metadataUrl = `/files/metadata/${uploadedFile.id}`;
        const fileUrl = `/files/${uploadedFile.id}`;
        const { data: fileMetadata } = await getData<{ data: FileMetadata }>(
          metadataUrl,
        );
        if (fileMetadata.mimetype.startsWith("image/")) {
          valueWithFile += `<p><img src="${
            import.meta.env.VITE_API_URL
          }${fileUrl}" alt="${
            fileMetadata.originalName
          }" style="max-width: 100%;"/></p>`;
        } else if (fileMetadata.mimetype.startsWith("video/")) {
          valueWithFile += `<p><video controls src="${
            import.meta.env.VITE_API_URL
          }${fileUrl}" style="max-width: 100%;"></video></p>`;
        } else {
          valueWithFile += `<p><a href="${
            import.meta.env.VITE_API_URL
          }${fileUrl}" target="_blank" rel="noopener noreferrer">${
            fileMetadata.originalName
          }</a></p>`;
        }
      }
      onChange(valueWithFile);
      if (newUploadsRef) {
        newUploadsRef.current = Array.from(
          new Set([
            ...(newUploadsRef.current || []),
            ...data.map((file) => file.id),
          ]),
        );
      }
    },
    [onChange, value],
  );
  return { onFileChange };
}
