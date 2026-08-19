import { NextResponse } from "next/server";

type CloudflareGroup = {
  count?: number;
  sum?: { edgeResponseBytes?: number };
  dimensions?: { datetimeMinute?: string; clientRequestPath?: string };
};

const query = `query DstatAnalytics($zoneTag: string!, $filter: filter!, $pathFilter: filter!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      series: httpRequestsAdaptiveGroups(limit: 60, filter: $filter, orderBy: [datetimeMinute_ASC]) {
        count
        sum { edgeResponseBytes }
        dimensions { datetimeMinute }
      }
      topPaths: httpRequestsAdaptiveGroups(limit: 5, filter: $pathFilter, orderBy: [sum_edgeResponseBytes_DESC]) {
        count
        sum { edgeResponseBytes }
        dimensions { clientRequestPath }
      }
    }
  }
}`;

export async function GET() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneTag = process.env.CLOUDFLARE_ZONE_ID;
  const hostname = process.env.CLOUDFLARE_HOSTNAME;

  if (!token || !zoneTag || !hostname) {
    return NextResponse.json({ configured: false, error: "Cloudflare Analytics is not configured." }, { status: 503 });
  }

  const end = new Date();
  const start = new Date(end.getTime() - 5 * 60 * 1000);
  const filter = {
    datetime_geq: start.toISOString(),
    datetime_lt: end.toISOString(),
    clientRequestHTTPHost: hostname,
    requestSource: "eyeball",
  };

  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { zoneTag, filter, pathFilter: filter } }),
      cache: "no-store",
    });
    const payload = await response.json() as { data?: { viewer?: { zones?: Array<{ series?: CloudflareGroup[]; topPaths?: CloudflareGroup[] }> } }; errors?: Array<{ message?: string }> };
    if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message ?? "Cloudflare Analytics request failed");

    const zone = payload.data?.viewer?.zones?.[0];
    const series = (zone?.series ?? []).map((group) => ({
      time: group.dimensions?.datetimeMinute ?? new Date().toISOString(),
      requests: group.count ?? 0,
      bytes: group.sum?.edgeResponseBytes ?? 0,
    }));
    const totalRequests = series.reduce((sum, point) => sum + point.requests, 0);
    const totalBytes = series.reduce((sum, point) => sum + point.bytes, 0);
    const seconds = Math.max((end.getTime() - start.getTime()) / 1000, 1);
    const current = { throughput: (totalBytes * 8) / seconds / 1e9, rpm: totalRequests / (seconds / 60), packets: 0, latency: 0 };
    const topPaths = (zone?.topPaths ?? []).map((group) => ({
      method: "HTTP", path: group.dimensions?.clientRequestPath ?? "/", requests: `${((group.count ?? 0) / 1000).toFixed(1)}k`, latency: "—", status: "—",
    }));
    return NextResponse.json({ configured: true, current, series: series.map((point) => ({ time: point.time.slice(11, 16), value: (point.bytes * 8) / 60 / 1e9 })), topPaths, source: hostname, refreshedAt: end.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ configured: true, error: error instanceof Error ? error.message : "Cloudflare Analytics request failed" }, { status: 502 });
  }
}
