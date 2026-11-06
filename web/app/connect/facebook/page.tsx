import type { Metadata } from "next";
import { cookies } from "next/headers";
import { FacebookConnectPanel } from "@/components/FacebookConnectPanel";
import { FACEBOOK_SESSION_COOKIE } from "@/lib/facebook-connect/config";
import { getFacebookConnectionView } from "@/lib/facebook-connect/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Свързване на Facebook страница | Обо",
  description: "Свързване на общинска Facebook страница за подготовка на пилот с Обо.",
  robots: { index: false, follow: false },
};

export default async function FacebookConnectionPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ error?: string | string[] }>;
}>) {
  const cookieStore = await cookies();
  const query = await searchParams;
  const errorCode = typeof query.error === "string" ? query.error : undefined;
  const view = await getFacebookConnectionView(
    cookieStore.get(FACEBOOK_SESSION_COOKIE)?.value,
    errorCode,
  );

  return <FacebookConnectPanel view={view} />;
}
