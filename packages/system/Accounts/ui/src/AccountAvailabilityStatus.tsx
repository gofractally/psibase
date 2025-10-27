import { Check, LoaderCircle, UserX } from "lucide-react";

export const AccountAvailabilityStatus = ({
    accountStatus,
    isLoading = false,
    isCreatingAccount,
}: {
    accountStatus?: string;
    isLoading: boolean;
    isCreatingAccount: boolean;
}) => (
    <div className="text-muted-foreground">
        {isLoading ? (
            <div className="flex gap-1">
                {" "}
                <div className="text-sm">Loading</div>
                <LoaderCircle
                    size={15}
                    className="animate my-auto animate-spin"
                />{" "}
            </div>
        ) : (
            <>
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
            </>
        )}
    </div>
);
