import { type UseMutationResult } from "@tanstack/react-query";
import { Copy, RefreshCcw } from "lucide-react";

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

    return (
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Share link</DialogTitle>
                <DialogDescription>
                    Anyone who has this link will be able to create an account.
                </DialogDescription>
            </DialogHeader>
            <div className="flex items-center space-x-2">
                <div className="grid flex-1 gap-2">
                    <Label htmlFor="link" className="sr-only">
                        Link
                    </Label>
                    <Input
                        id="link"
                        className={cn({ italic: generateInvite.isPending })}
                        value={generateInvite.data || "Loading"}
                        readOnly
                    />
                </div>
                <Button
                    type="submit"
                    size="sm"
                    className="px-3"
                    onClick={() => onCopyClick()}
                >
                    <span className="sr-only">Copy</span>
                    <Copy className="h-4 w-4" />
                </Button>
                <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="px-3"
                    onClick={() => generateInvite.mutate()}
                >
                    <span className="sr-only">Refresh</span>
                    <RefreshCcw className="h-4 w-4" />
                </Button>
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
