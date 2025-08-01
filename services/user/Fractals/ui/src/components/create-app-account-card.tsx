import { useState } from "react";

import { useCurrentFractal } from "@/hooks/use-current-fractal";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

import { CreateFractalModal } from "./create-fractal-modal";

export const CreateAppAccountCard = () => {
    const currentFractal = useCurrentFractal();

    const [showModal, setShowModal] = useState(false);

    return (
        <Card>
            <CreateFractalModal
                show={showModal}
                openChange={(e) => {
                    setShowModal(e);
                }}
            />
            <CardHeader>
                <CardTitle>Fractal not found</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
                Fractal {currentFractal} does not exist.
            </CardContent>
        </Card>
    );
};
