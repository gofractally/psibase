import type { SharedBalance, Token } from "./hooks/tokensPlugin/useBalances";

import { CreditTable } from "@/apps/tokens/components/credit-table";
import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import { TransferModal } from "@/apps/tokens/components/transfer-modal";
import { useBalances } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { updateBalanceCache } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { useEffect, useMemo, useState } from "react";

import { supervisor } from "@/supervisor";

import { useCurrentUser } from "@/hooks/use-current-user";
import { Account } from "@/lib/zod/Account";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { FieldTokenAmount } from "@shared/components/form/field-token-amount";
import { Card, CardContent } from "@shared/shadcn/ui/card";
import { toast } from "@shared/shadcn/ui/sonner";

import { TokenSelector } from "./components/token-selector";
import { useCredit } from "./hooks/tokensPlugin/useCredit";
import {
    defaultTransferValues,
    zTransferForm,
    zTransferFormMemo,
} from "./lib/transfer-form-schema";

export const TokensPage = () => {
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const { data, isLoading: isLoadingBalances } = useBalances(currentUserData);

    const currentUser = isSuccess ? currentUserData : null;

    const sharedBalances = data ? data.sharedBalances : [];
    const tokens = useMemo(() => (data ? data.tokens : []), [data]);

    const isNoTokens = currentUser && tokens.length == 0;

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md">
                {isNoTokens ? (
                    <NoTokensWarning />
                ) : (
                    <TokensPageContent
                        tokens={tokens}
                        currentUser={currentUser}
                        isLoading={!isSuccess || isLoadingBalances}
                        sharedBalances={sharedBalances}
                    />
                )}
            </div>
        </div>
    );
};

const TokensPageContent = ({
    tokens,
    currentUser,
    isLoading,
    sharedBalances,
}: {
    tokens: Token[];
    currentUser: string | null;
    isLoading: boolean;
    sharedBalances: SharedBalance[];
}) => {
    const { mutateAsync: credit } = useCredit();

    const [selectedTokenId, setSelectedTokenId] = useState<string>(
        tokens[0].id.toString(),
    );

    const handleConfirm = async ({
        value,
    }: {
        value: typeof defaultTransferValues;
    }) => {
        // Pad with 0 if the amount string starts with a dot (e.g., ".01" -> "0.01")
        const paddedAmount = value.amount.amount.startsWith(".")
            ? "0" + value.amount.amount
            : value.amount.amount;

        // Optimistically update the balance
        updateBalanceCache(
            Account.parse(currentUser),
            selectedTokenId,
            paddedAmount,
            "Subtract",
        );

        try {
            await credit({
                tokenId: selectedTokenId,
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
            // Rollback optimistic update on error
            updateBalanceCache(
                Account.parse(currentUser),
                selectedTokenId,
                paddedAmount,
                "Add",
            );
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
            onSubmit: zTransferForm(currentUser),
        },
    });

    const [isTransferModalOpen, setTransferModal] = useState(false);

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
    const disableForm = !currentUser || isLoading;

    const onSubmitPreflight = async (
        e: React.MouseEvent<HTMLButtonElement>,
    ) => {
        e.preventDefault();

        // this triggers the root level validation
        const errors = await form.validate("submit");
        if (Object.keys(errors).length > 0) return;

        // this triggers the field level validation
        const fieldErrors = await form.validateAllFields("submit");
        if (fieldErrors.length > 0) return;

        setTransferModal(true);
    };

    const handleSetMaxAmount = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        form.setFieldValue("amount", {
            amount: selectedToken?.balance?.amount.toString() ?? "",
        });
        form.validateField("amount.amount", "change");
    };

    const clearAmountErrors = () => {
        form.setFieldMeta("amount.amount", (prev) => ({
            ...prev,
            errors: [],
            errorMap: {},
        }));
    };

    return (
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
                            {!isLoading && (
                                <TokenSelector
                                    tokens={tokens}
                                    selectedToken={selectedToken}
                                    onChange={(tokenId) => {
                                        setSelectedTokenId(tokenId);
                                        clearAmountErrors();
                                    }}
                                    onClickAvailableBalance={handleSetMaxAmount}
                                />
                            )}
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
                                    precision={selectedToken?.precision ?? 0}
                                    balance={
                                        selectedToken?.balance?.amount ?? 0
                                    }
                                    disabled={disableForm}
                                    description={null}
                                    onMaxAmountClick={handleSetMaxAmount}
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
                                validators={{
                                    onChange: zTransferFormMemo,
                                }}
                            />
                            {!isTransferModalOpen && (
                                <div className="flex justify-end">
                                    <form.SubmitButton
                                        labels={["Send", "Sending..."]}
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
