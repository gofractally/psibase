import { Quantity } from "@shared/lib/quantity";
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
import { Item, ItemContent } from "@shared/shadcn/ui/item";
import { Separator } from "@shared/shadcn/ui/separator";

export const BuyNameConfirmationDialog = ({
    open,
    setOpen,
    account,
    price,
    slippage,
    isLoading,
    onConfirm,
}: {
    open: boolean;
    setOpen: (open: boolean) => void;
    account: string;
    price: Quantity;
    slippage: number;
    isLoading: boolean;
    onConfirm: () => void;
}) => {
    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Buy account name?</AlertDialogTitle>
                    <AlertDialogDescription>
                        You are about to buy and claim{" "}
                        <span className="text-primary font-medium">
                            {account.trim()}
                        </span>
                        .
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="mt-1 w-full space-y-2.5">
                    <Item variant="muted" className="flex-col items-stretch">
                        <ItemContent className="gap-3">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground text-sm font-light">
                                    Market price
                                </span>
                                <span className="text-primary text-sm font-medium tabular-nums">
                                    {price.format({
                                        includeLabel: true,
                                    })}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground text-sm font-light">
                                    Slippage
                                </span>
                                <span className="text-primary text-sm font-medium tabular-nums">
                                    Up to {slippage}%
                                </span>
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground text-sm font-light">
                                    Maximum cost
                                </span>
                                <span className="text-primary text-sm font-semibold tabular-nums">
                                    {price
                                        ?.multiply(1 + slippage / 100)
                                        .format({
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
