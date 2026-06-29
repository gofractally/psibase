import { Download } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";

const downloadKeyFile = (pemContent: string, filename: string) => {
    const blob = new Blob([pemContent], { type: "application/x-pem-file" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast("Key file downloaded");
};

interface DownloadKeyFileButtonProps {
    pemContent: string;
    filename: string;
}

export const DownloadKeyFileButton = ({
    pemContent,
    filename,
}: DownloadKeyFileButtonProps) => {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => downloadKeyFile(pemContent, filename)}
            aria-label="Download key file"
        >
            <Download className="h-4 w-4" />
        </Button>
    );
};
