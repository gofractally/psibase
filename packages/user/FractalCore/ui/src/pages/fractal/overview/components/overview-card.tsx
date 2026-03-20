import type { FractalRes } from "@/lib/graphql/fractals/getFractal";

import { FractalGuildIdentifier } from "@/components/fractal-guild-header-identifier";


import { GlowingCard } from "@shared/components/glowing-card";
import { CardContent, CardHeader } from "@shared/shadcn/ui/card";

export const OverviewCard = ({
    fractal,
    fractalAccount,
}: {
    fractal?: FractalRes;
    fractalAccount?: string;
}) => {


    return (
        <GlowingCard>
            <CardHeader className="flex items-center justify-between gap-2">
                <FractalGuildIdentifier
                    name={fractal?.fractal?.name}
                    account={fractalAccount}
                />
            </CardHeader>
            <CardContent className="space-y-1">
                <h3 className="text-muted-foreground text-sm font-medium">
                    Mission
                </h3>
                <p className="text-sm leading-relaxed">
                    {fractal?.fractal?.mission ?? "No mission available"}
                </p>
            </CardContent>

        </GlowingCard>
    );
};
