import { siblingUrl } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardFooter, CardTitle } from "@shared/shadcn/ui/card";

import { PortalCard } from "./portal-card";

export const DoneStep = ({ account }: { account: string }) => (
    <PortalCard progress={100}>
        <CardContent>
            <CardTitle className="text-3xl font-normal">
                <span className="font-semibold">{account}</span> has been
                imported on this device.
            </CardTitle>
        </CardContent>
        <CardFooter className="flex flex-1 justify-end">
            <Button asChild>
                <a href={siblingUrl()}>Go to Homepage</a>
            </Button>
        </CardFooter>
    </PortalCard>
);
