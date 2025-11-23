import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaperclipIcon } from "lucide-react";
import { FileMetadata } from "@/types/files";
import { getData } from "../../../api";

interface FileUploadProps {
  value: string;
  newUploadsRef?: React.RefObject<string[]>;
  onChange: (value: string) => void;
}

export const FileUpload = ({
  value,
  newUploadsRef,
  onChange,
}: FileUploadProps) => {
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;

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
      }
    );

    const { data }: { data: FileMetadata[] } = await response.json();
    let valueWithFile = value;

    for (const uploadedFile of data) {
      const metadataUrl = `/files/metadata/${uploadedFile.id}`;
      const fileUrl = `/files/${uploadedFile.id}`;
      const { data: fileMetadata } = await getData<{ data: FileMetadata }>(
        metadataUrl
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
        ])
      );
    }
  };
  return (
    <Button className="relative" variant="ghost" type="button" size="icon">
      <PaperclipIcon className="w-4 h-4" />
      <Input
        type="file"
        className="opacity-0 absolute inset-0"
        onChange={onFileChange}
        multiple
      />
    </Button>
  );
};
