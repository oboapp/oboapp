import BuyMeACoffeeButton from "@/components/BuyMeACoffeeButton";
import { APP_NAME } from "@/lib/pwa-metadata";
import Link from "next/link";

export default function OboAppOnlineSection() {
  return (
    <section
      aria-labelledby="oboapp-online-heading"
      className="bg-white rounded-lg shadow-md p-6 md:p-8 border border-neutral-border"
    >
      <h2
        id="oboapp-online-heading"
        className="text-2xl font-bold text-foreground mb-6"
      >
        {APP_NAME}
      </h2>
      <p className="my-4 text-sm text-neutral">
        Можеш да помогнеш за поддръжката на {APP_NAME}:
      </p>
      <BuyMeACoffeeButton />
      <p className="my-4 text-sm text-neutral">
        А, ако ти е любопитно колко струва месечно и за какво се харчат парите,
        можеш да видиш отчета на страницата{" "}
        <Link
          className="text-link hover:text-link-hover hover:underline"
          href="/author"
        >
          За автора и разходите
        </Link>
        .
      </p>
    </section>
  );
}
