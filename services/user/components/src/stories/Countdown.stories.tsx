import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Countdown as CountdownComponent } from "../ui/Countdown";

export default {
    component: CountdownComponent,
} as ComponentMeta<typeof CountdownComponent>;

const Template: ComponentStory<typeof CountdownComponent> = (args) => (
    <CountdownComponent {...args} />
);

export const Countdown = Template.bind({});
Countdown.args = {
    endTime: new Date(Date.now() + 60 * 1000),
};
