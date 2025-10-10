import { Plus } from "lucide-react";
import { useState } from "react";

import { ErrorCard } from "@/components/error-card";
import { ApplyGuildModal } from "@/components/modals/apply-guild-modal";

import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuild } from "@/hooks/use-guild";
import { useGuildAccount } from "@/hooks/use-guild-account";
import { createIdenticon } from "@/lib/createIdenticon";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const MyGuildMembership = () => {
    const {
        data: currentUser,
        isLoading: isLoadingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();

    const { data: memberships } = useGuildMembershipsOfUser(currentUser);

    const guildAccount = useGuildAccount();
    const isGuildMember = memberships?.some(
        (membership) => membership.guild.account == guildAccount,
    );

    const isLoading = isLoadingCurrentUser;

    const error = errorCurrentUser;

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">My Guild Membership</h1>
            </div>
            <div className="mt-3 space-y-6">
                {isLoading ? (
                    <>
                        <Skeleton className="h-44 w-full rounded-xl" />
                        <Skeleton className="h-44 w-full rounded-xl" />
                        <Skeleton className="h-44 w-full rounded-xl" />
                    </>
                ) : (
                    <>
                        <GuildOverviewCard />
                        {!isGuildMember && <ApplyGuildCard />}
                    </>
                )}
            </div>
        </div>
    );
};

const GuildOverviewCard = () => {
    const { data: guild } = useGuild();
    const { data: chainId } = useChainId();

    console.log({ guild });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-10 items-center justify-center rounded-lg border">
                        <img
                            src={createIdenticon(chainId + guild?.account)}
                            alt={guild?.displayName || "Guild"}
                            className="size-5"
                        />
                    </div>
                    <div>
                        <div className="text-xl font-semibold">
                            {guild?.displayName || "Loading..."}
                        </div>
                        <div className="text-muted-foreground text-sm font-normal">
                            {guild?.bio}
                        </div>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    <div>
                        <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                            Mission
                        </h3>
                        <p className="text-sm leading-relaxed">
                            {guild?.description || "No mission available."}
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

// const MembershipStatusCard = ({ membership }: { membership?: Membership }) => {
//     const status =
//         membership == null
//             ? "Not a member"
//             : membership
//                 ? getMemberLabel(membership.memberStatus)
//                 : "Loading...";
//     return (
//         <Card>
//             <CardHeader>
//                 <CardTitle className="text-lg">Membership status</CardTitle>
//             </CardHeader>
//             <CardContent className="space-y-4">
//                 <div className="flex items-center justify-between">
//                     <span className="text-sm font-medium">Status</span>
//                     <Badge
//                         variant={
//                             status === "Not a member"
//                                 ? "destructive"
//                                 : "default"
//                         }
//                         className={
//                             status === "Not a member"
//                                 ? "bg-destructive/10 text-destructive border-destructive/20"
//                                 : ""
//                         }
//                     >
//                         {status}
//                     </Badge>
//                 </div>

//                 {membership && (
//                     <>
//                         <Separator />
//                         <div className="flex items-center justify-between">
//                             <span className="text-sm font-medium">
//                                 Member since
//                             </span>
//                             <span className="text-muted-foreground text-sm">
//                                 {dayjs(membership.createdAt).format(
//                                     "MMMM D, YYYY",
//                                 )}
//                             </span>
//                         </div>
//                     </>
//                 )}
//             </CardContent>
//         </Card>
//     );
// };

const ApplyGuildCard = () => {
    const [showModal, setShowModal] = useState(false);

    // if (error) {
    //     return <ErrorCard error={error} />;
    // }

    return (
        <Card className="border-dashed">
            <ApplyGuildModal
                openChange={(show) => setShowModal(show)}
                show={showModal}
            />
            <CardContent className="pt-6">
                <div className="flex flex-col items-center space-y-4 text-center">
                    <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
                        <Plus className="text-muted-foreground h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold">Apply to Join</h3>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Create an application to join this guild.
                        </p>
                    </div>
                    <Button
                        onClick={() => {
                            setShowModal(true);
                        }}
                        size="lg"
                        className="w-full sm:w-auto"
                    >
                        Apply
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};
