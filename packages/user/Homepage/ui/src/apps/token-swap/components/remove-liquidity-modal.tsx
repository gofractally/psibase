import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@shared/shadcn/ui/dialog";
import { Button } from '@shared/shadcn/ui/button'

import { TokenAmount } from '@shared/lib/plugins/token-swap'
import { useRemoveLiquidity } from "../hooks/use-remove-liquidity";
import { useQuotePoolTokens } from "../hooks/use-quote-pool-tokens";
import { usePools } from "../hooks/use-pools";


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
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Remove Liquidity</DialogTitle>

                    <div className="flex justify-around gap-2">

                        <div>
                            {firstWithdrawal?.tokenId}
                            {firstWithdrawal?.amount}
                        </div>
                        <div>
                            {secondWithdrawal?.tokenId}
                            {secondWithdrawal?.amount}
                        </div>
                    </div>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="submit"
                        disabled={isPending}
                        onClick={() => {
                            trigger()
                        }}
                    >
                        {isPending ? "Removing" : "Remove Liquidity"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
