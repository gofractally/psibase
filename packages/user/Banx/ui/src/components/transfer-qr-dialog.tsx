import { Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { displayAmount } from "@/lib/amount";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { toast } from "@shared/shadcn/ui/sonner";

const QR_SIZE = 224;

export function TransferQrDialog({
    open,
    onOpenChange,
    url,
    payee,
    amount,
    symbol,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    url: string | null;
    payee: string;
    amount: string;
    symbol: string;
}) {
    const onCopy = async () => {
        if (!url) {
            toast("No transfer link.");
            return;
        }
        if ("clipboard" in navigator) {
            await navigator.clipboard.writeText(url);
            toast("Copied to clipboard.");
        } else {
            toast("Copying failed, not in a secure context.");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <QrCode className="size-4" />
                        Transfer QR
                    </DialogTitle>
                    <DialogDescription>
                        {url ? (
                            <>
                                <span className="text-foreground font-medium">
                                    {payee}
                                </span>{" "}
                                receives{" "}
                                <span className="text-foreground font-medium">
                                    {displayAmount(amount)} {symbol}
                                </span>
                                . The link sets the currency to {symbol}.
                            </>
                        ) : (
                            "Enter a payee, an amount, and a currency."
                        )}
                    </DialogDescription>
                </DialogHeader>
                {url ? (
                    <div className="flex flex-col items-center gap-6">
                        <div className="bg-white p-4">
                            <QRCodeSVG
                                value={url}
                                size={QR_SIZE}
                                marginSize={0}
                                title="Transfer QR code"
                            />
                        </div>
                        <div className="flex w-full items-center space-x-2">
                            <div className="grid flex-1 gap-2">
                                <Label htmlFor="transfer-link" className="sr-only">
                                    Link
                                </Label>
                                <Input
                                    id="transfer-link"
                                    value={url}
                                    readOnly
                                />
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                className="px-3"
                                onClick={() => void onCopy()}
                            >
                                <span className="sr-only">Copy</span>
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                ) : null}
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onOpenChange(false)}
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
