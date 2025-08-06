import { FC } from "react";

interface RawParameterEditorProps {
    values: Record<string, unknown>;
    onChange: (values: Record<string, unknown>) => void;
}

export const RawParameterEditor: FC<RawParameterEditorProps> = ({
    values,
    onChange,
}) => {
    const handleChange = (newValue: string) => {
        try {
            const parsed = JSON.parse(newValue);
            if (
                typeof parsed === "object" &&
                parsed !== null &&
                !Array.isArray(parsed)
            ) {
                onChange(parsed as Record<string, unknown>);
            }
        } catch {
            console.error("Invalid JSON");
        }
    };

    return (
        <textarea
            className="common-textarea"
            value={JSON.stringify(values, null, 2)}
            onChange={(e) => handleChange(e.target.value)}
        />
    );
};
