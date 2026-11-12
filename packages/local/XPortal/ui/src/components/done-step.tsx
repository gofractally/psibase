import { useEffect } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";

export const DoneStep = ({ account }: { account: string }) => {
    useEffect(() => {
        document.getElementById("account")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    }, []);

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-medium">
                <span className="font-semibold">{account}</span> has been
                imported on this device.
            </h2>
            <Button asChild className="w-full">
                <a href={siblingUrl()}>Go to Homepage</a>
            </Button>
        </div>
    );
};
