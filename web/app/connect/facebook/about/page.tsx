import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getButtonClasses } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Facebook страницата на района и Обо",
  description: "Как районната Facebook страница може да допълни публичните източници на Обо и как се подготвя пилотът.",
  openGraph: {
    title: "Facebook страницата на района като източник за Обо",
    description: "Какво проверяваме с пилота, как участва районът и защо свързването минава през Facebook приложение.",
    url: "/connect/facebook/about",
  },
  robots: { index: false, follow: false },
};

export default function FacebookConnectionAboutPage() {
  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <Link
        href="/connect/facebook"
        className={getButtonClasses("link", "sm", "sm", "mb-8 inline-flex items-center gap-2 px-0")}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Към страницата за свързване
      </Link>

      <header className="mb-10 max-w-3xl space-y-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-neutral">За районните екипи</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Facebook страницата на района като източник за Обо
        </h1>
        <p className="text-lg leading-8 text-neutral">
          Пилотът ще провери как публичните публикации на района могат да
          помогнат на хората да намират важните съобщения за местата, които следят.
        </p>
      </header>

      <div className="space-y-9 leading-7">
        <section aria-labelledby="facebook-about-purpose" className="space-y-3">
          <h2 id="facebook-about-purpose" className="text-xl font-semibold">Каква е идеята</h2>
          <p>
            Обо показва съобщения за градската инфраструктура на{" "}
            <Link href="/" className="text-primary underline underline-offset-4">карта</Link>
            {" "}и изпраща известия за избрани от хората зони. Примери са
            затворени улици, ремонти и прекъсвания на водата или топлоподаването.
            Картата е достъпна и за хора, които не ползват Facebook.
          </p>
          <p>
            Пилотът ще провери дали Facebook публикациите допълват полезно
            съобщенията от сайта на района. Ще се преглеждат наличният текст,
            местата, датите и дали публикацията е подходяща за Обо.
          </p>
        </section>

        <section aria-labelledby="facebook-about-participation" className="space-y-4">
          <h2 id="facebook-about-participation" className="text-xl font-semibold">Как участва районът</h2>
          <ol className="list-decimal space-y-3 pl-5 marker:font-semibold marker:text-primary">
            <li className="pl-2">
              Кметът или екипът на района уточняват участието и могат да изпратят
              линка за свързване на администратора на Facebook страницата.
            </li>
            <li className="pl-2">
              Администраторът прави първоначалното свързване във Facebook,
              потвърждава достъп за четене и избира страницата.
            </li>
            <li className="pl-2">
              Екипът продължава да публикува съобщенията по досегашния начин.
              Обхватът и началото на пилота се уговарят отделно.
            </li>
          </ol>
        </section>

        <section aria-labelledby="facebook-about-meta" className="space-y-3">
          <h2 id="facebook-about-meta" className="text-xl font-semibold">Защо е нужно Facebook приложение</h2>
          <p>
            За автоматичното четене на публикациите Обо използва официалния
            интерфейс на Facebook. Достъпът през него се предоставя на
            регистрирано приложение с разрешение от администратора на страницата.
          </p>
          <p>
            На екрана за разрешение приложението се казва <strong>OboApp</strong>.
            То е връзката, чрез която Обо ще може да чете избраната страница.
            Администраторът може да оттегли достъпа от настройките за бизнес
            интеграции във Facebook.
          </p>
          <p>
            При уговорен пилот обработката на съобщенията може да включва
            изкуствен интелект за разпознаване на места и дати. Подробностите
            са в{" "}
            <Link href="/connect/facebook/privacy" className="text-primary underline underline-offset-4">
              информацията за данните
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="facebook-about-next" className="space-y-5 rounded-2xl border border-neutral-border bg-neutral-light p-6 sm:p-8">
          <h2 id="facebook-about-next" className="text-xl font-semibold">Свързването е задача на администратора</h2>
          <p>
            Свързването подготвя страницата за пилота. Събирането на публикации
            се включва след отделна уговорка с районния екип.
          </p>
          <Link
            href="/connect/facebook#facebook-connection"
            className={getButtonClasses("primary", "lg", "md", "inline-flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary")}
          >
            Към свързване на страница
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </article>
  );
}
