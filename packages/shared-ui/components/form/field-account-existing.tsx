import { User, UserX } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Avatar } from "@shared/components/avatar";
import { getAccount, zGetAccountReturn } from "@shared/lib/get-account";
import { zAccount } from "@shared/lib/schemas/account";

import { withFieldGroup } from "./app-form";

/**
 * A field for entering an existing account name for use in a tanstack/react-form form
 * This will validate synchronously that the account name is a valid account name, and then asynchronously that the account exists
 * Because this uses the `withFieldGroup` HOC, this must be nested in the form's schema as a field group:
 *
 * ```tsx
 * const form = useAppForm({
 *     defaultValues: {
 *         to: {
 *             account: "", // must be nested
 *         },
 *     },
 *     validators: z.object({
 *         to: z.object({
 *             account: z.string(), // field-level validation will run on top of this
 *         }),
 *     }),
 *     ...
 * });
 * ```
 *
 * Then consume the field like so:
 *
 * ```tsx
 * <FieldAccountExisting
 *     form={form}
 *     fields="to"
 *     label="Recipient Account"
 *     description={undefined} // NOTE: TS will compalin if you do not provide ALL specified props
 *     placeholder="Enter account name"
 *     disabled={isDisabled}
 *     onValidate={(account) => ...}
 * />
 * ```
 *
 * @param label - The label for the field
 * @param description - Optional description text
 * @param placeholder - Placeholder text for the input
 * @param disabled - Whether the field is disabled
 * @param onValidate - Callback with validated account meta
 * @returns A field for entering an existing account name with validation
 */
export const FieldAccountExisting = withFieldGroup({
    defaultValues: {
        account: "",
    },
    props: {
        label: undefined as string | undefined,
        description: undefined as string | undefined,
        placeholder: undefined as string | undefined,
        disabled: false,
        onValidate: undefined as
            | ((account: z.infer<typeof zGetAccountReturn>) => void)
            | undefined,
    },
    render: function Render({
        group,
        disabled,
        label,
        description,
        placeholder,
        onValidate,
    }) {
        const [isValidating, setIsValidating] = useState(false);
        const [userNotFound, setUserNotFound] = useState(false);

        return (
            <group.AppField
                name="account"
                children={(field) => {
                    return (
                        <field.TextField
                            disabled={disabled}
                            label={label}
                            placeholder={placeholder}
                            description={description}
                            startContent={
                                <UserStartContent
                                    userNotFound={
                                        Boolean(field.state.value) &&
                                        userNotFound
                                    }
                                    value={field.state.value}
                                    isValid={field.state.meta.isValid}
                                    isValidating={isValidating}
                                />
                            }
                        />
                    );
                }}
                validators={{
                    onChange: () => setIsValidating(true),
                    onChangeAsyncDebounceMs: 500,
                    onChangeAsync: async ({ value }) => {
                        const account = await getAccount(value);
                        onValidate?.(account);
                        setIsValidating(false);
                        const notFound = !account?.accountNum;
                        setUserNotFound(notFound);
                    },
                    onSubmit: ({ fieldApi }) => {
                        const errors = fieldApi.parseValueWithSchema(zAccount);
                        if (errors) return errors;
                    },
                    onSubmitAsync: async ({ value }) => {
                        const account = await getAccount(value);
                        onValidate?.(account);
                        setIsValidating(false);
                        const notFound = !account?.accountNum;
                        setUserNotFound(notFound);
                        if (notFound) {
                            return "Account does not exist";
                        }
                    },
                }}
            />
        );
    },
});

const UserStartContent = ({
    userNotFound,
    value,
    isValid,
    isValidating,
}: {
    userNotFound: boolean;
    value: string;
    isValid: boolean;
    isValidating: boolean;
}) => {
    return (
        <div className="mx-1.5 flex h-5 w-5 items-center justify-center">
            {isValidating ? (
                <User size={16} />
            ) : userNotFound ? (
                <UserX size={16} className="text-destructive" />
            ) : isValid && value ? (
                <Avatar
                    account={value}
                    className="h-5 w-5"
                    alt="Recipient avatar"
                />
            ) : (
                <User size={16} />
            )}
        </div>
    );
};
