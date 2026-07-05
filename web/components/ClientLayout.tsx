"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AuthProvider } from "@/lib/auth-context";
import QueryProvider from "@/components/QueryProvider";
import { MSWProvider } from "@/components/MSWProvider";
import { Toaster, toast } from "sonner";

export default function ClientLayout({
  children,
  showHistoryReportLink,
}: Readonly<{
  children: React.ReactNode;
  showHistoryReportLink: boolean;
}>) {
  const pathname = usePathname();
  const isClient = typeof window !== "undefined";

  const hideFooterOnMobile =
    pathname === "/" &&
    isClient &&
    new URLSearchParams(window.location.search).has("messageId");

  const reserveAuthorFooterSpace = pathname === "/author";

  const footerClassName = [hideFooterOnMobile ? "hidden sm:block" : ""]
    .filter(Boolean)
    .join(" ");

  const scrollContainerClassName = [
    "flex-1 flex flex-col overflow-y-auto",
    reserveAuthorFooterSpace ? "pb-28 sm:pb-0" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    // Deduplicate toasts while visible: repeated clicks update the same toast
    // instead of stacking duplicates. After dismiss, the same id can be shown again.
    const originalError = toast.error.bind(toast);
    const originalSuccess = toast.success.bind(toast);
    const originalInfo = toast.info.bind(toast);
    const originalWarning = toast.warning.bind(toast);

    const buildId = (type: string, message: string) =>
      `dedup:${type}:${message.trim()}`;

    toast.error = (message, data) =>
      originalError(message, {
        ...data,
        id: data?.id ?? buildId("error", String(message)),
      });

    toast.success = (message, data) =>
      originalSuccess(message, {
        ...data,
        id: data?.id ?? buildId("success", String(message)),
      });

    toast.info = (message, data) =>
      originalInfo(message, {
        ...data,
        id: data?.id ?? buildId("info", String(message)),
      });

    toast.warning = (message, data) =>
      originalWarning(message, {
        ...data,
        id: data?.id ?? buildId("warning", String(message)),
      });

    return () => {
      toast.error = originalError;
      toast.success = originalSuccess;
      toast.info = originalInfo;
      toast.warning = originalWarning;
    };
  }, []);

  return (
    <MSWProvider>
      <div className="antialiased flex flex-col h-screen overflow-hidden">
        <QueryProvider>
          <AuthProvider>
            <Header />
            <div className={scrollContainerClassName}>
              <main className="flex-1 flex flex-col">{children}</main>
              <Footer
                showHistoryReportLink={showHistoryReportLink}
                className={footerClassName || undefined}
              />
            </div>
            <Toaster position="top-center" richColors />
          </AuthProvider>
        </QueryProvider>
      </div>
    </MSWProvider>
  );
}
