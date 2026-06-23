import type { ReactNode } from "react";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { Quantity } from "@shared/lib/quantity";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";
import { Dialog, DialogContent } from "@shared/shadcn/ui/dialog";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@shared/shadcn/ui/empty";
import { Item, ItemContent } from "@shared/shadcn/ui/item";
export type BuyNameConfirmationMode = "buy-and-claim" | "buy-only";

const DESCRIPTION_BY_MODE: Record<
    BuyNameConfirmationMode,
    (account: string) => ReactNode
> = {
    "buy-and-claim": (account) => (
        <>
            You are about to buy and claim{" "}
            <span className="text-primary font-medium">{account}</span>.
        </>
    ),
    "buy-only": (account) => (
        <>
            You are about to buy{" "}
            <span className="text-primary font-medium">{account}</span>.
        </>
    ),
};

export const BuyNameConfirmationDialog = ({
    open,
    setOpen,
    mode,
    account,
    price,
    previousPrice,
    isLoading,
    onConfirm,
    purchaseComplete = false,
    claimPageHref,
}: {
    open: boolean;
    setOpen: (open: boolean) => void;
    mode: BuyNameConfirmationMode;
    account: string;
    price: Quantity;
    /** Price shown before submit re-validation; used to warn if the ask increased. */
    previousPrice?: Quantity | null;
    isLoading: boolean;
    onConfirm: () => void;
    /** When true (buy-only), show success state instead of the confirmation form. */
    purchaseComplete?: boolean;
    /** Route to the claim page; required when `purchaseComplete` is true in buy-only mode. */
    claimPageHref?: string;
}) => {
    const trimmedAccount = account.trim();
    const priceIncreased =
        previousPrice != null && price.isGreaterThan(previousPrice);

    if (purchaseComplete && mode === "buy-only" && claimPageHref) {
        return (
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-sm">
                    <Empty className="border-0 p-0">
                        <EmptyHeader>
                            <EmptyMedia
                                variant="icon"
                                className="bg-green-500/10 text-green-600 dark:text-green-400"
                            >
                                <CircleCheck />
                            </EmptyMedia>
                            <EmptyTitle>Purchase complete</EmptyTitle>
                            <EmptyDescription>
                                You bought{" "}
                                <span className="text-primary font-medium">
                                    {trimmedAccount}
                                </span>
                                . You can claim your account anytime on the
                                Claim page.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button asChild>
                                <Link
                                    to={claimPageHref}
                                    onClick={() => setOpen(false)}
                                >
                                    Go to Claim
                                </Link>
                            </Button>
                        </EmptyContent>
                    </Empty>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Buy account name?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {DESCRIPTION_BY_MODE[mode](trimmedAccount)}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="mt-1 w-full space-y-2.5">
                    {priceIncreased ? (
                        <Alert variant="warning">
                            <TriangleAlert />
                            <AlertTitle variant="warning">
                                Price increased
                            </AlertTitle>
                            <AlertDescription variant="warning">
                                <p>
                                    The market price rose from{" "}
                                    <span className="font-medium tabular-nums">
                                        {previousPrice.format({
                                            includeLabel: true,
                                        })}
                                    </span>{" "}
                                    to{" "}
                                    <span className="font-medium tabular-nums">
                                        {price.format({ includeLabel: true })}
                                    </span>{" "}
                                    since you last saw it. The amounts below
                                    use the current price.
                                </p>
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    <Item variant="muted" className="flex-col items-stretch">
                        <ItemContent className="gap-3">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground text-sm font-light">
                                    Price
                                </span>
                                <span className="text-primary text-sm font-semibold tabular-nums">
                                    {price.format({
                                        includeLabel: true,
                                    })}
                                </span>
                            </div>
                        </ItemContent>
                    </Item>
                    <AlertDialogDescription>
                        Do you want to continue?
                    </AlertDialogDescription>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLoading}>
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isLoading}
                        onClick={(e) => {
                            e.preventDefault();
                            void onConfirm();
                        }}
                    >
                        {isLoading ? "Buying..." : "Buy"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
