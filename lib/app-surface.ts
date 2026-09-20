/** Which local product surface this process is serving. */

export type AppSurface = "care" | "pracx";

export function getAppSurface(): AppSurface {
  return process.env.NEXT_PUBLIC_APP_SURFACE === "pracx" ? "pracx" : "care";
}

export function isPracxStandalone() {
  return getAppSurface() === "pracx";
}

/** Public origin for the dedicated PRACX client link (local). */
export const PRACX_STANDALONE_ORIGIN = "http://localhost:3004";
