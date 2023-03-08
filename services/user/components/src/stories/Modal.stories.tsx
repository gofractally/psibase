import React, { useState } from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";
import { Button, Card, Container, Text, Modal as ModalComponent } from "../ui";

export default {
    component: ModalComponent,
} as ComponentMeta<typeof ModalComponent>;

const Template: ComponentStory<typeof ModalComponent> = (args) => {
    const [isModalOpen, setModalOpen] = useState(false);
    return (
        <div className="w-80">
            <Button onClick={() => setModalOpen(true)}>Open Modal</Button>
            <ModalComponent
                shouldCloseOnEsc
                shouldCloseOnOverlayClick
                ariaHideApp={false}
                isOpen={isModalOpen}
                onRequestClose={() => setModalOpen(false)}
                {...args}
            />
        </div>
    );
};

export const Modal = Template.bind({});
Modal.args = {
    children: (
        <Card>
            <Container>
                <Text>
                    Lorem ipsum dolor sit amet consectetur adipisicing elit.
                    Officia saepe sit repellat ipsum, odio maiores ex iure?
                    Quasi assumenda debitis quisquam, molestiae nulla
                    voluptatum, culpa nostrum nesciunt veritatis consectetur
                    quae?
                </Text>
                <Text size="sm">Press [ESC] or the Overlay to quit modal</Text>
            </Container>
        </Card>
    ),
};
