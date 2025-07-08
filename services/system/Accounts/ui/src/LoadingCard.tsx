import { LoaderCircle } from "lucide-react";

import { Card, CardHeader } from "@shared/shadcn/ui/card";
import { CardTitle } from "@shared/shadcn/ui/card";

export const LoadingCard = () => (
    <Card className="mx-auto mt-4 w-[350px]">
        <CardHeader>
            <div className="mx-auto">
                <LoaderCircle className="h-12 w-12 animate-spin" />
            </div>
            <CardTitle className="text-center">Loading...</CardTitle>
        </CardHeader>
    </Card>
);
