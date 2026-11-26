import { useCallback, useMemo } from "react";

import {
    displayAccount,
    isSavedContact,
    contactNickname,
} from "@/lib/contacts";

import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { type PluginCall } from "@shared/lib/plugins/lib/call-plugin-function";
import { profiles } from "@shared/lib/plugins";

/** Profiles owns this. Favor has no contacts plugin, so the hosting-app default fails. */
export const profilesReadPermission = profiles.api
    .hasReadPermission as PluginCall<[], boolean>;
export const profilesContactsGet = profiles.contacts.get;

export function useFavorContacts(returnPath: string) {
    const { data: user } = useCurrentUser();
    const { data: hasReadPermission, isPending: permissionPending } =
        useHasProfilesReadPermission({
            enabled: !!user,
            call: profilesReadPermission,
        });
    const contactsQuery = useContacts(
        user,
        {
            enabled: !!user && !!hasReadPermission,
            call: profilesContactsGet,
        },
        { enabled: true, returnPath },
    );
    const contacts = useMemo(
        () => contactsQuery.data ?? [],
        [contactsQuery.data],
    );

    const label = useCallback(
        (account: string) => displayAccount(contacts, account),
        [contacts],
    );
    const nicknameOf = useCallback(
        (account: string) => contactNickname(contacts, account),
        [contacts],
    );
    const isContact = useCallback(
        (account: string) => isSavedContact(contacts, account),
        [contacts],
    );

    return {
        user,
        contacts,
        hasReadPermission: !!hasReadPermission,
        isLoading:
            !!user &&
            (permissionPending ||
                (!!hasReadPermission && contactsQuery.isLoading)),
        label,
        nicknameOf,
        isContact,
    };
}
