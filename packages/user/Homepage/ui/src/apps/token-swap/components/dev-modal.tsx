import z from "zod";

import {
    tokenSwap,
    tokens,
    usePluginFunctionCallMutation,
} from "@shared/lib/plugins";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const DevModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { mutateAsync: createPool } = usePluginFunctionCallMutation(
        tokenSwap.api.newPool,
        {},
    );
    const { mutateAsync: createToken, isPending: isCreatingToken } =
        usePluginFunctionCallMutation(tokens.issuer.create, {});
    const { mutateAsync: mintToken, isPending: isMintingToken } =
        usePluginFunctionCallMutation(tokens.issuer.mint, {});

    const createTwoTokens = async () => {
        await createToken([4, "1000"]);
        await createToken([4, "1000"]);
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
                                    .parse(window.prompt("TokenID?")),
                                "1000",
                                "",
                            ]);
                        }}
                        disabled={isMintingToken}
                    >
                        Mint
                    </Button>

                    <Button
                        onClick={() => {
                            const tokenA = z
                                .number({ coerce: true })
                                .parse(window.prompt("Token A ID?"));
                            const tokenB = z
                                .number({ coerce: true })
                                .parse(window.prompt("Token B ID?"));
                            createPool([tokenA, tokenB, "300", "300"]);
                        }}
                        disabled={isMintingToken}
                    >
                        Create pool
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
