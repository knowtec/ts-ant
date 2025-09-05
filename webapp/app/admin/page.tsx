"use client";
import { useEffect, useState } from "react";

type RangeLb = {
  menWh60: any[];
  menPeakW: any[];
  womenWh60: any[];
  womenPeakW: any[];
};

type TodayRow = {
  id: number;
  name: string;
  gender: "M" | "F" | "U";
  date: string;
  start_ts: number;
  end_ts: number | null;
  peak_w: number;
  best_wh60: number;
  total_wh: number;
};
type DayRow = {
  date: string;
  sessions: number;
  sessions_ended: number;
  total_wh: number;
  total_eur: number;
  max_peak_w: number;
  max_best_wh60: number;
};
type SessionRow = TodayRow;
type ViewMode = "today" | "days";

function defaultRange() {
  const d = new Date();
  const to = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() - 6);
  const from = d.toISOString().slice(0, 10);
  return { from, to };
}

export default function Admin() {
  const [pin, setPin] = useState("");
  const [view, setView] = useState<ViewMode>("today");
  const [err, setErr] = useState<string>();

  // today
  const [rows, setRows] = useState<TodayRow[]>([]);

  // days range
  const { from: defF, to: defT } = defaultRange();
  const [from, setFrom] = useState(defF);
  const [to, setTo] = useState(defT);
  const [days, setDays] = useState<DayRow[]>([]);
  const [rangeSessions, setRangeSessions] = useState<SessionRow[]>([]);
  const [rangeLb, setRangeLb] = useState<RangeLb | null>(null);

  const hdr = () => ({
    "x-admin-pin": pin,
    "Content-Type": "application/json",
  });

  const loadToday = async () => {
    const r = await fetch(
      "/api/admin/sessions/today?pin=" + encodeURIComponent(pin)
    );
    if (r.status === 401) {
      setErr("Wrong PIN");
      setRows([]);
      return;
    }
    const j = await r.json();
    setRows(j.rows || []);
  };

  const loadRangeLeaderboard = async () => {
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
      to
    )}&pin=${encodeURIComponent(pin)}&limit=all`;
    const r = await fetch("/api/admin/range/leaderboard" + q);
    if (r.status === 401) {
      setErr("Wrong PIN");
      setRangeLb(null);
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(`LB range error: ${r.status} ${j?.error || ""}`);
      setRangeLb(null);
      return;
    }
    const j = await r.json();
    setRangeLb(j);
  };

  const loadDaysRange = async () => {
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
      to
    )}&pin=${encodeURIComponent(pin)}`;
    const r = await fetch("/api/admin/days" + q);
    if (r.status === 401) {
      setErr("Wrong PIN");
      setDays([]);
      return;
    }
    const j = await r.json();
    setDays(j.rows || []);
  };

  const loadSessionsRange = async () => {
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
      to
    )}&pin=${encodeURIComponent(pin)}`;
    const r = await fetch("/api/admin/range/sessions" + q);
    if (r.status === 401) {
      setErr("Wrong PIN");
      setRangeSessions([]);
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(`Range error: ${r.status} ${j?.error || ""}`);
      setRangeSessions([]);
      return;
    }
    const j = await r.json();
    setRangeSessions(j.rows || []);
  };

  useEffect(() => {
    const saved = localStorage.getItem("admin_pin");
    if (saved) setPin(saved);
  }, []);
  useEffect(() => {
    if (!pin) return;
    localStorage.setItem("admin_pin", pin);
    setErr(undefined);
    loadToday().catch(() => setErr("API error"));
  }, [pin]);

  useEffect(() => {
    if (view === "days" && pin) {
      setErr(undefined);
      Promise.all([
        loadDaysRange(),
        loadSessionsRange(),
        loadRangeLeaderboard(),
      ]).catch(() => setErr("API error"));
    }
  }, [view, pin]);

  const fmtTime = (ms?: number) =>
    ms ? new Date(ms).toLocaleTimeString() : "—";
  const refresh = async () => {
    setErr(undefined);
    if (view === "today") await loadToday();
    else {
      await loadDaysRange();
      await loadSessionsRange();
      await loadRangeLeaderboard();
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900 }}>Admin</h1>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          style={{
            padding: 8,
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            width: 140,
          }}
        />
        <button
          onClick={refresh}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#0f172a",
            color: "#fff",
          }}
        >
          Refresh
        </button>

        {err && <span style={{ color: "#DB0B33", marginLeft: 12 }}>{err}</span>}

        <nav style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <TabButton active={view === "today"} onClick={() => setView("today")}>
            Danes
          </TabButton>
          <TabButton active={view === "days"} onClick={() => setView("days")}>
            Po dnevih (range)
          </TabButton>
        </nav>
      </header>

      {view === "today" ? (
        <TodayTable
          rows={rows}
          fmtTime={fmtTime}
          pin={pin}
          onDeleted={loadToday}
        />
      ) : (
        <DaysRangeView
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
          onApply={async () => {
            await loadDaysRange();
            await loadSessionsRange();
            await loadRangeLeaderboard();
          }}
          days={days}
          sessions={rangeSessions}
          fmtTime={fmtTime}
          rangeLb={rangeLb}
        />
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 999,
        border: "1px solid #e2e8f0",
        background: active ? "#DB0B33" : "#fff",
        color: active ? "#fff" : "#0f172a",
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

function TodayTable({
  rows,
  fmtTime,
  pin,
  onDeleted,
}: {
  rows: any[];
  fmtTime: (n?: number) => string;
  pin: string;
  onDeleted: () => void;
}) {
  return (
    <table
      style={{
        width: "100%",
        background: "white",
        borderCollapse: "collapse",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <thead style={{ background: "#f1f5f9" }}>
        <tr>
          <th style={th}>ID</th>
          <th style={th}>Ime</th>
          <th style={th}>Spol</th>
          <th style={th}>Peak W</th>
          <th style={th}>Wh/60</th>
          <th style={th}>Wh</th>
          <th style={th}>Start</th>
          <th style={th}>End</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={td}>{r.id}</td>
            <td style={td}>{r.name || "—"}</td>
            <td style={td}>{r.gender}</td>
            <td style={td}>{r.peak_w?.toFixed?.(1) ?? r.peak_w}</td>
            <td style={td}>{r.best_wh60?.toFixed?.(1) ?? r.best_wh60}</td>
            <td style={td}>{r.total_wh?.toFixed?.(1) ?? r.total_wh}</td>
            <td style={td}>{fmtTime(r.start_ts)}</td>
            <td style={td}>{r.end_ts ? fmtTime(r.end_ts) : "—"}</td>
            <td style={td}>
              <button
                onClick={async () => {
                  if (!confirm(`Delete session #${r.id}?`)) return;
                  await fetch(
                    `/api/admin/session/${r.id}?pin=${encodeURIComponent(pin)}`,
                    { method: "DELETE" }
                  );
                  onDeleted();
                }}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: "#DB0B33",
                  color: "#fff",
                }}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td style={{ ...td, textAlign: "center" }} colSpan={9}>
              Ni seje za danes.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function DaysRangeView({
  from,
  to,
  onChange,
  onApply,
  days,
  sessions,
  fmtTime,
  rangeLb,
}: {
  from: string;
  to: string;
  onChange: (f: string, t: string) => void;
  onApply: () => void;
  days: DayRow[];
  sessions: SessionRow[];
  fmtTime: (n?: number) => string;
  rangeLb: RangeLb | null;
}) {
  const csvHref = `/api/export/range?from=${encodeURIComponent(
    from
  )}&to=${encodeURIComponent(to)}`;
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <label>
          Od:{" "}
          <input
            type="date"
            value={from}
            onChange={(e) => onChange(e.target.value, to)}
          />
        </label>
        <label>
          Do:{" "}
          <input
            type="date"
            value={to}
            onChange={(e) => onChange(from, e.target.value)}
          />
        </label>
        <button
          onClick={onApply}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#0f172a",
            color: "#fff",
          }}
        >
          Prikaži
        </button>
        <a
          href={csvHref}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#fff",
            color: "#0f172a",
            textDecoration: "none",
          }}
        >
          CSV (range)
        </a>
      </div>

      <div
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            background: "#f1f5f9",
            padding: "10px 12px",
            fontWeight: 800,
          }}
        >
          Lestvice (interval {from} – {to})
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            padding: 12,
          }}
        >
          <BoardAdmin
            title="M – največ Wh v 60 s"
            rows={rangeLb?.menWh60}
            valueKey="best_wh60"
            unit="Wh"
          />
          <BoardAdmin
            title="M – največji W (peak)"
            rows={rangeLb?.menPeakW}
            valueKey="peak_w"
            unit="W"
          />
          <BoardAdmin
            title="Ž – največ Wh v 60 s"
            rows={rangeLb?.womenWh60}
            valueKey="best_wh60"
            unit="Wh"
          />
          <BoardAdmin
            title="Ž – največji W (peak)"
            rows={rangeLb?.womenPeakW}
            valueKey="peak_w"
            unit="W"
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 16 }}>
        {/* povzetek po dnevih */}
        <div
          style={{
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "#f1f5f9",
              padding: "10px 12px",
              fontWeight: 800,
            }}
          >
            Dnevi v intervalu ({from} – {to})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Datum</th>
                <th style={th}>Seje</th>
                <th style={th}>Zaklj.</th>
                <th style={th}>Wh skupaj</th>
                <th style={th}>€ skupaj</th>
                <th style={th}>Max Peak W</th>
                <th style={th}>Naj Wh/60</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td style={td}>{d.date}</td>
                  <td style={td}>{d.sessions}</td>
                  <td style={td}>{d.sessions_ended}</td>
                  <td style={td}>{d.total_wh?.toFixed?.(1) ?? d.total_wh}</td>
                  <td style={{ ...td, color: "#DB0B33", fontWeight: 700 }}>
                    {d.total_eur?.toFixed?.(1) ?? d.total_eur}
                  </td>
                  <td style={td}>
                    {d.max_peak_w?.toFixed?.(1) ?? d.max_peak_w}
                  </td>
                  <td style={td}>
                    {d.max_best_wh60?.toFixed?.(1) ?? d.max_best_wh60}
                  </td>
                </tr>
              ))}
              {!days.length && (
                <tr>
                  <td style={{ ...td, textAlign: "center" }} colSpan={7}>
                    Ni podatkov.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* seje v intervalu */}
        <div
          style={{
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "#f1f5f9",
              padding: "10px 12px",
              fontWeight: 800,
            }}
          >
            Seje v intervalu ({from} – {to})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Datum</th>
                <th style={th}>ID</th>
                <th style={th}>Ime</th>
                <th style={th}>Spol</th>
                <th style={th}>Peak W</th>
                <th style={th}>Wh/60</th>
                <th style={th}>Wh</th>
                <th style={th}>Start</th>
                <th style={th}>End</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((r) => (
                <tr key={r.id + "_" + r.start_ts}>
                  <td style={td}>{r.date}</td>
                  <td style={td}>{r.id}</td>
                  <td style={td}>{r.name || "—"}</td>
                  <td style={td}>{r.gender}</td>
                  <td style={td}>{r.peak_w?.toFixed?.(1) ?? r.peak_w}</td>
                  <td style={td}>{r.best_wh60?.toFixed?.(1) ?? r.best_wh60}</td>
                  <td style={td}>{r.total_wh?.toFixed?.(1) ?? r.total_wh}</td>
                  <td style={td}>{fmtTime(r.start_ts)}</td>
                  <td style={td}>{r.end_ts ? fmtTime(r.end_ts) : "—"}</td>
                </tr>
              ))}
              {!sessions.length && (
                <tr>
                  <td style={{ ...td, textAlign: "center" }} colSpan={9}>
                    Ni sej.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function BoardAdmin({
  title,
  rows,
  valueKey,
  unit,
}: {
  title: string;
  rows?: any[];
  valueKey: string;
  unit: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        style={{
          background: "#DB0B33",
          color: "white",
          padding: "8px 12px",
          fontWeight: 700,
        }}
      >
        {title}
      </div>
      {/* Scroll, da se UI ne raztegne čez ekran */}
      <div style={{ maxHeight: 420, overflow: "auto" }}>
        <ol style={{ margin: 0, padding: 12 }}>
          {(rows || []).map((r: any, i: number) => (
            <li
              key={r.id ?? i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px dashed #e2e8f0",
                fontSize: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <b>{i + 1}.</b>
                <div  style={{ marginLeft: 50 }}>{typeof r?.id === "number" ? `#${r.id}` : "—"}</div>
                <div style={{ marginLeft: 50 }}>{r?.name}</div>
              </div>

              <div>
                <b>
                  {(r[valueKey] ?? 0).toFixed
                    ? r[valueKey].toFixed(1)
                    : r[valueKey]}
                </b>{" "}
                {unit}
              </div>
            </li>
          ))}
          {!rows?.length && (
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Ni rezultatov.</div>
          )}
        </ol>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 700,
};
const td: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #f1f5f9",
};
