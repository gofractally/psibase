import { CardContent, CardTitle } from "@shared/shadcn/ui/card";

import { PortalCard } from "./portal-card";

export const NotOpen = () => (
    <PortalCard>
        <CardContent className="flex flex-col gap-6">
            <CardTitle className="text-3xl font-normal">
                Account requests aren&apos;t open on this network
            </CardTitle>
            <a
                href="/admin"
                className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-4"
            >
                Node admin? Sign in
            </a>
        </CardContent>
    </PortalCard>
);
