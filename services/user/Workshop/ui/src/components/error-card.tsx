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
    error: Error;
    retry?: () => void;
}

export const ErrorCard = ({ error, retry }: Props) => {
    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CardHeader>
                <div className="mx-auto">
                    <TriangleAlert className="text-destructive h-12 w-12" />
                </div>
                <CardTitle>Uh oh</CardTitle>
                <CardDescription>{error.message}</CardDescription>
                {retry && (
                    <CardFooter className="flex justify-end">
                        <Button
                            onClick={() => {
                                retry();
                            }}
                        >
                            Login
                        </Button>
                    </CardFooter>
                )}
            </CardHeader>
        </Card>
    );
};
