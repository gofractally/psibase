import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { Alert, AlertDescription } from "@shared/shadcn/ui/alert";
import { CardContent } from "@shared/shadcn/ui/card";

interface Props {
    error: string;
}

export const ErrorCard = ({ error }: Props) => {
    return (
        <BrandedGlowingCard>
            <CardContent>
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            </CardContent>
        </BrandedGlowingCard>
    );
};
