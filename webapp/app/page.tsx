"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { useLastDefined } from "../hooks/useLastDefined";
import Image from "next/image";

type Leaderboards = {
  date: string;
  menWh60: any[];
  menPeakW: any[];
  womenWh60: any[];
  womenPeakW: any[];
};
type Stats = {
  date: string;
  euro_per_wh: number;
  today_wh: number;
  today_eur: number;
  all_wh: number;
  all_eur: number;
};
type Sample = {
  t: number;
  power?: number;
  cadence?: number;
  speedKph?: number;
  type?: "fe" | "power";
};

const BRIDGE_WS = "ws://127.0.0.1:9876";
const BRIDGE_API = "http://127.0.0.1:8080";

// ---- Modal ----
function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 20,
          width: 420,
          boxShadow: "0 20px 60px rgba(2,6,23,.25)",
        }}
      >
        {children}
        <div style={{ textAlign: "right", marginTop: 10 }}>
          <button onClick={onClose} style={{ fontSize: 12 }}>
            Zapri
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState<Sample[]>([]);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [lb, setLb] = useState<Leaderboards | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [session, setSession] = useState<any | null>(null);

  const [autoRunning, setAutoRunning] = useState(false);
  const [countdown, setCountdown] = useState<number>(0);
  const [pendingId, setPendingId] = useState<number | null>(null);

  // modal form
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  const [modalOpen, setModalOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const countdownRef = useRef<any>(null);
  const lastAutostartTsRef = useRef<number>(0);
  const autoEndAtRef = useRef<number | undefined>(undefined);

  const modalOpenRef = useRef(false);
  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);

  const prevPowerRef = useRef(0);

  const connect = () => {
    setErr(null);
    try {
      wsRef.current?.close();
    } catch {}
    const ws = new WebSocket(BRIDGE_WS);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setErr("WebSocket error");
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);

        // WS data
        if (msg.type === "fe" || msg.type === "power") {
          const s: Sample = {
            t: msg.t ?? Date.now(),
            power: msg.power,
            cadence: msg.cadence,
            speedKph: msg.speedKph,
            type: msg.type,
          };
          setData((prev) => {
            const now = Date.now();
            const next = [...prev, s];
            return next.filter((x) => now - x.t < 120000);
          });

          // AUTOSTART trigger (samo sproži server)
          const p = Number(msg.power ?? 0);
          const now = Date.now();
          const prev = prevPowerRef.current;

          prevPowerRef.current = p;
        }

        // server je ravno autostartal
        if (msg.type === "session_start" && msg.session) {
          if (modalOpenRef.current) {
            // Če je “lock” pravkar aktiviran, ignoriramo morebiten pozni session_start
            // (po želji še dodatno ubijemo sejo na serverju)
            fetch(BRIDGE_API + "/api/session/end", { method: "POST" }).catch(
              () => {}
            );
            return;
          }

          setAutoRunning(true);
          const endAt =
            (msg.session.start_ts ?? Date.now()) +
            (msg.session.auto_ms ?? 60000);
          autoEndAtRef.current = endAt;
          setCountdown(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)));
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = setInterval(() => {
            const left = Math.max(
              0,
              Math.ceil(((autoEndAtRef.current || 0) - Date.now()) / 1000)
            );
            setCountdown(left);
            if (left <= 0) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
            }
          }, 250);
        }

        // server je zaključil - po 60 s ali manualno
        if (msg.type === "session_end" && msg.ended) {
          setAutoRunning(false);
          setPendingId(msg.ended.id);
          setCountdown(0);
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          setModalOpen(true);
        }
      } catch {}
    };
  };

  useEffect(() => {
    const iv1 = setInterval(async () => {
      try {
        const r = await fetch(BRIDGE_API + "/api/leaderboard/today");
        setLb(await r.json());
      } catch {}
      try {
        const r = await fetch(BRIDGE_API + "/api/stats");
        setStats(await r.json());
      } catch {}
      try {
        const r = await fetch(BRIDGE_API + "/api/session/current");
        const j = await r.json();
        setSession(j.session);
      } catch {}
    }, 2000);
    return () => {
      clearInterval(iv1);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (modalOpen) {
          // blokiraj server-side autostart in za vsak primer zapri sejo
          await fetch(BRIDGE_API + "/api/autostart/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lock: true }),
          });
          await fetch(BRIDGE_API + "/api/session/end", { method: "POST" });
        } else {
          // odblokiraj autostart
          await fetch(BRIDGE_API + "/api/autostart/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lock: false }),
          });
        }
      } catch {}
    })();
  }, [modalOpen]);

  const latest = useMemo(() => data[data.length - 1], [data]);

  // 1) zadrži zadnjo znano vrednost
  const lastPower = useLastDefined(latest?.power);
  const lastCadence = useLastDefined(latest?.cadence);
  const lastSpeed = useLastDefined(latest?.speedKph);

  // 2) animiraj
  const aPower = useAnimatedNumber(lastPower, { duration: 300 });
  const aCadence = useAnimatedNumber(lastCadence, { duration: 300 });
  const aSpeed = useAnimatedNumber(lastSpeed, { duration: 300 });

  // 3) formatiraj
  const fmtP = (v?: number) =>
    v === undefined ? undefined : Math.round(v).toString();
  const fmtC = (v?: number) =>
    v === undefined ? undefined : Math.round(v).toString();
  const fmtS = (v?: number) => (v === undefined ? undefined : v.toFixed(1));
  const send = (o: any) => wsRef.current?.send(JSON.stringify(o));

  const fmt = (n?: number, d = 0) =>
    typeof n === "number" ? n.toFixed(d) : "—";

  const colorRed = "#DB0B33"; // red
  const colorGrey = "#1E2E3E"; // grey
  const colorLight = "#f8fafc"; // light

  return (
    <main
      style={{ minHeight: "100vh", background: colorLight, color: colorGrey }}
    >
      <header
        style={{
          // background: colorRed,
          color: "white",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Image height={80} width={180} src="/termo-logo.svg" alt="TermoShop" />
        <Image height={90} width={130} src="/letape.png" alt="TermoShop" />

        {/* <div style={{ fontSize: 14 }}>
          {autoRunning ? (
            <b>Auto session: {countdown}s</b>
          ) : (
            <span>Povezano</span>
          )}
        </div> */}
      </header>

      <BigCountdown seconds={countdown} show={autoRunning} />

      <div
        style={{
          margin: "0 auto",
          padding: "0 16px",
          display: "grid",
          gap: 16,
          gridTemplateColumns: "1.2fr .8fr",
        }}
      >
        {/* Left: Live + manual fallback */}
        <section
          style={{
            background: "white",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 10px 30px rgba(2,6,23,.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            {!connected && (
              <button
                onClick={connect}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: `1px solid ${colorGrey}`,
                  background: colorGrey,
                  color: "white",
                }}
              >
                {connected ? "Povezano" : "Poveži s trenažerjem"}
              </button>
            )}

            {/* {!connected && (
              <span style={{ fontSize: 12 }}>
                Run bridge: <code>npm start</code> v <b>ant-node-bridge</b>
              </span>
            )} */}
            {autoRunning && (
              <span style={{ fontSize: 12, color: colorRed }}>
                Preostalo: {countdown}s
              </span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <Metric label="Moč" value={fmtP(aPower)} unit="W" valueSize={120} />
            <Metric
              label="Kadenca"
              value={fmtC(aCadence)}
              unit="rpm"
              valueSize={120}
            />
            <Metric
              label="Hitrost"
              value={fmtS(aSpeed)}
              unit="km/h"
              valueSize={120}
            />
          </div>

          <div style={{ marginTop: "35px" }}>
            <h2 style={{ marginTop: 0 }}>Zbrana sredstva in energija</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <StatBox label="Danes (Wh)" value={stats?.today_wh} eur={false} />
              <StatBox
                label="Danes (€)"
                value={stats?.today_eur}
                eur={true}
                red
              />
              <StatBox label="Skupaj (Wh)" value={stats?.all_wh} />
              <StatBox
                label="Skupaj (€)"
                value={stats?.all_eur}
                eur={true}
                red
              />
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
              Stopnja: {stats?.euro_per_wh} €/Wh
            </div>
          </div>

          {/* Manual start/end (ostane kot fallback) */}
          {/* <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
            <div style={{padding:12, border:'1px solid #e2e8f0', borderRadius:12}}>
              <h3 style={{margin:'4px 0'}}>Ročni start (fallback)</h3>
              <ManualStart />
            </div>
            <div style={{padding:12, border:'1px solid #e2e8f0', borderRadius:12}}>
              <h3 style={{margin:'4px 0'}}>Ročni end (fallback)</h3>
              <button onClick={async()=>{ await fetch(BRIDGE_API+'/api/session/end',{method:'POST'}); }} style={{padding:'8px 12px', borderRadius:10, border:'1px solid #0f172a', background:'#0f172a', color:'white'}}>Save / Stop</button>
              <div style={{marginTop:10}}>
                <a href={BRIDGE_API + '/api/export/today.csv'} target="_blank" style={{fontSize:12}}>⬇ Export today CSV</a>
              </div>
            </div>
          </div> */}
        </section>

        {/* Right: Leaderboards & totals */}
        <RightPanels lb={lb} stats={stats} />
      </div>

      {/* Modal za poimenovanje po auto 60 s */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <h3 style={{ marginTop: 0 }}>Vnesi ime in spol za shranitev</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          <input
            placeholder="Ime"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #e2e8f0",
            }}
          />
          <div style={{ display: "flex", gap: 16 }}>
            <label>
              <input
                type="radio"
                checked={gender === "M"}
                onChange={() => setGender("M")}
              />{" "}
              M
            </label>
            <label>
              <input
                type="radio"
                checked={gender === "F"}
                onChange={() => setGender("F")}
              />{" "}
              Ž
            </label>
          </div>
          <button
            onClick={async () => {
              if (!pendingId) return;
              await fetch(BRIDGE_API + "/api/session/rename", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: pendingId, name, gender }),
              });
              setModalOpen(false);
              setPendingId(null);
              setName("");
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e11d48",
              background: "#e11d48",
              color: "white",
            }}
          >
            Shrani
          </button>
        </div>
      </Modal>

      <footer
        style={{
          textAlign: "center",
          fontSize: 10,
          color: "#64748b",
          padding: "12px 0",
        }}
      >
        © by Termo Shop
      </footer>
    </main>
  );
}

