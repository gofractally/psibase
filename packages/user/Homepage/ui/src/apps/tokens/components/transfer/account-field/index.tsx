import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Supervisor } from "@psibase/common-lib";

import { useContacts } from "@/apps/contacts/hooks/use-contacts";

import { useCurrentUser } from "@/hooks/use-current-user";

import { withFieldGroup } from "@shared/components/form/app-form";
import { FieldErrors } from "@shared/components/form/internal/field-errors";
import { zAccount } from "@shared/lib/schemas/account";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Command,
    CommandGroup,
    CommandInput,
    CommandList,
} from "@shared/shadcn/ui/command";
import { Label } from "@shared/shadcn/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@shared/shadcn/ui/popover";

import { Contact } from "./contact";
import { ContactListAccountItem } from "./contact-list-account-item";
import { ContactListContactItem } from "./contact-list-contact-item";
import { ContactListNoAccounts } from "./contact-list-no-accounts";
import { doesAccountExist } from "./helpers";
import { Placeholder } from "./placeholder";

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
export const FieldAccount = withFieldGroup({
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
        const { data: contacts } = useContacts(currentUser);
        const contactsExcludingCurrentUser = contacts?.filter(
            (c) => c.account !== currentUser,
        );

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
                                <PopoverTrigger asChild disabled={disabled}>
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
                                                    contacts?.find(
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
                                <PopoverContent className="w-full min-w-96 p-2">
                                    <Command>
                                        <CommandInput
                                            placeholder="Search account..."
                                            className="h-9 border-none ring-0"
                                            autoComplete="off"
                                            autoCorrect="off"
                                            autoCapitalize="off"
                                            spellCheck="false"
                                        />
                                        <CommandList>
                                            <ContactListNoAccounts
                                                currentUser={currentUser}
                                            />
                                            <CommandGroup
                                                heading="From your contacts"
                                                className={cn(
                                                    contactsExcludingCurrentUser?.length ===
                                                        0 && "hidden",
                                                )}
                                            >
                                                {contactsExcludingCurrentUser?.map(
                                                    (c) => (
                                                        <ContactListContactItem
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
                                                    ),
                                                )}
                                            </CommandGroup>
                                            <ContactListAccountItem
                                                value={field.state.value}
                                                currentUser={currentUser}
                                                onSelect={(currentValue) => {
                                                    field.handleChange(
                                                        currentValue,
                                                    );
                                                    setOpen(false);
                                                }}
                                                contactAccounts={
                                                    contacts?.map(
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
