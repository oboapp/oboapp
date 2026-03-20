import { Metadata } from "next";
import { SourceConfig } from "@/lib/types";
import sourcesData from "@/lib/sources.json";

interface Props {
  children: React.ReactNode;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}): Promise<Metadata> {
  const { sourceId } = await params;
  const typedSourcesData: SourceConfig[] = sourcesData;
  const source = typedSourcesData.find((s) => s.id === sourceId);

  if (!source) {
    return {
      title: "Източник не е намерен - OboApp",
    };
  }

  const baseUrl = "https://oboapp.online";
  const logoUrl = `${baseUrl}/sources/${source.id}.png`;

  return {
    title: `${source.name} - OboApp`,
    description: `Последни съобщения от ${source.name}`,
    openGraph: {
      title: `${source.name} - OboApp`,
      description: `Последни съобщения от ${source.name}`,
      url: `${baseUrl}/sources/${source.id}`,
      siteName: "OboApp",
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
      title: `${source.name} - OboApp`,
      description: `Последни съобщения от ${source.name}`,
      images: [logoUrl],
    },
  };
}

export default function SourceLayout({ children }: Props) {
  return <>{children}</>;
}
