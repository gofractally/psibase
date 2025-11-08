import { Check } from "lucide-react";

import { cn } from "@shared/lib/utils";
import { CommandItem } from "@shared/shadcn/ui/command";

import { Contact } from "./contact";

export const ContactListContactItem = ({
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
