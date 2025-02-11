import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateAppForm } from "./create-app-form";
import { useCreateApp } from "@/hooks/use-create-app";

export const CreateAppModal = ({
  show,
  openChange,
}: {
  show: boolean;
  openChange: (show: boolean) => void;
}) => {
  const { mutateAsync: createApp } = useCreateApp();

  return (
    <Dialog open={show} onOpenChange={openChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an app</DialogTitle>
          <CreateAppForm
            onSubmit={async (data) => {
              await createApp(data.appName);
              return data;
            }}
          />
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};
