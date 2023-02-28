import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { AvatarGroup } from "../ui/AvatarGroup";

export default {
    title: "Stories/Avacons/Avatar Group",
    component: AvatarGroup,
} as ComponentMeta<typeof AvatarGroup>;

const Template: ComponentStory<typeof AvatarGroup> = (args) => (
    <AvatarGroup {...args} />
);

const avatarGroupData = [
    {
        name: "Sparky",
        avatarUrl:
            "https://images.pexels.com/photos/3981337/pexels-photo-3981337.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500",
    },
    {
        name: "Brandon",
        avatarUrl:
            "https://images.pexels.com/photos/428364/pexels-photo-428364.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500",
    },
    {
        name: "Rebekah",
    },
    {},
    {
        name: "Mike",
        avatarUrl:
            "https://images.pexels.com/photos/2760248/pexels-photo-2760248.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500",
    },
    {
        name: "Val",
        avatarUrl:
            "https://images.pexels.com/photos/2323090/pexels-photo-2323090.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500",
    },
    {
        name: "Dude",
    },
];

export const Group = Template.bind({});
Group.args = {
    avatars: avatarGroupData,
    size: "3xl",
    shape: "hex",
    shadow: false,
};
