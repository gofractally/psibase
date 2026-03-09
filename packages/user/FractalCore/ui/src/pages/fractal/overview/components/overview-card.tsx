import type { FractalRes } from "@/lib/graphql/fractals/getFractal";
import type { Membership } from "@/lib/graphql/fractals/getMembership";

import dayjs from "dayjs";

import { FractalGuildIdentifier } from "@/components/fractal-guild-header-identifier";

import { getMemberLabel } from "@/lib/getMemberLabel";

import { GlowingCard } from "@shared/components/glowing-card";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { CardContent, CardFooter, CardHeader } from "@shared/shadcn/ui/card";

export const OverviewCard = ({
    fractal,
    fractalAccount,
    membership,
}: {
    fractal?: FractalRes;
    fractalAccount?: string;
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
            <CardHeader className="flex items-center justify-between gap-2">
                <FractalGuildIdentifier
                    name={fractal?.fractal?.name}
                    account={fractalAccount}
                />
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
