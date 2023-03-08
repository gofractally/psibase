import React from "react";
import ReactModal from "react-modal";

export const MODAL_INDEX = 50; // for external usage

const baseClass =
    "flex flex-col relative transform w-screen h-full sm:inset-1/2 sm:-translate-y-1/2 sm:-translate-x-1/2 shadow-2xl outline-none bg-white sm:bg-inberit";

export type ModalProps = ReactModal.Props & {
    title?: string;
    children?: React.ReactNode;
};

/**
 * For docs and props, see https://reactcommunity.org/react-modal/.
 */
export const Modal = ({ children, ...props }: ModalProps) => {
    return (
        <ReactModal
            closeTimeoutMS={200}
            className={baseClass}
            overlayClassName={{
                base: "fixed inset-0 bg-white bg-opacity-0 opacity-0 transition ease-in-out duration-200 backdrop-blur",
                beforeClose: "bg-opacity-0 opacity-0",
                afterOpen: props.isOpen ? "bg-opacity-70 opacity-100" : "",
            }}
            style={{
                overlay: {
                    zIndex: MODAL_INDEX,
                },
            }}
            {...props}
        >
            {children}
        </ReactModal>
    );
};
