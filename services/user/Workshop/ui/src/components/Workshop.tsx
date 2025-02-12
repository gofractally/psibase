import { useSetMetadata } from "@/hooks/useSetMetadata";
import {
  appMetadataQueryKey,
  MetadataResponse,
  Status,
  useAppMetadata,
} from "@/hooks/useAppMetadata";
import { Switch } from "@/components/ui/switch";
import { MetaDataForm } from "./metadata-form";
import { usePublishApp } from "@/hooks/usePublishApp";
import { z } from "zod";
import { toast } from "sonner";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";
import { ErrorCard } from "./error-card";
import { queryClient } from "@/queryClient";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { CreateAppAccountCard } from "./create-app-account-card";
import { Account } from "@/lib/zodTypes";

const setStatus = (
  metadata: z.infer<typeof MetadataResponse>,
  published: boolean
): z.infer<typeof MetadataResponse> => ({
  ...metadata,
  extraMetadata: {
    ...metadata.extraMetadata,
    status: published ? Status.Enum.published : Status.Enum.unpublished,
  },
});

const setCacheData = (appName: string, checked: boolean) => {
  queryClient.setQueryData(appMetadataQueryKey(appName), (data: unknown) => {
    if (data) {
      return setStatus(MetadataResponse.parse(data), checked);
    }
  });
};

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
  const { mutateAsync: publishApp, isPending: isPublishingApp } =
    usePublishApp();

  const handleChecked = async (checked: boolean, appName: string) => {
    try {
      setCacheData(appName, checked);
      toast(`Updating..`, {
        description: `${checked ? "Publishing" : "Unpublishing"} ${appName}`,
      });
      void (await publishApp({ account: appName, publish: checked }));
      toast(checked ? "Published" : "Unpublished", {
        description: checked
          ? `${appName} is now published.`
          : `${appName} is no longer published.`,
      });
    } catch (e) {
      toast("Failed to update", {
        description:
          e instanceof Error ? e.message : "Unrecognised error, see logs.",
      });
      setCacheData(appName, !checked);
    }
  };

  const isAppPublished = metadata
    ? metadata.extraMetadata.status == Status.Enum.published
    : false;

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
      <div className="mt-4 mx-4">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between">
            <div className="text-lg font-semibold text-center">
              {currentApp}
            </div>
            {isSuccess && (
              <div className="flex gap-2">
                <div className="flex flex-col justify-center">
                  <Label>Publish</Label>
                </div>
                <Switch
                  checked={isAppPublished}
                  disabled={isPublishingApp}
                  onCheckedChange={(checked) =>
                    handleChecked(checked, Account.parse(currentApp))
                  }
                />
              </div>
            )}
          </div>

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
    );
};
