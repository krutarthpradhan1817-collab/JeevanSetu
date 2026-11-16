import { ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Thin server-side proxy for reverse geocoding (keeps the browser off third-party rate limits). */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return ok({ displayName: null });
  }
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { "User-Agent": "JeevanSetu-Emergency-Routing/1.0 (demo application)", Accept: "application/json" } },
    );
    if (!response.ok) return ok({ displayName: null });
    const data = (await response.json()) as { display_name?: string; address?: Record<string, string> };
    const address = data.address ?? {};
    const parts = [
      address.road ?? address.pedestrian ?? address.neighbourhood,
      address.suburb ?? address.village ?? address.town ?? address.city,
      address.city_district ?? address.district,
      address.state,
    ].filter(Boolean);
    return ok({
      displayName: data.display_name ?? null,
      shortAddress: parts.length > 0 ? parts.join(", ") : data.display_name ?? null,
    });
  } catch {
    return ok({ displayName: null, shortAddress: null });
  }
});
