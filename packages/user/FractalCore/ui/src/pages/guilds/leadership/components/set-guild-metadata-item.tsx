import { useState } from "react";

import { useGuild } from "@/hooks/use-guild";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";

import { SetGuildMetadataModal } from "../../components/set-guild-metadata-modal";

export const SetGuildMetadataItem = () => {
    const { data: guild } = useGuild();
    const { data: currentUser } = useCurrentUser();

    const isRep = guild?.rep?.member === currentUser;
    const isCouncilMember =
        currentUser && guild?.council?.includes(currentUser);

    const [show, setShow] = useState(false);

    return (
        <>
            <SetGuildMetadataModal openChange={setShow} show={show} />
            {(isRep || isCouncilMember) && (
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
