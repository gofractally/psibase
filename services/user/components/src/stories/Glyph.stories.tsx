import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Glyph } from "../ui/Glyph";

export default {
    title: "Deprecated/Glyph",
    component: Glyph,
} as ComponentMeta<typeof Glyph>;

const Template: ComponentStory<typeof Glyph> = (args) => <Glyph {...args} />;

export const Default = Template.bind({});
Default.args = {
    chars: "ℝ",
};

export const WithIcon = Template.bind({});
WithIcon.args = {
    icon: "btc",
};

export const Static = Template.bind({});
Static.args = {
    icon: "f",
    isStatic: true,
    isOutline: true,
    size: "xl",
};
