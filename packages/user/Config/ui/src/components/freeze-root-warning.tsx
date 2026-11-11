import { TriangleAlert } from "lucide-react";

import type { RootFreezeGap } from "@/lib/freeze-root-gap";

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";
import { Spinner } from "@shared/shadcn/ui/spinner";

const listAccounts = (accounts: string[]) => accounts.join(", ");

export const FreezeRootWarning = ({
    gaps,
    pending,
    onOpenChange,
    onUnderstand,
}: {
    gaps: RootFreezeGap[] | null;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onUnderstand: () => void;
}) => {
    return (
        <AlertDialog open={gaps != null} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogMedia className="text-orange-600 dark:text-orange-400">
                        <TriangleAlert />
                    </AlertDialogMedia>
                    <AlertDialogTitle>
                        Root account is not included
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        A root account can still act for its subaccounts and
                        unfreeze them.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
                    {gaps?.map((gap) => (
                        <li key={gap.root}>
                            <span className="font-medium">{gap.root}</span>
                            <span className="text-muted-foreground">
                                {" "}
                                — {listAccounts(gap.subaccounts)}
                            </span>
                        </li>
                    ))}
                </ul>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        type="button"
                        disabled={pending}
                        onClick={onUnderstand}
                    >
                        {pending ? <Spinner data-icon="inline-start" /> : null}
                        I understand
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
