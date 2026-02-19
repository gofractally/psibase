
import { useCreateGuildInvite } from "@/hooks/fractals/use-create-guild-invite";
import { Button } from '@shared/shadcn/ui/button'
import { Copy, RefreshCcw } from "lucide-react";

import { cn } from "@shared/lib/utils";
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    Dialog,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { toast } from "@shared/shadcn/ui/sonner";
import { siblingUrl } from "@psibase/common-lib";
import { useGuildAccount } from "@/hooks/use-guild-account";
import { useEffect } from "react";
import { getSubDomain } from "@shared/lib/get-sub-domain";



export const InviteGuildMemberModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {

    const { mutateAsync: createGuildInvite, isPending: isCreatingGuildInvite, data: inviteString, error, isSuccess } = useCreateGuildInvite();

    const guildAccount = useGuildAccount();
    const link = siblingUrl(null, getSubDomain(), `/invite?token=${inviteString}`, true)

    console.log({ link, inviteString });

    useEffect(() => {
        if (show && !isSuccess)
        createGuildInvite([guildAccount!])
    }, [show, isSuccess, guildAccount, createGuildInvite])

    const onCopyClick = async () => {
        if (!link) {
            toast("No invite link.");
            return;
        }
        if ("clipboard" in navigator) {
            await navigator.clipboard.writeText(link);
            toast("Copied to clipboard.");
        } else {
            toast("Copying failed, not in secure context?");
            createGuildInvite([guildAccount!])
        }
    };

    return (
                    <Dialog open={show} onOpenChange={openChange}>


        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Share link</DialogTitle>
                <DialogDescription>
                    Anyone who has this link will be able to apply to the guild without fee.
                </DialogDescription>
            </DialogHeader>
            <div className="flex items-center space-x-2">
                <div className="grid flex-1 gap-2">
                    <Label htmlFor="link" className="sr-only">
                        Link
                    </Label>
                    <Input
                        id="link"
                        className={cn({ italic: isCreatingGuildInvite })}
                        value={link || "Loading"}
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
                    onClick={() => createGuildInvite([guildAccount!])}
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
                {error && (
                    <div className="text-destructive">
                        {error.message}
                    </div>
                )}
            </DialogFooter>
        </DialogContent>
                    </Dialog>

    );
};
