import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaperclipIcon } from "lucide-react";
import { useFileUploads } from "../../../hooks/use-file-uploads";

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
  const { onFileChange } = useFileUploads({ value, onChange, newUploadsRef });
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
