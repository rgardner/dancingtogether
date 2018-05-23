// @ts-ignore: No typings for Django Channels WebSocketBridge
declare var channels;

export interface WebSocketListenCallback {
    (action: any, stream: string): void;
}

export interface WebSocketBridge {
    connect(path: string): void;
    listen(callback: WebSocketListenCallback): void;
    send(data: any): void;
}

export class ChannelWebSocketBridge implements WebSocketBridge {
    impl = new channels.WebSocketBridge();
    connect(path: string) { this.impl.connect(path); }
    listen(callback: WebSocketListenCallback) { this.impl.listen(callback); }
    send(data: any) { this.impl.send(data); }
}
