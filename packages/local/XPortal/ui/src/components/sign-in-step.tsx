import { PageContainer } from "@shared/components/page-container";
import { Button } from "@shared/shadcn/ui/button";

export const SignInStep = () => (
    <PageContainer className="space-y-6">
        <h2 className="text-lg font-medium">Sign in with X</h2>
        <div className="flex justify-end">
            <Button asChild>
                <a href="/auth/x/start">Sign in with X</a>
            </Button>
        </div>
    </PageContainer>
);
