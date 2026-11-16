import { ok, route } from "@/lib/api";
import { searchLocation } from "@/lib/locationSearch";

export const dynamic = "force-dynamic";

/** Manual pickup search: a building, society, landmark, area or "lat, lng". Returns the outcome and what matched. */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const outcome = await searchLocation(q);
  return ok({ query: q, ...outcome });
});
