import { Billing } from "@/components/billing";
import { VirtualServer } from "@/components/virtual-server";

import { PageContainer } from "@shared/components/page-container";
import { useSystemToken } from "@shared/hooks/use-system-token";

export const Resources = () => {
    const { data: systemToken, isLoading: systemTokenLoading } =
        useSystemToken();

    return (
        <PageContainer className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">Resources</h2>
                <p className="text-muted-foreground text-sm">
                    Configure virtual server resources and billing settings.
                </p>
            </div>

            <div className="space-y-6">
                <VirtualServer />
                <Billing
                    systemToken={systemToken ?? null}
                    systemTokenLoading={systemTokenLoading}
                />
            </div>
        </PageContainer>
    );
};