function ManualStart() {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #e2e8f0" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label>
            <input
              type="radio"
              checked={gender === "M"}
              onChange={() => setGender("M")}
            />{" "}
            Moški
          </label>
          <label>
            <input
              type="radio"
              checked={gender === "F"}
              onChange={() => setGender("F")}
            />{" "}
            Ženske
          </label>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          onClick={async () => {
            await fetch("http://127.0.0.1:8080/api/session/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, gender }),
            });
          }}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #e11d48",
            background: "#e11d48",
            color: "white",
          }}
        >
          Start
        </button>
      </div>
    </>
  );
}

function RightPanels({
  lb,
  stats,
}: {
  lb: Leaderboards | null;
  stats: Stats | null;
}) {
  const colorRed = "#e11d48";
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 16,
          boxShadow: "0 10px 30px rgba(2,6,23,.06)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Današnje lestvice</h2>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <Board
            title="M - največ Wh v 60 s"
            rows={lb?.menWh60}
            valueKey="best_wh60"
            unit="Wh"
          />
          <Board
            title="M - največji W (peak)"
            rows={lb?.menPeakW}
            valueKey="peak_w"
            unit="W"
          />
          <Board
            title="Ž - največ Wh v 60 s"
            rows={lb?.womenWh60}
            valueKey="best_wh60"
            unit="Wh"
          />
          <Board
            title="Ž - največji W (peak)"
            rows={lb?.womenPeakW}
            valueKey="peak_w"
            unit="W"
          />
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  valueSize = 28,
}: {
  label: string;
  value?: string;
  unit: string;
  valueSize?: number;
}) {
  return (
    <div style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 12 }}>
      <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
      <div
        style={{
          fontSize: valueSize,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          transition: "transform 150ms ease-out, opacity 150ms linear",
          willChange: "transform, opacity",
        }}
      >
        {value ?? "—"}{" "}
        <span
          style={{
            fontSize: Math.max(14, Math.round(valueSize / 2)),
            color: "#64748b",
          }}
        >
          {unit}
        </span>
      </div>
    </div>
  );
}

