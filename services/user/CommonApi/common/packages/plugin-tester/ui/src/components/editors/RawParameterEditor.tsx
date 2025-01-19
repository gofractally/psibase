import { FC } from "react";

interface RawParameterEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export const RawParameterEditor: FC<RawParameterEditorProps> = ({
  value,
  onChange,
}) => (
  <textarea
    className="common-textarea"
    value={value}
    onChange={(e) => onChange(e.target.value)}
  />
);
