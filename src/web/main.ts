// Shared view contract for the ported debate module (mirrors the web app's src/main.ts).
export interface Ctx { url: URL; params: Record<string, string>; signal: AbortSignal; }
export type Cleanup = void | (() => void);
export type View = (root: HTMLElement, ctx: Ctx) => Cleanup | Promise<Cleanup>;
