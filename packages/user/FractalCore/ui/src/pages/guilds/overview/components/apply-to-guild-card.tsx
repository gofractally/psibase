import { Plus } from "lucide-react";
import { useState } from "react";

import { ApplyGuildModal } from "@/components/modals/apply-guild-modal";

import { useGuildMembership } from "@/hooks/fractals/use-guild-membership";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { ErrorCard } from "@shared/components/error-card";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { Card, CardContent } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const ApplyToGuildCard = () => {
    const [showModal, setShowModal] = useState(false);

    const guildAccount = useGuildAccount();

    const {
        data: currentUser,
        isPending: isPendingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();

    const {
        data: membership,
        isPending: isPendingMembership,
        error: errorMembership,
    } = useGuildMembership(guildAccount, currentUser);

    const isPending = isPendingCurrentUser || isPendingMembership;

    if (isPending) {
        return (
            <Card className="border-dashed">
                <CardContent className="pt-6">
                    <div className="flex flex-col items-center space-y-4 text-center">
                        <Skeleton className="h-12 w-12 rounded-full" />
                        <div className="space-y-1">
                            <Skeleton className="mx-auto h-6 w-32" />
                            <Skeleton className="mx-auto h-4 w-56" />
                            <Skeleton className="mx-auto h-4 w-48" />
                        </div>
                        <Skeleton className="h-10 w-full sm:w-24" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    const error = errorCurrentUser || errorMembership;

    if (error) {
        return <ErrorCard error={error} />;
    }

    if (membership) {
        return null;
    }

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
