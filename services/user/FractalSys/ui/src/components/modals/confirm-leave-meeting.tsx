import {
    Button,
    Container,
    Modal,
    ModalNav,
    Text,
    Icon,
} from "@toolbox/components/ui";

export const ConfirmLeaveMeetingModal = ({
    isOpen,
    cancelNavigation,
    confirmNavigation,
}: {
    isOpen: boolean;
    cancelNavigation: () => void;
    confirmNavigation: () => void;
}) => {
    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={cancelNavigation}
            contentLabel="Confirm Leaving Meeting"
            preventScroll
            shouldCloseOnOverlayClick
            shouldCloseOnEsc
        >
            <Container className="flex h-full select-none flex-col space-y-4 overflow-auto px-8 sm:h-[811px]">
                <ModalNav
                    title="Confirm Exit"
                    rightButton="close"
                    onClickLeftButton={cancelNavigation}
                />
                <div className="flex h-full flex-col gap-1">
                    <div className="flex-1">
                        <h1 className="mb-2 text-xl">Leave the meeting</h1>
                        <Text>
                            You have not submitted your consensus report yet.
                            Are you sure you want to leave the meeting?
                        </Text>
                    </div>
                    <div className="my-6 flex gap-3 pb-6">
                        <Button
                            onClick={cancelNavigation}
                            type="secondary"
                            size="lg"
                            className="flex-1"
                        >
                            Do not leave
                        </Button>
                        <Button
                            onClick={confirmNavigation}
                            type="primary"
                            size="lg"
                            className="flex-1"
                            isSubmit
                        >
                            Leave meeting <Icon size="sm" type="signOut" />
                        </Button>
                    </div>
                </div>
            </Container>
        </Modal>
    );
};
