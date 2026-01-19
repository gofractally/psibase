import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@shared/shadcn/ui/dialog";
import { Button } from '@shared/shadcn/ui/button'

import { useSwap } from "../hooks/use-swap";
import { usePools } from "../hooks/use-pools";
import z from "zod";

export const ConfirmSwapModal = ({
    show,
    openChange,
    poolIds,
    minimumReturn,
    fromAmount,
    fromToken,
    onSuccess,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    poolIds?: string[],
    minimumReturn?: string
    fromAmount?: string,
    fromToken?: number,
    toToken?: number,
    onSuccess?: () => void,
}) => {
    const { mutateAsync: swap, isPending } = useSwap();

    const { data: pools } = usePools();

    console.log({ poolIds, minimumReturn, fromAmount, fromToken, pools, isPending })

    const triggerSwap = async () => {
        await swap([z.string().array().parse(poolIds), { amount: z.string().parse(fromAmount), tokenId: z.number().parse(fromToken), }, z.string().parse(minimumReturn)])
        if (onSuccess) {
            onSuccess();
        }
        openChange(false)
    }

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Swap tokens</DialogTitle>
                    <div>
                        this is gonna swap from a to b
                    </div>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="submit"
                        disabled={isPending}
                        onClick={() => {
                            triggerSwap()
                        }}
                    >
                        {isPending ? "Swapping" : "Swap"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
