import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@shared/shadcn/ui/dialog";
import { Button } from '@shared/shadcn/ui/button'

import { TokenAmount } from '@shared/lib/plugins/token-swap'
import { useCreatePool } from "../hooks/use-create-pool";


export const CreatePoolModal = ({
    show,
    openChange,
    firstDeposit,
    secondDeposit,
    onSuccess,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    firstDeposit?: TokenAmount,
    secondDeposit?: TokenAmount,
    onSuccess?: () => void,
}) => {

    const { mutateAsync: createPool, isPending } = useCreatePool()



    const trigger = async () => {
        await createPool([firstDeposit!, secondDeposit!])
        if (onSuccess) {
            onSuccess();
        }
        openChange(false)
    }

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Pool</DialogTitle>

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
                        {isPending ? "Creating pool" : "Create pool"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
