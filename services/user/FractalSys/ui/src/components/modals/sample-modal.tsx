import {
    Button,
    Card,
    Container,
    Heading,
    Modal,
    Text,
} from "@toolbox/components/ui";

import { useModalExample } from "hooks";

export const SampleModal = () => {
    const { isOpen, dismiss } = useModalExample();

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={() => dismiss(false)}
            contentLabel="Sample Modal"
            preventScroll
            shouldCloseOnOverlayClick
            shouldCloseOnEsc
        >
            <Card>
                <Container>
                    <Heading tag="h2" styledAs="h4">
                        This is an example modal
                    </Heading>
                    <Text>
                        This example demonstrates how a modal can be invoked
                        from a hook via the state system, and how its result can
                        be asynchronously awaited by the calling component, and
                        acted upon. Check the console and choose an option
                        below.
                    </Text>
                    <div className="mx-10 mb-4 flex justify-around">
                        <Button
                            onClick={() => dismiss(false)}
                            type="secondary"
                            size="lg"
                        >
                            😢
                        </Button>
                        <Button onClick={() => dismiss(true)} size="lg">
                            😍
                        </Button>
                    </div>
                    <Text size="sm" className="text-center">
                        (You can also bail with [ESC] or by tapping the
                        overlay.)
                    </Text>
                </Container>
            </Card>
        </Modal>
    );
};
