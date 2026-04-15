declare module 'ws' {
  export default class WebSocket {
    constructor(url: string);
    addEventListener(type: string, listener: (event: any) => void): void;
    once(type: string, listener: (...args: any[]) => void): void;
    on(type: string, listener: (...args: any[]) => void): void;
    send(data: string): void;
    close(): void;
  }
}
