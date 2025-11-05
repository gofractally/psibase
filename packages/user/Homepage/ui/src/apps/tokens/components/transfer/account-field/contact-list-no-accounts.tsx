import { useCommandState } from "cmdk";

import { CommandEmpty } from "@shared/shadcn/ui/command";

export const ContactListNoAccounts = ({
    currentUser,
}: {
    currentUser?: string | null;
}) => {
    const search = useCommandState((state) => state.search);
    return (
        <CommandEmpty>
            {currentUser === search
                ? "Cannot send to yourself"
                : "Enter an account name"}
        </CommandEmpty>
    );
};
