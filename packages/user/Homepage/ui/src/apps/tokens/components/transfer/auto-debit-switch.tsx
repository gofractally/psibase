import { useState } from "react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Label } from "@shared/shadcn/ui/label";
import { toast } from "@shared/shadcn/ui/sonner";
import { Switch } from "@shared/shadcn/ui/switch";

import {
    useToggleUserManualDebit,
    useUserManualDebit,
} from "../../hooks/tokensPlugin/use-user-manual-debit";

export const AutoDebitSwitch = ({
    currentUser,
}: {
    currentUser: string | null;
}) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { mutateAsync } = useToggleUserManualDebit(currentUser);
    const { data: manualDebit } = useUserManualDebit(currentUser);
    const autoDebit = !manualDebit;

    const handleSwitchClick = () => {
        setIsDialogOpen(true);
    };

    const handleConfirm = async () => {
        try {
            await mutateAsync({ enable: autoDebit });
            toast.success(
                autoDebit ? "Auto debit turned off" : "Auto debit turned on",
            );
            setIsDialogOpen(false);
        } catch (e) {
            toast.error("Failed to toggle auto debit", {
                closeButton: true,
                richColors: true,
                duration: Infinity,
                description:
                    e instanceof Error
                        ? e.message
                        : `Unrecognised error, see logs.`,
            });
        }
    };

    return (
        <>
            <div className="flex items-center justify-end space-x-2">
                <Label htmlFor="auto-debit">Auto debit</Label>
                <Switch
                    id="auto-debit"
                    checked={autoDebit}
                    onCheckedChange={handleSwitchClick}
                />
            </div>
            <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {autoDebit
                                ? "Turn Auto Debit Off?"
                                : "Turn Auto Debit On?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {autoDebit ? (
                                <>
                                    Turning auto debit off prevents direct token
                                    transfers to you. Incoming tokens will
                                    appear on the Pending page where you can
                                    Accept or Reject them. These tokens won't be
                                    added to your balance until accepted, and
                                    senders can cancel them while pending.
                                </>
                            ) : (
                                <div className="space-y-2">
                                    <p>
                                        Turning auto debit on allows direct
                                        token transfers to you. Received tokens
                                        are immediately added to your balance
                                        and appear in your transfer history
                                        automatically. These transfers are
                                        final.
                                    </p>
                                    <p>
                                        Note: Any existing pending inbound
                                        transfers will still need to be handled
                                        manually.
                                    </p>
                                </div>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirm}>
                            Proceed
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
