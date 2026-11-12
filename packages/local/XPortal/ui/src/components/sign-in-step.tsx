import { Button } from "@shared/shadcn/ui/button";

export const SignInStep = () => (
    <div className="space-y-6">
        <div>
            <h2 className="text-lg font-medium">Sign in with X</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
                Your X account identifies this request. You will come back
                here to choose a plan.
            </p>
        </div>
        <Button asChild className="w-full">
            <a href="/auth/x/start">Sign in with X</a>
        </Button>
    </div>
);
