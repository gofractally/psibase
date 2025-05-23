import { Gavel } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCurrentUser } from "@/hooks/use-current-user";

import { CreateFractalModal } from "../components/create-fractal-modal";
import { LoginButton } from "../components/login-button";
import { Button } from "../components/ui/button";
import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "../components/ui/card";

export const Loader = () => {
    const { data: currentUser } = useCurrentUser();

    const isLoggedIn = typeof currentUser === "string";

    const navigate = useNavigate();

    if (isLoggedIn) {
        navigate("/browse");
    }

    const [showModal, setShowModal] = useState<boolean>(false);

    return (
        <Card className="mx-auto mt-4 w-[350px]">
            <CreateFractalModal
                show={showModal}
                openChange={(e) => {
                    setShowModal(e);
                }}
            />
            <CardHeader>
                <div className="mx-auto">
                    <Gavel className="h-12 w-12" />
                </div>
                <CardTitle>Fractals</CardTitle>
                <CardDescription>
                    The fractals app allows users to create fractals and
                    participate in fractal governance.
                </CardDescription>

                <CardDescription>
                    {isLoggedIn
                        ? "Add a fractal to continue"
                        : "Login to continue"}
                </CardDescription>
                <CardFooter className="flex justify-end">
                    {isLoggedIn ? (
                        <Button
                            onClick={() => {
                                setShowModal(true);
                            }}
                        >
                            Add fractal
                        </Button>
                    ) : (
                        <LoginButton />
                    )}
                </CardFooter>
            </CardHeader>
        </Card>
    );
};
