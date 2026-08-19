"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";

type ChartMetric = "bandwidth" | "requests" | "data";
type Point = { time: string; bandwidth: number; requests: number; bytes: number };
type PathRow = { method: string; path: string; requests: string; latency: string; status: string };

const REFRESH_SECONDS = 1;
const emptyPoints: Point[] = Array.from({ length: 6 }, (_, index) => ({ time: `-${5 - index}m`, bandwidth: 0, requests: 0, bytes: 0 }));

const metricOptions: Array<{ id: ChartMetric; label: string; detail: string }> = [
  { id: "bandwidth", label: "Bandwidth", detail: "Edge response throughput" },
  { id: "requests", label: "Requests", detail: "Requests per minute" },
  { id: "data", label: "Data", detail: "Edge response bytes" },
];

function compact(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: digits }).format(value);
}

function rate(value: number) {
  if (value >= 1) return `${value.toFixed(2)} Gb/s`;
  if (value > 0) return `${(value * 1000).toFixed(1)} Mb/s`;
  return "0.00 Gb/s";
}

function chartValues(points: Point[], metric: ChartMetric) {
  if (metric === "bandwidth") {
    const useMbps = Math.max(...points.map((point) => point.bandwidth), 0) < 1;
    return { values: points.map((point) => useMbps ? point.bandwidth * 1000 : point.bandwidth), unit: useMbps ? "Mb/s" : "Gb/s" };
  }
  if (metric === "requests") return { values: points.map((point) => point.requests), unit: "RPM" };
  return { values: points.map((point) => point.bytes / 1024 / 1024), unit: "MiB" };
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const rounded = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return rounded * exponent;
}

function axisLabel(value: number, unit: string) {
  if (unit === "RPM") return `${compact(value)} RPM`;
  if (unit === "MiB") return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MiB`;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function SelectedMetricChart({ metric, points }: { metric: ChartMetric; points: Point[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const safePoints = points.length > 1 ? points : emptyPoints;
  const { values, unit } = chartValues(safePoints, metric);
  const maximum = niceMax(Math.max(...values, 0) * 1.12);
  const line = values.map((value, index) => {
    const x = 4 + (index / Math.max(values.length - 1, 1)) * 92;
    const y = 91 - Math.min(value / maximum, 1) * 78;
    return `${x},${y}`;
  }).join(" ");
  const area = `4,94 ${line} 96,94`;
  const lastY = 91 - Math.min(values[values.length - 1] / maximum, 1) * 78;
  const labels = [1, .75, .5, .25, 0].map((ratio) => axisLabel(maximum * ratio, unit));
  const xIndexes = [0, Math.floor((safePoints.length - 1) / 4), Math.floor((safePoints.length - 1) / 2), Math.floor((safePoints.length - 1) * .75), safePoints.length - 1];
  const hoverX = hoverIndex === null ? null : 4 + (hoverIndex / Math.max(values.length - 1, 1)) * 92;
  const hoverValue = hoverIndex === null ? null : values[hoverIndex];
  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setHoverIndex(Math.min(values.length - 1, Math.max(0, Math.round(ratio * (values.length - 1)))));
  };

  return <div className="chart-area-wrap">
    <div className="chart-y-axis" aria-hidden="true">{labels.map((label) => <span key={label}>{label}</span>)}</div>
    <svg className="main-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${metricOptions.find((item) => item.id === metric)?.label} chart`} onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)}>
      {[13, 32.5, 52, 71.5, 91].map((y) => <line key={y} x1="4" x2="96" y1={y} y2={y} className="chart-grid-line" />)}
      <polygon points={area} className="chart-fill" />
      <polyline points={line} className="chart-series" />
      {hoverX !== null && <><line x1={hoverX} x2={hoverX} y1="13" y2="91" className="chart-hover-line" /><circle cx={hoverX} cy={91 - Math.min((hoverValue ?? 0) / maximum, 1) * 78} r="1.8" className="chart-hover-point" /></>}
      <circle cx="96" cy={lastY} r="1.25" className="chart-last-point" />
    </svg>
    {hoverIndex !== null && <div className="chart-tooltip" style={{ left: `${Math.min(Math.max(4 + (hoverIndex / Math.max(values.length - 1, 1)) * 92, 13), 87)}%` }}><span>{safePoints[hoverIndex].time}</span><strong>{axisLabel(hoverValue ?? 0, unit)}</strong></div>}
    <div className="chart-x-axis" aria-hidden="true">{xIndexes.map((index, position) => <span key={`${index}-${position}`}>{position === xIndexes.length - 1 ? "NOW" : safePoints[index].time}</span>)}</div>
  </div>;
}

