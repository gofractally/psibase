import React from "react";
import { Disclosure } from "@headlessui/react";
import classNames from "classnames";

import { Icon } from "./Icon";
import Text from "./Text";

export interface AccordionProps {
    label: string;
    disabled?: boolean;
    children: React.ReactNode;
}

export const Accordion = ({
    label = "Label",
    children,
    disabled,
}: AccordionProps) => {
    return (
        <Disclosure>
            {({ open }) => (
                <>
                    <Disclosure.Button
                        disabled={disabled}
                        className={classNames(
                            "flex w-full items-center justify-between gap-2 bg-gray-50 py-2 px-4 text-gray-900 ",
                            { "opacity-50": disabled }
                        )}
                    >
                        <Text span size="base">
                            {label}
                        </Text>
                        <Icon
                            type="drawUp"
                            size="sm"
                            className={classNames("text-gray-500", {
                                "rotate-180": open,
                                transform: open,
                            })}
                        />
                    </Disclosure.Button>
                    <Disclosure.Panel className="border-b-2 border-gray-100 py-2 px-4 text-gray-500">
                        {children}
                    </Disclosure.Panel>
                </>
            )}
        </Disclosure>
    );
};
