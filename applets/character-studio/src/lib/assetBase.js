/**
 * UI chrome assets bundled at build time.
 *
 * When the studio is inline-mounted in the Everywear shell, runtime asset
 * URLs resolve against /cs-assets. Dev serves that path from the applet's
 * public directory, and production copies the same directory into the shell
 * bundle. Do not point this at a runtime CDN; Avatar Studio is local-first.
 *
 * Importing small UI chrome assets through the bundler lets Vite fingerprint
 * and emit them with the shell build. Heavy runtime payloads
 * (character-assets, sound, hdr, ktx2, lora/sprite/thumbnail assets) resolve
 * through the local asset base and must be present before production QA.
 */
const bundledAssets = import.meta.glob(
  [
    "../../public/assets/icons/**/*.{png,jpg,svg}",
    "../../public/assets/media/btn_*.png",
    "../../public/assets/media/disabled.png",
    "../../public/assets/backgrounds/**/*.svg",
    "../../public/ui/**/*.{png,jpg,svg}",
    "../../public/textures/**/*.{png,jpg}",
    "../../public/3d/**/*.{png,svg}",
  ],
  { eager: true, query: "?url", import: "default" },
);

export function getAssetBase() {
  if (typeof window !== "undefined" && window.__EVERYWEAR_ASSET_BASE__ != null) {
    return window.__EVERYWEAR_ASSET_BASE__;
  }

  const env = import.meta.env?.VITE_ASSET_PATH;
  if (env != null && env !== "" && !/^https?:\/\//.test(env)) return env;

  return "";
}

export function getAssetUrl(path) {
  if (!path) return path;
  if (typeof path !== "string") return path;
  if (/^(https?:|blob:|data:)/.test(path)) return path;

  const base = getAssetBase().replace(/\/$/, "");
  if (base !== "" && path.startsWith(`${base}/`)) return path;

  const normalized = path.replace(/^\.\//, "").replace(/^\//, "");

  const bundled = bundledAssets[`../../public/${normalized}`];
  if (bundled != null) return bundled;

  return `${base}/${normalized}`;
}
