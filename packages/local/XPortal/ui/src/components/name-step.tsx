import { Check } from "lucide-react";
import { useState } from "react";

import { useAppForm } from "@shared/components/form/app-form";
import { isAccountAvailable } from "@shared/lib/get-account";
import {
    MIN_FREE_ACCOUNT_NAME_LENGTH,
    zAccountFree,
} from "@shared/lib/schemas/account";
import {
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Spinner } from "@shared/shadcn/ui/spinner";

import { PortalCard } from "./portal-card";
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
        <PortalCard progress={25}>
            <form.AppForm>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void form.handleSubmit();
                    }}
                    className="flex flex-col gap-6"
                >
                    <CardContent className="flex flex-col">
                        <div className="mb-6 flex-1 space-y-2">
                            <CardTitle className="text-3xl font-normal">
                                Request a free account
                            </CardTitle>
                            <CardDescription>
                                Choose an account name (8–10 characters). Use
                                lowercase letters, numbers, and hyphens.
                            </CardDescription>
                        </div>
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
                    </CardContent>
                    <CardFooter className="flex flex-1 justify-end">
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
                    </CardFooter>
                </form>
            </form.AppForm>
        </PortalCard>
    );
};
