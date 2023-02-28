import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, unstable_batchedUpdates } from "react-dom";

import {
    CancelDrop,
    CollisionDetection,
    DndContext,
    DragOverlay,
    DropAnimation,
    KeyboardCoordinateGetter,
    KeyboardSensor,
    MeasuringStrategy,
    Modifiers,
    MouseSensor,
    TouchSensor,
    UniqueIdentifier,
    closestCenter,
    getFirstCollision,
    pointerWithin,
    rectIntersection,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    AnimateLayoutChanges,
    SortableContext,
    SortingStrategy,
    arrayMove,
    defaultAnimateLayoutChanges,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
    DraggableContainer,
    DraggableContainerProps,
} from "./draggable-container";
import { DraggableItem, DraggableItemRenderProps } from "./draggable-item";
import { Items } from "./types";
import { coordinateGetter as multipleContainersCoordinateGetter } from "./utils/keyboard-coordinates";

const animateLayoutChanges: AnimateLayoutChanges = (args) =>
    defaultAnimateLayoutChanges({ ...args, wasDragging: true });

function DroppableContainer({
    children,
    disabled,
    id,
    items,
    containerPlaceholder,
    style,
    ...props
}: DraggableContainerProps & {
    disabled?: boolean;
    id: UniqueIdentifier;
    items: UniqueIdentifier[];
    containerPlaceholder: string;
    style?: React.CSSProperties;
}) {
    const {
        active,
        attributes,
        isDragging,
        listeners,
        over,
        setNodeRef,
        transition,
        transform,
    } = useSortable({
        id,
        data: {
            type: "container",
            children: items,
        },
        animateLayoutChanges,
    });

    const isOverContainer = over
        ? (id === over.id && active?.data.current?.type !== "container") ||
          items.includes(over.id)
        : false;

    return (
        <DraggableContainer
            ref={disabled ? undefined : setNodeRef}
            label={id as string}
            style={{
                ...style,
                transition,
                transform: CSS.Translate.toString(transform),
                opacity: isDragging ? 0.5 : undefined,
            }}
            hover={isOverContainer}
            handleProps={{
                ...attributes,
                ...listeners,
            }}
            placeholder={Boolean(!items.length)}
            {...props}
        >
            {items.length ? children : containerPlaceholder}
        </DraggableContainer>
    );
}

type ContainerPlaceholders = Record<UniqueIdentifier, string>;

interface Props {
    adjustScale?: boolean;
    cancelDrop?: CancelDrop;
    containerPlaceholders?: ContainerPlaceholders;
    containerClass?: string;
    containerStyle?: React.CSSProperties;
    coordinateGetter?: KeyboardCoordinateGetter;
    dropAnimation?: DropAnimation;
    getItemStyles?(args: {
        value: UniqueIdentifier;
        index: number;
        overIndex: number;
        isDragging: boolean;
        containerId: UniqueIdentifier;
        isSorting: boolean;
        isDragOverlay: boolean;
    }): React.CSSProperties;
    wrapperStyle?(args: { index: number }): React.CSSProperties;
    items: Items;
    setItems: React.Dispatch<React.SetStateAction<Items>>;
    handle?: boolean;
    strategy?: SortingStrategy;
    modifiers?: Modifiers;
    scrollable?: boolean;
    children(args: DraggableItemRenderProps): React.ReactElement;
}

const PLACEHOLDER_ID = "placeholder";

