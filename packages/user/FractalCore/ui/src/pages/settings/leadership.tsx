import { useCurrentUser } from "@/hooks/use-current-user";
import { useGuild } from "@/hooks/use-guild"
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@shared/shadcn/ui/alert-dialog";
import {
    Button
} from "@shared/shadcn/ui/button";
import { useResignRep } from "@/hooks/fractals/use-resign-rep";
import { useRemoveGuildRep } from "@/hooks/fractals/use-remove-guild-rep";
import { SetGuildRepModal } from "@/components/modals/set-guild-rep-modal";
import { useState } from "react";


const ResignAsRep = () => {

    const { data: guild } = useGuild();
    const { mutateAsync: resignAsRep, isPending } = useResignRep();

    return <Item variant="outline">
        <ItemContent>
            <ItemTitle>Resign as Representative</ItemTitle>
            <ItemDescription>
                Step down from your role as representative of the {guild?.displayName} guild.
            </ItemDescription>
        </ItemContent>
        <ItemActions>
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isPending}>Resign</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Resign as Representative?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You will no longer be the representative of the {guild?.displayName} guild. Leadership will return to the council.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { resignAsRep([guild!.account]) }}>Resign</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ItemActions>
    </Item>
}

const RemoveGuildRep = () => {

    const { data: guild } = useGuild();
    const { mutateAsync: removeGuildRep, isPending } = useRemoveGuildRep();

    return <Item variant="outline">
        <ItemContent>
            <ItemTitle>Remove Representative</ItemTitle>
            <ItemDescription>
                Remove {guild?.rep?.member} as representative of the guild.
            </ItemDescription>
        </ItemContent>
        <ItemActions>
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isPending}>Remove</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove {guild?.rep?.member}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will immediately remove {guild?.rep?.member} as representative of the {guild?.displayName} guild, leadership will return to the council.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { removeGuildRep([guild!.account]) }}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ItemActions>
    </Item>
}


export const Leadership = () => {

    const { data: guild } = useGuild();

    const { data: currentUser } = useCurrentUser();
    const isRep = guild?.rep?.member === currentUser;
    const isCouncilMember = currentUser && guild && guild.council ? (guild?.council || []).includes(currentUser) : false;

    const [showRepModal, setShowRepModal] = useState(false);


    return <div className="flex flex-col gap-2">
        <SetGuildRepModal openChange={(show) => setShowRepModal(show)} show={showRepModal} />

        {isRep && <ResignAsRep />}
        {isCouncilMember && !isRep && <RemoveGuildRep />}

        {(isRep || isCouncilMember) && <Item variant="outline">
            <ItemContent>
                <ItemTitle>Set representative</ItemTitle>
                <ItemDescription>
                    Set a guild member to represent the guild.
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <Button variant="outline" size="sm" onClick={() => { setShowRepModal(true) }}>
                    Set rep
                </Button>
            </ItemActions>
        </Item>}
    </div>
}

