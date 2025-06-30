import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/shadcn/ui/dialog";
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
          {children}
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};
