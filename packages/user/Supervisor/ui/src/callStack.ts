export interface Call {
    service: string;
    context: string;
    startTime?: number;
}

const seeTimingTraces = false;

// Callstack implementation that manages frames for every inter-plugin call
export class CallStack {
    private storage: Array<Call> = [];

    push(service: string, context: string): void {
        this.storage.push({
            service,
            context,
            startTime: Date.now(),
        });
    }

    pop(): Call | undefined {
        if (this.isEmpty()) {
            console.error(`Tried to pop empty callstack`);
            return undefined;
        }

        const idx = this.storage.length - 1;

        if (seeTimingTraces) {
            let shouldPrint = true;
            for (let i = 0; i < idx; ++i) {
                const frame = this.storage[i];
                if (
                    frame.service === "supervisor" ||
                    frame.context.includes("startTx") ||
                    frame.context.includes("finishTx")
                ) {
                    shouldPrint = false;
                    break;
                }
            }
            if (shouldPrint) {
                const popped = this.peek(0)!;
                const resolutionTime = Date.now() - popped.startTime!;
                console.log(
                    `Callstack: ${" ".repeat(4 * (this.storage.length - 1))}${popped.context} [${resolutionTime} ms]`,
                );
            }
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
