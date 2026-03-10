import { UserX } from "lucide-react";
import { useState } from "react";

import { useConcludeMembershipApplication } from "@/hooks/fractals/use-conclude-membership-application";
import { useGuildAccount } from "@/hooks/use-guild-account";

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";

export function AlertConfirmRejectApplication({
    children,
    applicant,
}: {
    children: React.ReactNode;
    applicant?: string;
}) {
    const [open, setOpen] = useState(false);

    const guildAccount = useGuildAccount();
    const { mutateAsync, isPending } = useConcludeMembershipApplication();

    const handleReject = async () => {
        if (!guildAccount || !applicant) {
            console.error(
                "Error submitting rejection: guild account or applicant not found",
            );
            return;
        }
        await mutateAsync([guildAccount, applicant, false]);
        setOpen(false);
    };

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                        <UserX />
                    </AlertDialogMedia>
                    <AlertDialogTitle>Reject application?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This applicant will not become a member of the guild.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        variant="destructive"
                        onClick={handleReject}
                        disabled={isPending}
                    >
                        {isPending ? "Rejecting..." : "Reject"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
