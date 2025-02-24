import {
  appMetadataQueryKey,
  MetadataResponse,
  Status,
  useAppMetadata,
} from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useSpa } from "@/hooks/useSpa";
import { Account } from "@/lib/zodTypes";
import { useSetCacheMode } from "@/hooks/useSetCacheMode";
import { usePublishApp } from "@/hooks/usePublishApp";
import { queryClient } from "@/queryClient";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCard } from "./Check-Card";
import { ServiceUpload } from "./service-upload";
import { useSiteConfig } from "@/hooks/useSiteConfig";
import { CspForm } from "./csp-form";
import { useSetCsp } from "@/hooks/useSetCsp";
import { Label } from "./ui/label";
import { Button } from "./ui/button";

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

  const { data: site } = useSiteConfig(currentApp);

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

      const isAppAlreadyPublishedError =
        e instanceof Error && e.message.includes("App is already published");
      setCacheData(appName, isAppAlreadyPublishedError || !checked);
    }
  };

  const isAppPublished = metadata
    ? metadata.extraMetadata.status == Status.Enum.published
    : false;

  const { mutate: setCsp } = useSetCsp();

  const handleCspSubmission = async (data: {
    globalPolicy: string;
    individualPolicies: Array<{ path: string; csp: string }>;
  }) => {
    // Set global CSP
    await setCsp({
      account: Account.parse(currentApp),
      path: "*",
      csp: data.globalPolicy,
    });

    // Set individual path CSPs
    for (const policy of data.individualPolicies) {
      await setCsp({
        account: Account.parse(currentApp),
        path: policy.path,
        csp: policy.csp,
      });
    }

    return data;
  };

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
          checked={!!(site && site.getConfig && site.getConfig.spa)}
          disabled={isSettingSpa}
          onChange={async (checked) => {
            await setSpa({
              account: Account.parse(currentApp),
              enableSpa: checked,
            });
          }}
          title="Single Page Application (SPA)"
          description="When enabled, all content requests return the root document except for requests to static assets (files with an extension)."
        />

        <CheckCard
          checked={!!(site && site.getConfig && site.getConfig.cache)}
          disabled={isSettingCacheMode}
          onChange={async (checked) => {
            await setCacheMode({
              account: Account.parse(currentApp),
              enableCache: checked,
            });
          }}
          title="Cache"
          description="When enabled, responses may be cached to improve performance."
        />

        <ServiceUpload />
        {site && site.getConfig ? (
          <CspForm
            onSubmit={handleCspSubmission}
            initialData={{
              globalPolicy: site.getConfig.globalCsp,
              individualPolicies: [],
            }}
          />
        ) : (
          <div className="flex flex-row items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-base">Content Security Policy</Label>
              <p className="text-sm text-muted-foreground">
                Loading site configuration...
              </p>
            </div>
            <Button variant="outline" disabled>
              Edit
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
