import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import React from "react";

export const ModalCreateToken = ({
  children,
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactElement;
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(e) => {
        onOpenChange(e);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a token</DialogTitle>
          <DialogDescription>
            Lorem ipsum, dolor sit amet consectetur adipisicing elit. Eveniet,
            beatae autem assumenda nulla, culpa dignissimos aperiam debitis
            voluptates mollitia a velit. Ducimus impedit esse tempora architecto
            voluptate sapiente ad quam!
          </DialogDescription>
          {children}
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};
