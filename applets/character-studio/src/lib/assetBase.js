export function getAssetBase() {
  if (typeof window !== "undefined" && window.__EVERYWEAR_ASSET_BASE__ != null) {
    return window.__EVERYWEAR_ASSET_BASE__;
  }

  const env = import.meta.env?.VITE_ASSET_PATH;
  if (env != null && env !== "") return env;

  return "";
}

export function getAssetUrl(path) {
  if (!path) return path;
  if (typeof path !== "string") return path;
  if (/^(https?:|blob:|data:)/.test(path)) return path;

  const base = getAssetBase().replace(/\/$/, "");
  if (base !== "" && path.startsWith(`${base}/`)) return path;

  return `${base}/${path.replace(/^\.\//, "").replace(/^\//, "")}`;
}
