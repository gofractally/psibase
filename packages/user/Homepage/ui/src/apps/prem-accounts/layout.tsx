import { useEffect } from "react";
import { Outlet } from "react-router-dom";

import { PageContainer } from "@shared/components/page-container";
import { supervisor } from "@shared/lib/supervisor";

export function PremAccountsLayout() {
    useEffect(() => {
        void supervisor.onLoaded();
    }, []);

    return (
        <PageContainer className="space-y-6">
            <Outlet />
        </PageContainer>
    );
}