export default function Home() {
  const [metric, setMetric] = useState<ChartMetric>("bandwidth");
  const [points, setPoints] = useState<Point[]>(emptyPoints);
  const [paths, setPaths] = useState<PathRow[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [current, setCurrent] = useState({ throughput: 0, rpm: 0 });

  useEffect(() => {
    let closed = false;
    let inFlight = false;
    let lastSignature = "";
    const poll = async () => {
      if (closed || inFlight) return;
      inFlight = true;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/cloudflare/analytics?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();
        if (closed) return;
        if (!response.ok) throw new Error(data.error ?? "Analytics unavailable");
        const nextPoints = data.series?.length ? data.series : emptyPoints;
        const signature = JSON.stringify({ refreshedAt: data.refreshedAt, current: data.current, series: nextPoints, paths: data.topPaths });
        if (signature !== lastSignature) {
          lastSignature = signature;
          setPoints(nextPoints);
          setPaths(data.topPaths ?? []);
          setCurrent({ throughput: data.current?.throughput ?? 0, rpm: data.current?.rpm ?? 0 });
          setLastUpdated(data.refreshedAt ?? new Date().toISOString());
        }
        setStatus("live");
      } catch {
        if (!closed) setStatus("offline");
      } finally {
        inFlight = false;
        if (!closed) setRefreshing(false);
      }
    };
    poll();
    const interval = window.setInterval(poll, REFRESH_SECONDS * 1000);
    return () => { closed = true; window.clearInterval(interval); };
  }, [refreshKey]);

  const selected = metricOptions.find((item) => item.id === metric)!;
  const totalBytes = useMemo(() => points.reduce((sum, point) => sum + point.bytes, 0), [points]);
  const latestUpdate = lastUpdated ? new Date(lastUpdated).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  const selectedValue = metric === "bandwidth" ? rate(current.throughput) : metric === "requests" ? `${compact(current.rpm)} RPM` : `${(totalBytes / 1024 / 1024).toFixed(1)} MiB`;

  return <main className="dstat-app">
    <aside className="dstat-sidebar"><a className="dstat-logo" href="#top"><span>⌁</span> dstat.space</a><nav><a className="side-link active" href="#top">Dashboard</a><p className="nav-group">Views &amp; tools</p><a className="side-link" href="#routes">Traffic routes</a><a className="side-link" href="#routes">Edge overview</a><p className="nav-group">Dstat</p><a className="side-link" href="#graph">Layer 7 <span>›</span></a><a className="side-link" href="#graph">Layer 4 <span>›</span></a></nav><div className="sidebar-source"><span className={`live-dot ${status}`} /> <div><strong>{status === "live" ? "Cloudflare connected" : "Cloudflare waiting"}</strong><small>Read-only edge telemetry</small></div></div></aside>
    <section className="dstat-content" id="top"><header className="monitor-header"><div><p>Cloudflare Analytics</p><h1>Traffic dashboard</h1></div><div className="header-status"><span className={`live-dot ${status}`} /> {refreshing ? "Updating…" : "1 second UI refresh"}<button type="button" onClick={() => setRefreshKey((key) => key + 1)}>Refresh now</button></div></header>
      <section className="notice-strip" aria-label="Monitor status"><div><strong>EDGE TRAFFIC</strong><span>dstat.kdns.fr</span></div><div><strong>NO ORIGIN LOAD</strong><span>Cloudflare-only collection</span></div><div><strong>{status === "live" ? "LIVE" : "WAITING"}</strong><span>Last check {latestUpdate}</span></div></section>
      <section className="graph-layout" id="graph"><aside className="graph-details"><div className="details-heading"><h2>Graph Details</h2><p>Cloudflare edge monitor</p></div><div className="details-divider" /><dl><div><dt>Graph Name</dt><dd>{selected.label}</dd></div><div><dt>Hostname</dt><dd>dstat.kdns.fr <button type="button" onClick={() => navigator.clipboard?.writeText("dstat.kdns.fr")} aria-label="複製網域">▣</button></dd></div><div><dt>Source</dt><dd>Cloudflare HTTP Analytics</dd></div><div><dt>Display</dt><dd>{selected.detail}</dd></div><div><dt>Refresh</dt><dd>UI every 1 second</dd></div></dl><div className="reminder"><strong>NOTE</strong><p>Cloudflare HTTP Analytics 的原始資料可能以每分鐘資料桶更新；這個頁面不會對你的 origin 發送測試流量。</p></div></aside>
        <article className="chart-panel"><div className="chart-panel-head"><div><p>LIVE GRAPH</p><h2>{selected.label}</h2><span>{selected.detail}</span></div><strong>{selectedValue}</strong></div><div className="chart-controls"><div className="metric-picker" role="group" aria-label="選擇圖表項目">{metricOptions.map((item) => <button key={item.id} type="button" className={metric === item.id ? "selected" : ""} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div><div className="chart-state"><span className={`live-dot ${status}`} /> {status === "live" ? "Streaming" : "Waiting"}</div></div><SelectedMetricChart metric={metric} points={points} /></article></section>
      <section className="below-graph" id="routes"><article className="current-summary"><div><span>Current bandwidth</span><strong>{rate(current.throughput)}</strong></div><div><span>Current requests</span><strong>{compact(current.rpm)} RPM</strong></div><div><span>5 min edge data</span><strong>{(totalBytes / 1024 / 1024).toFixed(1)} MiB</strong></div></article><article className="routes-panel"><div className="routes-head"><h2>Top routes</h2><span>Cloudflare edge data</span></div>{paths.length ? <table><thead><tr><th>PATH</th><th>REQUESTS</th></tr></thead><tbody>{paths.map((row) => <tr key={row.path}><td><code>{row.path}</code></td><td>{row.requests}</td></tr>)}</tbody></table> : <p className="empty-routes">Waiting for Cloudflare Analytics route data…</p>}</article></section>
    </section>
  </main>;
}
