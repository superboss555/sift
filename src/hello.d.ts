export interface HelloModule {
    add(a: number, b: number): number;
    multiply(a: number, b: number): number;
}

declare function initModule(): Promise<HelloModule>;

export default initModule;