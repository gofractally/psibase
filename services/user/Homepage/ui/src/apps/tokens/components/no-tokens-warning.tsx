import { TriangleAlert } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";

interface Props {
    onContinue: () => void;
}

export const NoTokensWarning = ({ onContinue }: Props) => {
    return (
        <div className="relative flex w-full justify-between rounded-lg border p-4">
            <div className="my-auto flex gap-2">
                <div className="my-auto h-full">
                    <TriangleAlert className="h-4 w-4 text-yellow-500" />
                </div>
                <div>
                    <div className="">Heads up!</div>
                    <div className="text-muted-foreground text-sm">
                        You currently have no token balances or tokens to
                        administer.
                    </div>
                    <div className="text-muted-foreground text-sm">
                        Receive some tokens or create a token to continue.
                    </div>
                </div>
            </div>
            <div className="my-auto">
                <Button onClick={() => onContinue()}>Create token</Button>
            </div>
        </div>
    );
};
