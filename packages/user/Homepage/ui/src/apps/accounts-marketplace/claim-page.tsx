import { UnclaimedNamesTable } from "@/apps/accounts-marketplace/components/unclaimed-names-table";
import { useUnclaimedNames } from "@/apps/accounts-marketplace/hooks/use-unclaimed-names";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export const ClaimPage = () => {
    const { data: currentUser } = useCurrentUser();
    const {
        data: names = [],
        isPending,
        isError,
        error,
    } = useUnclaimedNames(currentUser);

    return (
        <UnclaimedNamesTable
            names={names}
            isPending={!!currentUser && isPending}
            isError={isError}
            error={error}
        />
    );
};
