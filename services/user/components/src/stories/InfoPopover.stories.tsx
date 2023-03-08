import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Text, InfoPopover } from "../ui";

export default {
    children: "InfoPopover",
    component: InfoPopover,
} as ComponentMeta<typeof InfoPopover>;

const Template: ComponentStory<typeof InfoPopover> = (args) => (
    <InfoPopover {...args}>{args.children}</InfoPopover>
);

export const RegularInfoPopover = Template.bind({});

RegularInfoPopover.args = {
    buttonText: "Click to open",
    title: "Some title goes here",
    children: (
        <Text size="base">
            Lorem ipsum dolor sit amet consectetur adipisicing elit. Voluptas,
            enim illo nobis ipsam laboriosam veritatis repellat ut? Facere
            adipisci aliquid voluptas eos dignissimos necessitatibus harum atque
            nostrum. Autem, doloremque aliquid!
        </Text>
    ),
};
