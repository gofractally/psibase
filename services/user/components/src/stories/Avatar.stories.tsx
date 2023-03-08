import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Avatar } from "../ui/Avatar";

export default {
    title: "Stories/Avacons/Avatar",
    component: Avatar,
} as ComponentMeta<typeof Avatar>;

const Template: ComponentStory<typeof Avatar> = (args) => <Avatar {...args} />;

export const WithAvatarImage = Template.bind({});
WithAvatarImage.args = {
    avatarUrl:
        "https://images.pexels.com/photos/3981337/pexels-photo-3981337.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500",
    name: "Rey",
    size: "3xl",
    shape: "hex",
    shadow: true,
};

export const NoAvatarURL = Template.bind({});
NoAvatarURL.args = {
    name: "Rey",
    size: "3xl",
    shape: "hex",
    shadow: true,
};

export const NoNameOrAvatarURL = Template.bind({});
NoNameOrAvatarURL.args = {
    size: "3xl",
    shape: "hex",
    shadow: true,
};
