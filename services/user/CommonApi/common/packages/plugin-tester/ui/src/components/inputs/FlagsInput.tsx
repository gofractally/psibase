import { ReactNode } from "react";
import { BooleanInput } from "./BooleanInput";
import { camelCase } from "../../utils";

interface Flag {
  name: string;
}

interface FlagsInputProps {
  flags: Flag[];
  value: Record<string, boolean>;
  onChange: (value: Record<string, boolean>) => void;
  label?: ReactNode;
}

export const FlagsInput = ({
  flags,
  value,
  onChange,
  label,
}: FlagsInputProps) => {
  const handleFlagChange = (flagName: string, checked: boolean) => {
    onChange({
      ...value,
      [camelCase(flagName)]: checked,
    });
  };

  return (
    <div className="input-field">
      {label && <label>{label}</label>}
      <div className="flags-container">
        {flags.map((flag) => (
          <BooleanInput
            key={flag.name}
            value={value[camelCase(flag.name)] ?? false}
            onChange={(checked) => handleFlagChange(flag.name, checked)}
            label={flag.name}
          />
        ))}
      </div>
    </div>
  );
};
