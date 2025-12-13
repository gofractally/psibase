import { siblingUrl } from "@psibase/common-lib";

import { GlowingCard } from "@shared/components/glowing-card";
import { NetworkLogo } from "@shared/components/network-logo";
import { CardHeader } from "@shared/shadcn/ui/card";

export const BrandedGlowingCard = ({
    children,
}: {
    children: React.ReactNode;
}) => {
    return (
        <GlowingCard className="w-xl mx-4">
            <CardHeader className="-ml-2 -mt-2">
                <NetworkLogo
                    onClick={() => {
                        window.top!.location.href = siblingUrl();
                    }}
                />
            </CardHeader>
            {children}
        </GlowingCard>
    );
};
