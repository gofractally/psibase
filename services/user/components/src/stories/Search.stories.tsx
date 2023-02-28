import React, { useState } from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Search } from "../ui/Search";

export default {
    component: Search,
} as ComponentMeta<typeof Search>;

const Template: ComponentStory<typeof Search> = (args) => {
    const [value, setValue] = useState<string>(`${args.value || ""}`);
    return (
        <div className="w-80">
            <Search
                {...args}
                onChange={(newValue) => {
                    console.info("onchanging", newValue);
                    setValue(newValue);
                }}
                value={value}
            />
        </div>
    );
};

export const Default = Template.bind({});

export const Loading = Template.bind({});
Loading.args = {
    isLoading: true,
    value: "Something",
};

export const InvertedWithoutBorder = Template.bind({});
InvertedWithoutBorder.args = {
    inverted: true,
    noBorder: true,
};
