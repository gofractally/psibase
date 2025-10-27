import { useCommandState } from "cmdk";
import { Check, ChevronsUpDown, User, UserX } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Supervisor } from "@psibase/common-lib";

import { useContacts } from "@/apps/contacts/hooks/use-contacts";

import { useCurrentUser } from "@/hooks/use-current-user";

import { Avatar } from "@shared/components/avatar";
import { withFieldGroup } from "@shared/components/form/app-form";
import { FieldErrors } from "@shared/components/form/internal/field-errors";
import { zAccount } from "@shared/lib/schemas/account";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@shared/shadcn/ui/command";
import { Label } from "@shared/shadcn/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@shared/shadcn/ui/popover";

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
export const ComboboxFieldAccountExisting = withFieldGroup({
    defaultValues: {
        account: "",
    },
    props: {
        label: undefined as string | undefined,
        placeholder: undefined as string | undefined,
        disabled: false,
        supervisor: undefined as Supervisor | undefined,
    },
    render: function Render({
        group,
        disabled,
        label,
        placeholder,
        supervisor,
    }) {
        const [isValidating, setIsValidating] = useState(false);
        const [userNotFound, setUserNotFound] = useState(false);

        const { data } = useCurrentUser();
        const currentUser = data;
        const contacts = useContacts(currentUser);

        const [open, setOpen] = useState(false);

        return (
            <group.AppField
                name="account"
                children={(field) => {
                    const isError = field.state.meta.errors.length > 0;
                    const isTouched = field.state.meta.isTouched;

                    return (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <Label
                                    className={cn(
                                        isError &&
                                            isTouched &&
                                            "text-destructive",
                                    )}
                                >
                                    {label}
                                </Label>
                            </div>
                            <Popover open={open} onOpenChange={setOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        aria-expanded={open}
                                        aria-invalid={!field.state.meta.isValid}
                                        className="aria-expanded:border-ring aria-expanded:ring-ring/50 aria-expanded:dark:border-ring
                                        aria-expanded:dark:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:dark:ring-destructive/40
                                        aria-invalid:border-destructive aria-invalid:dark:border-destructive justify-between aria-expanded:ring-[3px]"
                                    >
                                        <Placeholder
                                            placeholder={placeholder}
                                            hidden={!!field.state.value}
                                        />
                                        {!!field.state.value && (
                                            <Contact
                                                value={field.state.value}
                                                name={
                                                    contacts.data?.find(
                                                        (contact) =>
                                                            contact.account ===
                                                            field.state.value,
                                                    )?.nickname
                                                }
                                                userNotFound={userNotFound}
                                                isValid={
                                                    field.state.meta.isValid
                                                }
                                                isValidating={isValidating}
                                            />
                                        )}
                                        <ChevronsUpDown className="opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-full p-2">
                                    <Command>
                                        <CommandInput
                                            placeholder="Search account..."
                                            className="h-9 border-none ring-0"
                                        />
                                        <CommandList>
                                            <NoAccountsFound
                                                currentUser={currentUser}
                                            />
                                            <CommandGroup heading="From your contacts">
                                                {contacts.data
                                                    ?.filter(
                                                        (c) =>
                                                            c.account !==
                                                            currentUser,
                                                    )
                                                    .map((c) => (
                                                        <ContactItem
                                                            key={c.account}
                                                            account={c.account}
                                                            name={c.nickname}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onSelect={(
                                                                currentValue,
                                                            ) => {
                                                                field.handleChange(
                                                                    currentValue,
                                                                );
                                                                setOpen(false);
                                                            }}
                                                        />
                                                    ))}
                                            </CommandGroup>
                                            <NoContactItem
                                                value={field.state.value}
                                                onSelect={(currentValue) => {
                                                    field.handleChange(
                                                        currentValue,
                                                    );
                                                    setOpen(false);
                                                }}
                                                contactAccounts={
                                                    contacts.data?.map(
                                                        (c) => c.account,
                                                    ) ?? []
                                                }
                                            />
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                            <FieldErrors meta={field.state.meta} />
                        </div>
                    );
                }}
                validators={{
                    onChange: () => setIsValidating(true),
                    onChangeAsyncDebounceMs: 500,
                    onChangeAsync: async ({ value }) => {
                        const exists = await doesAccountExist(
                            value,
                            supervisor!,
                        );
                        setIsValidating(false);
                        setUserNotFound(!exists);
                        return;
                    },
                    onSubmit: ({ fieldApi }) => {
                        const errors = fieldApi.parseValueWithSchema(zAccount);
                        if (errors) return errors;
                    },
                    onSubmitAsync: async ({ value }) => {
                        const exists = await doesAccountExist(
                            value,
                            supervisor!,
                        );
                        setIsValidating(false);
                        setUserNotFound(!exists);
                        if (exists) return;
                        return "Account does not exist";
                    },
                }}
            />
        );
    },
});

const ContactItem = ({
    account,
    name,
    value,
    onSelect,
}: {
    account: string;
    name?: string;
    value: string;
    onSelect: (value: string) => void;
}) => {
    return (
        <CommandItem
            key={account}
            value={account}
            onSelect={onSelect}
            keywords={[name ?? "", account]}
        >
            <Contact value={account} name={name} />
            <Check
                className={cn(
                    "ml-auto",
                    value === account ? "opacity-100" : "opacity-0",
                )}
            />
        </CommandItem>
    );
};

const NoContactItem = ({
    value,
    onSelect,
    contactAccounts,
}: {
    value: string;
    onSelect: (value: string) => void;
    contactAccounts: string[];
}) => {
    const search = useCommandState((state) => state.search);
    const isValidAccountName = zAccount.safeParse(search).success;

    if (!search || contactAccounts.includes(search) || !isValidAccountName) {
        return null;
    }
    return (
        <CommandGroup heading="Other account">
            <CommandItem
                key={`no-contact-found-${search}`}
                value={search}
                onSelect={onSelect}
            >
                <Contact value={search} isValidating />
                <Check
                    className={cn(
                        "ml-auto",
                        value === search ? "opacity-100" : "opacity-0",
                    )}
                />
            </CommandItem>
        </CommandGroup>
    );
};

const NoAccountsFound = ({ currentUser }: { currentUser?: string | null }) => {
    const search = useCommandState((state) => state.search);
    return (
        <CommandEmpty>
            {currentUser === search
                ? "Cannot send to yourself"
                : "No account found."}
        </CommandEmpty>
    );
};

const Contact = ({
    value,
    name,
    userNotFound = false,
    isValid = true,
    isValidating = false,
}: {
    value: string;
    name?: string;
    userNotFound?: boolean;
    isValid?: boolean;
    isValidating?: boolean;
}) => {
    return (
        <div className="flex items-center gap-1.5">
            <UserStartContent
                userNotFound={userNotFound}
                value={value}
                isValid={isValid}
                isValidating={isValidating}
            />
            {name ? (
                <div className="font-normal">
                    <span className="font-medium">{name}</span>{" "}
                    <span className="text-muted-foreground">({value})</span>
                </div>
            ) : (
                <div className="font-normal">{value}</div>
            )}
        </div>
    );
};

const Placeholder = ({
    placeholder,
    hidden,
}: {
    placeholder?: string;
    hidden: boolean;
}) => {
    if (hidden) return null;
    return (
        <span className="text-muted-foreground">
            {placeholder || "Select account..."}
        </span>
    );
};

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
    return (
        <div className="flex h-5 w-5 items-center justify-center">
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
