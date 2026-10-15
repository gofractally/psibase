import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";

export const FailedStep = ({ onBack }: { onBack?: () => void }) => (
    <PageContainer className="space-y-6">
        <h2 className="text-lg font-medium">
            This node is having a problem right now, please try again later.
        </h2>
        {onBack && (
            <div className="flex justify-end">
                <Button type="button" variant="outline" onClick={onBack}>
                    Back
                </Button>
            </div>
        )}
    </PageContainer>
);
