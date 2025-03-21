import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    // AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useAvatar } from "@/hooks/use-avatar";
import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentUser } from "@/hooks/use-current-user";

import { useBalances } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { Quantity } from "@/apps/tokens/lib/quantity";

interface Props {
    open: boolean;
    onContinue: () => void;
    onClose: () => void;
    isPending: boolean;
    title?: string;
    from?: string | null;
    amount?: string;
    tokenId?: number;
    to?: string;
}

export const TransferModal = ({
    open,
    onContinue,
    onClose,
    from,
    to,
    isPending,
    tokenId,
    amount,
}: Props) => {
    const { data } = useChainId();
    const chainId = data || "";

    const { data: currentUserData } = useCurrentUser();

    const { data: balances } = useBalances(currentUserData);
    const token = balances?.tokens.find((token) => token.id == tokenId);

    const convertedToInteger = Math.floor(
        Number(amount) * Math.pow(10, token?.precision || 0),
    );

    const quantity = token
        ? new Quantity(convertedToInteger.toString(), token.precision, token.id)
        : undefined;

    const numSymbol = quantity ? quantity.format(true).split(" ") : ["", ""];
    const [amountFormatted, symbol] = numSymbol;

    const fromAvatar = useAvatar(from);
    const toAvatar = useAvatar(to);

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
                                <div className="text-center text-muted-foreground">
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
                        <span>{amountFormatted}</span>
                        <span className="text-muted-foreground">{symbol}</span>
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
