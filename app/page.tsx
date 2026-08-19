"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";

type Metric = "bandwidth" | "requests" | "data";
type Point = { time: string; bandwidth: number; requests: number; bytes: number };
type Route = { path: string; requests: string };
type Status = "connecting" | "live" | "offline";

const refreshSeconds = 1;
const emptySeries: Point[] = Array.from({ length: 12 }, (_, index) => ({ time: `-${(11 - index) * 30}s`, bandwidth: 0, requests: 0, bytes: 0 }));
const metricInfo: Record<Metric, { label: string; description: string; color: string }> = {
  bandwidth: { label: "Bandwidth", description: "Edge response throughput", color: "#9ebcff" },
  requests: { label: "Requests", description: "Requests per minute", color: "#f1b969" },
  data: { label: "Data volume", description: "Edge response bytes", color: "#b996f5" },
};

function compact(value: number, fractionDigits = 1) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: fractionDigits }).format(value);
}

function formatBandwidth(value: number) {
  if (value >= 1) return `${value.toFixed(2)} Gb/s`;
  if (value > 0) return `${(value * 1000).toFixed(1)} Mb/s`;
  return "0.00 Gb/s";
}

function metricValues(points: Point[], metric: Metric) {
  if (metric === "bandwidth") {
    const mb = Math.max(...points.map((point) => point.bandwidth), 0) < 1;
    return { values: points.map((point) => mb ? point.bandwidth * 1000 : point.bandwidth), unit: mb ? "Mb/s" : "Gb/s" };
  }
  if (metric === "requests") return { values: points.map((point) => point.requests), unit: "RPM" };
  return { values: points.map((point) => point.bytes / 1024 / 1024), unit: "MiB" };
}

function roundAxis(value: number) {
  if (value <= 0) return 1;
  const scale = 10 ** Math.floor(Math.log10(value));
  const ratio = value / scale;
  return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * scale;
}

function displayAxis(value: number, unit: string) {
  if (unit === "RPM") return `${compact(value)} RPM`;
  if (unit === "MiB") return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MiB`;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function LiveChart({ metric, points }: { metric: Metric; points: Point[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const safePoints = points.length > 1 ? points : emptySeries;
  const { values, unit } = metricValues(safePoints, metric);
  const max = roundAxis(Math.max(...values, 0) * 1.12);
  const coords = values.map((value, index) => {
    const x = 3 + (index / Math.max(values.length - 1, 1)) * 94;
    const y = 92 - Math.min(value / max, 1) * 79;
    return { x, y };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `3,96 ${line} 97,96`;
  const axisLabels = [1, .75, .5, .25, 0].map((ratio) => displayAxis(max * ratio, unit));
  const xIndexes = [0, Math.floor((safePoints.length - 1) * .25), Math.floor((safePoints.length - 1) * .5), Math.floor((safePoints.length - 1) * .75), safePoints.length - 1];
  const hoverX = hoverIndex === null ? null : coords[hoverIndex].x;
  const hoverPoint = hoverIndex === null ? null : coords[hoverIndex];
  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setHoverIndex(Math.min(coords.length - 1, Math.max(0, Math.round(ratio * (coords.length - 1)))));
  };

  return <div className="plot-wrap">
    <div className="plot-y-axis" aria-hidden="true">{axisLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
    <svg className="plot" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${metricInfo[metric].label} live chart`} onMouseMove={onMove} onMouseLeave={() => setHoverIndex(null)}>
      {[13, 33, 52.5, 72, 92].map((y) => <line key={y} x1="3" x2="97" y1={y} y2={y} className="plot-grid" />)}
      <polygon points={area} className="plot-area" />
      <polyline points={line} className="plot-line" style={{ stroke: metricInfo[metric].color }} />
      {hoverX !== null && hoverPoint && <><line x1={hoverX} x2={hoverX} y1="13" y2="92" className="plot-guide" /><circle cx={hoverPoint.x} cy={hoverPoint.y} r="1.8" className="plot-hover-point" style={{ fill: metricInfo[metric].color }} /></>}
      <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="1.35" className="plot-last-point" style={{ fill: metricInfo[metric].color }} />
    </svg>
    {hoverIndex !== null && <div className="plot-tooltip" style={{ left: `${Math.min(Math.max(coords[hoverIndex].x, 12), 88)}%` }}><span>{safePoints[hoverIndex].time}</span><strong>{displayAxis(values[hoverIndex], unit)}</strong></div>}
    <div className="plot-x-axis" aria-hidden="true">{xIndexes.map((index, position) => <span key={`${index}-${position}`}>{position === xIndexes.length - 1 ? "NOW" : safePoints[index].time}</span>)}</div>
  </div>;
}

