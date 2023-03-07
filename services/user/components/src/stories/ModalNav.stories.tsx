import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import Container from "../ui/Container";
import { ModalNav as ModalNavComponent } from "../ui/ModalNav";

export default {
    component: ModalNavComponent,
} as ComponentMeta<typeof ModalNavComponent>;

const Template: ComponentStory<typeof ModalNavComponent> = (args) => (
    <Container className="bg-gray-100">
        <Container className="h-[500px] max-w-lg bg-white">
            <ModalNavComponent {...args} />
        </Container>
    </Container>
);

export const ModalNav = Template.bind({});
ModalNav.args = {
    title: "Modal Nav Title",
    leftButton: "close",
};
