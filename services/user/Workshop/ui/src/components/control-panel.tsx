import {
  appMetadataQueryKey,
  MetadataResponse,
  Status,
  useAppMetadata,
} from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useSpa } from "@/hooks/useSpa";
import { Account } from "@/lib/zodTypes";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useSetCacheMode } from "@/hooks/useSetCacheMode";
import { usePublishApp } from "@/hooks/usePublishApp";
import { queryClient } from "@/queryClient";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCard } from "./Check-Card";

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

export const ControlPanel = () => {
  const currentApp = useCurrentApp();
  const { data: metadata } = useAppMetadata(currentApp);

  const { mutateAsync: setSpa, isPending: isSettingSpa } = useSpa();
  const { mutateAsync: setCacheMode, isPending: isSettingCacheMode } =
    useSetCacheMode();

  const [spa, setSpaLocal] = useLocalStorage(`${currentApp}-spa`, false);
  const [cache, setCacheLocal] = useLocalStorage(`${currentApp}-cache`, false);

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

  return (
    <div className="w-full">
      <div className="flex flex-col gap-2">
        <CheckCard
          checked={isAppPublished}
          disabled={isPublishingApp}
          onChange={(checked) =>
            handleChecked(checked, Account.parse(currentApp))
          }
          title="Publish"
          description="Mark the app available for public use."
        />

        <CheckCard
          checked={spa}
          disabled={isSettingSpa}
          onChange={async (checked) => {
            await setSpa({
              account: Account.parse(currentApp),
              enableSpa: checked,
            });
            setSpaLocal(checked);
          }}
          title="Single Page Application (SPA)"
          description="When enabled, all content requests return the root document except for requests to static assets (files with an extension)."
        />

        <CheckCard
          checked={cache}
          disabled={isSettingCacheMode}
          onChange={async (checked) => {
            await setCacheMode({
              account: Account.parse(currentApp),
              enableCache: checked,
            });
            setCacheLocal(checked);
          }}
          title="Cache"
          description="Enable or disable caching of responses for the specified app. When enabled, responses may be cached to improve performance."
        />
      </div>
    </div>
  );
};
