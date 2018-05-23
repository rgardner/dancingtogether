export enum ListenerRole {
    None,
    DJ = 1 << 1,
    Admin = 1 << 2,
}

export function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
