import type { FormSchema } from "../hooks/useTokenForm";
import type { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";

import { Quantity } from "@/apps/tokens/lib/quantity";
import { useMemo } from "react";
import { useFormContext } from "react-hook-form";

import { useAvatar } from "@/hooks/use-avatar";
import { useCurrentUser } from "@/hooks/use-current-user";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
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
    selectedToken?: Token;
}

export const TransferModal = ({
    open,
    onContinue,
    onClose,
    isPending,
    selectedToken,
}: Props) => {
    const { data: currentUser } = useCurrentUser();
    const form = useFormContext<FormSchema>();

    const to = form.watch("to");
    const amount = form.watch("amount");

    const { avatarSrc: fromAvatar } = useAvatar(currentUser);
    const { avatarSrc: toAvatar } = useAvatar(to);

    const quantity = useMemo(() => {
        if (!selectedToken || !form.formState.isValid) return null;
        const { precision, id, symbol } = selectedToken;
        return new Quantity(amount, precision, id, symbol);
    }, [amount, selectedToken, form.formState.isValid]);

    if (!quantity) return null;

    return (
        <AlertDialog open={open}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Token transfer</AlertDialogTitle>
                    <div className="grid w-full grid-cols-2 gap-2">
                        {[
                            { label: "From", address: currentUser },
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
