import { User, UserX } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Supervisor } from "@psibase/common-lib";

import { useAvatar } from "@shared/hooks/use-avatar";
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
 *     supervisor={supervisor}
 * />
 * ```
 *
 * @param label - The label for the field
 * @param description - Optional description text
 * @param placeholder - Placeholder text for the input
 * @param disabled - Whether the field is disabled
 * @param supervisor - Consuming app's supervisor instance for account validation
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
        supervisor: undefined as Supervisor | undefined,
    },
    render: function Render({
        group,
        disabled,
        label,
        description,
        placeholder,
        supervisor,
    }) {
        const [isValidating, setIsValidating] = useState(false);
        return (
            <group.AppField
                name="account"
                children={(field) => {
                    const userNotFound = field.state.meta.errors.includes(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        "Account does not exist" as any,
                    );
                    return (
                        <field.TextField
                            disabled={disabled}
                            label={label}
                            placeholder={placeholder}
                            description={description}
                            startContent={
                                <UserStartContent
                                    userNotFound={userNotFound}
                                    value={field.state.value}
                                    isValid={field.state.meta.isValid}
                                    isValidating={isValidating}
                                />
                            }
                        />
                    );
                }}
                validators={{
                    onChange: ({ fieldApi }) => {
                        setIsValidating(true);
                        const errors = fieldApi.parseValueWithSchema(zAccount);
                        if (errors) return errors;
                    },
                    onChangeAsyncDebounceMs: 500,
                    onChangeAsync: async ({ value }) => {
                        const exists = await doesAccountExist(
                            value,
                            supervisor!,
                        );
                        setIsValidating(false);
                        if (exists) return;
                        return "Account does not exist";
                    },
                }}
            />
        );
    },
});

const zGetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
        resourceBalance: z.boolean().or(z.bigint()),
    })
    .optional();

export const doesAccountExist = async (
    accountName: string,
    supervisor: Supervisor,
): Promise<boolean> => {
    try {
        const res = zGetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        return Boolean(res?.accountNum);
    } catch (e) {
        // TODO: read this error, actually throw if there's something wrong, other than being invalid
        console.error(e);
        return false;
    }
};

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
    const { avatarSrc } = useAvatar(value);

    return (
        <div className="mx-1.5 flex h-5 w-5 items-center justify-center">
            {isValidating ? (
                <User size={16} />
            ) : userNotFound ? (
                <UserX size={16} className="text-destructive" />
            ) : isValid ? (
                <img
                    className="h-5 w-5 rounded-full border-2 border-white object-cover shadow-sm dark:border-slate-700"
                    src={avatarSrc}
                    alt="From account"
                />
            ) : (
                <User size={16} />
            )}
        </div>
    );
};
