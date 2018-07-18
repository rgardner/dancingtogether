// @ts-ignore: No typings for Django Channels IWebSocketBridge
declare var channels;

export type WebSocketListenCallback = (action: any, stream: string) => void;

export interface IWebSocketBridge {
    connect(path: string): void;
    listen(callback: WebSocketListenCallback): void;
    send(data: any): void;
}

export class ChannelWebSocketBridge implements IWebSocketBridge {
    private impl = new channels.WebSocketBridge();

    public connect(path: string) { this.impl.connect(path); }
    public listen(callback: WebSocketListenCallback) { this.impl.listen(callback); }
    public send(data: any) { this.impl.send(data); }
}
