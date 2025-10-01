import type { Token } from "./hooks/tokensPlugin/useBalances";
import type { Quantity } from "./lib/quantity";
import type { SelectOption } from "@shared/components/form/internal/select-field";

import { CreditTable } from "@/apps/tokens/components/credit-table";
import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import { TransferModal } from "@/apps/tokens/components/transfer-modal";
import { useBalances } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { updateBalanceCache } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { Icon as SelectIcon } from "@radix-ui/react-select";
import { useStore } from "@tanstack/react-form";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { supervisor } from "@/supervisor";

import { useCurrentUser } from "@/hooks/use-current-user";
import { Account } from "@/lib/zod/Account";

import { Avatar } from "@shared/components/avatar";
import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { FieldTokenAmount } from "@shared/components/form/field-token-amount";
import { Card, CardContent } from "@shared/shadcn/ui/card";
import { toast } from "@shared/shadcn/ui/sonner";

import { AnimateNumber } from "./components/AnimateNumber";
import { useCredit } from "./hooks/tokensPlugin/useCredit";
import {
    defaultTransferValues,
    zTransferForm,
} from "./lib/transfer-form-schema";

export const TokensPage = () => {
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const { data, isLoading: isLoadingBalances } = useBalances(currentUserData);
    const { mutateAsync: credit } = useCredit();

    const currentUser = isSuccess ? currentUserData : null;

    const sharedBalances = data ? data.sharedBalances : [];
    const tokens = useMemo(() => (data ? data.tokens : []), [data]);
    const isLoading = !isSuccess || isLoadingBalances;

    const handleConfirm = async ({
        value,
    }: {
        value: typeof defaultTransferValues;
    }) => {
        try {
            // Pad with 0 if the amount string starts with a dot (e.g., ".01" -> "0.01")
            const paddedAmount = value.amount.amount.startsWith(".")
                ? "0" + value.amount.amount
                : value.amount.amount;

            updateBalanceCache(
                Account.parse(currentUser),
                value.token,
                paddedAmount,
                "Subtract",
            );
            await credit({
                tokenId: value.token,
                receiver: value.to.account,
                amount: paddedAmount,
                memo: value.memo,
            });
            toast("Sent", {
                description: `Sent ${paddedAmount} ${
                    selectedToken?.label || selectedToken?.symbol
                } to ${value.to.account}`,
            });
            // do not reset the token field
            form.resetField("amount");
            form.resetField("to");
            form.resetField("memo");

            setTransferModal(false);
        } catch (e) {
            toast("Error", {
                description:
                    e instanceof Error
                        ? e.message
                        : `Unrecognised error, see logs.`,
            });
        }
    };

    const form = useAppForm({
        defaultValues: defaultTransferValues,
        onSubmit: handleConfirm,
        validators: {
            onChange: zTransferForm(currentUser),
        },
    });

    const [isTransferModalOpen, setTransferModal] = useState(false);

    const selectedTokenId = useStore(form.store, (state) => state.values.token);
    const selectedToken = tokens.find(
        (balance) => balance.id == Number(selectedTokenId),
    );

    useEffect(() => {
        // update token field value with default token once tokens load
        if (!selectedTokenId && tokens.length > 0) {
            form.setFieldValue("token", tokens[0].id.toString());
            return;
        }
    }, [form, selectedTokenId, tokens]);

    const isNoTokens = currentUser && tokens.length == 0;
    const disableForm = isNoTokens || isLoading;

    const onSubmitPreflight = async (
        e: React.MouseEvent<HTMLButtonElement>,
    ) => {
        e.preventDefault();
        const errors = await form.validateAllFields("submit");
        if (errors.length > 0) return;
        setTransferModal(true);
    };

    const handleSetMaxAmount = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        form.setFieldValue("amount", {
            amount: selectedToken?.balance?.amount.toString() ?? "",
        });
        form.validateField("amount.amount", "change");
    };

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md">
                {isNoTokens ? (
                    <NoTokensWarning />
                ) : (
                    <>
                        <form.AppForm>
                            <form className="space-y-4">
                                <GlowingCard>
                                    <TransferModal
                                        form={form}
                                        onClose={() => setTransferModal(false)}
                                        open={isTransferModalOpen}
                                        selectedToken={selectedToken}
                                        onSubmit={form.handleSubmit}
                                    />
                                    <CardContent className="@container space-y-2">
                                        <div className="@lg:flex-row flex flex-1 flex-col items-center justify-between gap-2">
                                            <form.AppField
                                                name="token"
                                                children={(field) => {
                                                    return (
                                                        <field.SelectField
                                                            options={tokens.map(
                                                                (token) => ({
                                                                    value: {
                                                                        id: token.id.toString(),
                                                                        balance:
                                                                            token.balance,
                                                                    },
                                                                    label: token.label,
                                                                }),
                                                            )}
                                                            keyExtractor={(
                                                                option,
                                                            ) =>
                                                                option.value.id
                                                            }
                                                            TriggerComponent={
                                                                <TokenSelectTrigger
                                                                    selectedToken={
                                                                        selectedToken
                                                                    }
                                                                />
                                                            }
                                                            OptionComponent={
                                                                TokenSelectOption
                                                            }
                                                        />
                                                    );
                                                }}
                                            />
                                            <AvailableBalance
                                                selectedToken={selectedToken}
                                                onClick={handleSetMaxAmount}
                                            />
                                        </div>
                                    </CardContent>
                                </GlowingCard>
                                <GlowingCard>
                                    <CardContent className="space-y-4">
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <FieldAccountExisting
                                                form={form}
                                                fields="to"
                                                label="Recipient"
                                                description={undefined}
                                                placeholder="Account"
                                                disabled={disableForm}
                                                supervisor={supervisor}
                                            />
                                            <FieldTokenAmount
                                                form={form}
                                                fields="amount"
                                                precision={
                                                    selectedToken?.precision ??
                                                    0
                                                }
                                                balance={
                                                    selectedToken?.balance
                                                        ?.amount ?? 0
                                                }
                                                disabled={disableForm}
                                                description={null}
                                                validators={{
                                                    onChangeListenTo: ["token"],
                                                }}
                                                onMaxAmountClick={
                                                    handleSetMaxAmount
                                                }
                                            />
                                        </div>
                                        <form.AppField
                                            name="memo"
                                            children={(field) => (
                                                <field.TextField
                                                    disabled={disableForm}
                                                    label="Memo (optional)"
                                                    placeholder="Add a note about this transfer"
                                                />
                                            )}
                                        />
                                        {!isTransferModalOpen && (
                                            <div className="flex justify-end">
                                                <form.SubmitButton
                                                    labels={[
                                                        "Send",
                                                        "Sending...",
                                                    ]}
                                                    onClick={onSubmitPreflight}
                                                />
                                            </div>
                                        )}
                                    </CardContent>
                                </GlowingCard>
                            </form>
                        </form.AppForm>
                        <div className="my-4">
                            <CreditTable
                                isLoading={isLoading}
                                user={currentUser}
                                balances={sharedBalances}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const TokenSelectOption = ({
    option,
}: {
    option: SelectOption<{ id: string; balance?: Quantity }>;
}) => {
    return (
        <div className="flex min-w-56 items-center justify-between gap-2">
            <div className="flex items-center gap-2">
                <Avatar
                    account={option.label}
                    type="glass"
                    className="size-5"
                />
                <span className="font-mono text-lg font-medium">
                    {option.label}
                </span>
            </div>
            <div>
                <span className="text-muted-foreground text-xs">
                    {option.value.balance?.format({
                        includeLabel: false,
                    })}
                </span>
            </div>
        </div>
    );
};

const GlowingCard = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="group relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-blue-500/20 blur-xl transition-all duration-500 group-hover:blur-2xl dark:from-purple-500/20 dark:to-blue-500/20" />
            <Card className="relative z-10 border-gray-300 transition-colors duration-300 hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-700">
                {children}
            </Card>
        </div>
    );
};

const TokenSelectTrigger = ({ selectedToken }: { selectedToken?: Token }) => {
    const tokenLabel = selectedToken?.label ?? "UNKNOWN";

    return (
        <div className="flex select-none items-center gap-2 p-1">
            <Avatar account={tokenLabel} type="glass" />
            <span className="font-mono text-3xl font-medium">{tokenLabel}</span>
            <SelectIcon asChild>
                <ChevronDown className="size-4 opacity-50" />
            </SelectIcon>
        </div>
    );
};

const AvailableBalance = ({
    selectedToken,
    onClick,
}: {
    selectedToken?: Token;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
    return (
        <div className="@lg:items-end flex flex-col items-center">
            <span className="text-foreground/75 select-none text-xs font-medium">
                Available
            </span>
            <span className="text-foreground/90 font-mono text-xl font-medium">
                <AnimateNumber
                    n={selectedToken?.balance?.amount ?? 0}
                    precision={selectedToken?.balance?.precision ?? 0}
                    className="hover:cursor-pointer hover:underline"
                    onClick={onClick}
                />
            </span>
        </div>
    );
};
