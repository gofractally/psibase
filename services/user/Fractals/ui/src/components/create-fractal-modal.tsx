import { useNavigate } from "react-router-dom";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { useCreateFractal } from "@/hooks/use-create-app";
import { useTrackedFractals } from "@/hooks/useTrackedFractals";

import { CreateFractalForm } from "./create-fractal-form";

export const CreateFractalModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { addFractal } = useTrackedFractals();
    const { mutateAsync: createApp } = useCreateFractal();

    const navigate = useNavigate();

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add a fractal</DialogTitle>
                    <CreateFractalForm
                        onSubmit={async (data) => {
                            void (await createApp({
                                account: data.fractalName,
                                mission: '',
                                name: ''
                            }));

                            addFractal(data.fractalName);
                            openChange(false);
                            navigate(`/fractal/${data.fractalName}`);
                            return data;
                        }}
                    />
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
