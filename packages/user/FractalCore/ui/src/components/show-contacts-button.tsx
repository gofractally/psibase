import { ShowContactsButton as SharedShowContactsButton } from "@shared/components/show-contacts-button";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { fractalCorePlugin } from "@/lib/plugin";

export const ShowContactsButton = ({
    returnPath,
}: {
    returnPath?: string;
}) => {
    const { data: currentUser } = useCurrentUser();
    const { data: hasProfilesReadPermission } = useHasProfilesReadPermission(
        fractalCorePlugin.contacts.hasReadPermission,
        {
            enabled: !!currentUser,
        },
    );
    const { refetch: prompt } = useContacts(
        fractalCorePlugin.contacts.get,
        currentUser,
        { enabled: false },
        returnPath ? { enabled: true, returnPath } : undefined,
    );

    return (
        <SharedShowContactsButton
            hasReadPermission={hasProfilesReadPermission}
            onRequestPermission={() => {
                void prompt();
            }}
        />
    );
};
