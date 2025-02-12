import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateAppForm } from "./create-app-form";
import { useTrackedApps } from "@/hooks/useTrackedApps";
import { useNavigate } from "react-router-dom";

export const CreateAppModal = ({
  show,
  openChange,
}: {
  show: boolean;
  openChange: (show: boolean) => void;
}) => {
  const { addApp } = useTrackedApps();

  const navigate = useNavigate();

  return (
    <Dialog open={show} onOpenChange={openChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an app</DialogTitle>
          <CreateAppForm
            onSubmit={async (data) => {
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
