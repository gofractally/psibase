import type { Unsubscribe } from "./types";

type Handler = (...args: never[]) => void;

export class EventBus<Events extends Record<string, Handler>> {
    private listeners = new Map<keyof Events, Set<Handler>>();

    on<Event extends keyof Events>(
        event: Event,
        handler: Events[Event],
    ): Unsubscribe {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(handler as Handler);
        return () => {
            set!.delete(handler as Handler);
        };
    }

    emit<Event extends keyof Events>(
        event: Event,
        ...args: Parameters<Events[Event]>
    ): void {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const handler of set) {
            (handler as Events[Event])(...args);
        }
    }
}
