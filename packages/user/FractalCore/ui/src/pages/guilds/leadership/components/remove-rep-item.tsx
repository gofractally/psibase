import { AlertItem } from "@/components/alert-item";

import { useGuildMemberRoles } from "@/hooks/fractals/use-guild-member-roles";
import { useRemoveGuildRep } from "@/hooks/fractals/use-remove-guild-rep";
import { useGuild } from "@/hooks/use-guild";

import { ErrorCard } from "@shared/components/error-card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const RemoveRepItem = () => {
    const { data: guild } = useGuild();
    const { data: roles, isPending, error } = useGuildMemberRoles();

    const { mutateAsync: removeGuildRep, isPending: isRemoving } =
        useRemoveGuildRep();

    if (isPending) {
        return <Skeleton className="h-20 w-full" />;
    }

    if (error) {
        return <ErrorCard error={error} />;
    }

    if (roles?.isCouncilMember && !roles?.isRep && guild?.rep?.member) {
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
