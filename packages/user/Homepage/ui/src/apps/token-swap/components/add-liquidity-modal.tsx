import { Plus } from "lucide-react";

import { TokenAmount } from "@shared/lib/plugins/token-swap";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";

import { useAddLiquidity } from "../hooks/use-add-liquidity";
import { useToken } from "../hooks/use-token";
import { AmountSummary } from "./amount-summary";

export const AddLiquidityModal = ({
    show,
    openChange,
    poolId,
    firstDeposit,
    secondDeposit,
    onSuccess,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    poolId?: number;
    firstDeposit?: TokenAmount;
    secondDeposit?: TokenAmount;
    onSuccess?: () => void;
}) => {
    const { mutateAsync: addLiquidity, isPending } = useAddLiquidity();

    const { data: firstDepositToken } = useToken(firstDeposit?.tokenId);

    const { data: secondDepositToken } = useToken(secondDeposit?.tokenId);

    const trigger = async () => {
        await addLiquidity([poolId!, firstDeposit!, secondDeposit!]);
        if (onSuccess) {
            onSuccess();
        }
        openChange(false);
    };

    return (
        <AlertDialog open={show}>
            <AlertDialogContent className="max-w-md">
                <AlertDialogHeader className="text-center">
                    <AlertDialogTitle className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        Add Liquidity
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                        Please review the details before confirming your
                        liquidity contribution.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="mt-3 space-y-4">
                    {/* From Account */}
                    <AmountSummary
                        amount={Number(firstDeposit?.amount).toString() || ""}
                        avatarSeed={firstDeposit?.tokenId?.toString() ?? "?"}
                        label="Deposit #1"
                        title={
                            firstDepositToken?.symbol ||
                            `ID: ${firstDeposit?.tokenId}`
                        }
                    />

                    <div className="flex justify-center">
                        <Plus className="text-slate-600 dark:text-slate-400" />
                    </div>

                    {/* To Account */}
                    <AmountSummary
                        amount={Number(secondDeposit?.amount).toString() ?? ""}
                        avatarSeed={secondDeposit?.tokenId?.toString() ?? "?"}
                        label="Deposit #2"
                        title={
                            secondDepositToken?.symbol ||
                            `ID: ${secondDeposit?.tokenId}`
                        }
                    />
                </div>

                <AlertDialogFooter className="mt-6 flex-col gap-3 sm:flex-row">
                    <AlertDialogCancel
                        onClick={() => {
                            openChange(false);
                        }}
                        className="order-2 w-full sm:order-1 sm:w-auto"
                    >
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        type="button"
                        onClick={() => {
                            trigger();
                        }}
                        disabled={isPending}
                        className="order-1 sm:order-2"
                    >
                        {isPending ? (
                            <div className="flex items-center gap-2">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"></div>
                                Depositing...
                            </div>
                        ) : (
                            "Deposit"
                        )}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
