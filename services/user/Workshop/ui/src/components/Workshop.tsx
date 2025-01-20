import { useLoggedInUser } from "@/hooks/useLoggedInUser";
import { Button } from "./ui/button";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
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
import { queryClient } from "@/main";
import { z } from "zod";
import { toast } from "sonner";
import { Label } from "./ui/label";

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
  const { data: currentUser, isFetched } = useLoggedInUser();

  const { mutateAsync: login } = useCreateConnectionToken();
  const { data: metadata, isSuccess } = useAppMetadata(currentUser);

  const { mutateAsync: updateMetadata } = useSetMetadata();
  const { mutateAsync: publishApp } = usePublishApp();

  const handleChecked = async (checked: boolean, appName: string) => {
    try {
      setCacheData(appName, checked);
      toast(`Updating..`, {
        description: `${checked ? "Publishing" : "Unpublishing"} ${appName}`,
      });
      void (await publishApp({ account: appName, publish: checked }));
      toast("Update success", {
        description: `${checked ? "Published" : "Unpublished"} ${appName}`,
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

  return (
    <div className="mt-4">
      <div className="flex flex-col gap-4">
        <Button
          variant="secondary"
          onClick={() => {
            login();
          }}
          disabled={!isFetched}
        >
          {!isFetched ? "Loading" : currentUser ? "Change App" : "Select app"}
        </Button>

        <div className="flex justify-between">
          <div className="text-lg font-semibold text-center">{currentUser}</div>
          <div className="flex gap-2">
            <div className="flex flex-col justify-center">
              <Label>Publish</Label>
            </div>
            <Switch
              checked={isAppPublished}
              disabled={!currentUser}
              onCheckedChange={(checked) =>
                handleChecked(checked, z.string().parse(currentUser))
              }
            />
          </div>
        </div>

        {isSuccess && (
          <MetaDataForm
            existingValues={metadata && metadata.appMetadata}
            onSubmit={async (x) => {
              await updateMetadata({
                ...x,
                owners: [],
              });
              return x;
            }}
          />
        )}
      </div>
    </div>
  );
};
