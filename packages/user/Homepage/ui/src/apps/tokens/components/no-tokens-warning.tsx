import { TriangleAlert } from "lucide-react";

import { EmptyBlock } from "@shared/components/empty-block";

export const NoTokensWarning = () => {
    return (
        <EmptyBlock
            title="Heads up!"
            description="You currently have no token balances or tokens to administer. Receive some tokens to continue."
            Icon={TriangleAlert}
            iconClass="text-yellow-500"
        />
    );
};
