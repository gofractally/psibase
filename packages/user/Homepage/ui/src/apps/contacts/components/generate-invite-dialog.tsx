import { type UseMutationResult } from "@tanstack/react-query";
import { Copy, RefreshCcw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    DialogClose,
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

export const GenerateInviteDialogContent = ({
    generateInvite,
}: {
    generateInvite: UseMutationResult<string, Error, void, unknown>;
}) => {
    const onCopyClick = async () => {
        if (!generateInvite.data) {
            toast("No invite link.");
            return;
        }
        if ("clipboard" in navigator) {
            await navigator.clipboard.writeText(generateInvite.data);
            toast("Copied to clipboard.");
        } else {
            toast("Copying failed, not in secure context?");
            generateInvite.mutate();
        }
    };

    const inviteUrl = generateInvite.data;
    const showQr = Boolean(inviteUrl) && !generateInvite.isPending;

    return (
        <DialogContent className="sm:max-w-xl">
            <DialogHeader>
                <DialogTitle>Share invite</DialogTitle>
                <DialogDescription>
                    Anyone who has this link or scans the code will be able to
                    create an account.
                </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-6">
                <div className="bg-white p-4">
                    {showQr ? (
                        <QRCodeSVG
                            value={inviteUrl!}
                            size={QR_SIZE}
                            marginSize={0}
                            title="Invite QR code"
                        />
                    ) : (
                        <div
                            className="bg-muted"
                            style={{ width: QR_SIZE, height: QR_SIZE }}
                            aria-hidden
                        />
                    )}
                </div>
                <div className="flex w-full items-center space-x-2">
                    <div className="grid flex-1 gap-2">
                        <Label htmlFor="link" className="sr-only">
                            Link
                        </Label>
                        <Input
                            id="link"
                            className={cn({ italic: generateInvite.isPending })}
                            value={inviteUrl || "Loading"}
                            readOnly
                        />
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        className="px-3"
                        onClick={() => onCopyClick()}
                    >
                        <span className="sr-only">Copy</span>
                        <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="px-3"
                        onClick={() => generateInvite.mutate()}
                    >
                        <span className="sr-only">Refresh</span>
                        <RefreshCcw className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <DialogFooter className="sm:justify-start">
                <DialogClose asChild>
                    <Button type="button" variant="secondary">
                        Close
                    </Button>
                </DialogClose>
                {generateInvite.error && (
                    <div className="text-destructive">
                        {generateInvite.error.message}
                    </div>
                )}
            </DialogFooter>
        </DialogContent>
    );
};
