export function getAssetBase() {
  if (typeof window !== "undefined" && window.__EVERYWEAR_ASSET_BASE__ != null) {
    return window.__EVERYWEAR_ASSET_BASE__;
  }

  const env = import.meta.env?.VITE_ASSET_PATH;
  if (env != null && env !== "") return env;

  return "";
}
