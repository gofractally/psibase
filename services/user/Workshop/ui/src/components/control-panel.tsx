import { useAppMetadata } from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useSpa } from "@/hooks/useSpa";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Account } from "@/lib/zodTypes";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useSetCacheMode } from "@/hooks/useSetCacheMode";

export const ControlPanel = () => {
  const currentApp = useCurrentApp();
  const { data: metadata } = useAppMetadata(currentApp);
  console.log({ metadata });

  const { mutateAsync: setSpa, isPending: isSettingSpa } = useSpa();
  const { mutateAsync: setCacheMode, isPending: isSettingCacheMode } =
    useSetCacheMode();

  const [spa, setSpaLocal] = useLocalStorage(`${currentApp}-spa`, false);
  const [cache, setCacheLocal] = useLocalStorage(`${currentApp}-cache`, false);

  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold">Control Panel</h1>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="flex flex-col justify-center">
            <Label>Single Page Application (SPA)</Label>
          </div>
          <Switch
            checked={spa}
            disabled={isSettingSpa}
            onCheckedChange={async (checked) => {
              await setSpa({
                account: Account.parse(currentApp),
                enableSpa: checked,
              });
              setSpaLocal(checked);
            }}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex flex-col justify-center">
            <Label>Cache mode</Label>
          </div>
          <Switch
            checked={cache}
            disabled={isSettingCacheMode}
            onCheckedChange={async (checked) => {
              await setCacheMode({
                account: Account.parse(currentApp),
                enableCache: checked,
              });
              setCacheLocal(checked);
            }}
          />
        </div>
      </div>
    </div>
  );
};
