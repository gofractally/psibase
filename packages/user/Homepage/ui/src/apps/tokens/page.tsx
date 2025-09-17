import { CreditTable } from "@/apps/tokens/components/credit-table";
import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import { TransferModal } from "@/apps/tokens/components/transfer-modal";
import { useBalances } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { useEffect, useMemo, useState } from "react";

import { supervisor } from "@/supervisor";

import { useCurrentUser } from "@/hooks/use-current-user";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { FieldTokenAmount } from "@shared/components/form/field-token-amount";

import { defaultTransferValues, zTransferForm } from "./hooks/useTokenForm";

export const TokensPage = () => {
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const { data, isLoading: isLoadingBalances } = useBalances(currentUserData);

    const currentUser = isSuccess ? currentUserData : null;

    const sharedBalances = data ? data.sharedBalances : [];
    const tokens = useMemo(() => (data ? data.tokens : []), [data]);
    const isLoading = !isSuccess || isLoadingBalances;

    const form = useAppForm({
        defaultValues: defaultTransferValues,
        onSubmit: () => setTransferModal(true),
        validators: {
            onChange: zTransferForm,
        },
    });

    const [isTransferModalOpen, setTransferModal] = useState(false);

    const selectedTokenId = form.state.values.token;
    const selectedToken = tokens.find(
        (balance) => balance.id == Number(selectedTokenId),
    );

    useEffect(() => {
        // update token field value with default token once tokens loadz
        if (!selectedTokenId && tokens.length > 0) {
            form.setFieldValue("token", tokens[0].id.toString());
            return;
        }
    }, [form, selectedTokenId, tokens]);

    const isNoTokens = currentUser && tokens.length == 0;
    const disableForm = isNoTokens || isLoading;

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <div className="mx-auto flex max-w-screen-lg flex-col gap-3 p-4">
                {isNoTokens && <NoTokensWarning onContinue={() => {}} />}
                <form.AppForm>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            form.handleSubmit();
                        }}
                        className="mx-auto w-full space-y-8"
                    >
                        <TransferModal
                            form={form}
                            onClose={() => setTransferModal(false)}
                            open={isTransferModalOpen}
                            selectedToken={selectedToken}
                        />
                        <>
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
                                <form.Subscribe
                                    selector={(state) => state.values.token}
                                >
                                    {(t) => {
                                        const token = tokens.find(
                                            (balance) =>
                                                balance.id == Number(t),
                                        );

                                        return (
                                            <FieldTokenAmount
                                                form={form}
                                                fields="amount"
                                                precision={token?.precision}
                                                disabled={disableForm}
                                                description={undefined}
                                            />
                                        );
                                    }}
                                </form.Subscribe>
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
                            <div className="flex justify-end">
                                <form.SubmitButton
                                    labels={[
                                        "Transfer",
                                        "Transferring...",
                                        "Transferred",
                                    ]}
                                />
                            </div>
                        </>
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
