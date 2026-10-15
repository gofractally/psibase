import { Check } from "lucide-react";
import { useState } from "react";

import { useAppForm } from "@shared/components/form/app-form";
import { PageContainer } from "@shared/components/page-container";
import { isAccountAvailable } from "@shared/lib/get-account";
import {
    MIN_FREE_ACCOUNT_NAME_LENGTH,
    zAccountFree,
} from "@shared/lib/schemas/account";
import { Spinner } from "@shared/shadcn/ui/spinner";

import { PortalError } from "../lib/portal-api";
import { type SignupRequest, startSignup } from "../lib/signup-request";

const NAME_TAKEN = "This account name is not available";

export const NameStep = ({
    defaultName,
    onRequested,
    onClosed,
    onFailed,
}: {
    defaultName: string;
    onRequested: (request: SignupRequest) => void;
    /** The node stopped accepting requests. */
    onClosed: () => void;
    onFailed: (name: string) => void;
}) => {
    const [availableName, setAvailableName] = useState<string | null>(null);

    const form = useAppForm({
        defaultValues: { account: defaultName },
        onSubmit: async ({ value: { account: name } }) => {
            try {
                onRequested(await startSignup(name));
            } catch (error) {
                if (error instanceof PortalError && error.status === 409) {
                    setAvailableName(null);
                    form.setFieldMeta("account", (prev) => ({
                        ...prev,
                        isTouched: true,
                        errorMap: { onSubmit: NAME_TAKEN },
                    }));
                } else if (
                    error instanceof PortalError &&
                    error.status === 403
                ) {
                    onClosed();
                } else {
                    console.error("Signup request failed:", error);
                    onFailed(name);
                }
            }
        },
    });

    const checkName = async ({ value }: { value: string }) => {
        if (value.length < MIN_FREE_ACCOUNT_NAME_LENGTH) return undefined;
        const parsed = zAccountFree.safeParse(value);
        if (!parsed.success) return parsed.error.issues[0].message;
        if ((await isAccountAvailable(value)) !== "Available") {
            return NAME_TAKEN;
        }
        setAvailableName(value);
        return undefined;
    };

    const nameStatus = (
        <form.Subscribe
            selector={(state) => [
                state.isFieldsValidating,
                state.values.account === availableName,
            ]}
        >
            {([isValidating, isAvailable]) =>
                isValidating ? (
                    <span className="text-muted-foreground shrink-0 pr-3">
                        <Spinner className="size-3.5" />
                    </span>
                ) : isAvailable ? (
                    <span className="flex shrink-0 items-center gap-1 pr-3 text-sm font-medium text-green-500">
                        <Check className="size-3.5" />
                        Available
                    </span>
                ) : null
            }
        </form.Subscribe>
    );

    return (
        <PageContainer className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">Request a free account</h2>
                <p className="text-muted-foreground text-sm">
                    Choose an account name (8–10 characters). Use lowercase
                    letters, numbers, and hyphens.
                </p>
            </div>
            <form.AppForm>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void form.handleSubmit();
                    }}
                    className="space-y-6"
                >
                    <form.AppField
                        name="account"
                        asyncDebounceMs={500}
                        validators={{ onChangeAsync: checkName }}
                        children={(field) => (
                            <field.TextField
                                label="Account name"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                endContent={nameStatus}
                            />
                        )}
                    />
                    <div className="flex justify-end">
                        <form.Subscribe
                            selector={(state) =>
                                !state.isFieldsValidating &&
                                state.values.account === availableName
                            }
                        >
                            {(isAvailable) => (
                                <form.SubmitButton
                                    labels={["Continue", "Requesting..."]}
                                    disabled={!isAvailable}
                                />
                            )}
                        </form.Subscribe>
                    </div>
                </form>
            </form.AppForm>
        </PageContainer>
    );
};
