export enum ListenerRole {
  None = 0,
  DJ = 1 << 1,
  Admin = 1 << 2,
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function median(arr: number[]): number {
  return arr.concat().sort()[Math.floor(arr.length / 2)];
}

export class CircularArray<T> {
  private array: T[] = [];
  private position = 0;
  constructor(readonly capacity: number) {}

  public get length(): number {
    return this.array.length;
  }

  public entries(): T[] {
    return this.array;
  }

  public push(e: T): void {
    this.array[this.position % this.capacity] = e;
    this.position++;
  }
}
