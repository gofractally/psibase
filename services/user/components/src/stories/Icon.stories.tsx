import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Icon as IconComponent } from "../ui/Icon";

export default {
    component: IconComponent,
} as ComponentMeta<typeof IconComponent>;

const Template: ComponentStory<typeof IconComponent> = (args) => (
    <div className="w-80">
        <IconComponent {...args} />
    </div>
);

export const Icon = Template.bind({});
Icon.args = {
    type: "notification",
    size: "sm",
};
