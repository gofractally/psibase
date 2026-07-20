export interface Call {
    service: string;
    debugInfo: string;
    startTime?: number;
}

const seeTimingTraces = false;

// Callstack implementation that manages frames for every inter-plugin call
export class CallStack {
    private storage: Array<Call> = [];

    push(service: string, debugInfo: string): void {
        this.storage.push({
            service,
            debugInfo,
            startTime: Date.now(),
        });
    }

    pop(): Call | undefined {
        if (this.isEmpty()) {
            console.error(`Tried to pop empty callstack`);
            return undefined;
        }

        if (seeTimingTraces) {
            const popped = this.peek(0)!;
            const resolutionTime = Date.now() - popped.startTime!;
            console.log(
                `Callstack: ${" ".repeat(4 * (this.storage.length - 1))}${popped.debugInfo} [${resolutionTime} ms]`,
            );
        }

        return this.storage.pop();
    }

    peek(depth: number): Call | undefined {
        return this.storage[this.storage.length - (1 + depth)];
    }

    peekBottom(height: number): Call | undefined {
        if (this.isEmpty()) {
            return undefined;
        }
        return this.storage[0 + height];
    }

    isEmpty(): boolean {
        return this.storage.length === 0;
    }

    reset(): void {
        this.storage = [];
    }

    export(): string[] {
        return this.storage.map((frame) => frame.service);
    }
}
