import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { ActionButton } from "../ui/ActionButton";

export default {
    component: ActionButton,
} as ComponentMeta<typeof ActionButton>;

const Template: ComponentStory<typeof ActionButton> = (args) => (
    <ActionButton {...args} />
);

export const Primary = Template.bind({});
Primary.args = {
    label: "Send",
    icon: "send",
    onClick: () => alert("Sending 1 BTC to Sparky!"),
};

export const Loading = Template.bind({});
Loading.args = {
    label: "Send",
    icon: "send",
    isLoading: true,
};

export const Disabled = Template.bind({});
Disabled.args = {
    label: "Send",
    icon: "send",
    disabled: true,
};
