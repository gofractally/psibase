import { CreditTable } from "@/apps/tokens/components/credit-table";
import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import { TransferModal } from "@/apps/tokens/components/transfer-modal";
import { useBalances } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { updateBalanceCache } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { useStore } from "@tanstack/react-form";
import { useEffect, useMemo, useState } from "react";

import { supervisor } from "@/supervisor";

import { useCurrentUser } from "@/hooks/use-current-user";
import { Account } from "@/lib/zod/Account";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { FieldTokenAmount } from "@shared/components/form/field-token-amount";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";

import { AnimateNumber } from "./components/AnimateNumber";
import { useCredit } from "./hooks/tokensPlugin/useCredit";
import { defaultTransferValues, zTransferForm } from "./hooks/useTokenForm";

export const TokensPage = () => {
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const { data, isLoading: isLoadingBalances } = useBalances(currentUserData);
    const { isPending, mutateAsync: credit } = useCredit();

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

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <div className="mx-auto flex max-w-screen-lg flex-col gap-3 p-4">
                {isNoTokens && <NoTokensWarning onContinue={() => {}} />}
                <form.AppForm>
                    <form className="mx-auto w-full space-y-8">
                        <TransferModal
                            form={form}
                            onClose={() => setTransferModal(false)}
                            open={isTransferModalOpen}
                            selectedToken={selectedToken}
                            onSubmit={form.handleSubmit}
                        />
                        <form.AppField
                            name="token"
                            children={(field) => (
                                <field.SelectField
                                    label="Token"
                                    options={tokens.map((token) => ({
                                        value: token.id.toString(),
                                        label: token.label,
                                    }))}
                                    className="w-full"
                                />
                            )}
                        />
                        <AnimateNumber
                            n={selectedToken?.balance?.amount ?? 0}
                            precision={selectedToken?.balance?.precision ?? 0}
                            className="hover:underline"
                            onClick={() => {
                                form.setFieldValue("amount", {
                                    amount:
                                        selectedToken?.balance?.amount.toString() ??
                                        "",
                                });
                            }}
                        />
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
                                balance={selectedToken?.balance?.amount ?? 0}
                                disabled={disableForm}
                                description={null}
                                validators={{
                                    onChangeListenTo: ["token"],
                                }}
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
                                <Button
                                    type="button"
                                    onClick={onSubmitPreflight}
                                >
                                    {isPending ? "Sending..." : "Send"}
                                </Button>
                            </div>
                        )}
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
