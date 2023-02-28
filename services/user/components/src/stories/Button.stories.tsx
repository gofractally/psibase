import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Button as ButtonComponent } from "../ui/Button";

export default {
    children: "Button",
    component: ButtonComponent,
} as ComponentMeta<typeof ButtonComponent>;

const Template: ComponentStory<typeof ButtonComponent> = (args) => (
    <ButtonComponent {...args} />
);

export const Button = Template.bind({});
Button.args = {
    type: "primary",
    children: "Button",
    size: "lg",
};
