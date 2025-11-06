import { useCommandState } from "cmdk";
import { Check } from "lucide-react";

import { zAccount } from "@shared/lib/schemas/account";
import { cn } from "@shared/lib/utils";
import { CommandGroup, CommandItem } from "@shared/shadcn/ui/command";

import { Contact } from "./contact";

export const ContactListAccountItem = ({
    value,
    onSelect,
    contactAccounts,
    currentUser,
}: {
    value: string;
    onSelect: (value: string) => void;
    contactAccounts: string[];
    currentUser?: string | null;
}) => {
    const search = useCommandState((state) => state.search);
    const isValidAccountName = zAccount.safeParse(search).success;

    if (
        !search ||
        contactAccounts.includes(search) ||
        !isValidAccountName ||
        search === currentUser
    ) {
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
