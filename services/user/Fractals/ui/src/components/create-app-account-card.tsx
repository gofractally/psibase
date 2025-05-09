import { useState } from "react";

import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import { useCurrentFractal } from "@/hooks/useCurrentFractal";

import { CreateFractalModal } from "./create-fractal-modal";
import { Button } from "./ui/button";

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
                Fractal {currentFractal} does not exist, click continue to
                create an account{" "}
                <span className="text-primary"> {currentFractal}</span> as a
                fractal.
            </CardContent>
            <CardFooter>
                <Button
                    onClick={() => {
                        setShowModal(true);
                    }}
                >
                    Create fractal
                </Button>
            </CardFooter>
        </Card>
    );
};
