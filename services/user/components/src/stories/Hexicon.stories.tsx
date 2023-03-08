import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Hexicon } from "../ui/Hexicon";

export default {
    title: "Stories/Avacons/Hexicon",
    component: Hexicon,
} as ComponentMeta<typeof Hexicon>;

const Template: ComponentStory<typeof Hexicon> = (args) => (
    <Hexicon {...args} />
);

export const Solid = Template.bind({});
Solid.args = {
    size: "5xl",
    shadow: true,
    bgColorClass: "bg-[#FF9900]",
    iconType: "btc",
    outline: false,
    iconShade: "light",
    iconStyle: "solid",
};

export const Outline = Template.bind({});
Outline.args = {
    size: "5xl",
    iconType: "btc",
    outline: true,
    iconShade: "light",
    iconStyle: "solid",
};
