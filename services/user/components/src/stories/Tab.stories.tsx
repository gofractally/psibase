import React, {useState} from "react";
import { ComponentMeta, ComponentStory } from "@storybook/react";
import { Tab as HeadlessTab } from "@headlessui/react";

import { Button, Card, Container, Badge } from "../ui";
import { Tab as StyledTab } from "../ui/Tab";

export default {
    component: StyledTab,
} as ComponentMeta<typeof StyledTab>;

const Template: ComponentStory<typeof StyledTab> = (args) => {
    const [counter, setCounter] = useState(0);
    return (
        <Card>
            <HeadlessTab.Group as="section">
                <HeadlessTab.List as={Card} className="flex flex-wrap gap-2">
                    <StyledTab>
                        My tokens <Badge value={String(counter)} />
                    </StyledTab>
                    <StyledTab>All tokens</StyledTab>
                    <StyledTab disabled={args.disabled}>
                        History <Badge value="0" disabled={args.disabled} />
                    </StyledTab>
                </HeadlessTab.List>
                <Container>
                    <HeadlessTab.Panel as={Card}>
                        My tokens! <br /><br />
                        <Button onClick={() => setCounter(counter + 1)}>Add Token</Button>
                    </HeadlessTab.Panel>
                    <HeadlessTab.Panel as={Card}>All tokens!</HeadlessTab.Panel>
                    <HeadlessTab.Panel as={Card}>
                        Change the disabled state to disable this tab.
                    </HeadlessTab.Panel>
                </Container>
            </HeadlessTab.Group>
        </Card>
    );
};
export const Tab = Template.bind({});
