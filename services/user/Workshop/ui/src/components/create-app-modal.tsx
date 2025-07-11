import { useNavigate } from "react-router-dom";

import { useCreateApp } from "@/hooks/use-create-app";
import { useTrackedApps } from "@/hooks/useTrackedApps";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { CreateAppForm } from "./create-app-form";

export const CreateAppModal = ({
    show,
    openChange,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
}) => {
    const { addApp } = useTrackedApps();
    const { mutateAsync: createApp } = useCreateApp();

    const navigate = useNavigate();

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add an app</DialogTitle>
                    <CreateAppForm
                        onSubmit={async (data) => {
                            void (await createApp({
                                account: data.appName,
                                allowExistingAccount: true,
                            }));

                            addApp(data.appName);
                            openChange(false);
                            navigate(`/app/${data.appName}`);
                            return data;
                        }}
                    />
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
