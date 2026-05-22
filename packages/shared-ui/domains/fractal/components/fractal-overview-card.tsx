import type { FractalRes } from "../lib/graphql/get-fractal";
import type { Membership } from "../lib/graphql/get-membership";

import dayjs from "dayjs";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { GlowingCard } from "@shared/components/glowing-card";
import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { CardContent, CardFooter, CardHeader } from "@shared/shadcn/ui/card";

import { FractalGuildIdentifier } from "./fractal-guild-header-identifier";

export const OverviewCard = ({
    fractal,
    fractalAccount,
    membership,
    linksToFractal = false,
}: {
    fractal?: FractalRes;
    fractalAccount?: string;
    membership?: Membership;
    linksToFractal?: boolean;
}) => {
    const isMember = membership != null;
    const status = !isMember
        ? "Not a member"
        : membership
          ? 'Member'
          : "Loading...";

    const content = (
        <GlowingCard
            cardClassName={cn(
                linksToFractal &&
                    "cursor-pointer transition-[box-shadow,border-color] duration-200 group-hover:border-primary/45 group-hover:shadow-lg group-hover:shadow-primary/5 group-hover:ring-1.5 group-hover:ring-primary/25 dark:group-hover:border-primary/50",
            )}
        >
            <CardHeader className="flex items-center justify-between gap-2">
                <FractalGuildIdentifier
                    name={fractal?.fractal?.name}
                    account={fractalAccount}
                />
                <div className="flex shrink-0 items-center gap-1.5">
                    <Badge
                        variant={isMember ? "default" : "destructive"}
                        className={cn({
                            "bg-destructive/10 text-destructive border-destructive/20":
                                !isMember,
                        })}
                    >
                        {status}
                    </Badge>
                    {linksToFractal && (
                        <ChevronRight
                            className="text-muted-foreground group-hover:text-primary size-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
                            aria-hidden
                        />
                    )}
                </div>
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

    if (linksToFractal === false) {
        return content;
    }

    return (
        <Link
            to={siblingUrl(null, fractalAccount)}
            className="focus-visible:ring-primary/50 group block rounded-xl outline-none transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2"
            target="_blank"
        >
            <span className="sr-only">Open fractal in new tab</span>
            {content}
        </Link>
    );
};
