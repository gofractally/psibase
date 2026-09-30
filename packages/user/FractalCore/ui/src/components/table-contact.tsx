import { TableContact as SharedTableContact } from "@shared/components/tables/table-contact";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { fractalCorePlugin } from "@/lib/plugin";

export const TableContact = ({ account }: { account: string }) => {
    const {
        data: currentUser,
        isPending: isPendingCurrentUser,
        isError: isErrorCurrentUser,
    } = useCurrentUser();

    const {
        data: hasProfilesReadPermission,
        isPending: isPendingHasProfilesReadPermission,
        isError: isErrorHasProfilesReadPermission,
    } = useHasProfilesReadPermission(
        fractalCorePlugin.embedded.canReadContacts,
        {
            enabled: !!currentUser,
        },
    );

    const {
        data: contacts,
        isLoading: isLoadingContacts,
        isError: isErrorContacts,
    } = useContacts(fractalCorePlugin.embedded.getContacts, currentUser, {
        enabled: !!hasProfilesReadPermission,
    });

    const nickname = contacts?.find((contact) => contact.account === account)
        ?.nickname;

    return (
        <SharedTableContact
            account={account}
            nickname={nickname}
            isLoading={
                isPendingCurrentUser ||
                isPendingHasProfilesReadPermission ||
                isLoadingContacts
            }
            isError={
                isErrorCurrentUser ||
                isErrorHasProfilesReadPermission ||
                isErrorContacts
            }
        />
    );
};
