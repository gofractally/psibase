import { AlertItem } from "@/components/alert-item";

import { useRemoveGuildRep } from "@/hooks/fractals/use-remove-guild-rep";
import { useGuild } from "@/hooks/use-guild";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export const RemoveRepItem = () => {
    const { data: guild } = useGuild();
    const { data: currentUser } = useCurrentUser();

    const isRep = guild?.rep?.member === currentUser;
    const isCouncilMember =
        currentUser && guild?.council?.includes(currentUser);

    const { mutateAsync: removeGuildRep, isPending: isRemoving } =
        useRemoveGuildRep();

    if (isCouncilMember && !isRep && guild?.rep?.member) {
        return (
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
        );
    }

    return null;
};