export function MultipleContainers({
    adjustScale = false,
    cancelDrop,
    handle = false,
    items,
    setItems,
    containerPlaceholders,
    containerClass,
    containerStyle,
    coordinateGetter = multipleContainersCoordinateGetter,
    dropAnimation,
    getItemStyles = () => ({}),
    wrapperStyle = () => ({}),
    modifiers,
    strategy = verticalListSortingStrategy,
    scrollable,
    children,
}: Props) {
    const [containers, setContainers] = useState(
        Object.keys(items) as UniqueIdentifier[]
    );
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
    const lastOverId = useRef<UniqueIdentifier | null>(null);
    const recentlyMovedToNewContainer = useRef(false);
    const isSortingContainer = activeId ? containers.includes(activeId) : false;

    /**
     * Custom collision detection strategy optimized for multiple containers
     *
     * - First, find any droppable containers intersecting with the pointer.
     * - If there are none, find intersecting containers with the active draggable.
     * - If there are no intersecting containers, return the last matched intersection
     *
     */
    const collisionDetectionStrategy: CollisionDetection = useCallback(
        (args) => {
            if (activeId && activeId in items) {
                return closestCenter({
                    ...args,
                    droppableContainers: args.droppableContainers.filter(
                        (container) => container.id in items
                    ),
                });
            }

            // Start by finding any intersecting droppable
            const pointerIntersections = pointerWithin(args);
            const intersections =
                pointerIntersections.length > 0
                    ? // If there are droppables intersecting with the pointer, return those
                      pointerIntersections
                    : rectIntersection(args);
            let overId = getFirstCollision(intersections, "id");

            if (overId != null) {
                if (overId in items) {
                    const containerItems = items[overId];

                    // If a container is matched and it contains items
                    if (containerItems.length > 0) {
                        // Return the closest droppable within that container
                        overId = closestCenter({
                            ...args,
                            droppableContainers:
                                args.droppableContainers.filter(
                                    (container) =>
                                        container.id !== overId &&
                                        containerItems.includes(container.id)
                                ),
                        })[0]?.id;
                    }
                }

                lastOverId.current = overId;

                return [{ id: overId }];
            }

            // When a draggable item moves to a new container, the layout may shift
            // and the `overId` may become `null`. We manually set the cached `lastOverId`
            // to the id of the draggable item that was moved to the new container, otherwise
            // the previous `overId` will be returned which can cause items to incorrectly shift positions
            if (recentlyMovedToNewContainer.current) {
                lastOverId.current = activeId;
            }

            // If no droppable is matched, return the last match
            return lastOverId.current ? [{ id: lastOverId.current }] : [];
        },
        [activeId, items]
    );
    const [clonedItems, setClonedItems] = useState<Items | null>(null);
    const sensors = useSensors(
        useSensor(MouseSensor),
        useSensor(TouchSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter,
        })
    );
    const findContainer = (id: UniqueIdentifier) => {
        if (id in items) {
            return id;
        }

        return Object.keys(items).find((key) => items[key].includes(id));
    };

    const getIndex = (id: UniqueIdentifier) => {
        const container = findContainer(id);

        if (!container) {
            return -1;
        }

        const index = items[container].indexOf(id);

        return index;
    };

    const onDragCancel = () => {
        if (clonedItems) {
            // Reset items to their original state in case items have been
            // Dragged across containers
            setItems(clonedItems);
        }

        setActiveId(null);
        setClonedItems(null);
    };

    useEffect(() => {
        requestAnimationFrame(() => {
            recentlyMovedToNewContainer.current = false;
        });
    }, [items]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            measuring={{
                droppable: {
                    strategy: MeasuringStrategy.Always,
                },
            }}
            onDragStart={({ active }) => {
                setActiveId(active.id);
                setClonedItems(items);
            }}
            onDragOver={({ active, over }) => {
                const overId = over?.id;

                if (overId == null || active.id in items) {
                    return;
                }

                const overContainer = findContainer(overId);
                const activeContainer = findContainer(active.id);

                if (!overContainer || !activeContainer) {
                    return;
                }

                if (activeContainer !== overContainer) {
                    setItems((items) => {
                        const activeItems = items[activeContainer];
                        const overItems = items[overContainer];
                        const overIndex = overItems.indexOf(overId);
                        const activeIndex = activeItems.indexOf(active.id);

                        let newIndex: number;

                        if (overId in items) {
                            newIndex = overItems.length + 1;
                        } else {
                            const isBelowOverItem =
                                over &&
                                active.rect.current.translated &&
                                active.rect.current.translated.top >
                                    over.rect.top + over.rect.height;

                            const modifier = isBelowOverItem ? 1 : 0;

                            newIndex =
                                overIndex >= 0
                                    ? overIndex + modifier
                                    : overItems.length + 1;
                        }

                        recentlyMovedToNewContainer.current = true;

                        return {
                            ...items,
                            [activeContainer]: items[activeContainer].filter(
                                (item) => item !== active.id
                            ),
                            [overContainer]: [
                                ...items[overContainer].slice(0, newIndex),
                                items[activeContainer][activeIndex],
                                ...items[overContainer].slice(
                                    newIndex,
                                    items[overContainer].length
                                ),
                            ],
                        };
                    });
                }
            }}
            onDragEnd={({ active, over }) => {
                if (active.id in items && over?.id) {
                    setContainers((containers) => {
                        const activeIndex = containers.indexOf(active.id);
                        const overIndex = containers.indexOf(over.id);

                        return arrayMove(containers, activeIndex, overIndex);
                    });
                }

                const activeContainer = findContainer(active.id);

                if (!activeContainer) {
                    setActiveId(null);
                    return;
                }

                const overId = over?.id;

                if (overId == null) {
                    setActiveId(null);
                    return;
                }

                if (overId === PLACEHOLDER_ID) {
                    const newContainerId = getNextContainerId();

                    unstable_batchedUpdates(() => {
                        setContainers((containers) => [
                            ...containers,
                            newContainerId,
                        ]);
                        setItems((items) => ({
                            ...items,
                            [activeContainer]: items[activeContainer].filter(
                                (id) => id !== activeId
                            ),
                            [newContainerId]: [active.id],
                        }));
                        setActiveId(null);
                    });
                    return;
                }

                const overContainer = findContainer(overId);

                if (overContainer) {
                    const activeIndex = items[activeContainer].indexOf(
                        active.id
                    );
                    const overIndex = items[overContainer].indexOf(overId);

                    if (activeIndex !== overIndex) {
                        setItems((items) => ({
                            ...items,
                            [overContainer]: arrayMove(
                                items[overContainer],
                                activeIndex,
                                overIndex
                            ),
                        }));
                    }
                }

                setActiveId(null);
            }}
            cancelDrop={cancelDrop}
            onDragCancel={onDragCancel}
            modifiers={modifiers}
        >
            <div className={containerClass}>
                <SortableContext
                    items={[...containers, PLACEHOLDER_ID]}
                    strategy={verticalListSortingStrategy}
                >
                    {containers.map((containerId) => (
                        <DroppableContainer
                            key={containerId}
                            id={containerId}
                            items={items[containerId]}
                            containerPlaceholder={
                                containerPlaceholders?.[containerId] ??
                                "drop here"
                            }
                            scrollable={scrollable}
                            style={containerStyle}
                            onRemove={() => handleRemove(containerId)}
                        >
                            <SortableContext
                                items={items[containerId]}
                                strategy={strategy}
                            >
                                {items[containerId].map((value, index) => {
                                    return (
                                        <SortableItem
                                            disabled={isSortingContainer}
                                            key={value}
                                            id={value}
                                            index={index}
                                            handle={handle}
                                            style={getItemStyles}
                                            wrapperStyle={wrapperStyle}
                                            renderItem={children}
                                            containerId={containerId}
                                            getIndex={getIndex}
                                        />
                                    );
                                })}
                            </SortableContext>
                        </DroppableContainer>
                    ))}
                </SortableContext>
            </div>
            {createPortal(
                <DragOverlay
                    adjustScale={adjustScale}
                    dropAnimation={dropAnimation}
                >
                    {activeId ? renderSortableItemDragOverlay(activeId) : null}
                </DragOverlay>,
                document.body
            )}
        </DndContext>
    );

    function renderSortableItemDragOverlay(id: UniqueIdentifier) {
        return (
            <DraggableItem
                value={id}
                handle={handle}
                style={getItemStyles({
                    containerId: findContainer(id) as UniqueIdentifier,
                    overIndex: -1,
                    index: getIndex(id),
                    value: id,
                    isSorting: true,
                    isDragging: true,
                    isDragOverlay: true,
                })}
                wrapperStyle={wrapperStyle({ index: 0 })}
                renderItem={children}
                dragOverlay
            />
        );
    }

    function handleRemove(containerID: UniqueIdentifier) {
        setContainers((containers) =>
            containers.filter((id) => id !== containerID)
        );
    }

    function getNextContainerId() {
        const containerIds = Object.keys(items);
        const lastContainerId = containerIds[containerIds.length - 1];

        return String.fromCharCode(lastContainerId.charCodeAt(0) + 1);
    }
}

