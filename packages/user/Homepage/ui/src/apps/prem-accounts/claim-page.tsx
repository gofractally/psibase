import { UnclaimedNamesTable } from "@/apps/prem-accounts/components/unclaimed-names-table";
import { useUnclaimedNames } from "@/apps/prem-accounts/hooks/use-unclaimed-names";

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
