import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { HexiconGroup } from "../ui/HexiconGroup";

export default {
    title: "Stories/Avacons/Hexicon Group",
    component: HexiconGroup,
} as ComponentMeta<typeof HexiconGroup>;

const Template: ComponentStory<typeof HexiconGroup> = (args) => (
    <HexiconGroup {...args} />
);

const hexiconGroupData = [
    {
        iconType: "btc",
        bgColorClass: "bg-[#FF9900]",
    },
    {
        iconType: "f",
        bgColorClass: "bg-gray-300",
        iconShade: "dark",
    },
    {
        iconType: "eos",
        bgColorClass: "bg-gray-800",
    },
    {
        iconType: "fire",
        bgColorClass: "bg-green-500",
    },
];

export const Group = Template.bind({});
Group.args = {
    icons: hexiconGroupData,
    size: "5xl",
    shadow: false,
};
