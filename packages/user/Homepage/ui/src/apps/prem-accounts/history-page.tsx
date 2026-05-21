import { HistorySection } from "@/apps/prem-accounts/components/history-section";
import { useNameEvents } from "@/apps/prem-accounts/hooks/use-name-events";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export const HistoryPage = () => {
    const { data: currentUser } = useCurrentUser();
    const {
        data: events = [],
        isPending,
        isError,
        error,
    } = useNameEvents(currentUser);

    return (
        <HistorySection
            events={events}
            isPending={!!currentUser && isPending}
            isError={isError}
            error={error}
            isLoggedIn={!!currentUser}
        />
    );
};
