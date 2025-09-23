import { CreditTable } from "@/apps/tokens/components/credit-table";
import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import { TransferModal } from "@/apps/tokens/components/transfer-modal";
import { useBalances } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { updateBalanceCache } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { glass } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { Icon as SelectIcon } from "@radix-ui/react-select";
import { useStore } from "@tanstack/react-form";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { supervisor } from "@/supervisor";

import { useCurrentUser } from "@/hooks/use-current-user";
import { Account } from "@/lib/zod/Account";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { FieldTokenAmount } from "@shared/components/form/field-token-amount";
import { Card, CardContent } from "@shared/shadcn/ui/card";
import { toast } from "@shared/shadcn/ui/sonner";

import { AnimateNumber } from "./components/AnimateNumber";
import { useCredit } from "./hooks/tokensPlugin/useCredit";
import { defaultTransferValues, zTransferForm } from "./hooks/useTokenForm";

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
            updateBalanceCache(
                Account.parse(currentUser),
                value.token,
                value.amount.amount,
                "Subtract",
            );
            await credit({
                tokenId: value.token,
                receiver: value.to.account,
                amount: value.amount.amount,
                memo: value.memo,
            });
            toast("Sent", {
                description: `Sent ${value.amount.amount} ${
                    selectedToken?.label || selectedToken?.symbol
                } to ${value.to.account}`,
            });
            form.reset();
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
            onChange: zTransferForm,
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

    const onSubmitPreflight = async () => {
        const res = await form.validateAllFields("submit");
        if (res.length > 0) return;
        setTransferModal(true);
    };

    const handleSetMaxAmount = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        form.setFieldValue("amount", {
            amount: selectedToken?.balance?.amount.toString() ?? "",
        });
    };

    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-md">
                {isNoTokens && <NoTokensWarning onContinue={() => {}} />}
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
                                            const tokenLabel =
                                                selectedToken?.label ??
                                                "UNKNOWN";
                                            const tokenIcon = createAvatar(
                                                glass,
                                                {
                                                    seed: tokenLabel,
                                                    size: 40,
                                                },
                                            ).toDataUri();

                                            return (
                                                <field.SelectField
                                                    options={tokens.map(
                                                        (token) => ({
                                                            value: token.id.toString(),
                                                            label: token.label,
                                                        }),
                                                    )}
                                                    triggerComponent={
                                                        <div className="flex select-none items-center gap-2 p-1">
                                                            <img
                                                                src={tokenIcon}
                                                                alt="Token"
                                                                className="rounded-full"
                                                            />
                                                            <span className="font-mono text-3xl font-medium">
                                                                {tokenLabel}
                                                            </span>
                                                            <SelectIcon asChild>
                                                                <ChevronDown className="size-4 opacity-50" />
                                                            </SelectIcon>
                                                        </div>
                                                    }
                                                />
                                            );
                                        }}
                                    />
                                    <div className="@lg:items-end flex flex-col items-center">
                                        <span className="text-foreground/75 select-none text-xs font-medium">
                                            Available
                                        </span>
                                        <span className="text-foreground/90 font-mono text-xl font-medium">
                                            <AnimateNumber
                                                n={
                                                    selectedToken?.balance
                                                        ?.amount ?? 0
                                                }
                                                precision={
                                                    selectedToken?.balance
                                                        ?.precision ?? 0
                                                }
                                                className="hover:cursor-pointer hover:underline"
                                                onClick={handleSetMaxAmount}
                                            />
                                        </span>
                                    </div>
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
                                            selectedToken?.precision ?? 0
                                        }
                                        balance={
                                            selectedToken?.balance?.amount ?? 0
                                        }
                                        disabled={disableForm}
                                        description={null}
                                        validators={{
                                            onChangeListenTo: ["token"],
                                        }}
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
                                />
                                {!isTransferModalOpen && (
                                    <div className="flex justify-end">
                                        <form.SubmitButton
                                            labels={[
                                                "Send",
                                                "Sending...",
                                                "Send",
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
