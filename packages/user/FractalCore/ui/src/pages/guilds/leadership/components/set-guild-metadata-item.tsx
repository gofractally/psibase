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

import { SetGuildMetadataModal } from "../../components/set-guild-metadata-modal";
import { useGuildAccount } from "@/hooks/use-guild-account";

export const SetGuildMetadataItem = () => {
    const { data: roles, isPending, error } = useGuildMemberRoles();

    const [show, setShow] = useState(false);

    const guild = useGuildAccount()

    if (isPending) {
        return <Skeleton className="h-20 w-full" />;
    }

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <>
            <SetGuildMetadataModal guildAccount={guild} openChange={setShow} show={show} />
            {roles?.isGuildAdmin && (
                <Item variant="muted">
                    <ItemContent>
                        <ItemTitle>Edit guild metadata</ItemTitle>
                        <ItemDescription>
                            Edit the guild's display name, description and
                            mission.
                        </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShow(true)}
                        >
                            Edit
                        </Button>
                    </ItemActions>
                </Item>
            )}
        </>
    );
};
