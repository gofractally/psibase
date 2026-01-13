import { Copy } from "lucide-react";

import { useToast } from "@/components/ui/use-toast";

import { Button } from "@shared/shadcn/ui/button";

interface CopyButtonProps {
    text: string;
    ariaLabel: string;
}

export const CopyButton = ({ text, ariaLabel }: CopyButtonProps) => {
    const { toast } = useToast();

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast({
                title: "Copied",
                description: "The text has been copied to the clipboard.",
            });
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };
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
