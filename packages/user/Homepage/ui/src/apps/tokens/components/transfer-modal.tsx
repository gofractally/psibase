import type { Token } from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balances";

import { useStore } from "@tanstack/react-form";
import { ArrowDown, Loader2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar } from "@shared/components/avatar";
import { withForm } from "@shared/components/form/app-form";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import { Quantity } from "@shared/lib/quantity";
import { cn } from "@shared/lib/utils";
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
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Label } from "@shared/shadcn/ui/label";

import { defaultTransferValues } from "../lib/transfer-form-schema";

const Party = ({
    label,
    account,
    primary,
    secondary,
}: {
    label: string;
    account: string;
    primary: string;
    secondary?: string;
}) => (
    <div className="bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2.5">
        <Avatar account={account} className="size-9 shrink-0" alt={label} />
        <div className="min-w-0 flex-1 leading-tight">
            <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                {label}
            </p>
            <p className="truncate text-sm font-medium">{primary}</p>
            {secondary && (
                <p className="text-muted-foreground truncate font-mono text-xs">
                    {secondary}
                </p>
            )}
        </div>
    </div>
);

export const TransferModal = withForm({
    defaultValues: defaultTransferValues,
    props: {
        open: false,
        onClose: () => {},
        selectedToken: undefined as Token | undefined,
        onSubmit: ({
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            addToContacts,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            closeConfirmationModal,
        }: {
            addToContacts: boolean;
            closeConfirmationModal: () => void;
        }) => {},
    },
    render: function TransferModal({
        form,
        open,
        onClose,
        selectedToken,
        onSubmit,
    }) {
        const { data: currentUser } = useCurrentUser();
        const { data: profile } = useProfile(currentUser, true);
        const { data: contacts } = useContacts(currentUser);

        const [to, amount, memo, isSubmitting] = useStore(
            form.store,
            (state) => [
                state.values.to.account,
                state.values.amount,
                state.values.memo,
                state.isSubmitting,
            ],
        );

        const getContactDisplay = (account: string) => {
            const contact = contacts?.find((c) => c.account === account);
            if (contact?.nickname) {
                return { primary: contact.nickname, secondary: account };
            }
            return { primary: account, secondary: undefined };
        };

        const fromContact = profile?.profile?.displayName
            ? {
                  primary: profile.profile.displayName,
                  secondary: currentUser || "",
              }
            : { primary: currentUser || "", secondary: undefined };

        const toContact = getContactDisplay(to);

        const isRecipientInContacts = contacts?.some((c) => c.account === to);
        const [addToContacts, setAddToContacts] = useState(false);

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

        const handleClose = () => {
            setAddToContacts(false);
            onClose();
        };

        if (!quantity) return <></>;

        return (
            <AlertDialog open={open}>
                <AlertDialogContent className="max-w-md gap-4">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm transfer</AlertDialogTitle>
                        <AlertDialogDescription>
                            Review the details below. Transfers to accounts with
                            auto debit enabled are final.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="bg-card/70 rounded-xl border px-4 py-5 text-center">
                        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                            Amount
                        </p>
                        <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                            <span className="font-mono">
                                {quantity.format({
                                    fullPrecision: true,
                                    includeLabel: false,
                                })}
                            </span>{" "}
                            <span
                                className={cn(
                                    "text-muted-foreground text-base font-normal",
                                    !quantity.hasTokenSymbol() && "italic",
                                )}
                            >
                                {quantity.getDisplayLabel()}
                            </span>
                        </p>
                        {memo && (
                            <p
                                className="text-muted-foreground mt-2 truncate text-xs"
                                title={memo}
                            >
                                “{memo}”
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Party
                            label="From"
                            account={currentUser || ""}
                            primary={fromContact.primary}
                            secondary={fromContact.secondary}
                        />
                        <div className="flex justify-center">
                            <ArrowDown className="text-muted-foreground size-4" />
                        </div>
                        <Party
                            label="To"
                            account={to}
                            primary={toContact.primary}
                            secondary={toContact.secondary}
                        />
                    </div>

                    {!isRecipientInContacts && (
                        <label
                            htmlFor="add-to-contacts"
                            className="hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-lg border border-dashed px-3 py-2.5 transition-colors"
                        >
                            <Checkbox
                                id="add-to-contacts"
                                checked={addToContacts}
                                onCheckedChange={(checked) =>
                                    setAddToContacts(checked === true)
                                }
                                className="mt-0.5"
                            />
                            <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
                                <Label
                                    htmlFor="add-to-contacts"
                                    className="flex items-center gap-1.5 text-sm font-medium"
                                >
                                    <UserPlus className="text-muted-foreground size-3.5" />
                                    Add to contacts
                                </Label>
                                <span className="text-muted-foreground text-xs">
                                    <span className="font-mono">{to}</span> is
                                    not in your contacts yet.
                                </span>
                            </span>
                        </label>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogCancel
                            onClick={handleClose}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            onClick={() => {
                                onSubmit({
                                    addToContacts,
                                    closeConfirmationModal: handleClose,
                                });
                            }}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    Sending…
                                </>
                            ) : (
                                "Confirm transfer"
                            )}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        );
    },
});
