import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Link2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { FacebookConnectionView } from "@/lib/facebook-connect/types";
import { getButtonClasses } from "@/lib/theme";

const errorMessages: Record<
  Extract<FacebookConnectionView, { status: "error" }>["code"],
  string
> = {
  cancelled: "Свързването беше отменено. Можеш да започнеш отново.",
  expired: "Времето за потвърждение изтече. Започни свързването отново.",
  permissions:
    "Липсва необходимият достъп до страница. Започни отново и разреши преглед на страниците, които управляваш, и публичните им публикации.",
  provider: "Facebook временно не отговори. Опитай отново след малко.",
  storage:
    "Свързването не беше запазено. Опитай отново. Ако проблемът продължи, уведоми човека, който ти изпрати линка.",
  invalid: "Потвърждението е невалидно. Започни свързването отначало.",
  rate_limit:
    "Твърде много опити за свързване. Изчакай няколко минути и опитай отново.",
  too_many_pages:
    "Избрани са твърде много страници. Започни отново и разреши достъп само до страницата за пилота.",
};

function ConnectionStartForm({ ready }: Readonly<{ ready: boolean }>) {
  return (
    <form action="/api/integrations/facebook/start" method="post" className="space-y-6">
      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          name="consent"
          value="yes"
          required
          disabled={!ready}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span>
          Потвърждавам, че имам право да свържа страницата, и разрешавам
          достъп за четене за подготовката на пилота. Прочетох{" "}
          <Link href="/connect/facebook/privacy" className="text-primary underline underline-offset-4">
            информацията за данните
          </Link>
          .
        </span>
      </label>
      <button
        type="submit"
        disabled={!ready}
        className={getButtonClasses("primary", "lg", "md", "flex w-full items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary")}
      >
        Продължи с Facebook
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}

function ConnectionState({ view }: Readonly<{ view: FacebookConnectionView }>) {
  if (view.status === "connected") {
    return (
      <div className="space-y-6">
        <CheckCircle2 className="text-success" size={36} aria-hidden="true" />
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold">Страницата е свързана</h2>
          <output className="block space-y-3">
            <span className="block break-words text-lg font-medium">{view.pageName}</span>
            <span className="block leading-7 text-neutral">
              Следва потвърждение на пилота с екипа на Обо. Събирането на
              публикации остава изключено.
            </span>
          </output>
        </div>
        <p className="text-sm leading-6">
          Уточни следващите стъпки с човека, който ти изпрати линка.
          Можеш да премахнеш достъпа по всяко време от Facebook.
        </p>
        <a
          href="https://www.facebook.com/settings?tab=business_tools"
          className={getButtonClasses("ghost", "md", "md", "inline-flex focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary")}
        >
          <span className="text-foreground">Управлявай достъпа във Facebook</span>
        </a>
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <div className="space-y-6">
        <div role="alert" className="space-y-3">
          <AlertCircle className="text-error" size={32} aria-hidden="true" />
          <h2 className="text-2xl font-semibold">Свързването не завърши</h2>
          <p className="leading-7 text-neutral">{errorMessages[view.code]}</p>
        </div>
        <Link
          href="/connect/facebook?restart=1"
          className={getButtonClasses("primary", "md", "md", "inline-flex focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary")}
        >
          Опитай отново
        </Link>
      </div>
    );
  }

  if (view.status === "select") {
    if (view.pages.length === 0) {
      return (
        <div className="space-y-5">
          <h2 className="text-2xl font-semibold">Няма налични страници</h2>
          <p className="leading-7 text-neutral">
            Започни отново и провери за кои страници разрешаваш достъп във Facebook.
          </p>
          <Link href="/connect/facebook?restart=1" className={getButtonClasses("link")}>
            Обратно към свързването
          </Link>
        </div>
      );
    }

    return (
      <form action="/api/integrations/facebook/select" method="post" className="space-y-6">
        <input type="hidden" name="csrf" value={view.csrfToken} />
        <fieldset className="min-w-0 space-y-4">
          <legend className="text-2xl font-semibold">Избери страница за Обо</legend>
          <p id="facebook-page-help" className="leading-7 text-neutral">
            Свържи една от страниците, за които разреши достъп за четене.
          </p>
          <div className="max-h-80 space-y-3 overflow-y-auto p-1">
            {view.pages.map((page) => {
              return (
                <label
                  key={page.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-neutral-border p-4 transition-colors hover:bg-neutral-light has-checked:border-primary has-checked:bg-neutral-light"
                >
                  <input
                    type="radio"
                    name="pageId"
                    value={page.id}
                    required
                    aria-describedby="facebook-page-help"
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words font-medium">{page.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <button
          type="submit"
          className={getButtonClasses("primary", "lg", "md", "flex w-full items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary")}
        >
          Свържи избраната страница
          <Link2 size={18} aria-hidden="true" />
        </button>
        <p className="text-sm leading-6 text-neutral">
          След свързването предстои отделно потвърждение за начало на пилота.
        </p>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">
          {view.ready ? "За администратора на страницата" : "Подготвяме свързването"}
        </h2>
        <p className="leading-7 text-neutral">
          {view.ready
            ? "Продължи през Facebook, за да разрешиш достъп за четене и да избереш страницата на района."
            : "Свързването ще бъде достъпно скоро. Човекът, който ти изпрати линка, ще потвърди кога можеш да продължиш."}
        </p>
      </div>
      {!view.ready && (
        <output className="flex items-center gap-2 rounded-lg bg-neutral-light p-3 text-sm text-foreground">
          <Clock3 size={18} aria-hidden="true" />
          Очаква се готовност за свързване
        </output>
      )}
      <ConnectionStartForm ready={view.ready} />
    </div>
  );
}

export function FacebookConnectPanel({ view }: Readonly<{ view: FacebookConnectionView }>) {
  return (
    <section aria-labelledby="facebook-connect-title" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-8 max-w-3xl space-y-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-neutral">Обо · Пилот с Facebook страниците на районите</p>
        <h1 id="facebook-connect-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
          Важните съобщения на района и извън Facebook
        </h1>
        <p className="text-lg leading-8 text-neutral">
          Обо показва публични съобщения за ремонти, аварии и промени в града
          на карта и изпраща известия за избрани места. С този пилот искаме
          да проверим дали публикациите във Facebook страницата на района
          могат да бъдат още един източник за Обо.
        </p>
        <p className="border-l-4 border-primary pl-4 font-medium leading-7">
          За начало препрати този линк на колегата, който управлява
          Facebook страницата на района.
        </p>
        <Link href="/connect/facebook/about" className="inline-block font-medium text-primary underline underline-offset-4">
          За пилота и защо е нужно Facebook приложение
        </Link>
      </div>
      <div className="grid overflow-hidden rounded-2xl border border-neutral-border bg-background md:grid-cols-5">
        <aside aria-labelledby="facebook-access-title" className="space-y-7 bg-neutral-light p-6 sm:p-8 md:col-span-2">
          <div className="flex size-12 items-center justify-center rounded-xl border border-neutral-border bg-background text-primary">
            <ShieldCheck size={25} aria-hidden="true" />
          </div>
          <h2 id="facebook-access-title" className="text-xl font-semibold">Какво е нужно от района</h2>
          <ul className="space-y-6 text-sm leading-6">
            <li>
              <p className="font-semibold">Достъп за четене</p>
              <p className="mt-1 text-foreground">Администраторът разрешава четене на публичните публикации в избраната страница.</p>
            </li>
            <li>
              <p className="font-semibold">Публикуване както досега</p>
              <p className="mt-1 text-foreground">В пилота ще използваме съществуващите публикации на страницата.</p>
            </li>
            <li>
              <p className="font-semibold">Начало след уговорка</p>
              <p className="mt-1 text-foreground">След свързването уточняваме с екипа на района обхвата и началото на пилота.</p>
            </li>
          </ul>
          <Link href="/connect/facebook/privacy" className="inline-block text-sm font-medium text-primary underline underline-offset-4">
            Как се използват данните
          </Link>
        </aside>
        <div id="facebook-connection" className="scroll-mt-6 p-6 sm:p-8 md:col-span-3 md:p-10">
          <ConnectionState view={view} />
        </div>
      </div>
    </section>
  );
}
