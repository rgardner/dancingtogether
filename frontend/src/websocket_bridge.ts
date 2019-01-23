import ReconnectingWebSocket from 'reconnecting-websocket';

import DTError from './DTError';

export type WebSocketListenCallback = (action: any) => void;

export interface IWebSocketBridge {
    connect(path: string): void;
    listen(callback: WebSocketListenCallback): void;
    send(data: any): void;
}

export class ChannelWebSocketBridge implements IWebSocketBridge {
    private impl?: ReconnectingWebSocket;

    public connect(path: string) {
        this.impl = new ReconnectingWebSocket(path);
        this.impl.onclose = (event) => {
            console.log(`Websocket closed: code=${event.code}, wasClean=${event.wasClean}`);
        };
    }

    public listen(callback: WebSocketListenCallback) {
        if (!this.impl) {
            throw new DTError('invalid operation: ChannelWebSocketBridge.connect not called');
        }

        this.impl.onmessage = (event) => callback(JSON.parse(event.data));
    }

    public send(data: any) {
        this.impl!.send(JSON.stringify(data));
    }
}
