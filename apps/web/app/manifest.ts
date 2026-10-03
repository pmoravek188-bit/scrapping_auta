import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scrapping cars",
    short_name: "Cars",
    description: "Hlídání inzerátů s ojetými auty napříč bazary",
    lang: "cs",
    start_url: "/results",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2f6cf5",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
