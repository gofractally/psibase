import { Outlet } from "react-router-dom";

import { PageContainer } from "@shared/components/page-container";

export function AccountMarketplaceLayout() {
    return (
        <PageContainer className="space-y-6">
            <Outlet />
        </PageContainer>
    );
}
