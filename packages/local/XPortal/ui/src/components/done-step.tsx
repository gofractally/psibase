import { siblingUrl } from "@psibase/common-lib";

import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";

export const DoneStep = ({ account }: { account: string }) => (
    <PageContainer className="space-y-6">
        <h2 className="text-lg font-medium">
            <span className="font-semibold">{account}</span> has been imported
            on this device.
        </h2>
        <div className="flex justify-end">
            <Button asChild>
                <a href={siblingUrl()}>Go to Homepage</a>
            </Button>
        </div>
    </PageContainer>
);
