import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { HeaderIllustration as HeaderIllustrationComponent } from "../ui/HeaderIllustration";

export default {
    component: HeaderIllustrationComponent,
} as ComponentMeta<typeof HeaderIllustrationComponent>;

const Template: ComponentStory<typeof HeaderIllustrationComponent> = (args) => (
    <HeaderIllustrationComponent {...args} />
);

export const HeaderIllustration = Template.bind({});
HeaderIllustration.args = {
    color: "blue",
    size: "sm",
    icon: "sparkles",
    iconStyle: "solid",
};
