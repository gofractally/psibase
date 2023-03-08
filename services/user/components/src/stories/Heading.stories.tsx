import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";
import { Heading } from "../ui/Heading";

export default {
    title: "Base Styles/Type & Text/Heading",
    component: Heading,
} as ComponentMeta<typeof Heading>;

const Template: ComponentStory<typeof Heading> = (args) => (
    <Heading {...args} />
);

export const Heading1 = Template.bind({});
Heading1.args = {
    tag: "h1",
    children: "This is a heading",
};

export const Heading2 = Template.bind({});
Heading2.args = {
    tag: "h2",
    children: "This is a heading",
};

export const Heading3 = Template.bind({});
Heading3.args = {
    tag: "h3",
    children: "This is a heading",
};

export const Heading4 = Template.bind({});
Heading4.args = {
    tag: "h4",
    children: "This is a heading",
};

export const Heading5 = Template.bind({});
Heading5.args = {
    tag: "h5",
    children: "This is a heading",
};

export const Heading6 = Template.bind({});
Heading6.args = {
    tag: "h6",
    children: "This is a heading",
};
