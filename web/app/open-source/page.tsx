import { Metadata } from "next";
import Link from "next/link";
import LicenceSection from "./LicenceSection";
import ContributorsSection from "./ContributorsSection";
import DepsSection from "./DepsSection";
import OpenDataSection from "./OpenDataSection";
import AISection from "./AISection";
import SponsorsSection from "./SponsorsSection";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "OboApp е отворен | OboApp",
  description:
    "OboApp е отворен код. Вижте лиценза, библиотеките, на които се крепи, и хората, които го изграждат.",
};

interface GitHubContributor {
  login: string;
  avatar_url: string;
  html_url: string;
  type: string;
}

async function getContributors(): Promise<GitHubContributor[]> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/vbuch/oboapp/contributors?per_page=100",
      {
        headers: { Accept: "application/vnd.github+json" },
        next: { revalidate: 86400 },
      },
    );
    if (!res.ok) return [];
    const data: GitHubContributor[] = await res.json();
    return data.filter((c) => c.type !== "Bot");
  } catch {
    return [];
  }
}

export default async function OpenSourcePage() {
  const contributors = await getContributors();

  return (
    <main className="min-h-screen bg-neutral-light">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-6">
          <Link
            href="/"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span aria-hidden="true">←</span>
            <span>Начало</span>
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-foreground mb-8">
          OboApp е отворен
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8 items-start">
          <div className="space-y-8">
            <LicenceSection />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              <ContributorsSection contributors={contributors} />
              <SponsorsSection />
              <AISection />
            </div>
          </div>
          <div className="space-y-8">
            <DepsSection />
            <OpenDataSection />
          </div>
        </div>
      </div>
    </main>
  );
}
