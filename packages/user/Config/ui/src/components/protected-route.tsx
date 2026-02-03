import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCurrentUser } from "@/hooks/useCurrentUser";

import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    const [showModal, setShowModal] = useState(false);

    const { data: currentUser } = useCurrentUser();
    const { mutateAsync: login, isPending } = useConnectAccount();

    const navigate = useNavigate();

    useEffect(() => {
        if (currentUser === null) {
            setShowModal(true);
        }
    }, [currentUser]);

    return (
        <Dialog
            open={showModal}
            onOpenChange={(open) => {
                const isRefusingToLogin = !open && currentUser === null;
                if (isRefusingToLogin) {
                    navigate("/");
                } else {
                    setShowModal(open);
                }
            }}
        >
            {children}
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Login required</DialogTitle>
                    <DialogDescription>
                        You must be logged in to visit this page.
                    </DialogDescription>
                    <div className="flex w-full justify-end">
                        <Button disabled={isPending} onClick={() => login()}>
                            Login
                        </Button>
                    </div>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
