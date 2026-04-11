import { Metadata } from "next";
import NotFoundLayout from "@/components/NotFoundLayout";
import { APP_NAME } from "@/lib/pwa-metadata";

export const metadata: Metadata = {
  title: `Страницата не е намерена - ${APP_NAME}`,
  description: "Страницата, която търсите, не съществува.",
};

export default function NotFound() {
  return (
    <NotFoundLayout
      title="Страницата не е намерена"
      description="Страницата, която търсите, не съществува или е била преместена."
      actions={[{ href: "/", label: "Начало" }]}
    />
  );
}
