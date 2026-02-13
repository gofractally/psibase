import { Avatar } from "@shared/components/avatar";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const TableContact = ({ account }: { account: string }) => {
    const {
        data: currentUser,
        isPending: isPendingCurrentUser,
        isError: isErrorCurrentUser,
    } = useCurrentUser();

    const {
        data: contacts,
        isPending: isPendingContacts,
        isError: isErrorContacts,
    } = useContacts(currentUser);

    if (isPendingCurrentUser || isPendingContacts) {
        return (
            <div className="@lg:h-auto flex h-10 items-center gap-2">
                <Skeleton className="@lg:h-5 @lg:w-5 h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-24" />
            </div>
        );
    }

    if (isErrorCurrentUser || isErrorContacts) {
        return <div>{account}</div>;
    }

    const contact = contacts?.find((contact) => contact.account === account);
    return (
        <div className="@lg:h-auto flex h-10 items-center gap-2">
            <Avatar
                account={account}
                className="@lg:h-5 @lg:w-5 h-8 w-8"
                alt="Contact avatar"
            />
            {contact?.nickname ? (
                <div className="@lg:flex-row @lg:gap-1 flex flex-col">
                    <div className="font-medium">{contact.nickname}</div>
                    <div className="text-muted-foreground italic">
                        {account}
                    </div>
                </div>
            ) : (
                <div className="italic">{account}</div>
            )}
        </div>
    );
};
