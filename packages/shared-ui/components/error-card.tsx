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
    title?: string;
    error?: Error;
    retry?: () => void;
    retryLabel?: string;
}

export const ErrorCard = ({ error, retry, retryLabel = "Login", title = "Uh oh" }: Props) => {
    const message =
        error?.message ||
        "Something went wrong. Check the console for more details.";
    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <TriangleAlert className="text-destructive h-12 w-12" />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{message}</CardDescription>
                {retry && (
                    <CardFooter className="flex justify-end">
                        <Button
                            onClick={() => {
                                retry();
                            }}
                        >
                            {retryLabel}
                        </Button>
                    </CardFooter>
                )}
            </CardHeader>
        </Card>
    );
};
