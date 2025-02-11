import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateAppForm } from "./create-app-form";
import { useCreateApp } from "@/hooks/use-create-app";
import { useTrackedApps } from "@/hooks/useTrackedApps";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNavigate } from "react-router-dom";

export const CreateAppModal = ({
  show,
  openChange,
}: {
  show: boolean;
  openChange: (show: boolean) => void;
}) => {
  const { mutateAsync: createApp } = useCreateApp();

  const { data: currentUser } = useCurrentUser();
  const { addApp } = useTrackedApps(currentUser);

  const navigate = useNavigate();

  return (
    <Dialog open={show} onOpenChange={openChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an app</DialogTitle>
          <CreateAppForm
            onSubmit={async (data) => {
              await createApp(data.appName);
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
