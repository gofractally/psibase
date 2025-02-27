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
import { SiteConfigResponse, useSiteConfig } from "@/hooks/useSiteConfig";
import { CspForm } from "./csp-form";
import { useSetCsp } from "@/hooks/useSetCsp";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { useDeleteCsp } from "@/hooks/useDeleteCsp";

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

const NormalisedPolicy = z.object({
  path: z.string(),
  csp: z.string(),
})

const NormalisedPolicyWithHash = NormalisedPolicy.extend({
  hash: z.string(),
})

const createHash = (policy: z.infer<typeof NormalisedPolicy>) => 
  NormalisedPolicyWithHash.parse({ 
    ...policy, 
    hash: policy.path + policy.csp 
  });

const normalizePolicies = (site: z.infer<typeof SiteConfigResponse>): z.infer<typeof NormalisedPolicy>[] => NormalisedPolicy.array().parse([
  ...(site.getConfig?.globalCsp ? [{ path: "*", csp: site.getConfig.globalCsp }] : []),
  ...(site.getContent.edges.map(edge => ({ path: edge.node.path, csp: edge.node.csp })) || []),
]);

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

  const { mutateAsync: setCsp } = useSetCsp();
  const { mutateAsync: removeCsp } = useDeleteCsp();

  const handleCspSubmission = async (data: {
    individualPolicies: Array<{ path: string; csp: string }>;
  }) => {
    if (!site) throw new Error("Site configuration not found");
    
    const existingPolicies = normalizePolicies(site).map(createHash);
    const incomingPolicies = data.individualPolicies.map(createHash);

    const newPolicies = incomingPolicies.filter(policy => 
      !existingPolicies.some(p => p.hash === policy.hash)
    );
    const updatedPolicies = incomingPolicies.filter(policy => 
      existingPolicies.some(p => p.hash === policy.hash)
    );
    const deletedPolicies = existingPolicies.filter(policy => 
      !incomingPolicies.some(p => p.hash === policy.hash)
    );

    
    
    for (const policy of [...newPolicies, ...updatedPolicies]) {
      await setCsp({
        account: Account.parse(currentApp),
        path: policy.path,
        csp: policy.csp,
      });
    }

    for (const policy of deletedPolicies) {
      await removeCsp({
        account: Account.parse(currentApp),
        path: policy.path,
      });
    }

    toast("CSP updated", {
      description: "CSP has been updated successfully.",
    });

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
              individualPolicies: normalizePolicies(site)
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
