import type { Metadata } from "next";
import Link from "next/link";
import { getFacebookConnectionContext } from "@/lib/facebook-connect/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Изтриване на Facebook връзка | Обо",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function FacebookDeletionPage({ searchParams }: Readonly<{
  searchParams: Promise<{ code?: string | string[] }>;
}>) {
  const { code } = await searchParams;
  let completed = false;
  if (typeof code === "string" && /^[A-Za-z0-9_-]{32}$/.test(code)) {
    try {
      const context = await getFacebookConnectionContext();
      completed = (await context.store.getDeletionReceipt(code)) !== null;
    } catch {
      completed = false;
    }
  }
  return (
    <section className="mx-auto max-w-2xl space-y-5 px-4 py-12">
      <h1 className="text-3xl font-bold">Изтриване на Facebook връзка</h1>
      <p className="leading-7 text-neutral">
        {completed
          ? "Връзките и запазените данни за достъп са изтрити."
          : "Потвърждението не е намерено. Провери линка от Facebook или се свържи с човека, който ти изпрати поканата."}
      </p>
      <Link href="/connect/facebook/privacy" className="text-primary underline">Как се използват данните</Link>
    </section>
  );
}
