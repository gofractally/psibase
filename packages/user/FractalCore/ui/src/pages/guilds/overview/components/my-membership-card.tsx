import dayjs from "dayjs";

import { useGuildMembership } from "@/hooks/fractals/use-guild-membership";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Badge } from "@shared/shadcn/ui/badge";
import {
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { RegisterCandidacyItem } from "./register-candidacy-item";
import { ResignAsRepItem } from "./resign-as-rep-item";

export const MyMembershipCard = () => {
    const {
        data: currentUser,
        isPending: isPendingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();
    const guildAccount = useGuildAccount();
    const {
        data: membership,
        isPending: isPendingMembership,
        error: errorMembership,
    } = useGuildMembership(guildAccount, currentUser);

    const isGuildMember = membership != null;
    const isPending = isPendingCurrentUser || isPendingMembership;

    if (isPending) {
        return (
            <GlowingCard>
                <CardHeader className="flex items-center justify-between">
                    <Skeleton className="h-6 w-32" />
                    <div className="flex gap-2">
                        <Skeleton className="h-5 w-20 rounded-full" />
                        <Skeleton className="h-5 w-24 rounded-full" />
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </CardContent>
                <CardFooter className="justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-28" />
                </CardFooter>
            </GlowingCard>
        );
    }

    const error = errorCurrentUser || errorMembership;

    if (error) {
        return <ErrorCard error={error} />;
    }

    const isCandidate = membership?.isCandidate;
    const isRep = membership?.guild.rep?.member === currentUser;
    const isCouncilor = membership?.guild.council?.includes(currentUser ?? "");

    if (!isGuildMember) {
        return null;
    }

    return (
        <GlowingCard>
            <CardHeader className="flex items-center justify-between">
                <CardTitle>My Membership</CardTitle>
                <div className="flex gap-2">
                    {isCandidate && <Badge variant="default">Candidate</Badge>}
                    {isRep && <Badge variant="default">Representative</Badge>}
                    {isCouncilor && <Badge variant="default">Councilor</Badge>}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <RegisterCandidacyItem />
                <ResignAsRepItem />
            </CardContent>
            <CardFooter className="justify-between">
                <div className="text-muted-foreground text-xs font-normal italic">
                    Reputation: {membership?.score}
                </div>
                <div className="text-muted-foreground text-xs font-normal italic">
                    Member since{" "}
                    {dayjs(membership?.createdAt).format("MMMM D, YYYY")}
                </div>
            </CardFooter>
        </GlowingCard>
    );
};
