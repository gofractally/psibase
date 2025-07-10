import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";

interface Props {
  onChange: (enabled: boolean) => void | Promise<void>;
  checked: boolean;
  disabled: boolean;
  title: string;
  description?: string;
}

export const CheckCard = ({
  checked,
  disabled,
  title,
  onChange,
  description,
}: Props) => {
  return (
    <div className="flex flex-row items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label className="text-base">{title}</Label>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <div>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    </div>
  );
};
