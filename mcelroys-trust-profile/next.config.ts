import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
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
