import { useCpuPricing } from "@/hooks/use-cpu-pricing";
import { useNetPricing } from "@/hooks/use-net-pricing";

import { PricingSection } from "@/components/pricing-section";

export const ResourcePricing = () => {
    const { data: cpuPricing, isLoading: cpuLoading } = useCpuPricing();
    const { data: netPricing, isLoading: netLoading } = useNetPricing();

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Resource Pricing</h2>
                <p className="text-muted-foreground text-sm">
                    View and configure CPU and network resource pricing parameters.
                </p>
            </div>

            <div className="space-y-6">
                <PricingSection
                    title="CPU Pricing"
                    pricing={cpuPricing}
                    isLoading={cpuLoading}
                    billableUnitLabel="ms"
                />
                <PricingSection
                    title="NET Pricing"
                    pricing={netPricing}
                    isLoading={netLoading}
                    billableUnitLabel="bytes"
                />
            </div>
        </div>
    );
};
