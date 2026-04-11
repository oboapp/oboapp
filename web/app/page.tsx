import { Suspense } from "react";
import type { Metadata } from "next";
import HomeContent from "@/components/HomeContent";
import SplashScreen from "@/components/SplashScreen";
import { getConfiguredLocalityDescription } from "@/lib/locality-metadata";

export const metadata: Metadata = {
  openGraph: {
    url: "/",
    description: getConfiguredLocalityDescription(),
  },
};

export default function Home() {
  return (
    <Suspense fallback={<SplashScreen />}>
      <HomeContent />
    </Suspense>
  );
}
