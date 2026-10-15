import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardFooter, CardTitle } from "@shared/shadcn/ui/card";

import { PortalCard } from "./portal-card";

export const FailedStep = ({ onBack }: { onBack?: () => void }) => (
    <PortalCard>
        <CardContent>
            <CardTitle className="text-3xl font-normal">
                This node is having a problem right now, please try again
                later.
            </CardTitle>
        </CardContent>
        {onBack && (
            <CardFooter className="flex flex-1 justify-end">
                <Button type="button" variant="outline" onClick={onBack}>
                    Back
                </Button>
            </CardFooter>
        )}
    </PortalCard>
);
