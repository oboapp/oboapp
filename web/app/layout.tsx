import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import ClientLayout from "@/components/ClientLayout";
import {
  APP_NAME,
  METADATA_ICON_LINKS,
  PWA_ICON_PATHS,
  PWA_MANIFEST_PATH,
} from "@/lib/pwa-metadata";
import { getConfiguredLocalityDescription } from "@/lib/locality-metadata";

const description = getConfiguredLocalityDescription();

const rawBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
if (!rawBaseUrl)
  throw new Error(
    "NEXT_PUBLIC_BASE_URL is required — set an absolute http/https URL (e.g. https://example.com) in web/.env.local",
  );

export const metadata: Metadata = {
  title: APP_NAME,
  description,
  metadataBase: new URL(rawBaseUrl),
  manifest: PWA_MANIFEST_PATH,
  icons: {
    icon: [
      { url: PWA_ICON_PATHS.faviconSvg, type: "image/svg+xml" },
      { url: PWA_ICON_PATHS.faviconIco },
    ],
    apple: PWA_ICON_PATHS.appleTouchIcon,
    other: [...METADATA_ICON_LINKS],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  openGraph: {
    title: APP_NAME,
    description,
    locale: "bg_BG",
    type: "website",
    siteName: APP_NAME,
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html lang="bg">
      <head>
        {/* Preconnect to Google Maps domains for faster LCP */}
        <link rel="preconnect" href="https://maps.googleapis.com" />
        <link
          rel="preconnect"
          href="https://maps.gstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://maps.googleapis.com" />
        <link rel="dns-prefetch" href="https://maps.gstatic.com" />
      </head>
      <body className="font-sofia">
        {gaId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                
                // Wait for consent before initializing
                gtag('consent', 'default', {
                  'analytics_storage': 'denied'
                });
                
                // Check for stored consent and initialize if granted
                if (typeof window !== 'undefined') {
                  const consent = localStorage.getItem('ga_consent');
                  if (consent === 'granted') {
                    gtag('consent', 'update', {
                      'analytics_storage': 'granted'
                    });
                    gtag('config', '${gaId}', {
                      page_path: window.location.pathname,
                    });
                  }
                }
              `}
            </Script>
          </>
        )}
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
