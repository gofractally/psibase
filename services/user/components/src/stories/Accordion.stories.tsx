import React from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";

import { Text, Accordion as AccordionComponent } from "../ui";

export default {
    children: "Accordion",
    component: AccordionComponent,
} as ComponentMeta<typeof AccordionComponent>;

const Template: ComponentStory<typeof AccordionComponent> = (args) => (
    <AccordionComponent {...args}>{args.children}</AccordionComponent>
);

export const Accordion = Template.bind({});
export const DisabledAccordion = Template.bind({});

export const LargeAccordion = Template.bind({});

DisabledAccordion.args = {
    label: "This is a disabled accordion",
    disabled: true,
};

Accordion.args = {
    label: "How does ƒractally attract members?",
    children: (
        <Text size="base">
            Lorem ipsum dolor sit amet consectetur adipisicing elit. Voluptas,
            enim illo nobis ipsam laboriosam veritatis repellat ut? Facere
            adipisci aliquid voluptas eos dignissimos necessitatibus harum atque
            nostrum. Autem, doloremque aliquid!
        </Text>
    ),
};

LargeAccordion.args = {
    label: "Do the chickens have large talons?",
    children: (
        <div>
            <Text size="base">
                Lorem ipsum dolor sit, amet consectetur adipisicing elit.
                Consequatur fugiat soluta, alias aliquid tenetur, optio
                repellendus unde non veritatis culpa repudiandae officia
                provident quod ducimus eum, laborum esse ipsam molestias.
            </Text>
            <Text size="base">
                Lorem Ipsum has been the industry's standard dummy text ever
                since the 1500s, when an unknown printer took a galley of type
                and scrambled it to make a type specimen book.
            </Text>
            <Text size="base">
                Lorem Ipsum has been the industry's standard dummy text ever
                since the 1500s, when an unknown printer took a galley of type
                and scrambled it to make a type specimen book.
            </Text>
        </div>
    ),
};
