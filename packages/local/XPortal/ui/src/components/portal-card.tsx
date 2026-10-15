import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { Progress } from "@shared/shadcn/ui/progress";

/** The network-branded card every screen renders in. `progress` is a percentage. */
export const PortalCard = ({
    progress,
    children,
}: {
    progress?: number;
    children: React.ReactNode;
}) => (
    <BrandedGlowingCard>
        {progress !== undefined && (
            <div className="-mt-6 px-6">
                <Progress value={progress} />
            </div>
        )}
        {children}
    </BrandedGlowingCard>
);
