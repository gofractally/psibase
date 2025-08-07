import { ChangeEvent } from "react";

interface Utf8InputProps {
    value: Uint8Array;
    onChange: (value: Uint8Array, rawInput: string) => void;
    rawInput: string;
}

const encoder = new TextEncoder();

const isValidUtf8 = (str: string): boolean => {
    try {
        return str === decodeURIComponent(encodeURIComponent(str));
    } catch {
        return false;
    }
};

export const Utf8Input = ({ onChange, rawInput }: Utf8InputProps) => {
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        if (isValidUtf8(newValue)) {
            onChange(encoder.encode(newValue), newValue);
        }
    };

    return (
        <input
            type="text"
            className="common-input"
            value={rawInput}
            onChange={handleChange}
            placeholder="Enter UTF-8 text"
            spellCheck={false}
        />
    );
};
