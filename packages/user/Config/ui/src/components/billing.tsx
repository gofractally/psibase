import { useMemo } from "react";

import { useSetEnableBilling } from "@/hooks/use-set-enable-billing";
import { useSetFeeReceiverAccount } from "@/hooks/use-set-fee-receiver-account";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { useBillingConfig } from "@shared/hooks/use-billing-config";
import { parseError } from "@shared/lib/parse-error-message";
import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";

interface SystemTokenInfo {
    id: string;
    symbol?: string;
}

interface BillingFormData {
    tokenFeeReceiverAccount: { account: string };
}

interface BillingProps {
    systemToken: SystemTokenInfo | null;
    systemTokenLoading: boolean;
}

export const Billing = ({ systemToken, systemTokenLoading }: BillingProps) => {
    const {
        mutateAsync: setFeeReceiverAccount,
        error: feeReceiverError,
        isError: feeReceiverIsError,
        reset: resetFeeReceiver,
    } = useSetFeeReceiverAccount();
    const {
        mutateAsync: setEnableBilling,
        error: enableBillingError,
        isError: enableBillingIsError,
        reset: resetEnableBilling,
    } = useSetEnableBilling();
    const { data: billingConfig, isLoading: billingConfigLoading } =
        useBillingConfig();

    const computedInitialValues = useMemo<BillingFormData>(() => {
        if (billingConfig) {
            return {
                tokenFeeReceiverAccount: {
                    account: billingConfig.feeReceiver || "",
                },
            };
        }
        return {
            tokenFeeReceiverAccount: { account: "" },
        };
    }, [billingConfig]);

    const billingForm = useAppForm({
        defaultValues: computedInitialValues,
        onSubmit: async (data: { value: BillingFormData }) => {
            resetFeeReceiver();
            await setFeeReceiverAccount([
                data.value.tokenFeeReceiverAccount.account,
            ]);
            billingForm.reset(data.value);
        },
    });

    const feeReceiverTxError =
        feeReceiverIsError && feeReceiverError
            ? parseError(feeReceiverError)
            : null;
    const enableBillingTxError =
        enableBillingIsError && enableBillingError
            ? parseError(enableBillingError)
            : null;

    const hasFeeReceiverAccount = useMemo(() => {
        return (
            billingConfig?.feeReceiver != null &&
            billingConfig.feeReceiver !== ""
        );
    }, [billingConfig?.feeReceiver]);

    const handleEnableBilling = async () => {
        resetEnableBilling();
        await setEnableBilling([]);
    };

    if (billingConfigLoading) {
        return (
            <div className="rounded-lg border p-4">
                <div className="mb-4">
                    <h3 className="text-base font-medium">Billing</h3>
                </div>
                <p className="text-muted-foreground text-sm">Loading...</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border p-4">
            <div className="mb-4">
                <h3 className="text-base font-medium">Billing</h3>
            </div>

            <div className="space-y-6">
                <div>
                    <Label>System Token</Label>
                    <p className="mt-1 text-sm">
                        {systemTokenLoading
                            ? "Loading..."
                            : systemToken?.id
                              ? systemToken.symbol
                              : "None"}
                    </p>
                </div>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        billingForm.handleSubmit();
                    }}
                >
                    <div className="space-y-4">
                        <div>
                            <FieldAccountExisting
                                form={billingForm}
                                fields={{
                                    account: "tokenFeeReceiverAccount.account",
                                }}
                                label="Billing fees paid to:"
                                placeholder="Enter account name"
                                disabled={
                                    !systemToken?.id || hasFeeReceiverAccount
                                }
                                description={undefined}
                                onValidate={undefined}
                            />
                            <billingForm.Subscribe selector={(state) => state}>
                                {(state) => {
                                    const account =
                                        state.values.tokenFeeReceiverAccount
                                            ?.account ?? "";
                                    const initial =
                                        computedInitialValues
                                            .tokenFeeReceiverAccount?.account ??
                                        "";
                                    const isSaveEnabled =
                                        account !== "" && account !== initial;
                                    return (
                                        <div className="mt-2">
                                            {feeReceiverTxError && (
                                                <p className="text-destructive mb-2 text-sm">
                                                    {feeReceiverTxError}
                                                </p>
                                            )}
                                            <Button
                                                type="submit"
                                                disabled={
                                                    !systemToken?.id ||
                                                    hasFeeReceiverAccount ||
                                                    !isSaveEnabled
                                                }
                                            >
                                                Save
                                            </Button>
                                        </div>
                                    );
                                }}
                            </billingForm.Subscribe>
                        </div>
                    </div>
                </form>

                {billingConfig?.enabled ? (
                    <div>
                        <Label>Billing</Label>
                        <p className="mt-1 text-sm">Enabled</p>
                    </div>
                ) : (
                    <div>
                        {enableBillingTxError && (
                            <p className="text-destructive mb-2 text-sm">
                                {enableBillingTxError}
                            </p>
                        )}
                        <Button
                            type="button"
                            disabled={!hasFeeReceiverAccount}
                            onClick={handleEnableBilling}
                        >
                            Enable billing
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
