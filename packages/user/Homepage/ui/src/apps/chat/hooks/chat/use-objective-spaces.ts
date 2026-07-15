import { useCallback, useEffect, useRef, useState } from "react";

import { fetchMySpaces } from "../../lib/chat-api";
import type { GraphqlSpaceEntry } from "../../lib/space-bridge";

const SPACES_RELOAD_ON_PRESENCE_MS = 750;

export type UseObjectiveSpacesResult = {
    objectiveSpaces: GraphqlSpaceEntry[];
    setObjectiveSpaces: React.Dispatch<
        React.SetStateAction<GraphqlSpaceEntry[]>
    >;
    spacesLoadError: string | null;
    setSpacesLoadError: React.Dispatch<React.SetStateAction<string | null>>;
    objectiveSpacesRef: React.MutableRefObject<GraphqlSpaceEntry[]>;
    loadObjectiveSpaces: () => Promise<GraphqlSpaceEntry[]>;
    loadObjectiveSpacesRef: React.MutableRefObject<
        () => Promise<GraphqlSpaceEntry[]>
    >;
    scheduleSpacesReloadOnPresenceOnline: () => void;
    spacesReloadOnPresenceTimerRef: React.MutableRefObject<
        ReturnType<typeof globalThis.setTimeout> | null
    >;
};

/** Load/reload objective spaces and debounced presence-driven reload. */
export function useObjectiveSpaces(
    selfAccount: string | null,
): UseObjectiveSpacesResult {
    const [objectiveSpaces, setObjectiveSpaces] = useState<GraphqlSpaceEntry[]>(
        [],
    );
    const [spacesLoadError, setSpacesLoadError] = useState<string | null>(null);
    const objectiveSpacesRef = useRef<GraphqlSpaceEntry[]>([]);
    objectiveSpacesRef.current = objectiveSpaces;

    const spacesReloadOnPresenceTimerRef = useRef<ReturnType<
        typeof globalThis.setTimeout
    > | null>(null);

    const loadObjectiveSpaces = useCallback(async () => {
        try {
            const spaces = await fetchMySpaces();
            objectiveSpacesRef.current = spaces;
            setObjectiveSpaces(spaces);
            setSpacesLoadError(null);
            return spaces;
        } catch (e) {
            const detail =
                e instanceof Error ? e.message : "Could not load chat spaces.";
            setSpacesLoadError(detail);
            throw e;
        }
    }, []);

    const loadObjectiveSpacesRef = useRef(loadObjectiveSpaces);
    loadObjectiveSpacesRef.current = loadObjectiveSpaces;

    const scheduleSpacesReloadOnPresenceOnline = useCallback(() => {
        if (spacesReloadOnPresenceTimerRef.current) {
            globalThis.clearTimeout(spacesReloadOnPresenceTimerRef.current);
        }
        spacesReloadOnPresenceTimerRef.current = globalThis.setTimeout(() => {
            spacesReloadOnPresenceTimerRef.current = null;
            void loadObjectiveSpacesRef.current();
        }, SPACES_RELOAD_ON_PRESENCE_MS);
    }, []);

    useEffect(() => {
        if (!selfAccount) return;
        void loadObjectiveSpaces();
    }, [selfAccount, loadObjectiveSpaces]);

    useEffect(
        () => () => {
            if (spacesReloadOnPresenceTimerRef.current) {
                globalThis.clearTimeout(spacesReloadOnPresenceTimerRef.current);
            }
        },
        [],
    );

    return {
        objectiveSpaces,
        setObjectiveSpaces,
        spacesLoadError,
        setSpacesLoadError,
        objectiveSpacesRef,
        loadObjectiveSpaces,
        loadObjectiveSpacesRef,
        scheduleSpacesReloadOnPresenceOnline,
        spacesReloadOnPresenceTimerRef,
    };
}
