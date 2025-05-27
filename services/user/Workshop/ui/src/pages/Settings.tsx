import { useSetMetadata } from "@/hooks/useSetMetadata";
import { useAppMetadata } from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { ErrorCard } from "@/components/error-card";
import { Spinner } from "@/components/ui/spinner";
import { MetaDataForm } from "@/components/metadata-form";
import { Account } from "@/lib/zodTypes";
import { ControlPanel } from "@/components/control-panel";

export const Settings = () => {
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
        <div>
          <div className="w-full flex justify-center">
            <Spinner size="lg" className="bg-black text-center dark:bg-white" />
          </div>
          <div>Fetching app metadata...</div>
        </div>
      </div>
    );
  }  else
    return (
      <div className="mx-auto w-full grid p-4 grid-cols-1 lg:grid-cols-2 gap-8 max-w-screen-xl">
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
        <div>
          <ControlPanel />
        </div>
      </div>
    );
};
