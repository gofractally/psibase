import { useClaimPurchasedName } from "@/apps/accounts-marketplace/hooks/use-claim-purchased-name";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

type Props = {
    account: string;
    open: boolean;
    onClose: () => void;
};

export const ClaimNameDialog = ({ account, open, onClose }: Props) => {
    const { continueClaim, isClaiming, isOpeningImport } =
        useClaimPurchasedName(account);
    const isBusy = isClaiming || isOpeningImport;

    return (
        <Dialog open={open} onOpenChange={() => {}}>
            <DialogContent
                className="sm:max-w-xl"
                showCloseButton={false}
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>Claim name?</DialogTitle>
                    <DialogDescription>
                        Claiming{" "}
                        <span className="text-primary font-mono">
                            {account}
                        </span>{" "}
                        creates the account and reveals its private key.
                        You&apos;ll be prompted to save the key and confirm it
                        before you can use the account.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy}
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void continueClaim()}
                    >
                        {isClaiming
                            ? "Claiming..."
                            : isOpeningImport
                              ? "Opening..."
                              : "Continue"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
