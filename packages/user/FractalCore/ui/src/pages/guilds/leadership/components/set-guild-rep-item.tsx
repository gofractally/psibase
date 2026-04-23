import { useState } from "react";

import { useGuildMemberRoles } from "@/hooks/fractals/use-guild-member-roles";

import { ErrorCard } from "@shared/components/error-card";
import { Button } from "@shared/shadcn/ui/button";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { SetGuildRepModal } from "./set-guild-rep-modal";

export const SetGuildRepItem = () => {
    const { data: roles, isPending, error } = useGuildMemberRoles();

    const [showRepModal, setShowRepModal] = useState(false);

    if (isPending) {
        return <Skeleton className="h-20 w-full" />;
    }

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <>
            <SetGuildRepModal
                openChange={(show) => setShowRepModal(show)}
                show={showRepModal}
            />
            {roles?.isGuildAdmin && (
                <Item variant="muted">
                    <ItemContent>
                        <ItemTitle>Set representative</ItemTitle>
                        <ItemDescription>
                            Set a guild member to represent the guild.
                        </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowRepModal(true)}
                        >
                            Set rep
                        </Button>
                    </ItemActions>
                </Item>
            )}
        </>
    );
};
