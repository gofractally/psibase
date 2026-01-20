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
import { useCreatePool } from "../hooks/use-create-pool";
import { AmountSummary } from "./amount-summary";
import { Plus } from "lucide-react";


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
        <AlertDialog open={show}>
            <AlertDialogContent className="max-w-md">
                <AlertDialogHeader className="text-center">
                    <AlertDialogTitle className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        Create Pool
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                        By proceeding you will be creating a pool and adding your below token amounts.
                        It is import both token deposits are of equal market value.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="mt-3 space-y-4">
                    <AmountSummary
                        amount={firstDeposit?.amount || ''}
                        avatarSeed={firstDeposit?.tokenId?.toString() ?? '?'}
                        label='Founding deposit #1'
                        title={firstDeposit?.tokenId.toString() ?? '?'}
                    />


                    <div className="flex justify-center">
                        <Plus className="text-slate-600 dark:text-slate-400" />
                    </div>

                    <AmountSummary
                        amount={secondDeposit?.amount ?? ''}
                        avatarSeed={secondDeposit?.tokenId?.toString() ?? '?'}
                        label='Founding deposit #2'
                        title={secondDeposit?.tokenId?.toString() ?? '?'}
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
                                Creating...
                            </div>
                        ) : (
                            "Create pool"
                        )}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
