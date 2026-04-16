import { PricingSection } from "@/components/pricing-section";

import { useResourcePricing } from "@/hooks/use-resource-pricing";

import { PageContainer } from "@shared/components/page-container";

export const ResourcePricing = () => {
    const { data: pricing, isLoading } = useResourcePricing();

    return (
        <PageContainer className="space-y-6">
            <div>
                <h2 className="text-lg font-medium">Resource Pricing</h2>
                <p className="text-muted-foreground text-sm">
                    View and configure CPU and network resource pricing
                    parameters.
                </p>
            </div>

            <div className="space-y-6">
                <PricingSection
                    key={pricing?.cpuPricing ? "cpu-ready" : "cpu-loading"}
                    title="CPU Pricing"
                    pricing={pricing?.cpuPricing}
                    isLoading={isLoading}
                    billableUnitLabel="ms"
                />
                <PricingSection
                    key={pricing?.netPricing ? "net-ready" : "net-loading"}
                    title="NET Pricing"
                    pricing={pricing?.netPricing}
                    isLoading={isLoading}
                    billableUnitLabel="bytes"
                />
            </div>
        </PageContainer>
    );
};
