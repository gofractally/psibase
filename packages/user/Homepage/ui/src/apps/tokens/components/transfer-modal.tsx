import { Quantity } from "@/apps/tokens/lib/quantity";

import { useAvatar } from "@/hooks/use-avatar";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    // AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";

interface Props {
    open: boolean;
    onContinue: () => void;
    onClose: () => void;
    isPending: boolean;
    title?: string;
    from?: string | null;
    to?: string;
    quantity: Quantity | null;
}

export const TransferModal = ({
    open,
    onContinue,
    onClose,
    from,
    to,
    isPending,
    quantity,
}: Props) => {
    const { avatarSrc: fromAvatar } = useAvatar(from);
    const { avatarSrc: toAvatar } = useAvatar(to);

    if (!quantity) return null;

    return (
        <AlertDialog open={open}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Token transfer</AlertDialogTitle>
                    <div className="grid w-full grid-cols-2 gap-2">
                        {[
                            { label: "From", address: from },
                            { label: "To", address: to },
                        ].map(({ label, address }) => (
                            <div
                                key={label}
                                className="flex flex-col items-center gap-1 "
                            >
                                <div className="text-muted-foreground text-center">
                                    {label}
                                </div>
                                <div>
                                    <img
                                        className="h-20 w-20 border object-cover"
                                        src={
                                            label == "From"
                                                ? fromAvatar
                                                : toAvatar
                                        }
                                    />
                                </div>
                                <div className="truncate text-center text-lg">
                                    {address}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex w-full justify-center gap-2 text-center text-xl font-semibold">
                        <span>Sending </span>
                        <span>{quantity.format()}</span>
                    </div>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => onClose()}>
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isPending}
                        onClick={() => onContinue()}
                    >
                        {isPending ? "Sending" : "Send"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
