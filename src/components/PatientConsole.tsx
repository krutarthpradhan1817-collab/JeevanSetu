"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MapView from "@/components/MapView";
import { Alert, Badge, Card, EmptyState, KeyValue, ProgressSteps, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/useLive";
import { formatDistance, formatDuration, formatEta } from "@/lib/geo";
import { TrafficLegend } from "@/components/TrafficLegend";
import { networkToLines, type MapTrafficLine, type TrafficSegmentView } from "@/lib/trafficView";
import { routeLabelMarkers, routeLines } from "@/lib/routeStyle";
import { RouteOptionCards } from "@/components/RouteOptionCards";
import { useVehiclePose } from "@/lib/movingPoint";
import {
  EMERGENCY_CATEGORIES,
  SEVERITIES,
  categoryIcon,
  categoryLabel,
  disruptionIcon,
  disruptionLabel,
  statusLabel,
  STATUS_TONE,
} from "@/lib/domain";

type HospitalJson = {
  id: number;
  code: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  lat: number;
  lng: number;
  emergencyLevel: string;
  traumaLevel: string;
  facilities: string[];
  verified: boolean;
  status: string;
};

type CandidateJson = {
  hospitalId: number;
  code: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  emergencyLevel: string;
  traumaLevel: string;
  facilities: string[];
  verified: boolean;
  durationSeconds: number;
  distanceMeters: number;
  suitability: number;
  missing: string[];
  matched: string[];
  traffic: string;
  disruptions: { id: number; title: string; type: string; severity: string; roadName: string }[];
};

type PlanOptionJson = {
  label: string;
  key?: string;
  algorithm?: string;
  trafficMix?: { green: number; orange: number; red: number };
  overlapWithFastest?: number;
  nodesExpanded?: number;
  computeMs?: number;
  geometry: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  freeFlowSeconds: number;
  delaySeconds: number;
  traffic: string;
  roadNames: string[];
  disruptions: { id: number; title: string; type: string; severity: string; roadName: string }[];
};

type PlanJson = {
  provider?: string;
  options: PlanOptionJson[];
  fastest: PlanOptionJson | null;
  generatedAt: string;
  networkSize: { nodes: number; edges: number };
};

type DetailJson = {
  request: {
    id: number;
    publicId: string;
    status: string;
    category: string;
    severity: string;
    mode: string;
    patientName: string;
    patientPhone: string;
    pickupLat: number;
    pickupLng: number;
    pickupAddress: string;
    etaMinutes: number | null;
    distanceKm: number | null;
    createdAt: string;
    updatedAt: string;
    notes: string;
  };
  hospital: HospitalJson | null;
  preferredHospital: HospitalJson | null;
  ambulance: {
    id: number;
    code: string;
    type: string;
    status: string;
    lat: number;
    lng: number;
    facilities: string[];
  } | null;
  driver: { id: number; name: string; phone: string; licenseNo: string } | null;
  trip: { id: number; status: string; acceptedAt: string | null; arrivedPickupAt: string | null; pickedUpAt: string | null } | null;
  route: { id: number; mode: string; distanceMeters: number; durationSeconds: number; createdAt: string; geometry: [number, number][]; trafficSummary?: { key?: string; segments?: TrafficSegmentView[] } } | null;
  plan: PlanJson | null;
  ambulanceProgress?: number;
  routeDurationSeconds?: number | null;
  ambulanceUpdatedAt?: string | null;
  disruptions: {
    id: number;
    title: string;
    type: string;
    severity: string;
    status: string;
    lat: number;
    lng: number;
    confidence?: number;
    verification?: string;
    sourceName?: string | null;
  }[];
};

const STATUS_FLOW = ["assigned", "enroute_pickup", "arrived_pickup", "enroute_hospital", "arrived_hospital", "completed"];

export default function PatientConsole() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<{ lat: number; lng: number; label: string; source: string; approximate?: boolean }[]>([]);
  const [manualNote, setManualNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [hospitals, setHospitals] = useState<HospitalJson[]>([]);
  const [candidates, setCandidates] = useState<CandidateJson[]>([]);
  const [ranking, setRanking] = useState(false);
  const [form, setForm] = useState({
    patientName: "",
    patientPhone: "",
    category: "cardiac",
    severity: "serious",
    mode: "nearest" as "nearest" | "desired",
    preferredHospitalId: 0,
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailJson | null>(null);
  const [activePublicId, setActivePublicId] = useState<string | null>(null);
  const [dispatchNote, setDispatchNote] = useState<string | null>(null);
  const rankSeq = useRef(0);

  useEffect(() => {
    void api<{ hospitals: HospitalJson[] }>("/api/hospitals")
      .then((data) => setHospitals(data.hospitals))
      .catch(() => setHospitals([]));
  }, []);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocation is not available in this browser. Drop a pin on the map instead.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude };
        setCoords(next);
        setLocating(false);
        try {
          const geo = await api<{ shortAddress: string | null }>(
            `/api/geocode?lat=${next.lat}&lng=${next.lng}`,
          );
          setAddress(geo.shortAddress ?? `Dropped pin (${next.lat.toFixed(4)}, ${next.lng.toFixed(4)})`);
        } catch {
          setAddress(`Dropped pin (${next.lat.toFixed(4)}, ${next.lng.toFixed(4)})`);
        }
      },
      () => {
        setLocating(false);
        setGeoError("Location permission denied. Tap the map to drop the pickup pin manually.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  // Rank hospitals by road travel time + suitability whenever pickup/category changes.
  useEffect(() => {
    if (!coords || form.mode !== "nearest") {
      setCandidates([]);
      return;
    }
    const seq = ++rankSeq.current;
    setRanking(true);
    const timer = setTimeout(() => {
      void api<{ candidates: CandidateJson[] }>("/api/hospitals/rank", {
        method: "POST",
        body: JSON.stringify({ lat: coords.lat, lng: coords.lng, category: form.category }),
      })
        .then((data) => {
          if (seq === rankSeq.current) setCandidates(data.candidates);
        })
        .catch(() => {
          if (seq === rankSeq.current) setCandidates([]);
        })
        .finally(() => {
          if (seq === rankSeq.current) setRanking(false);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [coords, form.category, form.mode]);

  // Poll the request state while a request is active.
  useEffect(() => {
    if (!activePublicId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api<{ detail: DetailJson }>(`/api/requests/${activePublicId}`);
        if (!cancelled) setDetail(data.detail);
      } catch {
        /* keep previous state */
      }
    };
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activePublicId]);

  const findManualLocation = async () => {
    const text = manualQuery.trim();
    if (!text) {
      setManualNote("Type an address, landmark, area or coordinates first.");
      setManualResults([]);
      return;
    }
    setSearching(true);
    setManualNote(null);
    try {
      const data = await api<{ results: { lat: number; lng: number; label: string; source: string; approximate?: boolean }[]; note: string | null }>(
        `/api/geocode/search?q=${encodeURIComponent(text)}`,
      );
      setManualResults(data.results);
      setManualNote(data.note);
      // A single clear match (or typed coordinates) is used straight away.
      if (data.results.length === 1 && data.results[0].source === "coordinates") chooseManualPlace(data.results[0]);
    } catch (err) {
      setManualResults([]);
      setManualNote(err instanceof Error ? err.message : "The location could not be searched");
    } finally {
      setSearching(false);
    }
  };

  const chooseManualPlace = (place: { lat: number; lng: number; label: string; source?: string; approximate?: boolean }) => {
    setCoords({ lat: place.lat, lng: place.lng });
    const base = place.source === "coordinates" ? "Typed coordinates" : place.label;
    const label = place.approximate ? `${base} (approximate — move the pin to your building)` : base;
    setAddress(label.length > 140 ? `${label.slice(0, 140)}…` : label);
    setGeoError(null);
    setManualResults([]);
    setManualNote(null);
  };

  const submit = async () => {
    if (!coords) {
      setError("Pickup location is required — use GPS or drop a pin on the map.");
      return;
    }
    if (!form.patientName.trim() || !form.patientPhone.trim()) {
      setError("Patient name and contact number are required.");
      return;
    }
    if (form.mode === "desired" && !form.preferredHospitalId) {
      setError("Select the preferred hospital.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await api<{
        request: { publicId: string };
        ambulanceCandidates?: { status: string; code: string; roadDistanceMeters: number | null; roadDurationSeconds: number | null }[];
      }>("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          patientName: form.patientName,
          patientPhone: form.patientPhone,
          category: form.category,
          severity: form.severity,
          mode: form.mode,
          lat: coords.lat,
          lng: coords.lng,
          pickupAddress: address,
          preferredHospitalId: form.mode === "desired" ? form.preferredHospitalId : null,
          notes: form.notes,
        }),
      });
      const chosen = data.ambulanceCandidates?.find((c) => c.status === "selected");
      const rankedCount = data.ambulanceCandidates?.filter((c) => c.roadDurationSeconds !== null).length ?? 0;
      setDispatchNote(
        chosen
          ? `Closest ambulance by road: ${chosen.code} — ${formatDistance(chosen.roadDistanceMeters ?? 0)}, ${formatDuration(chosen.roadDurationSeconds ?? 0)} away. Chosen from ${rankedCount} ambulance(s) with a road route.`
          : null,
      );
      setActivePublicId(data.request.publicId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the emergency request");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setActivePublicId(null);
    setDetail(null);
    setForm((prev) => ({ ...prev, patientName: "", patientPhone: "", notes: "" }));
  };

  const activeGeometry = detail?.plan?.fastest?.geometry ?? detail?.route?.geometry ?? null;
  const vehiclePose = useVehiclePose(
    activeGeometry,
    detail?.ambulanceProgress ?? 0,
    detail?.routeDurationSeconds ?? null,
    detail?.ambulanceUpdatedAt ?? null,
  );

  const mapMarkers = useMemo(() => {
    const markers: {
      id: string;
      lat: number;
      lng: number;
      kind: "ambulance" | "patient" | "hospital" | "disruption" | "pin";
      label?: string;
      detail?: string;
    }[] = [];
    if (coords) {
      markers.push({
        id: "pickup",
        lat: coords.lat,
        lng: coords.lng,
        kind: "patient",
        label: "Patient pickup",
        detail: address || "Dropped pin",
      });
    }
    const hospital = detail?.hospital ?? null;
    if (hospital) {
      markers.push({
        id: "hospital",
        lat: hospital.lat,
        lng: hospital.lng,
        kind: "hospital",
        label: hospital.name,
        detail: `${hospital.emergencyLevel} · ${hospital.address}`,
      });
    }
    for (const disruption of detail?.disruptions ?? []) {
      markers.push({
        id: `disruption-${disruption.id}`,
        lat: disruption.lat,
        lng: disruption.lng,
        kind: "disruption",
        label: disruptionLabel(disruption.type),
        detail: `${disruption.title} (${disruption.severity})`,
      });
    }
    return markers;
  }, [coords, address, detail]);

  // Traffic heatmap of the route the ambulance is driving, plus the surrounding roads.
  const [patientTrafficOn, setPatientTrafficOn] = useState(true);
  const [patientNetTraffic, setPatientNetTraffic] = useState<MapTrafficLine[]>([]);
  const trafficPickupLat = detail?.request.pickupLat;
  const trafficPickupLng = detail?.request.pickupLng;
  useEffect(() => {
    if (!patientTrafficOn || trafficPickupLat === undefined || trafficPickupLng === undefined) return;
    let cancelled = false;
    const load = () =>
      api<{ edges: { level: "green" | "orange" | "red"; points: [number, number][] }[] }>(
        `/api/traffic?lat=${trafficPickupLat}&lng=${trafficPickupLng}&radius=2500`,
      )
        .then((traffic) => {
          if (!cancelled) setPatientNetTraffic(networkToLines(traffic.edges, "pt-net", 3, 0.45));
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [patientTrafficOn, trafficPickupLat, trafficPickupLng]);
  const patientTrafficLines = useMemo<MapTrafficLine[]>(() => {
    if (!patientTrafficOn) return [];
    return patientNetTraffic;
  }, [patientTrafficOn, patientNetTraffic, detail]);

  const patientSelectedKey = detail?.route?.trafficSummary?.key ?? "fastest";
  const mapPolylines = useMemo(
    () => routeLines(detail?.plan?.options ?? [], patientSelectedKey, detail?.route?.geometry ?? null),
    [detail, patientSelectedKey],
  );

  const mapCircles = useMemo(
    () =>
      (detail?.disruptions ?? []).map((disruption) => ({
        id: `circle-${disruption.id}`,
        lat: disruption.lat,
        lng: disruption.lng,
        radius: disruption.severity === "severe" ? 700 : 450,
        color: disruption.severity === "severe" ? "#ef4444" : "#f59e0b",
        label: `${disruptionIcon(disruption.type)} ${disruption.title}`,
      })),
    [detail],
  );

  const statusIndex = detail ? Math.max(0, STATUS_FLOW.indexOf(detail.request.status)) : 0;
  const fastest = detail?.plan?.fastest ?? null;


  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card className="card-pad">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-bold text-white">Emergency request</h1>
            <Badge tone="red">24×7</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Share the patient location and emergency type. JeevanSetu assigns the nearest feasible ambulance and keeps
            the route updated.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <span className="label">1 · Pickup location</span>
              <div className="flex gap-2">
                <button type="button" className="btn flex-1" onClick={locate} disabled={locating}>
                  {locating ? "Detecting…" : "📍 Use my GPS"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setCoords({ lat: 23.0225, lng: 72.5714 });
                    setAddress("Ahmedabad city centre (demo pin)");
                  }}
                >
                  Demo pin
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                {coords
                  ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}${address ? ` · ${address}` : ""}`
                  : "Or enter the location below, or tap anywhere on the map to drop the pickup pin."}
              </p>
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
                <label className="label" htmlFor="manual-location">
                  Or enter the location manually
                </label>
                <div className="flex gap-2">
                  <input
                    id="manual-location"
                    className="input"
                    value={manualQuery}
                    onChange={(event) => setManualQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void findManualLocation();
                      }
                    }}
                    placeholder="Building, society, landmark or area — e.g. Shreeji Complex Ahmedabad, or 23.02, 72.57"
                    autoComplete="off"
                  />
                  <button type="button" className="btn btn-sm whitespace-nowrap" onClick={() => void findManualLocation()} disabled={searching}>
                    {searching ? "Searching…" : "Find"}
                  </button>
                </div>
                {manualNote ? <p className="mt-1.5 text-[11px] text-amber-300">{manualNote}</p> : null}
                {manualResults.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Choose the right place</p>
                    {manualResults.map((place) => (
                      <button
                        key={`${place.lat},${place.lng}`}
                        type="button"
                        onClick={() => chooseManualPlace(place)}
                        className="w-full rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-left text-[11px] text-slate-200 transition hover:border-sky-500/60 hover:bg-sky-500/10"
                      >
                        <span className="block font-semibold">{place.label.length > 90 ? `${place.label.slice(0, 90)}…` : place.label}</span>
                        <span className={`text-[10px] ${place.approximate ? "text-amber-300" : "text-slate-500"}`}>
                          {place.lat.toFixed(5)}, {place.lng.toFixed(5)} ·{" "}
                          {place.approximate
                            ? "nearest known place"
                            : place.source === "openstreetmap" || place.source === "photon"
                              ? "OpenStreetMap"
                              : place.source === "gazetteer"
                                ? "Gujarat area list"
                                : "typed coordinates"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {geoError ? (
                <div className="mt-2">
                  <Alert tone="amber">{geoError}</Alert>
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="patientName">
                  Patient name
                </label>
                <input
                  id="patientName"
                  className="input"
                  value={form.patientName}
                  onChange={(event) => setForm((prev) => ({ ...prev, patientName: event.target.value }))}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="label" htmlFor="patientPhone">
                  Contact number
                </label>
                <input
                  id="patientPhone"
                  className="input"
                  value={form.patientPhone}
                  onChange={(event) => setForm((prev) => ({ ...prev, patientPhone: event.target.value }))}
                  placeholder="+91 …"
                />
              </div>
            </div>

            <div>
              <span className="label">2 · Emergency category</span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {EMERGENCY_CATEGORIES.map((category) => (
                  <button
                    key={category.value}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, category: category.value }))}
                    className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition ${
                      form.category === category.value
                        ? "border-red-500/70 bg-red-500/15 text-red-200"
                        : "border-slate-700 bg-slate-950/50 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <span className="mr-1">{category.icon}</span>
                    {category.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="label">Severity</span>
              <div className="flex gap-1.5">
                {SEVERITIES.map((severity) => (
                  <button
                    key={severity}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, severity }))}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
                      form.severity === severity
                        ? severity === "critical"
                          ? "border-red-500 bg-red-600/30 text-red-200"
                          : severity === "serious"
                            ? "border-amber-500 bg-amber-500/20 text-amber-200"
                            : "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                        : "border-slate-700 bg-slate-950/50 text-slate-400"
                    }`}
                  >
                    {severity}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="label">3 · Hospital selection</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, mode: "nearest" }))}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
                    form.mode === "nearest"
                      ? "border-sky-500/70 bg-sky-500/15 text-sky-200"
                      : "border-slate-700 bg-slate-950/50 text-slate-400"
                  }`}
                >
                  Nearest suitable
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, mode: "desired" }))}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
                    form.mode === "desired"
                      ? "border-sky-500/70 bg-sky-500/15 text-sky-200"
                      : "border-slate-700 bg-slate-950/50 text-slate-400"
                  }`}
                >
                  Desired hospital
                </button>
              </div>

              {form.mode === "nearest" ? (
                <div className="mt-2 space-y-1.5">
                  {ranking ? <Spinner label="Ranking hospitals by road travel time…" /> : null}
                  {!ranking && candidates.length === 0 ? (
                    <p className="text-[11px] text-slate-500">Set a pickup location to see ranked hospitals.</p>
                  ) : null}
                  {candidates.map((candidate, index) => (
                    <div
                      key={candidate.hospitalId}
                      className={`rounded-lg border px-2.5 py-2 ${
                        index === 0 ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-800 bg-slate-950/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-100">
                            {index === 0 ? "★ " : ""}
                            {candidate.name}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {formatDuration(candidate.durationSeconds)} · {formatDistance(candidate.distanceMeters)} ·{" "}
                            {candidate.emergencyLevel}
                          </p>
                        </div>
                        <Badge tone={candidate.suitability >= 80 ? "green" : candidate.suitability >= 55 ? "amber" : "red"}>
                          {candidate.suitability}% fit
                        </Badge>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Matched: {candidate.matched.join(", ") || "emergency care"}
                        {candidate.missing.length > 0 ? ` · Missing: ${candidate.missing.join(", ")}` : ""}
                      </p>
                      {candidate.disruptions.length > 0 ? (
                        <p className="mt-1 text-[10px] text-amber-300">
                          ⚠ {candidate.disruptions.length} disruption(s) on this route
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2">
                  <select
                    className="input"
                    value={form.preferredHospitalId}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, preferredHospitalId: Number(event.target.value) }))
                    }
                  >
                    <option value={0}>Select a registered hospital…</option>
                    {hospitals
                      .filter((hospital) => hospital.status === "active")
                      .map((hospital) => (
                        <option key={hospital.id} value={hospital.id}>
                          {hospital.name} — {hospital.city} ({hospital.emergencyLevel})
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-500">
                    The route to your chosen hospital is still computed on the live road network with disruptions.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="label" htmlFor="notes">
                Notes for the crew (optional)
              </label>
              <textarea
                id="notes"
                className="input min-h-[60px]"
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Landmark, gate number, patient condition…"
              />
            </div>

            {error ? <Alert tone="red">{error}</Alert> : null}

            <button type="button" className="btn btn-primary w-full py-2.5" onClick={submit} disabled={submitting}>
              {submitting ? "Dispatching…" : "🚨 Dispatch ambulance now"}
            </button>
            <p className="text-[10px] leading-relaxed text-slate-500">
              Demonstration system. In a real emergency call 108. Hospital capabilities shown are registered demo
            values, not live bed availability.
          </p>
          </div>
        </Card>

        {detail ? (
          <Card className="card-pad">
            <SectionTitle
              title={`Request ${detail.request.publicId}`}
              subtitle={`Raised ${new Date(detail.request.createdAt).toLocaleTimeString()}`}
              right={<Badge tone={STATUS_TONE[detail.request.status] ?? "slate"}>{statusLabel(detail.request.status)}</Badge>}
            />
            <ProgressSteps
              steps={["Assigned", "To pickup", "Pickup", "To hospital", "At hospital", "Completed"]}
              current={statusIndex}
            />
            {dispatchNote ? <Alert tone="green">{dispatchNote}</Alert> : null}
            <div className="mt-3">
              <KeyValue label="Category" value={`${categoryIcon(detail.request.category)} ${categoryLabel(detail.request.category)}`} />
              <KeyValue label="Severity" value={detail.request.severity.toUpperCase()} />
              <KeyValue label="Mode" value={detail.request.mode === "nearest" ? "Nearest suitable hospital" : "Desired hospital"} />
              <KeyValue label="Destination" value={detail.hospital?.name ?? "—"} />
              <KeyValue
                label="Ambulance"
                value={detail.ambulance ? `${detail.ambulance.code} (${detail.ambulance.type})` : "Finding nearest…"}
              />
              <KeyValue label="Driver" value={detail.driver ? `${detail.driver.name} · ${detail.driver.phone}` : "—"} />
              <KeyValue label="ETA" value={formatEta(detail.request.etaMinutes)} />
              <KeyValue label="Road distance" value={detail.request.distanceKm ? `${detail.request.distanceKm} km` : "—"} />
              <KeyValue
                label="Route updated"
                value={detail.route ? new Date(detail.route.createdAt).toLocaleTimeString() : "—"}
              />
            </div>
            {fastest ? (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">{fastest.label}</span>
                  <Badge tone={fastest.traffic === "low" ? "green" : fastest.traffic === "moderate" ? "amber" : "red"}>
                    {fastest.traffic} traffic
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {formatDistance(fastest.distanceMeters)} · {formatDuration(fastest.durationSeconds)} ·{" "}
                  {fastest.delaySeconds > 0 ? `+${formatDuration(fastest.delaySeconds)} delay` : "free flowing"}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">Via {fastest.roadNames.slice(0, 4).join(" · ")}</p>
                {detail.plan && detail.plan.options.length > 0 ? (
                  <div className="mt-2">
                    <RouteOptionCards options={detail.plan.options} selectedKey={patientSelectedKey} provider={detail.plan.provider} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {detail.disruptions.length > 0 ? (
              <div className="mt-3">
                <Alert tone="amber">
                  {detail.disruptions.length} active disruption(s) in the coverage area. Routes are recalculated
                  automatically when they affect your journey. Each event shows its source, confidence and
                  verification status — unverified reports never create confirmed closures.
                </Alert>
              </div>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Link href={`/track/${detail.request.publicId}`} className="btn btn-sm flex-1">
                Open live tracking
              </Link>
              <button type="button" className="btn btn-sm" onClick={reset}>
                New request
              </button>
            </div>
          </Card>
        ) : null}
      </div>

      <div className="space-y-4">
        <Card className="card-pad">
          <SectionTitle
            title="Live map"
            subtitle="Actual road-following geometry returned by the routing engine"
            right={
              detail?.ambulance ? (
                <Badge tone="green">Ambulance {detail.ambulance.code}</Badge>
              ) : (
                <Badge tone="slate">Awaiting dispatch</Badge>
              )
            }
          />
          <MapView
            vehicle={
              detail?.ambulance && activeGeometry
                ? {
                    geometry: activeGeometry,
                    progress: detail.ambulanceProgress ?? 0,
                    durationSeconds: detail.routeDurationSeconds ?? null,
                    updatedAt: detail.ambulanceUpdatedAt ?? null,
                    label: detail.ambulance.code,
                    detail: `${detail.ambulance.type} · ${Math.round(vehiclePose?.speedKph ?? 0)} km/h · ${Math.round(
                      (vehiclePose?.progress ?? 0) * 100,
                    )}% of route`,
                  }
                : null
            }
            followVehicle={Boolean(detail?.ambulance)}
            center={coords ? [coords.lat, coords.lng] : [23.0225, 72.5714]}
            zoom={coords ? 13 : 9}
            markers={[...mapMarkers, ...routeLabelMarkers(detail?.plan?.options ?? [], patientSelectedKey)]}
            polylines={mapPolylines}
            trafficLines={patientTrafficLines}
            circles={mapCircles}
            fitKey={mapPolylines.length > 0 ? "route" : undefined}
            flyTo={coords ? [coords.lat, coords.lng] : null}
            onMapClick={(lat, lng) => {
              setCoords({ lat, lng });
              setAddress(`Dropped pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
            }}
            className="h-[360px] sm:h-[460px]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <TrafficLegend compact />
            <button type="button" className="btn btn-sm" onClick={() => setPatientTrafficOn((value) => !value)}>
              Traffic {patientTrafficOn ? "on" : "off"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded bg-red-500" /> Active route
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded bg-sky-400" /> Alternative
            </span>
            <span className="flex items-center gap-1">🚑 Ambulance</span>
            <span className="flex items-center gap-1">🏥 Hospital</span>
            <span className="flex items-center gap-1">⚠️ Disruption</span>
          </div>
        </Card>

        {detail ? (
          <Card className="card-pad">
            <SectionTitle title="Assigned ambulance" subtitle="Live position and status" />
            {detail.ambulance ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-lg font-bold text-white">{detail.ambulance.code}</p>
                  <p className="text-xs text-slate-400">
                    {detail.ambulance.type} ambulance · {detail.ambulance.status.replace("_", " ")}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {vehiclePose
                      ? `${vehiclePose.position.lat.toFixed(5)}, ${vehiclePose.position.lng.toFixed(5)}`
                      : `${detail.ambulance.lat.toFixed(5)}, ${detail.ambulance.lng.toFixed(5)}`}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-emerald-300">
                    Moving on the fastest route
                    {vehiclePose
                      ? ` · ${Math.round(vehiclePose.speedKph)} km/h · ${formatDistance(vehiclePose.remainingMeters)} to go`
                      : " · live position refreshed every 4s"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-xs font-semibold text-slate-200">{detail.driver?.name ?? "Driver not linked"}</p>
                  <p className="text-[11px] text-slate-400">{detail.driver?.phone ?? "—"}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Licence {detail.driver?.licenseNo || "—"}</p>
                </div>
              </div>
            ) : (
              <EmptyState title="No ambulance assigned yet" hint="The dispatch engine is scanning available units." />
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Pickup</p>
                <p className="text-xs text-slate-200">{detail.request.pickupAddress || "GPS location"}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Hospital</p>
                <p className="text-xs text-slate-200">{detail.hospital?.name ?? "—"}</p>
                <p className="text-[10px] text-slate-500">{detail.hospital?.address}</p>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
