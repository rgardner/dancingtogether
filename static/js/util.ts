export enum ListenerRole {
    None = 0,
    DJ = 1 << 1,
    Admin = 1 << 2,
}

export function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function median(arr: Array<number>): number {
    return arr.concat().sort()[Math.floor(arr.length / 2)];
}

export class CircularArray<T> {
    array: Array<T> = [];
    position = 0;
    constructor(readonly capacity: number) {
    }

    get length(): number {
        return this.array.length;
    }

    entries(): Array<T> {
        return this.array;
    }

    push(e: T) {
        this.array[this.position % this.capacity] = e;
        this.position++;
    }
}
