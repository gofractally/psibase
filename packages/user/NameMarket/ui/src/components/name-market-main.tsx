import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import { HistorySection } from "./history-section";

import { supervisor } from "@shared/lib/supervisor";

export type NameMarketOutletContext = {
    bumpHistory: () => void;
};

export function NameMarketMain() {
    const [historyNonce, setHistoryNonce] = useState(0);

    const bumpHistory = useCallback(() => {
        setHistoryNonce((n) => n + 1);
    }, []);

    useEffect(() => {
        void supervisor.onLoaded();
    }, []);

    return (
        <div className="mx-auto w-full max-w-screen-md px-4 pb-8">
            <Outlet
                context={{ bumpHistory } satisfies NameMarketOutletContext}
            />
            <HistorySection historyNonce={historyNonce} />
        </div>
    );
}
