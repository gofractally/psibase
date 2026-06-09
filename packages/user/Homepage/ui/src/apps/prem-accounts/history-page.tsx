import { HistorySection } from "@/apps/prem-accounts/components/history-section";
import { usePaginatedNameEvents } from "@/apps/prem-accounts/hooks/use-paginated-name-events";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export const HistoryPage = () => {
    const { data: currentUser } = useCurrentUser();
    const {
        events,
        pageIndex,
        hasNextPage,
        hasPreviousPage,
        goNext,
        goPrevious,
        isPending,
        isFetching,
        isError,
        error,
    } = usePaginatedNameEvents(currentUser);

    return (
        <HistorySection
            events={events}
            pageIndex={pageIndex}
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            onNextPage={goNext}
            onPreviousPage={goPrevious}
            isPending={isPending}
            isFetching={isFetching}
            isError={isError}
            error={error}
            isLoggedIn={!!currentUser}
        />
    );
};
