/** Injected by electron/preload.ts; absent when running in a plain browser tab. */
interface Window {
  aurea?: {
    readonly isElectron: true;
    readonly platform: NodeJS.Platform | string;
    readonly versions: {
      readonly electron: string | undefined;
      readonly chrome: string | undefined;
      readonly node: string | undefined;
    };
    /** {port, token} of the running studiod, or null if it failed to boot */
    readonly studiod: () => Promise<{ port: number; token: string } | null>;
  };
}
