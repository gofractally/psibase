import type { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";

import { Quantity } from "@/apps/tokens/lib/quantity";
import { useStore } from "@tanstack/react-form";
import { useMemo } from "react";

import { useAvatar } from "@/hooks/use-avatar";
import { useCurrentUser } from "@/hooks/use-current-user";

import { withForm } from "@shared/components/form/app-form";
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

import { defaultTransferValues } from "../hooks/useTokenForm";

export const TransferModal = withForm({
    defaultValues: defaultTransferValues,
    props: {
        open: false,
        onClose: () => {},
        selectedToken: undefined as Token | undefined,
        onSubmit: () => {},
    },
    render: function TransferModal({
        form,
        open,
        onClose,
        selectedToken,
        onSubmit,
    }) {
        const { data: currentUser } = useCurrentUser();

        const [to, amount, isSubmitting] = useStore(form.store, (state) => [
            state.values.to.account,
            state.values.amount,
            state.isSubmitting,
        ]);

        const { avatarSrc: fromAvatar } = useAvatar(currentUser);
        const { avatarSrc: toAvatar } = useAvatar(to);

        const quantity = useMemo(() => {
            if (!selectedToken) return null;
            const { precision, id, symbol } = selectedToken;
            try {
                return new Quantity(amount.amount, precision, id, symbol);
            } catch (error) {
                console.log(error);
                return null;
            }
        }, [amount.amount, selectedToken]);

        if (!quantity) return <></>;

        return (
            <AlertDialog open={open}>
                <AlertDialogContent>
                    <AlertDialogDescription>
                        Are you sure you want to send {quantity.format()} to{" "}
                        {to}?
                    </AlertDialogDescription>
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

                        <Button
                            type="button"
                            onClick={onSubmit}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Sending..." : "Confirm"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        );
    },
});
