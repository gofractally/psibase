import { Transition } from "@headlessui/react";

interface ModalSceneTransitionContainerProps {
    show: boolean;
    className?: string;
    children: React.ReactNode;
}

export const ModalSceneTransitionContainer = ({
    show,
    className = "",
    children,
}: ModalSceneTransitionContainerProps) => (
    <Transition
        show={show}
        enter="transition-opacity duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-200 absolute inset-0"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        className={className}
    >
        {children}
    </Transition>
);

export default ModalSceneTransitionContainer;
