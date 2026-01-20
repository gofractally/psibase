import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@shared/shadcn/ui/dialog";
import { Button } from '@shared/shadcn/ui/button'

import { useAddLiquidity } from "../hooks/use-add-liquidity";
import { TokenAmount } from '@shared/lib/plugins/token-swap'


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
    poolId?: number,
    firstDeposit?: TokenAmount,
    secondDeposit?: TokenAmount,
    onSuccess?: () => void,
}) => {

    const { mutateAsync: addLiquidity, isPending } = useAddLiquidity()



    const trigger = async () => {
        await addLiquidity([poolId!, firstDeposit!, secondDeposit!])
        if (onSuccess) {
            onSuccess();
        }
        openChange(false)
    }

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add liquidity</DialogTitle>

                    <div className="flex justify-around gap-2">

                        <div>
                            {firstDeposit?.tokenId}
                            {firstDeposit?.amount}
                        </div>
                        <div>
                            {secondDeposit?.tokenId}
                            {secondDeposit?.amount}
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
                        {isPending ? "Adding" : "Add liquidity"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
