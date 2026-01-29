import { cn } from "@shared/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

interface Token {
    id: number;
    symbol: string | null | undefined;
}

interface PickTokenModalProps {
    show: boolean;
    openChange: (open: boolean) => void;
    onSelectToken: (id: number) => void;
    tokens: Token[];
}

export const PickTokenModal = ({
    show,
    openChange,
    onSelectToken,
    tokens,
}: PickTokenModalProps) => {
    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Select Token</DialogTitle>
                </DialogHeader>

                <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1 py-2">
                    {tokens.length === 0 ? (
                        <div className="text-muted-foreground py-6 text-center">
                            No tokens available
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {tokens.map((token) => (
                                <button
                                    key={token.id}
                                    onClick={() => {
                                        onSelectToken(token.id);
                                        openChange(false); // optional: close after selection
                                    }}
                                    className={cn(
                                        "flex w-full items-center justify-between rounded-md px-4 py-3 text-left",
                                        "hover:bg-accent hover:text-accent-foreground",
                                        "focus:ring-ring focus:outline-none focus:ring-2 focus:ring-offset-2",
                                        "transition-colors",
                                    )}
                                >
                                    <div className="font-medium">
                                        {token.symbol?.toUpperCase() ?? "Unknown"}
                                    </div>
                                    <div className="text-muted-foreground font-mono text-sm">
                                        {token.id}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
