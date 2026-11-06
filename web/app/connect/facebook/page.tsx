import type { Metadata } from "next";
import { cookies } from "next/headers";
import { FacebookConnectPanel } from "@/components/FacebookConnectPanel";
import { FACEBOOK_SESSION_COOKIE } from "@/lib/facebook-connect/config";
import { getFacebookConnectionView } from "@/lib/facebook-connect/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Пилот с Facebook страницата на района | Обо",
  description: "Да проверим как публичните Facebook съобщения на района могат да допълнят картата и известията на Обо.",
  openGraph: {
    title: "Важните съобщения на района и извън Facebook",
    description: "Пилот за използване на Facebook страницата на района като източник за картата и известията на Обо.",
    url: "/connect/facebook",
  },
  twitter: {
    title: "Пилот с Facebook страницата на района | Обо",
    description: "Пилот за използване на публичните публикации на района като още един източник за Обо.",
  },
  robots: { index: false, follow: false },
};

export default async function FacebookConnectionPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ error?: string | string[]; restart?: string | string[] }>;
}>) {
  const cookieStore = await cookies();
  const query = await searchParams;
  const errorCode = typeof query.error === "string" ? query.error : undefined;
  const view = await getFacebookConnectionView(
    query.restart === "1" ? undefined : cookieStore.get(FACEBOOK_SESSION_COOKIE)?.value,
    errorCode,
  );

  return <FacebookConnectPanel view={view} />;
}
