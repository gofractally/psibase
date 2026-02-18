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

import { SetGuildRepModal } from "./set-guild-rep-modal";

export const SetGuildRepItem = () => {
    const { data: guild } = useGuild();
    const { data: currentUser } = useCurrentUser();

    const isRep = guild?.rep?.member === currentUser;
    const isCouncilMember =
        currentUser && guild?.council?.includes(currentUser);

    const [showRepModal, setShowRepModal] = useState(false);

    return (
        <>
            <SetGuildRepModal
                openChange={(show) => setShowRepModal(show)}
                show={showRepModal}
            />
            {(isRep || isCouncilMember) && (
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
