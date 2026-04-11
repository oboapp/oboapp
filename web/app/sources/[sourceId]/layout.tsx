import { Metadata } from "next";
import sourcesData from "@/lib/sources";
import { APP_NAME } from "@/lib/pwa-metadata";

interface Props {
  children: React.ReactNode;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}): Promise<Metadata> {
  const { sourceId } = await params;
  const source = sourcesData.find((s) => s.id === sourceId);

  if (!source) {
    return {
      title: `Източник не е намерен - ${APP_NAME}`,
    };
  }

  const logoUrl = `/sources/${source.id}.png`;

  return {
    title: `${source.name} - ${APP_NAME}`,
    description: `Последни съобщения от ${source.name}`,
    openGraph: {
      title: `${source.name} - ${APP_NAME}`,
      description: `Последни съобщения от ${source.name}`,
      url: `/sources/${source.id}`,
      siteName: APP_NAME,
      images: [
        {
          url: logoUrl,
          width: 200,
          height: 200,
          alt: source.name,
        },
      ],
      locale: "bg_BG",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${source.name} - ${APP_NAME}`,
      description: `Последни съобщения от ${source.name}`,
      images: [{ url: logoUrl }],
    },
  };
}

export default function SourceLayout({ children }: Props) {
  return <>{children}</>;
}
