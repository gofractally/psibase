import { useState } from "react";


import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

import { CreateGuildModal } from "./create-guild-modal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";

export const CreateAppAccountCard = () => {
    const currentFractal = useFractalAccount();

    const [showModal, setShowModal] = useState(false);

    return (
        <Card>
            <CreateGuildModal
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
