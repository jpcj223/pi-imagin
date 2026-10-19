import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const configuredName = (process.env.PI_IMAGIN_APP_NAME ?? process.env.PI_WEB_APP_NAME)?.trim();
  const appName = !configuredName || configuredName === "Pi Web" || configuredName === "pi-web"
    ? "Pi Imagin"
    : configuredName;
  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "Local web interface for the pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: "/icons/icon-cosmic-ocean-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-cosmic-ocean-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
