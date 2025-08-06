import { TriangleAlert } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

interface Props {
    errorMessage: string;
    action?: () => void;
    actionLabel?: string;
}

export const ErrorCard = ({
    errorMessage,
    action,
    actionLabel = "Login",
}: Props) => {
    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <TriangleAlert className="text-destructive h-12 w-12" />
                </div>
                <CardTitle>Hmm...</CardTitle>
                <CardDescription>{errorMessage}</CardDescription>
                {action && (
                    <CardFooter className="flex justify-end">
                        <Button
                            onClick={() => {
                                action();
                            }}
                        >
                            {actionLabel}
                        </Button>
                    </CardFooter>
                )}
            </CardHeader>
        </Card>
    );
};
