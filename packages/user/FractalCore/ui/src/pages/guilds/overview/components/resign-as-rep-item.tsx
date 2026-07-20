import { AlertItem } from "@/components/alert-item";

import { useResignRep } from "@/hooks/fractals/use-resign-rep";
import { useGuild } from "@/hooks/use-guild";

import { useCurrentUser } from "@shared/hooks/use-current-user";

export const ResignAsRepItem = () => {
    const { data: guild } = useGuild();
    const { data: currentUser } = useCurrentUser();

    const isRep = guild?.rep?.member === currentUser;

    const { mutateAsync: resignAsRep, isPending: isResigning } = useResignRep();

    if (isRep) {
        return (
            <AlertItem
                title="Resign as Representative"
                description={`Step down from your role as representative of the ${guild?.displayName} guild.`}
                confirmTitle="Resign as Representative?"
                confirmDescription={
                    <>
                        You will no longer be the representative of the{" "}
                        <strong>{guild?.displayName}</strong> guild. Leadership
                        will return to the council.
                    </>
                }
                buttonText="Resign"
                onConfirm={() => resignAsRep([guild!.account])}
                isPending={isResigning}
            />
        );
    }

    return null;
};
