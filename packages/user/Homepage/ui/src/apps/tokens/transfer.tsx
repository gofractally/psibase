import type { TokensOutletContext } from "./layout";

import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { supervisor } from "@/supervisor";

import { TransferModal } from "@/apps/tokens/components/transfer-modal";

import { GlowingCard } from "@/components/glowing-card";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { FieldTokenAmount } from "@shared/components/form/field-token-amount";
import { CardContent } from "@shared/shadcn/ui/card";
import { toast } from "@shared/shadcn/ui/sonner";

import { CreditTable } from "./components/credit-table";
import { useCredit } from "./hooks/tokensPlugin/useCredit";
import { useTransferActions } from "./hooks/use-transfer-actions";
import {
    defaultTransferValues,
    zTransferForm,
    zTransferFormMemo,
} from "./lib/transfer-form-schema";

export const TransferPage = () => {
    const context = useOutletContext<TokensOutletContext>();
    if (!context) return <div>No context</div>;
    return <TransferPageContents />;
};

const TransferPageContents = () => {
    const context = useOutletContext<TokensOutletContext>();
    const { selectedToken, currentUser, isLoading } = context;
    const { mutateAsync: credit } = useCredit(currentUser);

    const { setHandleSetMaxAmount, setClearAmountErrors } =
        useTransferActions();

    const handleConfirm = async ({
        value,
    }: {
        value: typeof defaultTransferValues;
    }) => {
        const selectedTokenId = selectedToken.id.toString();

        // Pad with 0 if the amount string starts with a dot (e.g., ".01" -> "0.01")
        const paddedAmount = value.amount.amount.startsWith(".")
            ? "0" + value.amount.amount
            : value.amount.amount;

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

            form.resetField("amount");
            form.resetField("to");
            form.resetField("memo");

            setTransferModal(false);
        } catch (e) {
            setTransferModal(false);
            toast.error("Token transfer failed", {
                closeButton: true,
                richColors: true,
                duration: Infinity,
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

    const disableForm =
        !currentUser || isLoading || selectedToken?.isTransferable === false;

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

    const handleSetMaxAmount = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            form.setFieldValue("amount", {
                amount: selectedToken?.balance?.amount.toString() ?? "",
            });
            form.validateField("amount.amount", "change");
        },
        [form, selectedToken],
    );

    const clearAmountErrors = useCallback(() => {
        form.setFieldMeta("amount.amount", (prev) => ({
            ...prev,
            errors: [],
            errorMap: {},
        }));
    }, [form]);

    // Expose functions to layout via Jotai atoms
    useEffect(() => {
        setHandleSetMaxAmount(() => handleSetMaxAmount);
        setClearAmountErrors(() => clearAmountErrors);

        return () => {
            setHandleSetMaxAmount(null);
            setClearAmountErrors(null);
        };
    }, [
        setHandleSetMaxAmount,
        setClearAmountErrors,
        handleSetMaxAmount,
        clearAmountErrors,
    ]);

    return (
        <div className="space-y-4">
            <TransferModal
                form={form}
                onClose={() => setTransferModal(false)}
                open={isTransferModalOpen}
                selectedToken={selectedToken}
                onSubmit={form.handleSubmit}
            />
            <GlowingCard>
                <form.AppForm>
                    <form>
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
                                        disabled={disableForm}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </form>
                </form.AppForm>
            </GlowingCard>
            {currentUser && selectedToken && (
                <CreditTable user={currentUser} token={selectedToken} />
            )}
        </div>
    );
};
