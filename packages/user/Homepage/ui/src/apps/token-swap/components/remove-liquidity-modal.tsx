import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from '@shared/shadcn/ui/button'

import { TokenAmount } from '@shared/lib/plugins/token-swap'
import { useRemoveLiquidity } from "../hooks/use-remove-liquidity";
import { useQuotePoolTokens } from "../hooks/use-quote-pool-tokens";
import { usePools } from "../hooks/use-pools";
import { AmountSummary } from "./amount-summary";
import { Minus } from "lucide-react";


export const RemoveLiquidityModal = ({
    show,
    openChange,
    amount,
    onSuccess,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    amount?: TokenAmount,
    onSuccess?: () => void,
}) => {

    const { data: pools } = usePools(4000);
    const focusedPool = (pools || []).find(pool => pool.id == amount?.tokenId)

    const { data: outputs } = useQuotePoolTokens(!!focusedPool, focusedPool, amount?.amount)
    const { mutateAsync: removeLiquidity, isPending } = useRemoveLiquidity()

    const [firstWithdrawal, secondWithdrawal] = outputs || [];

    const trigger = async () => {
        await removeLiquidity([amount!])
        if (onSuccess) {
            onSuccess();
        }
        openChange(false)
    }

    return (
        <AlertDialog open={show}>
            <AlertDialogContent className="max-w-md">
                <AlertDialogHeader className="text-center">
                    <AlertDialogTitle className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        Confirm Swap
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                        Please review the details before confirming your
                        trade.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="mt-3 space-y-4">
                    <AmountSummary
                        amount={firstWithdrawal?.amount || ''}
                        avatarSeed={firstWithdrawal?.tokenId?.toString() ?? '?'}
                        label='Withdrawal #1'
                        title={firstWithdrawal?.tokenId.toString() ?? '?'}
                    />


                    <div className="flex justify-center">
                        <Minus className="text-slate-600 dark:text-slate-400" />
                    </div>

                    <AmountSummary
                        amount={secondWithdrawal?.amount ?? ''}
                        avatarSeed={secondWithdrawal?.tokenId?.toString() ?? '?'}
                        label='Withdrawal #2'
                        title={secondWithdrawal?.tokenId?.toString() ?? '?'}
                    />
                </div>



                <AlertDialogFooter className="mt-6 flex-col gap-3 sm:flex-row">
                    <AlertDialogCancel
                        onClick={() => { openChange(false) }}
                        className="order-2 w-full sm:order-1 sm:w-auto"
                    >
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        type="button"
                        onClick={() => {
                            trigger()
                        }}
                        disabled={isPending}
                        className="order-1 sm:order-2"
                    >
                        {isPending ? (
                            <div className="flex items-center gap-2">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"></div>
                                Removing...
                            </div>
                        ) : (
                            "Remove Liquidity"
                        )}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
