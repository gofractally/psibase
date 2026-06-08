import { GripHorizontal, X } from "lucide-react";
import { SortableItem, SortableKnob } from "react-easy-sort";

import { Avatar } from "@shared/components/avatar";
import { type LocalContact } from "@shared/hooks/use-contacts";
import { type Account } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";

type RankedAccountItemProps = {
    account: Account;
    currentUser: Account | null | undefined;
    contacts: LocalContact[] | undefined;
    onRemove: (account: Account) => void;
};

export const RankedAccountItem = ({
    account,
    currentUser,
    contacts,
    onRemove,
}: RankedAccountItemProps) => {
    const nickname = contacts?.find((contact) => contact.account === account)
        ?.nickname;
    const isCurrentUser = currentUser === account;
    const primaryLabel = isCurrentUser ? "You" : nickname;

    return (
        <SortableItem>
            <div className="bg-background cursor-grab">
                <SortableKnob>
                    <div className="border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground flex w-full select-none items-center gap-3 rounded-sm border p-2">
                        <GripHorizontal className="h-5 w-5" />
                        <Avatar
                            account={account}
                            className="h-8 w-8"
                            alt="Contact avatar"
                        />
                        <div className="flex-1">
                            {primaryLabel ? (
                                <div className="flex flex-col">
                                    <div className="text-base font-medium leading-tight">
                                        {primaryLabel}
                                    </div>
                                    <div className="text-muted-foreground text-sm italic leading-tight">
                                        {account}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-base italic">{account}</div>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRemove(account)}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </SortableKnob>
            </div>
        </SortableItem>
    );
};
