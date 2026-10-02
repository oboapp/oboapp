import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { articleTitleKey, articleUrlKey, extractListingPage, extractPostDetails } from "./extractors";

// Structure captured from /bg/repairs-and-traffic-changes on 2026-10-02.
const fixture = `<main id="main-content">
  <a href="/bg/web/guest/w/7983928"><img src="/image/journal/article"></a>
  <a href="/bg/web/guest/w/7983928?tracking=1#body">
    <small><span class="date">02.10.2026</span></small>
    <div class="news-title"><p>Организация на движението за провеждане на „Маратон София '2026"</p></div>
    <div class="desc">Article summary</div>
  </a>
  <a href="https://evil.example/w/1"><span class="date">02.10.2026</span><div class="news-title">External</div></a>
  <a href="/w/invalid"><span class="date">31.02.2026</span><div class="news-title">Invalid date</div></a>
  <a href="/w/missing"><div class="news-title">Missing date</div></a>
  <a title="Следваща страница" href="/bg/web/guest/repairs-and-traffic-changes?instance_cur=2">Next</a>
</main>`;

function domPage(): Page {
  return { evaluate: vi.fn(async (fn, arg) => fn(arg)) } as unknown as Page;
}

describe("Sofia live listing layout", () => {
  beforeEach(() => { document.body.innerHTML = fixture; });

  it("extracts the article text, full publication date and pagination without image duplicates", async () => {
    const result = await extractListingPage(domPage());
    expect(result.posts).toEqual([{
      url: "https://www.sofia.bg/bg/web/guest/w/7983928",
      title: `Организация на движението за провеждане на „Маратон София '2026"`,
      date: "2026-10-02T00:00:00.000Z",
    }]);
    expect(result.nextUrl).toBe("https://www.sofia.bg/bg/web/guest/repairs-and-traffic-changes?instance_cur=2");
  });

  it("does not follow an external pagination link", async () => {
    document.querySelector("a[title]")?.setAttribute("href", "https://evil.example/repairs-and-traffic-changes");
    expect((await extractListingPage(domPage())).nextUrl).toBeNull();
  });

  it("supports news listing pagination for the RSS fallback", async () => {
    document.querySelector("a[title]")?.setAttribute("href", "/bg/web/guest/news?cur=2");
    expect((await extractListingPage(domPage(), "https://www.sofia.bg/bg/news")).nextUrl)
      .toBe("https://www.sofia.bg/bg/web/guest/news?cur=2");
  });

  it("matches locale and guest aliases of legacy URLs and normalizes title whitespace", () => {
    expect(articleUrlKey("https://www.sofia.bg/bg/web/guest/w/7983928?x=1"))
      .toBe(articleUrlKey("https://www.sofia.bg/w/7983928"));
    expect(articleTitleKey(" Ремонт\u00a0на\n улица ")).toBe("Ремонт на улица");
  });

  it("extracts the current /w/ article layout and removes unwanted content", async () => {
    document.body.innerHTML = `<main id="main-content">
      <div class="component-paragraph text-break">Маратон София</div>
      <div class="component-paragraph text-break"><p>Маршрутът по булеварда</p><script>tracking()</script></div>
    </main><footer><div class="component-paragraph text-break">Footer</div></footer>`;
    const result = await extractPostDetails(domPage());
    expect(result.title).toBe("Маратон София");
    expect(result.contentHtml).toBe("<p>Маршрутът по булеварда</p>");
  });
});
