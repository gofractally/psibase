import { useMemo, useState, useEffect } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";

import { useAppForm } from "@shared/components/form/app-form";
import { useBillingConfig } from "@shared/hooks/use-billing-config";
import { useSetEnableBilling } from "@/hooks/use-set-enable-billing";
import { useSetFeeReceiverAccount } from "@/hooks/use-set-fee-receiver-account";
import { parseError } from "@shared/lib/parseErrorMessage";

interface SystemTokenInfo {
    id: string;
    symbol?: string;
}

interface BillingFormData {
    enableBilling: boolean;
    tokenFeeReceiverAccount: { account: string };
}

interface BillingProps {
    systemToken: SystemTokenInfo | null;
    systemTokenLoading: boolean;
}

export const Billing = ({
    systemToken,
    systemTokenLoading,
}: BillingProps) => {
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
    const { data: billingConfig, isLoading: billingConfigLoading } = useBillingConfig();

    // Track the submitted/initial value of enableBilling for comparison
    const [submittedEnableBilling, setSubmittedEnableBilling] = useState<boolean | null>(null);

    const computedInitialValues = useMemo<BillingFormData>(() => {
        if (billingConfig) {
            return {
                enableBilling: billingConfig.enabled,
                tokenFeeReceiverAccount: { account: billingConfig.feeReceiver || "" },
            };
        }
        return {
            enableBilling: false,
            tokenFeeReceiverAccount: { account: "" },
        };
    }, [billingConfig]);

    useEffect(() => {
        if (billingConfig) {
            setSubmittedEnableBilling(billingConfig.enabled);
        } else {
            setSubmittedEnableBilling(false);
        }
    }, [billingConfig]);

    const billingForm = useAppForm({
        defaultValues: computedInitialValues,
        onSubmit: async (data: { value: BillingFormData }) => {
            resetFeeReceiver();
            await setFeeReceiverAccount([data.value.tokenFeeReceiverAccount.account]);
            billingForm.reset(data.value);
        },
    });

    const feeReceiverTxError =
        feeReceiverIsError && feeReceiverError ? parseError(feeReceiverError) : null;
    const enableBillingTxError =
        enableBillingIsError && enableBillingError ? parseError(enableBillingError) : null;

    const hasFeeReceiverAccount = useMemo(() => {
        return billingConfig?.feeReceiver != null && billingConfig.feeReceiver !== "";
    }, [billingConfig?.feeReceiver]);

    const handleApplyEnableBilling = async () => {
        resetEnableBilling();
        await setEnableBilling([billingForm.state.values.enableBilling]);
        setSubmittedEnableBilling(billingForm.state.values.enableBilling);
        billingForm.reset(billingForm.state.values);
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

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    billingForm.handleSubmit();
                }}
            >
                <div className="space-y-4">
                    <div>
                        <Label>System Token</Label>
                        <p className="mt-1 text-sm">
                            {systemTokenLoading
                                ? "Loading..."
                                : systemToken
                                  ? systemToken.symbol || systemToken.id
                                  : "None"}
                        </p>
                    </div>

                    <div>
                        <FieldAccountExisting
                            form={billingForm}
                            fields={{ account: "tokenFeeReceiverAccount.account" }}
                            label="Token fee receiver account"
                            placeholder="Enter account name"
                            disabled={hasFeeReceiverAccount}
                            description={undefined}
                            onValidate={undefined}
                        />
                        {!hasFeeReceiverAccount && (
                            <billingForm.Subscribe selector={(state) => state}>
                                {(state) => {
                                    const account =
                                        state.values.tokenFeeReceiverAccount?.account ?? "";
                                    const initial =
                                        computedInitialValues.tokenFeeReceiverAccount?.account ?? "";
                                    const isSaveEnabled =
                                        account !== "" && account !== initial;
                                    return (
                                        <div className="mt-2">
                                            {feeReceiverTxError && (
                                                <p className="text-destructive text-sm mb-2">
                                                    {feeReceiverTxError}
                                                </p>
                                            )}
                                            <Button
                                                type="submit"
                                                disabled={!isSaveEnabled}
                                            >
                                                Save
                                            </Button>
                                        </div>
                                    );
                                }}
                            </billingForm.Subscribe>
                        )}
                    </div>

                    <billingForm.AppField name="enableBilling">
                        {(field) => (
                            <>
                                <field.CheckboxField
                                    label="Enable billing"
                                    disabled={!hasFeeReceiverAccount}
                                />
                                {hasFeeReceiverAccount && (
                                    <billingForm.Subscribe
                                        selector={(state) =>
                                            state.values.enableBilling
                                        }
                                    >
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        {(enableBilling: any) => {
                                            const isApplyEnabled =
                                                submittedEnableBilling !==
                                                    null &&
                                                enableBilling !==
                                                    submittedEnableBilling;
                                            return (
                                                <div className="mt-2">
                                                    {enableBillingTxError && (
                                                        <p className="text-destructive text-sm mb-2">
                                                            {enableBillingTxError}
                                                        </p>
                                                    )}
                                                    <Button
                                                        type="button"
                                                        onClick={
                                                            handleApplyEnableBilling
                                                        }
                                                        disabled={
                                                            !isApplyEnabled
                                                        }
                                                    >
                                                        Apply
                                                    </Button>
                                                </div>
                                            );
                                        }}
                                    </billingForm.Subscribe>
                                )}
                            </>
                        )}
                    </billingForm.AppField>
                </div>
            </form>
        </div>
    );
};
