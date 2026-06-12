import type { ReactNode } from "react";

import { z } from "zod";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { useBranding } from "@shared/hooks/use-branding";
import { useImportExisting } from "@shared/hooks/use-import-existing";
import { b64ToPem, validateB64 } from "@shared/lib/b64-key-utils";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";

interface ConfirmKeyStepProps {
    /** The account the user must re-enter to confirm they saved their credentials. */
    expectedAccount: string;
    /** Called after the credentials have been successfully imported. */
    onImported: (account: string) => Promise<void> | void;
    onBack?: () => void;
    title?: ReactNode;
    description?: ReactNode;
    submitLabels?: [label: string, submittingLabel: string];
    mismatchMessage?: string;
    importErrorMessage?: string;
    /** Extra classes for the content area (e.g. "px-0" inside a dialog). */
    contentClassName?: string;
    /** Extra classes for the footer area (e.g. "px-0" inside a dialog). */
    footerClassName?: string;
}

/**
 * Step UI that asks the user to re-enter their new account name and private
 * key, then imports the credentials onto this device via the accounts plugin.
 */
export const ConfirmKeyStep = ({
    expectedAccount,
    onImported,
    onBack,
    title,
    description,
    submitLabels = ["Confirm", "Confirming..."],
    mismatchMessage = "Account name must match the account name you just created",
    importErrorMessage = "Error signing in. Check your private key and try again.",
    contentClassName,
    footerClassName,
}: ConfirmKeyStepProps) => {
    const { data: networkName } = useBranding();
    const importExistingMutation = useImportExisting();

    const form = useAppForm({
        defaultValues: {
            account: {
                account: "",
            },
            privateKey: "",
        },
        validators: {
            onChange: z.object({
                account: z.object({
                    account: zAccount.or(z.literal("")),
                }),
                privateKey: z.string(),
            }),
            onSubmit: z.object({
                account: z.object({
                    account: zAccount.refine(
                        (val) => val.trim() === expectedAccount.trim(),
                        {
                            message: mismatchMessage,
                        },
                    ),
                }),
                privateKey: z.string().refine(
                    (val) => {
                        return validateB64(val);
                    },
                    {
                        message: "Private key must be a valid base64 string",
                    },
                ),
            }),
        },
        onSubmit: async (data) => {
            await handleImport(
                data.value.account.account.trim(),
                data.value.privateKey,
            );
        },
    });

    const handleImport = async (account: string, b64: string) => {
        const pemFormatted = b64ToPem(b64);

        try {
            await importExistingMutation.mutateAsync({
                account: account,
                key: pemFormatted,
            });
            await onImported(account);
        } catch (e) {
            console.error("Import and login failed");
            console.error(e);
            form.fieldInfo.privateKey.instance?.setErrorMap({
                onSubmit: importErrorMessage,
            });
        }
    };

    return (
        <form.AppForm>
            <form
                id="import-account-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    form.handleSubmit();
                }}
                className="flex flex-col gap-6"
            >
                <CardContent className={`flex flex-col ${contentClassName ?? ""}`}>
                    <div className="mb-6 flex-1 space-y-2">
                        <CardTitle className="text-3xl font-normal">
                            {title ?? "Sign in"}
                        </CardTitle>
                        <CardDescription>
                            {description ?? `Use your ${networkName} account`}
                        </CardDescription>
                    </div>
                    <div className="flex flex-1 flex-col gap-4">
                        <form.Subscribe
                            selector={(state) => [state.isSubmitting]}
                        >
                            {([isSubmitting]) => (
                                <FieldAccountExisting
                                    form={form}
                                    fields="account"
                                    label="Account name"
                                    description={undefined}
                                    placeholder="Account name"
                                    disabled={isSubmitting}
                                    onValidate={undefined}
                                />
                            )}
                        </form.Subscribe>
                        <form.AppField
                            name="privateKey"
                            children={(field) => {
                                return (
                                    <field.TextField
                                        type="password"
                                        label="Private key"
                                        placeholder="Private key"
                                    />
                                );
                            }}
                        />
                    </div>
                </CardContent>
                <CardFooter
                    className={`mt-4 flex flex-1 ${onBack ? "justify-between" : "justify-end"} ${footerClassName ?? ""}`}
                >
                    {onBack ? (
                        <CardAction>
                            <Button
                                type="button"
                                variant="link"
                                onClick={onBack}
                                className="-ml-4"
                            >
                                Back
                            </Button>
                        </CardAction>
                    ) : null}
                    <CardAction>
                        <form.SubmitButton labels={submitLabels} />
                    </CardAction>
                </CardFooter>
            </form>
        </form.AppForm>
    );
};
