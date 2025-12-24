import { useState } from "react";

import { AlertItem } from "@/components/alert-item";
import { SetGuildRepModal } from "@/components/modals/set-guild-rep-modal";

import { useRemoveGuildRep } from "@/hooks/fractals/use-remove-guild-rep";
import { useResignRep } from "@/hooks/fractals/use-resign-rep";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuild } from "@/hooks/use-guild";

import { Button } from "@shared/shadcn/ui/button";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";

export const Leadership = () => {
    const { data: guild } = useGuild();
    const { data: currentUser } = useCurrentUser();

    const isRep = guild?.rep?.member === currentUser;
    const isCouncilMember =
        currentUser && guild?.council?.includes(currentUser);

    const { mutateAsync: resignAsRep, isPending: isResigning } = useResignRep();
    const { mutateAsync: removeGuildRep, isPending: isRemoving } =
        useRemoveGuildRep();

    const [showRepModal, setShowRepModal] = useState(false);

    return (
        <div className="flex flex-col gap-2">
            <SetGuildRepModal
                openChange={(show) => setShowRepModal(show)}
                show={showRepModal}
            />

            {isRep && (
                <AlertItem
                    title="Resign as Representative"
                    description={`Step down from your role as representative of the ${guild?.displayName} guild.`}
                    confirmTitle="Resign as Representative?"
                    confirmDescription={
                        <>
                            You will no longer be the representative of the{" "}
                            <strong>{guild?.displayName}</strong> guild.
                            Leadership will return to the council.
                        </>
                    }
                    buttonText="Resign"
                    onConfirm={() => resignAsRep([guild!.account])}
                    isPending={isResigning}
                />
            )}

            {isCouncilMember && !isRep && guild?.rep?.member && (
                <AlertItem
                    title="Remove Representative"
                    description={`Remove ${guild.rep.member} as representative of the guild.`}
                    confirmTitle={`Remove ${guild.rep.member}?`}
                    confirmDescription={
                        <>
                            This will immediately remove{" "}
                            <span className="font-semibold">
                                {guild.rep.member}
                            </span>{" "}
                            as representative of the{" "}
                            <span className="font-semibold">
                                {guild.displayName}
                            </span>{" "}
                            guild. Leadership will return to the council.
                        </>
                    }
                    buttonText="Remove"
                    onConfirm={() => removeGuildRep([guild!.account])}
                    isPending={isRemoving}
                    variant="outline"
                />
            )}

            {(isRep || isCouncilMember) && (
                <Item variant="outline">
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
        </div>
    );
};
