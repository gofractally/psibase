import type { FractalRes } from "@/lib/graphql/fractals/getFractal";
import type { Membership } from "@/lib/graphql/fractals/getMembership";

import dayjs from "dayjs";

import { getMemberLabel } from "@/lib/getMemberLabel";

import { GlowingCard } from "@shared/components/glowing-card";
import { createIdenticon } from "@shared/lib/create-identicon";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { CardContent, CardFooter, CardHeader } from "@shared/shadcn/ui/card";

export const OverviewCard = ({
    fractal,
    fractalAccount,
    chainId,
    membership,
}: {
    fractal?: FractalRes;
    fractalAccount?: string;
    chainId: string;
    membership?: Membership;
}) => {
    const isMember = membership != null;
    const status = !isMember
        ? "Not a member"
        : membership
          ? getMemberLabel(membership.memberStatus)
          : "Loading...";

    return (
        <GlowingCard>
            <CardHeader className="flex items-center gap-2">
                <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-12 items-center justify-center rounded-lg border">
                    <img
                        src={createIdenticon(chainId + fractalAccount)}
                        alt={`${fractal?.fractal?.name || "Fractal"} identicon`}
                        className="size-3/5"
                    />
                </div>
                <div className="flex-1">
                    <div className="text-xl font-semibold leading-tight">
                        {fractal?.fractal?.name || "Loading..."}
                    </div>
                    <div className="text-muted-foreground text-sm font-normal leading-tight">
                        {fractalAccount}
                    </div>
                </div>
                <Badge
                    variant={isMember ? "default" : "destructive"}
                    className={cn({
                        "bg-destructive/10 text-destructive border-destructive/20":
                            !isMember,
                    })}
                >
                    {status}
                </Badge>
            </CardHeader>
            <CardContent className="space-y-1">
                <h3 className="text-muted-foreground text-sm font-medium">
                    Mission
                </h3>
                <p className="text-sm leading-relaxed">
                    {fractal?.fractal?.mission ?? "No mission available"}
                </p>
            </CardContent>
            <CardFooter className="justify-end">
                <div className="text-muted-foreground text-xs font-normal italic">
                    Member since{" "}
                    {dayjs(membership?.createdAt).format("MMMM D, YYYY")}
                </div>
            </CardFooter>
        </GlowingCard>
    );
};
