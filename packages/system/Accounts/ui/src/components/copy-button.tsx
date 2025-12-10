import { Copy } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";

const copyToClipboard = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        console.error("Failed to copy:", err);
    }
};

interface CopyButtonProps {
    text: string;
    ariaLabel: string;
}

export const CopyButton = ({ text, ariaLabel }: CopyButtonProps) => {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => copyToClipboard(text)}
            aria-label={ariaLabel}
        >
            <Copy className="h-4 w-4" />
        </Button>
    );
};
