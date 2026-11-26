import { Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { displayAmount } from "@/lib/amount";
import type { PayRequest } from "@/lib/graphql";
import { invoicePayUrl } from "@/lib/invoice-url";

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

export function InvoiceQrDialog({
    open,
    onOpenChange,
    request,
    symbol,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    request: PayRequest | null;
    symbol: string;
}) {
    const url = request ? invoicePayUrl(request) : "";

    const onCopy = async () => {
        if (!url) {
            toast("No invoice link.");
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
                        Invoice QR
                    </DialogTitle>
                    <DialogDescription>
                        {request ? (
                            <>
                                Show this code so anyone with a path to you can
                                pay{" "}
                                <span className="text-foreground font-medium">
                                    {displayAmount(request.remaining)} {symbol}
                                </span>
                                {request.memo
                                    ? ` · ${request.memo}`
                                    : ""}. They do not need your account name.
                            </>
                        ) : (
                            "Select an invoice to share."
                        )}
                    </DialogDescription>
                </DialogHeader>
                {request ? (
                    <div className="flex flex-col items-center gap-6">
                        <div className="bg-white p-4">
                            <QRCodeSVG
                                value={url}
                                size={QR_SIZE}
                                marginSize={0}
                                title="Invoice QR code"
                            />
                        </div>
                        <div className="flex w-full items-center space-x-2">
                            <div className="grid flex-1 gap-2">
                                <Label htmlFor="invoice-link" className="sr-only">
                                    Link
                                </Label>
                                <Input
                                    id="invoice-link"
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
