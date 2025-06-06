import { FormLabel } from "@/components/ui/form";
import { Check, UserX, LoaderCircle } from "lucide-react";

export const AccountAvailabilityStatus = ({
  accountStatus,
  isCreatingAccount,
}: {
  accountStatus: string;
  isCreatingAccount: boolean;
}) => (
  <FormLabel className="text-muted-foreground">
    {isCreatingAccount &&
      (accountStatus === "Available" ? (
        <div className="flex gap-1">
          <div className="text-sm">Available</div>
          <Check size={15} className="my-auto" />{" "}
        </div>
      ) : accountStatus === "Taken" ? (
        <div className="flex gap-1">
          {" "}
          <div className="text-sm">Taken</div>
          <UserX size={15} className=" my-auto" />{" "}
        </div>
      ) : undefined)}
    {!isCreatingAccount && accountStatus === "Available" && (
      <div className="flex gap-1">
        <div className="text-sm">Account does not exist</div>
        <UserX size={15} className=" my-auto" />{" "}
      </div>
    )}
    {accountStatus === "Invalid" && (
      <div className="flex gap-1">
        {" "}
        <div className="text-sm">Invalid</div>
        <UserX size={15} className=" my-auto" />{" "}
      </div>
    )}
    {accountStatus === "Loading" && (
      <div className="flex gap-1">
        {" "}
        <div className="text-sm">Loading</div>
        <LoaderCircle size={15} className="animate animate-spin my-auto" />{" "}
      </div>
    )}
  </FormLabel>
);
