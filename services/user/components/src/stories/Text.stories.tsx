import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";
import { Text } from "../ui/Text";

export default {
    title: "Base Styles/Type & Text/Text",
    component: Text,
} as ComponentMeta<typeof Text>;

const Template: ComponentStory<typeof Text> = (args) => <Text {...args} />;

const text =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam laoreet nibh felis, id lobortis turpis auctor eu. Donec vel elit augue. In malesuada libero quis diam tincidunt mollis vitae gravida ex. Cras pellentesque, dolor eget auctor pharetra, orci lacus blandit purus, ac pretium turpis nulla eu lacus. Suspendisse fermentum odio odio, at accumsan mauris porta ac. Curabitur aliquam massa at enim pharetra vestibulum id vestibulum erat. Suspendisse placerat, augue eget molestie pretium, turpis diam consectetur ex, et porta dui mauris ac diam. Phasellus vestibulum tellus tortor, quis sodales lectus ultricies eget.";

export const LargeDefault = Template.bind({});
LargeDefault.args = {
    size: "lg",
    children: text,
};

export const Medium = Template.bind({});
Medium.args = {
    size: "base",
    children: text,
};

export const Small = Template.bind({});
Small.args = {
    size: "sm",
    children: text,
};

export const ExtraSmall = Template.bind({});
ExtraSmall.args = {
    size: "xs",
    children: text,
};
