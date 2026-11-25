import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

export function NicknameContactField({
    account,
    value,
    onChange,
    disabled,
    id,
}: {
    account: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    id?: string;
}) {
    const inputId = id ?? `nick-${account}`;
    return (
        <div className="grid gap-2">
            <Label htmlFor={inputId}>Nickname for {account}</Label>
            <Input
                id={inputId}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Optional"
                autoComplete="nickname"
                disabled={disabled}
            />
            <p className="text-muted-foreground text-xs">
                If they aren't in your contacts yet, a nickname adds them to
                Payees.
            </p>
        </div>
    );
}
