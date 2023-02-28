import React, { useState, RefObject, useRef } from "react";
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

export interface SceneActions {
    nextScene: () => void;
    prevScene: () => void;
    isSceneShown: (currentScene: number) => boolean;
    resetScene: () => void;
    sceneContainerRef: React.Ref<HTMLElement>;
}

export const useModalScenes = () => {
    const [scene, setScene] = useState(0);
    const ref = useRef<HTMLElement>(null);

    const scrollToTop = () => {
        if (ref && ref.current) ref.current.scrollTop = 0;
    };

    const nextScene = () => {
        setScene(scene + 1);
        scrollToTop();
    };

    const prevScene = () => {
        setScene(scene - 1);
        scrollToTop();
    };

    const isSceneShown = (currentScene: number): boolean => {
        return scene === currentScene;
    };

    const resetScene = () => {
        setScene(0);
    };

    return {
        nextScene,
        prevScene,
        isSceneShown,
        resetScene,
        sceneContainerRef: ref,
    };
};

export interface SceneProps {
    showScene: boolean;
    nextScene?: () => void;
    prevScene?: () => void;
    dismiss?: (args?: any) => void;
}
