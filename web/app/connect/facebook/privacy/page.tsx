import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getButtonClasses } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Данни при свързване с Facebook | Обо",
  description: "Информация за достъпа и данните при свързване на Facebook страница с Обо.",
  robots: { index: false, follow: false },
};

export default function FacebookConnectionPrivacyPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <Link href="/connect/facebook" className={getButtonClasses("link", "sm", "sm", "mb-8 inline-flex items-center gap-2 px-0")}>
        <ArrowLeft size={16} aria-hidden="true" />
        Обратно към свързването
      </Link>
      <div className="mb-8 space-y-4 border-b border-neutral-border pb-8">
        <ShieldCheck className="text-primary" size={32} aria-hidden="true" />
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Данни при свързване с Facebook</h1>
        <p className="text-lg leading-8 text-neutral">
          Връзката подготвя избраната Facebook страница за бъдещ пилот с Обо.
          Началото на събирането на публикации се потвърждава отделно.
        </p>
      </div>
      <div className="space-y-8 leading-7">
        <section aria-labelledby="facebook-privacy-data" className="space-y-3">
          <h2 id="facebook-privacy-data" className="text-xl font-semibold">Какви данни се запазват</h2>
          <p>
            При свързването се получават имената и идентификаторите на
            страниците, за които разрешиш достъп. След избора се запазват
            идентификаторът и името на избраната страница, статусът на
            връзката и моментът на свързване. Това позволява на екипа да
            подготви участието ѝ в пилота.
          </p>
          <p>
            Facebook издава код за достъп до страницата. Обо го съхранява
            защитено за разрешените операции. Кодът се обработва на сървъра.
          </p>
          <p>
            Идентификаторът на профила, който даде разрешението, се пази като
            защитена хеш стойност. Тя позволява връзката да бъде намерена
            при оттегляне на достъпа или изтриване на данни.
          </p>
        </section>
        <section aria-labelledby="facebook-privacy-retention" className="space-y-3">
          <h2 id="facebook-privacy-retention" className="text-xl font-semibold">Срок на съхранение</h2>
          <p>
            Временната сесия за свързване е валидна 15 минути.
            Данните за запазената връзка се съхраняват до успешно
            завършване на оттеглянето на достъпа или изтриването.
          </p>
          <p>
            При оттегляне се създава временен запис със защитената хеш
            стойност и срок 30 минути. Той предотвратява запазването на
            връзка от по-стара сесия и след изтичането си подлежи на
            автоматично изчистване.
          </p>
        </section>
        <section aria-labelledby="facebook-privacy-pilot" className="space-y-3">
          <h2 id="facebook-privacy-pilot" className="text-xl font-semibold">Публични съобщения и бъдещ пилот</h2>
          <p>
            При отделно потвърден пилот публичните съобщения може да бъдат
            обработвани с изкуствен интелект за разпознаване на темата,
            местоположението и датите на събитието. Преди началото се
            уточняват обхватът, условията за обработване и сроковете за
            съхранение на публикациите.
          </p>
        </section>
        <section aria-labelledby="facebook-privacy-revoke" className="space-y-3">
          <h2 id="facebook-privacy-revoke" className="text-xl font-semibold">Оттегляне на достъпа и изтриване</h2>
          <p>
            Можеш да премахнеш Обо от{" "}
            <a href="https://www.facebook.com/settings?tab=business_tools" className="text-primary underline underline-offset-4">
              бизнес интеграциите във Facebook
            </a>
            . Facebook може да изпрати към Обо искане за оттегляне на
            достъпа или изтриване на данните. Тогава кодът за достъп и
            данните за съответната връзка се изтриват. След заявка за
            изтриване се запазват случаен код за потвърждение и моментът
            на изпълнение.
          </p>
          <p>
            Ако изтриването временно не успее, данните, нужни за
            довършването му, се пазят до успешно приключване.
            Потвърждение се издава след завършване на изтриването.
          </p>
        </section>
        <section aria-labelledby="facebook-privacy-contact" className="space-y-3">
          <h2 id="facebook-privacy-contact" className="text-xl font-semibold">Въпроси за връзката</h2>
          <p>
            Обърни се към човека, който ти изпрати линка за свързване.
            Технически въпроси могат да се обсъдят и в{" "}
            <a href="https://github.com/oboapp/oboapp" className="text-primary underline underline-offset-4">
              GitHub проекта на Обо
            </a>
            . Пази кодовете за достъп извън съобщения и публични дискусии.
          </p>
        </section>
      </div>
    </article>
  );
}
