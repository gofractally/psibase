export type KeyBits = {
    left: boolean;
    right: boolean;
    forward: boolean;
    back: boolean;
    fire: boolean;
};

export function createKeyBits(): KeyBits {
    return {
        left: false,
        right: false,
        forward: false,
        back: false,
        fire: false,
    };
}

function mapKey(code: string, key: string): keyof KeyBits | null {
    switch (code) {
        case "ArrowLeft":
        case "KeyA":
            return "left";
        case "ArrowRight":
        case "KeyD":
            return "right";
        case "ArrowUp":
        case "KeyW":
            return "forward";
        case "ArrowDown":
        case "KeyS":
            return "back";
        case "Space":
            return "fire";
        default:
            if (key === " ") return "fire";
            return null;
    }
}

export function attachKeyboard(keys: KeyBits): () => void {
    const down = (e: KeyboardEvent) => {
        const k = mapKey(e.code, e.key);
        if (!k) return;
        e.preventDefault();
        keys[k] = true;
    };
    const up = (e: KeyboardEvent) => {
        const k = mapKey(e.code, e.key);
        if (!k) return;
        e.preventDefault();
        keys[k] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
        window.removeEventListener("keydown", down);
        window.removeEventListener("keyup", up);
    };
}

export function inputFromKeys(keys: KeyBits) {
    return {
        turn: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
        throttle: (keys.forward ? 1 : 0) - (keys.back ? 1 : 0),
        fire: keys.fire,
    };
}
