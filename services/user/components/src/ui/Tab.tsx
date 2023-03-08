import React from "react";
import { Tab as HeadlessTab } from "@headlessui/react";

import Text from "./Text";

export interface TabProps {
    disabled?: boolean;
    children: React.ReactNode;
}

const optionBaseClass =
    "inline-block py-2 px-3 text-sm font-semibold text-center hover:bg-gray-50 select-none";
const notSelectedClass = "text-gray-500 hover:text-gray-600 cursor-pointer";
const selectedClass = "text-gray-900 cursor-pointer";
const disabledClass = "text-gray-400 cursor-not-allowed hover:bg-inherit";

/**
 * 🖼 [Figma Designs](https://www.figma.com/file/nKp13nMbOKwtvUSuNaQk0A/%C6%92SYSTEM-UX?node-id=800%3A140275).
 *
 * ℹ️ We are using the `@headlessui/react` package for an accessible tab system that follows best practices. This `<Tab />`
 * component is a styled-up `<Tab />` component from that Headless UI system.
 *
 * 🚧 Only the basic design as been implemented. Designs with icons, underlines, badges, etc. aren't yet implemented.
 */
export const Tab = ({ disabled, children }: TabProps) => {
    return (
        <HeadlessTab disabled={disabled}>
            {({ selected }) => (
                <div
                    className={`${optionBaseClass} ${
                        disabled
                            ? disabledClass
                            : selected
                            ? selectedClass
                            : notSelectedClass
                    }`}
                >
                    <Text span size="base">
                        {children}
                    </Text>
                </div>
            )}
        </HeadlessTab>
    );
};

export default Tab;
