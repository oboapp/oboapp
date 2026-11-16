import { cookies } from "next/headers";
import { FACEBOOK_SESSION_COOKIE } from "@/lib/facebook-connect/config";
import {
  facebookRedirect,
  readFacebookForm,
  requireFacebookSameOrigin,
} from "@/lib/facebook-connect/http";
import {
  getFacebookConnectionContext,
  selectFacebookPage,
} from "@/lib/facebook-connect/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getFacebookConnectionContext();
    requireFacebookSameOrigin(request, context.config);
    const form = await readFacebookForm(request);
    const cookieStore = await cookies();
    await selectFacebookPage(context, cookieStore.get(FACEBOOK_SESSION_COOKIE)?.value, {
      pageId: form.get("pageId") || "",
      csrf: form.get("csrf") || "",
    });
    return facebookRedirect(request);
  } catch (error) {
    return facebookRedirect(request, { error });
  }
}
