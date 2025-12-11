
import {
    Button
} from "@shared/shadcn/ui/button";

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
import { useInitToken } from "@/hooks/fractals/use-init-token";
import { useGuild } from "@/hooks/use-guild";
import { useFractal } from "@/hooks/fractals/use-fractal";



export const RewardConsensusSettings = ({ guildAccount }: { guildAccount?: string }) => {

    const { data: fractal } = useFractal();
    const { data: guild } = useGuild(guildAccount);
    const { mutateAsync: initalizeToken, isPending } = useInitToken();

    console.log(guild, 'is guild');
    const isTokenActive = !!fractal?.fractal?.consensusReward;

    console.log(fractal, 'is the frac')
    if (!isTokenActive) {
        return <Item variant="outline">
            <ItemContent>
                <ItemTitle>Consensus Rewards</ItemTitle>
                <ItemDescription>
                    Distribute consensus rewards to ranked guilds and their members based on their membership scores.
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isPending}>Initialize token</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will mint an allocation of fractal tokens towards consensus reward distribution. This cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => { initalizeToken([]) }}>Continue</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

            </ItemActions>
        </Item>
    }


    return null;
}