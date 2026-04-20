import { ReactNode } from "react";

interface BooleanInputProps {
    value: boolean;
    onChange: (value: boolean) => void;
    label?: ReactNode;
}

export const BooleanInput = ({ value, onChange, label }: BooleanInputProps) => {
    const handleClick = () => {
        onChange(!value);
    };

    return (
        <div className="input-field">
            <div className="optional-header clickable" onClick={handleClick}>
                <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => onChange(e.target.checked)}
                    className="common-checkbox"
                />
                {label && <label>{label}</label>}
            </div>
        </div>
    );
};
