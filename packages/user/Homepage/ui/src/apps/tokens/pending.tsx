import { useOutletContext } from "react-router-dom";

import { useUserLinesOfCredit } from "./hooks/tokensPlugin/useUserLinesOfCredit";
import { TokensOutletContext } from "./layout";

export const PendingPage = () => {
    const context = useOutletContext<TokensOutletContext>();
    if (!context) return <div>No context</div>;
    return <PendingPageContents />;
};

export const PendingPageContents = () => {
    const context = useOutletContext<TokensOutletContext>();
    const { currentUser } = context;

    const { data } = useUserLinesOfCredit(currentUser);
    console.log("pendingTransactions:", data);
    return <div>Pending page</div>;
};
