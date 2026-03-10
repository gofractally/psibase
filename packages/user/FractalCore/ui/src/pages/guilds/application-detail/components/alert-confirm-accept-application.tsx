import { UserCheck } from "lucide-react";
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

export function AlertConfirmAcceptApplication({
    children,
    applicant,
}: {
    children: React.ReactNode;
    applicant?: string;
}) {
    const [open, setOpen] = useState(false);

    const guildAccount = useGuildAccount();
    const { mutateAsync, isPending } = useConcludeMembershipApplication();

    const handleAccept = async () => {
        if (!guildAccount || !applicant) {
            console.error(
                "Error submitting acceptance: guild account or applicant not found",
            );
            return;
        }
        await mutateAsync([guildAccount, applicant, true]);
        setOpen(false);
    };
    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogMedia>
                        <UserCheck />
                    </AlertDialogMedia>
                    <AlertDialogTitle>Accept application?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This applicant will become a member of the guild.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        variant="default"
                        disabled={isPending}
                        onClick={handleAccept}
                    >
                        {isPending ? "Accepting..." : "Accept"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
