import {
    type Conversation,
    useConversations,
} from "@/apps/chainmail/hooks/use-conversations";
import {
    type PendingBalance,
    useUserPendingBalance,
} from "@/apps/tokens/hooks/tokens-plugin/use-pending-balances";

import { useCurrentUser } from "@shared/hooks/use-current-user";

/**
 * Everything waiting on the user, gathered from the apps that can tell us:
 * unread chats and incoming token transfers that need accepting.
 */
export const useNotifications = () => {
    const { data: user } = useCurrentUser();
    const { conversations, unreadTotal, markAllRead } = useConversations();
    const pending = useUserPendingBalance(user);

    const unreadChats: Conversation[] = conversations.filter(
        (c) => c.unread > 0,
    );
    const incomingTransfers: PendingBalance[] =
        pending.data?.filter((p) => p.debitor === user) ?? [];

    return {
        unreadChats,
        unreadMessages: unreadTotal,
        incomingTransfers,
        count: unreadTotal + incomingTransfers.length,
        markChatsRead: markAllRead,
    };
};