interface SortableItemProps {
    containerId: UniqueIdentifier;
    id: UniqueIdentifier;
    index: number;
    handle: boolean;
    disabled?: boolean;
    style(args: any): React.CSSProperties;
    getIndex(id: UniqueIdentifier): number;
    renderItem(args: DraggableItemRenderProps): React.ReactElement;
    wrapperStyle({ index }: { index: number }): React.CSSProperties;
}

function SortableItem({
    disabled,
    id,
    index,
    handle,
    renderItem,
    style,
    containerId,
    getIndex,
    wrapperStyle,
}: SortableItemProps) {
    const {
        setNodeRef,
        setActivatorNodeRef,
        listeners,
        isDragging,
        isSorting,
        over,
        overIndex,
        transform,
        transition,
    } = useSortable({
        id,
    });
    const mounted = useMountStatus();
    const mountedWhileDragging = isDragging && !mounted;

    return (
        <DraggableItem
            ref={disabled ? undefined : setNodeRef}
            value={id}
            dragging={isDragging}
            sorting={isSorting}
            handle={handle}
            handleProps={handle ? { ref: setActivatorNodeRef } : undefined}
            index={index}
            wrapperStyle={wrapperStyle({ index })}
            style={style({
                index,
                value: id,
                isDragging,
                isSorting,
                overIndex: over ? getIndex(over.id) : overIndex,
                containerId,
            })}
            transition={transition}
            transform={transform}
            fadeIn={mountedWhileDragging}
            listeners={listeners}
            renderItem={renderItem}
        />
    );
}

function useMountStatus() {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        const timeout = setTimeout(() => setIsMounted(true), 500);

        return () => clearTimeout(timeout);
    }, []);

    return isMounted;
}

export default MultipleContainers;