function StatusDot({ status }: { status: Status }) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />;
}

export default function Home() {
  const [activeMetric, setActiveMetric] = useState<Metric>("bandwidth");
  const [points, setPoints] = useState<Point[]>(emptySeries);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [current, setCurrent] = useState({ bandwidth: 0, rpm: 0 });

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let lastSignature = "";
    const poll = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      setIsRefreshing(true);
      try {
        const response = await fetch(`/api/cloudflare/analytics?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();
        if (disposed) return;
        if (!response.ok) throw new Error(data.error ?? "Cloudflare Analytics unavailable");
        const nextPoints = data.series?.length ? data.series : emptySeries;
        const signature = JSON.stringify({ refreshedAt: data.refreshedAt, current: data.current, series: nextPoints, routes: data.topPaths });
        if (signature !== lastSignature) {
          lastSignature = signature;
          setPoints(nextPoints);
          setRoutes(data.topPaths ?? []);
          setCurrent({ bandwidth: data.current?.throughput ?? 0, rpm: data.current?.rpm ?? 0 });
          setLastUpdated(data.refreshedAt ?? new Date().toISOString());
        }
        setStatus("live");
      } catch {
        if (!disposed) setStatus("offline");
      } finally {
        inFlight = false;
        if (!disposed) setIsRefreshing(false);
      }
    };
    poll();
    const interval = window.setInterval(poll, refreshSeconds * 1000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [refreshKey]);

  const selectedMetric = metricInfo[activeMetric];
  const totalBytes = useMemo(() => points.reduce((total, point) => total + point.bytes, 0), [points]);
  const selectedValue = activeMetric === "bandwidth" ? formatBandwidth(current.bandwidth) : activeMetric === "requests" ? `${compact(current.rpm)} RPM` : `${(totalBytes / 1024 / 1024).toFixed(1)} MiB`;
  const updatedLabel = lastUpdated ? new Date(lastUpdated).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return <main className="app-shell">
    <aside className="sidebar"><a href="#top" className="brand"><span className="brand-glyph">d</span><span className="brand-name">dstat</span><span className="brand-tag">EDGE</span></a><div className="account-switcher"><span className="account-mark">D</span><div><strong>Personal workspace</strong><small>Cloudflare monitor</small></div><span className="account-chevron">⌄</span></div><nav className="side-nav"><a href="#top" className="nav-link active"><span>⌂</span>Overview</a><a href="#graph" className="nav-link"><span>◒</span>Live graph</a><a href="#routes" className="nav-link"><span>≋</span>Top routes</a><div className="nav-caption">MONITORING</div><a href="#graph" className="nav-link"><span>◈</span>Layer 7 <em>HTTP</em></a><a href="#graph" className="nav-link"><span>◇</span>Layer 4 <em>SOON</em></a></nav><div className="side-footer"><div className="side-connection"><StatusDot status={status} /><span>{status === "live" ? "Cloudflare connected" : status === "offline" ? "Connection error" : "Connecting"}</span></div><small>Read-only telemetry</small></div></aside>
    <section className="main" id="top"><header className="topbar"><div className="crumbs"><span>dstat</span><b>/</b><strong>Overview</strong></div><div className="topbar-right"><div className="top-status"><StatusDot status={status} />{isRefreshing ? "Updating" : "Live monitor"}</div><span className="top-divider" /><span className="top-host">dstat.kdns.fr</span><button className="refresh-button" type="button" onClick={() => setRefreshKey((key) => key + 1)} aria-label="立即重新整理">↻</button><span className="user-avatar">D</span></div></header>
      <section className="intro"><div><p className="eyebrow">REAL-TIME EDGE TELEMETRY</p><h1>Traffic overview</h1><p className="intro-copy">Monitor traffic passing through Cloudflare without touching your origin server.</p></div><div className="live-readout"><span>LIVE NOW</span><strong>{selectedValue}</strong><small>{selectedMetric.label} · 5 minute window</small></div></section>
      <section className="signal-strip"><div><span className="signal-label">HOSTNAME</span><strong>dstat.kdns.fr</strong></div><div><span className="signal-label">SOURCE</span><strong>Cloudflare Analytics</strong></div><div><span className="signal-label">LAST CHECK</span><strong>{updatedLabel}</strong></div><div><span className="signal-label">REFRESH</span><strong>1 second</strong></div></section>
      <section className="monitor-grid" id="graph"><article className="chart-card"><div className="card-heading"><div><p className="card-eyebrow">LIVE GRAPH</p><h2>{selectedMetric.label}</h2><span>{selectedMetric.description}</span></div><div className="chart-total"><strong>{selectedValue}</strong><span><StatusDot status={status} /> {status === "live" ? "streaming" : "waiting"}</span></div></div><div className="chart-toolbar"><div className="metric-tabs" role="group" aria-label="選擇圖表指標">{(Object.keys(metricInfo) as Metric[]).map((key) => <button key={key} type="button" className={activeMetric === key ? "selected" : ""} onClick={() => setActiveMetric(key)}>{metricInfo[key].label}</button>)}</div><span className="window-label">Last 5 minutes <span>⌄</span></span></div><LiveChart metric={activeMetric} points={points} /><div className="chart-foot"><span>Cloudflare minute buckets may arrive with provider delay.</span><span>UI refresh {refreshSeconds}s</span></div></article>
        <aside className="inspector" id="routes"><div className="inspector-heading"><div><p className="card-eyebrow">MONITOR</p><h2>Graph details</h2></div><StatusDot status={status} /></div><div className="detail-list"><div><span>Graph</span><strong>{selectedMetric.label}</strong></div><div><span>Protocol</span><strong>L7 HTTP</strong></div><div><span>Data source</span><strong>Cloudflare edge</strong></div><div><span>Origin load</span><strong className="good">Protected</strong></div></div><div className="inspector-section"><div className="section-title"><h3>Top routes</h3><span>5 min</span></div>{routes.length ? <div className="route-list">{routes.slice(0, 5).map((route) => <div className="route-row" key={route.path}><code>{route.path}</code><span>{route.requests}</span></div>)}</div> : <p className="empty-state">Waiting for route data…</p>}</div><div className="inspector-note"><span>i</span><p>Packets and p99 latency require L4 telemetry or an active test agent. HTTP Analytics remains read-only.</p></div></aside></section>
      <section className="summary-row"><div className="summary-item"><span>Bandwidth</span><strong>{formatBandwidth(current.bandwidth)}</strong><small>5 min average</small></div><div className="summary-item"><span>Requests</span><strong>{compact(current.rpm)} RPM</strong><small>Edge request rate</small></div><div className="summary-item"><span>Data volume</span><strong>{(totalBytes / 1024 / 1024).toFixed(1)} MiB</strong><small>Last 5 minutes</small></div><div className="summary-item unavailable"><span>Packets / p99</span><strong>Unavailable</strong><small>Requires L4 or agent</small></div></section>
      <footer className="footer"><span>dstat · Cloudflare read-only monitor</span><span>API status: {status}</span></footer>
    </section>
  </main>;
}
