import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // HOW LONG VERCEL KEEPS AN OPTIMISED IMAGE, AND WHY IT IS THE WHOLE GAME.
    //
    // Measured 2026-10-21 against the live site: Open Food Facts' own origin
    // takes ~8.5 s to serve a 12 KB product thumbnail. A cold optimiser miss
    // costs ~8.7 s -- i.e. Vercel adds only ~100 ms -- and a warm hit costs
    // 164 ms. The upstream fetch IS the cost, which is why `unoptimized`
    // would make this worse rather than better: it would move that 8.5 s onto
    // every visitor instead of paying it once.
    //
    // With no value here, Vercel honours OFF's own Cache-Control and re-fetches
    // when it expires, so visitors keep paying the 8.5 s again. 31 days means
    // each image is slow once, for one person, ever.
    minimumCacheTTL: 2678400,
    // Product photographs come from Open Food Facts contributors. next/image
    // refuses any host that isn't listed here, which is the point: it means a
    // stray URL in the database cannot turn a product page into a request to
    // somewhere we never agreed to load from.
    //
    // Three hosts because OFF has moved its image serving over time and older
    // records still carry the earlier forms.
    remotePatterns: [
      { protocol: "https", hostname: "images.openfoodfacts.org", pathname: "/images/**" },
      { protocol: "https", hostname: "static.openfoodfacts.org", pathname: "/images/**" },
      { protocol: "https", hostname: "world.openfoodfacts.org", pathname: "/images/**" },
    ],
  },
};

export default nextConfig;
