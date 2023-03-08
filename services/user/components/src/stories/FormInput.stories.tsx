import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Input as InputComponent } from "../ui/Form";

export default {
    title: "Stories/Form Controls/Input",
    component: InputComponent,
} as ComponentMeta<typeof InputComponent>;

const Template: ComponentStory<typeof InputComponent> = (args) => (
    <InputComponent {...args} />
);

export const Input = Template.bind({});
Input.args = {
    label: "Email",
    placeholder: "Placeholder",
    helperText: "Helper text",
    helperTextStyle: "normal",
    disabled: false,
    readOnly: false,
    type: "email",
    rightIcon: "close",
    onClickRightIcon: () => alert("Clicked right icon"),
};
