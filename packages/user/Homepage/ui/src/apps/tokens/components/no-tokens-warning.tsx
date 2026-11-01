import { Coins } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";

export const NoTokensWarning = () => {
    return (
        <Panel title="No tokens yet">
            <EmptyState
                icon={Coins}
                className="min-h-40"
                detail="You currently have no token balances. Once another account sends you tokens they will appear here and you can send them onward."
            >
                Nothing to send
            </EmptyState>
        </Panel>
    );
};
