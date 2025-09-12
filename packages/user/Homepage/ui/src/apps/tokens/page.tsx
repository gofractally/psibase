import { CreditTable } from "@/apps/tokens/components/credit-table";
import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import { TransferModal } from "@/apps/tokens/components/transfer-modal";
import { useBalances } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { useEffect, useMemo, useState } from "react";

import { useCurrentUser } from "@/hooks/use-current-user";

import { useAppForm } from "@shared/components/form/app-form";

export const defaultTransferValues = {
    amount: "",
    token: "",
    memo: "",
    to: "",
};

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
        // validators: {
        //     onChange: () => formSchema(tokens),
        // },
    });

    const [isTransferModalOpen, setTransferModal] = useState(false);

    const selectedTokenId = form.state.values.token;
    const selectedToken = tokens.find(
        (balance) => balance.id == Number(selectedTokenId),
    );

    useEffect(() => {
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
                                    <field.TokenSelect tokens={tokens} />
                                )}
                            />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <form.AppField
                                    name="to"
                                    children={(field) => (
                                        <field.TextField
                                            disabled={disableForm}
                                        />
                                    )}
                                />
                                <form.AppField
                                    name="amount"
                                    children={(field) => (
                                        <field.TokenAmountInput
                                            selectedToken={selectedToken}
                                            disabled={disableForm}
                                        />
                                    )}
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
