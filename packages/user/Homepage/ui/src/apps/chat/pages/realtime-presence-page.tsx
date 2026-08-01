import { RealtimeConnectionIndicator } from "@/apps/chat/components/realtime-connection-indicator";
import { useRealtimePresence } from "@/apps/chat/hooks/use-realtime-presence";
import { ContactWithPresenceRow } from "@/apps/chat/pages/presence-contact-row";

import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";

/**
 * PR3 presence-only Chat page: connection indicator + contacts with online dots.
 * Conversation list / Spaces / messaging land in later PRs.
 */
export function RealtimePresencePage() {
    const { data: currentUser } = useCurrentUser();
    const { data: contactsData, isLoading: isLoadingContacts } =
        useContacts(currentUser);
    const { connectionState, presenceReady, presenceByAccount } =
        useRealtimePresence();

    const others = (contactsData ?? []).filter(
        (contact) => contact.account !== currentUser,
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <h1 className="text-lg font-semibold">Chat</h1>
                <RealtimeConnectionIndicator
                    connectionState={connectionState}
                    presenceReady={presenceReady}
                />
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-1 px-2 py-3">
                    <p className="text-muted-foreground px-2 pb-2 text-xs font-semibold uppercase tracking-wide">
                        Contacts
                    </p>
                    {isLoadingContacts ? (
                        <p className="text-muted-foreground px-3 py-2 text-sm">
                            Loading contacts…
                        </p>
                    ) : others.length === 0 ? (
                        <p className="text-muted-foreground px-3 py-2 text-sm">
                            No contacts yet. Add mutual contacts in Contacts,
                            then open this page on both accounts to see
                            presence.
                        </p>
                    ) : (
                        others.map((contact) => (
                            <ContactWithPresenceRow
                                key={contact.account}
                                contact={contact}
                                presence={
                                    presenceByAccount[contact.account] ??
                                    "unknown"
                                }
                            />
                        ))
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
