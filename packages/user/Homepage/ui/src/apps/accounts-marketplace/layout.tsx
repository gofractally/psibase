import { Outlet } from "react-router-dom";

import { ErrorCard } from "@shared/components/error-card";
import { PageContainer } from "@shared/components/page-container";
import { useSystemToken } from "@shared/hooks/use-system-token";

export function AccountMarketplaceLayout() {
    const { data: systemToken, isPending: isPendingToken } = useSystemToken();

    if (!isPendingToken && systemToken?.untransferable) {
        return (
            <PageContainer>
                <ErrorCard
                    title="Not available"
                    error={
                        new Error(
                            "Premium account names are not offered on this network. New accounts use free names.",
                        )
                    }
                />
            </PageContainer>
        );
    }

    return (
        <PageContainer className="space-y-6">
            <Outlet />
        </PageContainer>
    );
}
