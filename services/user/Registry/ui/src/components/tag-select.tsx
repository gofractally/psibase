import { X } from "lucide-react";

import { Badge } from "@shadcn/badge";
import {
    Command,
    CommandGroup,
    CommandItem,
    CommandList,
} from "@shadcn/command";
import { Command as CommandPrimitive } from "cmdk";
import { useCallback, useRef, useState, KeyboardEvent, useEffect } from "react";
import { useTags } from "@hooks/use-tags";

type Tag = Record<"value" | "label", string>;

interface TagSelectProps {
    selectedTags: Tag[];
    onChange: (tags: Tag[]) => void;
}

export function TagSelect({ selectedTags, onChange }: TagSelectProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const [availableTags, setAvailableTags] = useState<Tag[]>([]);

    const { getRelatedTags } = useTags();

    const handleInputChange = useCallback(
        async (value: string) => {
            setInputValue(value);
            if (value.trim().length > 0) {
                const relatedTags = await getRelatedTags(value);
                setAvailableTags(
                    relatedTags?.tags.map((tag) => ({
                        value: tag,
                        label: tag,
                    })) || [],
                );
            } else {
                setAvailableTags([]);
            }
        },
        [getRelatedTags],
    );

    const handleUnselect = useCallback(
        (tag: Tag) => {
            onChange(selectedTags.filter((s) => s.value !== tag.value));
        },
        [onChange, selectedTags],
    );

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            const input = inputRef.current;
            if (input) {
                if (e.key === "Delete" || e.key === "Backspace") {
                    if (input.value === "") {
                        onChange(selectedTags.slice(0, -1));
                    }
                }
                if (e.key === "Escape") {
                    input.blur();
                }
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    addNewTag(input.value);
                }
            }
        },
        [onChange, selectedTags],
    );

    const addNewTag = useCallback(
        (value: string) => {
            const trimmedValue = value.trim();
            if (
                trimmedValue &&
                !selectedTags.some((tag) => tag.value === trimmedValue)
            ) {
                const newTag = { value: trimmedValue, label: trimmedValue };
                onChange([...selectedTags, newTag]);
                setInputValue("");
            }
        },
        [onChange, selectedTags],
    );

    const filteredTags = availableTags.filter(
        (tag) =>
            !selectedTags.some(
                (selectedTag) => selectedTag.value === tag.value,
            ) && tag.label.toLowerCase().includes(inputValue.toLowerCase()),
    );

    const handleSelect = (tag: Tag) => {
        if (
            !selectedTags.some((selectedTag) => selectedTag.value === tag.value)
        ) {
            onChange([...selectedTags, tag]);
        }
        setInputValue("");
    };

    return (
        <Command
            onKeyDown={handleKeyDown}
            className="overflow-visible bg-transparent"
        >
            <div className="group rounded-md border border-input px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <div className="flex flex-wrap gap-1">
                    {selectedTags.map((tag) => {
                        return (
                            <Badge key={tag.value} variant="secondary">
                                {tag.label}
                                <button
                                    className="ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            handleUnselect(tag);
                                        }
                                    }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onClick={() => handleUnselect(tag)}
                                >
                                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                </button>
                            </Badge>
                        );
                    })}
                    <CommandPrimitive.Input
                        ref={inputRef}
                        value={inputValue}
                        onValueChange={handleInputChange}
                        onBlur={() => {
                            setOpen(false);
                            addNewTag(inputValue);
                        }}
                        onFocus={() => setOpen(true)}
                        placeholder="Select tags..."
                        className="ml-2 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                    />
                </div>
            </div>
            <div className="relative mt-2">
                <CommandList>
                    {open && filteredTags.length > 0 ? (
                        <div className="absolute top-0 z-10 w-full rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in">
                            <CommandGroup className="h-full overflow-auto">
                                {filteredTags.map((tag) => {
                                    return (
                                        <CommandItem
                                            key={tag.value}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                            }}
                                            onSelect={() => handleSelect(tag)}
                                            className={"cursor-pointer"}
                                        >
                                            {tag.label}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </div>
                    ) : null}
                </CommandList>
            </div>
        </Command>
    );
}
