import { useSetMetadata } from "@/hooks/useSetMetadata";
import { useAppMetadata } from "@/hooks/useAppMetadata";
import { MetaDataForm } from "./metadata-form";
import { Spinner } from "./ui/spinner";
import { ErrorCard } from "./error-card";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { CreateAppAccountCard } from "./create-app-account-card";
import { Account } from "@/lib/zodTypes";
import { ControlPanel } from "./control-panel";
import { FileUploader } from "./file-uploader";

export const Workshop = () => {
  const currentApp = useCurrentApp();

  const {
    data: metadata,
    isLoading,
    isSuccess,
    error: metadataError,
  } = useAppMetadata(currentApp);

  const { data: accountStatus } = useAccountStatus(currentApp);
  const invalidAccountError =
    accountStatus == "Invalid" ? new Error(`Invalid account name`) : undefined;

  const { mutateAsync: updateMetadata } = useSetMetadata();

  const error = metadataError || invalidAccountError;

  if (error) {
    return <ErrorCard error={error} />;
  } else if (isLoading) {
    return (
      <div className="h-dvh w-full flex justify-center">
        <div className="w-full">
          <div className="w-full flex justify-center">
            <Spinner size="lg" className="bg-black text-center dark:bg-white" />
          </div>
          <div>Fetching app metadata...</div>
        </div>
      </div>
    );
  } else if (accountStatus == "Available") {
    return (
      <div className="mx-auto p-4 max-w-screen-md">
        <CreateAppAccountCard />
      </div>
    );
  } else
    return (
      <div className="grid p-4 grid-cols-3 gap-2">
        <div className="">
          <div className="flex flex-col gap-4">
            <div className="flex justify-between"></div>

            {isSuccess && (
              <MetaDataForm
                key={currentApp}
                existingValues={metadata ? metadata.appMetadata : undefined}
                onSubmit={async (x) => {
                  await updateMetadata({
                    metadata: {
                      ...x,
                      owners: [],
                    },
                    account: Account.parse(currentApp),
                  });
                  return x;
                }}
              />
            )}
          </div>
        </div>
        <div>
          <FileUploader />
        </div>
        <div>
          <ControlPanel />
        </div>
      </div>
    );
};
