import z from "zod";

import {
    tokens,
    usePluginFunctionMutation,
} from "@shared/lib/plugins";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUserTokenBalances } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balances";

export const DevModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {

    const { data: currentUser } = useCurrentUser()
    const { refetch: refetchTokenBalances } = useUserTokenBalances(currentUser)


    const { mutateAsync: createToken, isPending: isCreatingToken } =
        usePluginFunctionMutation(tokens.issuer.create, {});
    const { mutateAsync: mintToken, isPending: isMintingToken } =
        usePluginFunctionMutation(tokens.issuer.mint, {
            onSuccess: () => {
                refetchTokenBalances()
            }
        });

    const createTwoTokens = async () => {
        await createToken([4, "1000000000"]);
        await createToken([4, "1000000000"]);
    };

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Dev tools</DialogTitle>
                    <DialogDescription>
                        Only for development purposes.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <Button
                        onClick={() => createTwoTokens()}
                        disabled={isCreatingToken}
                    >
                        Create two tokens
                    </Button>
                    <Button
                        onClick={() => {
                            mintToken([
                                z
                                    .number({ coerce: true })
                                    .parse(window.prompt("Token ID?")),
                                z
                                    .string()
                                    .parse(window.prompt("Amount?")),
                                "",
                            ]);
                        }}
                        disabled={isMintingToken}
                    >
                        Mint
                    </Button>

                </div>
            </DialogContent>
        </Dialog>
    );
};
