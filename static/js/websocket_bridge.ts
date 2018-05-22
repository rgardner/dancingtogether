export interface WebSocketListenCallback {
    (action: any, stream: string): void;
}

export interface WebSocketBridge {
    connect(path: string): void;
    listen(callback: WebSocketListenCallback): void;
    send(data: any): void;
}
