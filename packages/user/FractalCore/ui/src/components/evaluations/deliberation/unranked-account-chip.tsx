import { Plus } from "lucide-react";

import { Avatar } from "@shared/components/avatar";
import { type LocalContact } from "@shared/hooks/use-contacts";
import { type Account } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";

type UnrankedAccountChipProps = {
    account: Account;
    currentUser: Account | null | undefined;
    contacts: LocalContact[] | undefined;
    onAdd: (account: Account) => void;
};

export const UnrankedAccountChip = ({
    account,
    currentUser,
    contacts,
    onAdd,
}: UnrankedAccountChipProps) => {
    const nickname = contacts?.find((contact) => contact.account === account)
        ?.nickname;
    const isCurrentUser = currentUser === account;
    const primaryLabel = isCurrentUser ? "You" : nickname;

    return (
        <Button
            variant="outline"
            size="sm"
            className="h-auto justify-between gap-2 px-2 py-1.5"
            onClick={() => onAdd(account)}
        >
            <div className="flex min-w-0 items-center gap-2">
                <Avatar
                    account={account}
                    className="h-6 w-6"
                    alt="Contact avatar"
                />
                <div className="min-w-0 text-left">
                    {primaryLabel ? (
                        <div className="flex flex-col leading-tight">
                            <div className="truncate text-xs font-medium">
                                {primaryLabel}
                            </div>
                            <div className="text-muted-foreground truncate text-[11px] italic">
                                {account}
                            </div>
                        </div>
                    ) : (
                        <div className="truncate text-xs italic">{account}</div>
                    )}
                </div>
            </div>
            <Plus className="h-4 w-4 shrink-0" />
        </Button>
    );
};
