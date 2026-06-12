import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { useClaimAndSetKey } from "@/apps/prem-accounts/hooks/use-claim-and-set-key";
import QueryKey from "@/lib/query-keys";

import { ConfirmKeyStep } from "@shared/components/account-key/confirm-key-step";
import { SaveKeyStep } from "@shared/components/account-key/save-key-step";
import { pemToB64 } from "@shared/lib/b64-key-utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Progress } from "@shared/shadcn/ui/progress";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { toast } from "@shared/shadcn/ui/sonner";

type Step = "1_EXPLAIN" | "2_SAVE" | "3_CONFIRM";

type Props = {
    account: string;
    open: boolean;
    onClose: () => void;
};

/**
 * Captive dialog that walks the user through claiming a purchased account
 * name. Once the claim has been kicked off, the dialog cannot be dismissed
 * until the user has saved their new private key and confirmed it by
 * re-importing the account.
 */
export const ClaimNameDialog = ({ account, open, onClose }: Props) => {
    const [step, setStep] = useState<Step>("1_EXPLAIN");
    const [keyB64, setKeyB64] = useState("");

    const queryClient = useQueryClient();
    const { data: currentUser } = useCurrentUser();
    const claimMutation = useClaimAndSetKey();
    const isClaiming = claimMutation.isPending;

    const invalidateClaimQueries = () => {
        void queryClient.invalidateQueries({
            queryKey: QueryKey.premUnclaimedNames(currentUser),
        });
        void queryClient.invalidateQueries({
            queryKey: QueryKey.premNameEvents(currentUser),
        });
    };

    const close = () => {
        onClose();
        setStep("1_EXPLAIN");
        setKeyB64("");
    };

    const handleContinue = async () => {
        try {
            const privateKey = await claimMutation.mutateAsync([account]);
            setKeyB64(pemToB64(privateKey));
            setStep("2_SAVE");
        } catch (error) {
            console.error("Failed to claim account:", error);
        }
    };

    return (
        <Dialog open={open} onOpenChange={() => {}}>
            <DialogContent
                className="sm:max-w-xl"
                showCloseButton={false}
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                <Progress
                    value={
                        step === "1_EXPLAIN" ? 33 : step === "2_SAVE" ? 67 : 100
                    }
                />
                {step === "1_EXPLAIN" && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Claim name?</DialogTitle>
                            <DialogDescription>
                                Claiming{" "}
                                <span className="text-primary font-mono">
                                    {account}
                                </span>{" "}
                                creates the account and reveals its private key.
                                You&apos;ll be prompted to save the key and
                                confirm it before you can use the account.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={isClaiming}
                                onClick={close}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={isClaiming}
                                onClick={() => void handleContinue()}
                            >
                                {isClaiming ? "Claiming..." : "Continue"}
                            </Button>
                        </DialogFooter>
                    </>
                )}

                {step === "2_SAVE" && (
                    <>
                        <DialogTitle className="sr-only">
                            Secure your account
                        </DialogTitle>
                        <SaveKeyStep
                            accountName={account}
                            keyB64={keyB64}
                            onContinue={() => setStep("3_CONFIRM")}
                            contentClassName="px-0"
                            footerClassName="px-0"
                        />
                    </>
                )}

                {step === "3_CONFIRM" && (
                    <>
                        <DialogTitle className="sr-only">
                            Confirm your key
                        </DialogTitle>
                        <ConfirmKeyStep
                            expectedAccount={account}
                            onBack={() => setStep("2_SAVE")}
                            title="Confirm your key"
                            description="Re-enter your new account name and private key to confirm you saved them."
                            mismatchMessage="Account name must match the account name you just claimed"
                            importErrorMessage="Error importing account. Check your private key and try again."
                            onImported={() => {
                                invalidateClaimQueries();
                                toast.success(
                                    `Account "${account}" claimed and imported`,
                                );
                                close();
                            }}
                            contentClassName="px-0"
                            footerClassName="px-0"
                        />
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};