function Board({
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
  const colorRed = "#e11d48";
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: colorRed,
          color: "white",
          padding: "8px 12px",
          fontWeight: 700,
          fontSize: "28px",
        }}
      >
        {title}
      </div>
      <ol style={{ margin: 0, padding: 12 }}>
        {(rows || []).slice(0, 5).map((r, i) => (
          <li
            key={r.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "6px 0",
              borderBottom: "1px dashed #e2e8f0",
              fontSize: "24px",
            }}
          >
            <span>
              <b>{i + 1}.</b> {r.name}
            </span>
            <span>
              <b>
                {(r[valueKey] ?? 0).toFixed
                  ? r[valueKey].toFixed(1)
                  : r[valueKey]}
              </b>{" "}
              {unit}
            </span>
          </li>
        ))}
        {!rows?.length && (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Ni še rezultatov.
          </div>
        )}
      </ol>
    </div>
  );
}
function StatBox({
  label,
  value,
  red = false,
  eur,
}: {
  label: string;
  value: any;
  red?: boolean;
  eur?: boolean;
}) {
  return (
    <div style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 12 }}>
      <div style={{ color: "#64748b", fontSize: 22 }}>{label}</div>
      <div
        style={{
          fontSize: 68,
          fontWeight: 800,
          color: red ? "#e11d48" : "#334155",
        }}
      >
        {value ?? "—"} {eur ? "€" : ""}
      </div>
    </div>
  );
}

function BigCountdown({ seconds, show }: { seconds: number; show: boolean }) {
  if (!show || seconds <= 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
        zIndex: 60,
        background: "rgba(248,250,252,0.0)",
      }}
    >
      <div
        style={{
          padding: "24px 36px",
          borderRadius: 24,
          boxShadow: "0 20px 60px rgba(2,6,23,.25)",
          background: "white",
          border: "1px solid #fecdd3",
        }}
      >
        <div style={{ textAlign: "center", color: "#e11d48" }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "#0f172a",
              marginBottom: 8,
            }}
          >
            Preostali čas
          </div>
          <div
            style={{
              fontSize: 160,
              lineHeight: 1,
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums", // da števke ne skačejo
            }}
          >
            {seconds}
          </div>
          <div style={{ fontSize: 16, color: "#334155" }}>sekund</div>
        </div>
      </div>
    </div>
  );
}
