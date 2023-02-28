import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";
import { Loader } from "../ui/Loader";

export default {
    component: Loader,
} as ComponentMeta<typeof Loader>;

const Template: ComponentStory<typeof Loader> = (args) => <Loader {...args} />;

export const Default = Template.bind({});
Default.args = { size: "lg" };

const SplashTemplate: ComponentStory<typeof Loader> = (args) => {
    return (
        <div>
            <h1>Example Page</h1>
            <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
                eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut
                enim ad minim veniam, quis nostrud exercitation ullamco laboris
                nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor
                in reprehenderit in voluptate velit esse cillum dolore eu fugiat
                nulla pariatur. Excepteur sint occaecat cupidatat non proident,
                sunt in culpa qui officia deserunt mollit anim id est laborum.
            </p>
            <Loader {...args} />
        </div>
    );
};

export const Splash = SplashTemplate.bind({});
Splash.args = { splash: true, size: "4xl" };
