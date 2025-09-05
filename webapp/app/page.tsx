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
          width: 820,
          boxShadow: "0 20px 60px rgba(2,6,23,.25)",
        }}
      >
        {children}

        <div style={{ textAlign: "right", marginTop: 10 }}>
          <button
            onClick={onClose}
            style={{
              fontSize: 16,
              background: "#fff",
              border: "1px solid black",
              color: "#000",
              padding: "10px",
              display: "block",
              width: "100%",
              borderRadius: 25,
            }}
          >
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

  const [autoRunning, setAutoRunning] = useState(false); //spremeni nazaj na FALSE
  const [countdown, setCountdown] = useState<number>(0); //spremeni nazaj na 0
  const [pendingId, setPendingId] = useState<number | null>(null);

  // modal form
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  const [modalOpen, setModalOpen] = useState(false);

  // --- rekord animacija & highlight ---
  const [showRecord, setShowRecord] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const lastSavedIdRef = useRef<number | null>(null); // ID seje po "Shrani"
  const celebratedIdRef = useRef<number | null>(null); // da animacije ne podvajamo

  const [pendingSummary, setPendingSummary] = useState<{
    id: number;
    peak_w?: number;
    best_wh60?: number;
    total_wh?: number;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const countdownRef = useRef<any>(null);
  const lastAutostartTsRef = useRef<number>(0);
  const autoEndAtRef = useRef<number | undefined>(undefined);

  // --- ZONE overlay ---
  type Zone = {
    id: string;
    name: string;
    color: string;
    min: number;
    max: number;
  }; // min/max so % FTP (0–1.5)

  const DEFAULT_FTP = Number(localStorage?.getItem("ftp_w") ?? 250);
  const DEFAULT_ZONE_ON = localStorage?.getItem("zone_on") !== "0";

  const ZONES: Zone[] = [
    { id: "Z1", name: "Recovery", color: "#3b82f6", min: 0.0, max: 0.55 }, // modra
    { id: "Z2", name: "Endurance", color: "#22c55e", min: 0.56, max: 0.75 }, // zelena
    { id: "Z3", name: "Tempo", color: "#f59e0b", min: 0.76, max: 0.9 }, // oranžno-rumena
    { id: "Z4", name: "Threshold", color: "#f97316", min: 0.91, max: 1.05 }, // oranžna
    { id: "Z5", name: "VO2 Max", color: "#ef4444", min: 1.06, max: 1.2 }, // rdeča
    { id: "Z6", name: "Anaerobic", color: "#dc2626", min: 1.21, max: 9.99 }, // temno rdeča
  ];

  const [ftp, setFtp] = useState<number>(DEFAULT_FTP);
  const [zoneOn, setZoneOn] = useState<boolean>(DEFAULT_ZONE_ON);

  // simulacija (za test, ne vpliva na bridge)
  const [simOn, setSimOn] = useState<boolean>(false);
  const [simPower, setSimPower] = useState<number>(0);

  // izračun cone
  function getZone(powerW: number, ftpW: number) {
    const p = Math.max(0, powerW);
    const pct = ftpW > 0 ? p / ftpW : 0;
    const z = ZONES.find((z) => pct >= z.min && pct <= z.max) || ZONES[0];
    return { ...z, pct, power: p };
  }

  // intenziteta in hitrost pulza po coni
  function zoneVisuals(zoneId: string) {
    switch (zoneId) {
      case "Z1":
        return { alpha: 0.06, dur: 2600 };
      case "Z2":
        return { alpha: 0.09, dur: 2200 };
      case "Z3":
        return { alpha: 0.12, dur: 1800 };
      case "Z4":
        return { alpha: 0.16, dur: 1500 };
      case "Z5":
        return { alpha: 0.2, dur: 1300 };
      case "Z6":
        return { alpha: 0.22, dur: 1100 };
      default:
        return { alpha: 0.1, dur: 2000 };
    }
  }

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
          setPendingSummary({
            id: msg.ended.id,
            peak_w: Number(msg.ended.peak_w ?? 0),
            best_wh60: Number(msg.ended.best_wh60 ?? 0),
            total_wh: Number(msg.ended.total_wh ?? 0),
          });
          setCountdown(0);
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          setModalOpen(true);
        }

        if (msg.type === "session_discarded") {
          if (pendingId === msg.id) {
            setModalOpen(false);
            setPendingId(null);
            setName("");
          }
        }

        if (msg.type === "leaderboard_all") {
          setLb({
            date: "ALL", // ali "ALL-TIME" / "Skupno"
            menWh60: msg.menWh60 ?? [],
            menPeakW: msg.menPeakW ?? [],
            womenWh60: msg.womenWh60 ?? [],
            womenPeakW: msg.womenPeakW ?? [],
          });
          const myId = lastSavedIdRef.current;
          if (myId && celebratedIdRef.current !== myId) {
            const firsts = [
              msg.menWh60?.[0],
              msg.menPeakW?.[0],
              msg.womenWh60?.[0],
              msg.womenPeakW?.[0],
            ].filter(Boolean);

            const isRecord = firsts.some((r: any) => r?.id === myId);
            if (isRecord) {
              setHighlightId(myId); // vizualni highlight v tabelah
              setShowRecord(true); // pokaži konfete/efekt
              celebratedIdRef.current = myId;
              // po 6s ugasni highlight (po želji)
              setTimeout(() => setHighlightId(null), 6000);
            }
          }
        }
      } catch {}
    };
  };

  useEffect(() => {
    const iv1 = setInterval(async () => {
      try {
        const r = await fetch("/api/leaderboard/all");
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

  const effectivePower = simOn ? simPower : lastPower ?? 0;
  const zone = getZone(effectivePower, ftp);
  const zVis = zoneVisuals(zone.id);

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
      style={{
        minHeight: "100vh",
        background: colorGrey,
        color: colorGrey,
        display: "flex",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          margin: "0 auto",
          padding: "16px",
          display: "grid",
          gap: 16,
          width: "100%",
        }}
      >
        <header
          style={{
            color: "white",
            borderRadius: 16,
            boxShadow: "0 10px 30px rgba(2,6,23,.06)",
            display: "flex",
            position: "relative",
          }}
        >
          <img
            src="/header.jpg"
            alt="TermoShop"
            style={{ borderRadius: 16, width: "100%" }}
          />

          {/* <BigCountdown seconds={countdown} show={autoRunning} /> */}
          <BigCountdown seconds={countdown} show={autoRunning} />

          {/* {autoRunning && (
            <span style={{ fontSize: 12, color: colorRed }}>
              Preostalo: {countdown}s
            </span>
          )} */}
        </header>
      </div>

      <div
        style={{
          margin: "0 auto",
          padding: "0 16px 16px",
          display: "grid",
          gap: 16,
          gridTemplateColumns: "1.4fr .6fr",
          width: "100%",
        }}
      >
        {/* Left: Live + manual fallback */}
        <section
          style={{
            background: "white",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 10px 30px rgba(2,6,23,.06)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
              marginBottom: 16,
              flex: 1,
            }}
          >
            <Metric label="Moč" value={fmtP(aPower)} unit="W" valueSize={100} />
            <Metric
              label="Kadenca"
              value={fmtC(aCadence)}
              unit="rpm"
              valueSize={100}
            />
            <Metric
              label="Hitrost"
              value={fmtS(aSpeed)}
              unit="km/h"
              valueSize={100}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2 style={{ marginTop: 0 }}>Zbrana sredstva in energija</h2>
              {!connected && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <button
                    onClick={connect}
                    style={{
                      padding: "10px 15px",
                      borderRadius: 12,
                      border: `1px solid ${colorRed}`,
                      background: colorRed,
                      color: "white",
                      fontSize: 18,
                    }}
                  >
                    {connected ? "Povezano" : "Poveži s trenažerjem"}
                  </button>
                </div>
              )}
            </div>

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

            <footer
              style={{
                marginTop: 20,
                textAlign: "center",
                fontSize: 10,
                color: "#64748b",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 16, color: "#64748b" }}>
                Tečaj: {stats?.euro_per_wh} € = 1 Wh
              </div>

              <div style={{ fontSize: 10, textAlign: "center" }}>
                © by Termo Shop
              </div>
            </footer>
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
        <RightPanels lb={lb} stats={stats} highlightId={highlightId} />
      </div>

      {/* Modal za poimenovanje po auto 60 s */}
      <Modal
        open={modalOpen}
        onClose={async () => {
          // Če modal zapremo brez shranjevanja -> takoj izbrišemo sejo
          if (pendingId) {
            try {
              await fetch("http://127.0.0.1:8080/api/session/discard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: pendingId }),
              });
            } catch {}
            setPendingId(null);
            setName("");
            setPendingSummary(null);
          }
          setModalOpen(false);
        }}
      >
        {pendingSummary && (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Tekmovalec: <b>#{pendingSummary.id}</b>
            </div>
            <div
              style={{
                marginTop: 6,
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              <SmallStat
                label="Moč"
                value={fmt(pendingSummary.peak_w, 0)}
                unit="W"
              />
              <SmallStat
                label="Wh / 60s"
                value={fmt(pendingSummary.best_wh60, 1)}
                unit="Wh"
              />
              <SmallStat
                label="Skupaj"
                value={fmt(pendingSummary.total_wh, 1)}
                unit="Wh"
              />
            </div>
          </div>
        )}
        <h3 style={{ marginTop: 0, fontSize: 40, marginBottom: 20 }}>
          Vnesi ime, primek in spol tekmovalca
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          <input
            placeholder="Ime in Priimek"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              height: "50px",
              marginBottom: 20,
            }}
          />
          <div style={{ display: "flex", gap: 16, marginBottom: 30 }}>
            <label>
              <input
                type="radio"
                checked={gender === "M"}
                onChange={() => setGender("M")}
                style={{ width: "50px", height: "50px" }}
              />{" "}
              M
            </label>
            <label>
              <input
                type="radio"
                checked={gender === "F"}
                onChange={() => setGender("F")}
                style={{ width: "50px", height: "50px" }}
              />{" "}
              Ž
            </label>
          </div>
          <button
            // gumb "Shrani"
            onClick={async () => {
              if (!pendingId) return;
              await fetch("http://127.0.0.1:8080/api/session/rename", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: pendingId, name, gender }),
              });
              lastSavedIdRef.current = pendingId;
              // brez fetch refetcha – bridge pošlje 'leaderboard_all' po WS
              setModalOpen(false);
              setPendingId(null);
              setPendingSummary(null);
              setName("");
            }}
            style={{
              padding: "18px 22px",
              borderRadius: 25,
              fontSize: 16,
              border: "1px solid #e11d48",
              background: "#e11d48",
              color: "white",
            }}
          >
            Shrani
          </button>
        </div>
      </Modal>
      <ZoneOverlay
        show={zoneOn}
        color={zone.color}
        alpha={zVis.alpha}
        duration={zVis.dur}
        label={`${zone.id} • ${zone.name} • ${Math.round(
          zone.pct * 100
        )}% FTP • ${Math.round(effectivePower)} W`}
      />
      <RecordOverlay show={showRecord} onDone={() => setShowRecord(false)} />
      {/* simulacija CON */}
      {/* <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 70,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 12,
          boxShadow: "0 10px 30px rgba(2,6,23,.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <label style={{ fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={zoneOn}
              onChange={(e) => {
                setZoneOn(e.target.checked);
                try {
                  localStorage.setItem("zone_on", e.target.checked ? "1" : "0");
                } catch {}
              }}
            />{" "}
            Zone overlay
          </label>
          <label style={{ fontSize: 12, color: "#334155" }}>
            FTP:
            <input
              type="number"
              value={ftp}
              onChange={(e) => {
                const v = Math.max(
                  50,
                  Math.min(800, Number(e.target.value) || 0)
                );
                setFtp(v);
                try {
                  localStorage.setItem("ftp_w", String(v));
                } catch {}
              }}
              style={{ width: 72, marginLeft: 6 }}
            />{" "}
            W
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={simOn}
              onChange={(e) => setSimOn(e.target.checked)}
            />{" "}
            Simulacija
          </label>
          <input
            type="range"
            min={0}
            max={1000}
            step={10}
            value={simPower}
            onChange={(e) => setSimPower(Number(e.target.value))}
            style={{ width: 160 }}
            disabled={!simOn}
          />
          <div
            style={{
              width: 56,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {simOn ? `${simPower} W` : ""}
          </div>
        </div>
      </div> */}
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
  highlightId,
}: {
  lb: Leaderboards | null;
  stats: Stats | null;
  highlightId: number;
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
        <h2 style={{ marginTop: 0 }}>Lestvice</h2>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <Board
            title="M - največ Wh v 60 s"
            rows={lb?.menWh60}
            valueKey="best_wh60"
            unit="Wh"
            highlightId={highlightId}
          />
          <Board
            title="M - največji W (peak)"
            rows={lb?.menPeakW}
            valueKey="peak_w"
            unit="W"
            highlightId={highlightId}
          />
          <Board
            title="Ž - največ Wh v 60 s"
            rows={lb?.womenWh60}
            valueKey="best_wh60"
            unit="Wh"
            highlightId={highlightId}
          />
          <Board
            title="Ž - največji W (peak)"
            rows={lb?.womenPeakW}
            valueKey="peak_w"
            unit="W"
            highlightId={highlightId}
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
      <div style={{ color: "#64748b", fontSize: 26 }}>{label}</div>
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
            fontSize: Math.max(12, Math.round(valueSize / 2)),
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
  highlightId,
}: {
  title: string;
  rows?: any[];
  valueKey: string;
  unit: string;
  highlightId?: number | null;
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
        {(rows || []).slice(0, 5).map((r, i) => {
          const isHL = highlightId && r?.id === highlightId;
          return (
            <li
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px dashed #e2e8f0",
                fontSize: "24px",
                borderRadius: 10,
                boxShadow: isHL
                  ? "0 0 0 4px rgba(219,11,51,.15), 0 0 24px rgba(219,11,51,.35)"
                  : undefined,
                background: isHL
                  ? "linear-gradient(90deg, #fff6f7, #ffffff)"
                  : undefined,
                transition: "box-shadow .2s ease",
              }}
            >
              <span>
                {isHL ? "👑 " : ""}
                <b>{i + 1}.</b> #{r.id ?? "—"}
              </span>
              <span>{r?.name}</span>
              <span>
                <b>
                  {(r[valueKey] ?? 0).toFixed
                    ? r[valueKey].toFixed(1)
                    : r[valueKey]}
                </b>{" "}
                {unit}
              </span>
            </li>
          );
        })}
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
      <div style={{ color: "#64748b", fontSize: 25 }}>{label}</div>
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
        position: "absolute",
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
        zIndex: 60,
        background: "rgba(248,250,252,0.0)",
        top: "65%",
        transform: "translateY(-50%)",
        right: 60,
      }}
    >
      <div
        style={{
          padding: "12px 65px",
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
              fontSize: 170,
              lineHeight: 1,
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums", // da števke ne skačejo
            }}
          >
            {seconds}
          </div>
          <div style={{ fontSize: 24, color: "#334155" }}>sekund</div>
        </div>
      </div>
    </div>
  );
}

function SmallStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 8,
        background: "white",
        border: "1px solid #eef2f7",
      }}
    >
      <div style={{ fontSize: 20, color: "#64748b" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 100 }}>
        {value} <span style={{ fontSize: 35, color: "#64748b" }}>{unit}</span>
      </div>
    </div>
  );
}

function RecordOverlay({
  show,
  onDone,
}: {
  show: boolean;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!show) return;
    const root = ref.current!;
    // ustvari ~80 “konfetov”
    const count = 80;
    const els: HTMLDivElement[] = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "confetti";
      el.style.left = Math.random() * 100 + "vw";
      el.style.top = "-10px";
      el.style.setProperty("--rx", Math.random() * 720 - 360 + "deg");
      el.style.setProperty("--ry", Math.random() * 720 - 360 + "deg");
      el.style.setProperty("--tx", Math.random() * 60 - 30 + "vw");
      el.style.setProperty("--dur", 2.5 + Math.random() * 1.5 + "s");
      el.style.width = "10px";
      el.style.height = "14px";
      el.style.background = [
        "#DB0B33",
        "#ef4444",
        "#f97316",
        "#22c55e",
        "#06b6d4",
        "#a855f7",
      ][Math.floor(Math.random() * 6)];
      el.style.position = "fixed";
      el.style.zIndex = "100";
      el.style.willChange = "transform, opacity";
      root.appendChild(el);
      els.push(el);
      // trigger animacijo
      // @ts-ignore
      el.animate(
        [
          { transform: "translate(0,0) rotateX(0) rotateY(0)", opacity: 1 },
          {
            transform: `translate(var(--tx), 100vh) rotateX(var(--rx)) rotateY(var(--ry))`,
            opacity: 0.8,
          },
        ],
        {
          duration: parseFloat(el.style.getPropertyValue("--dur")) * 1000,
          easing: "cubic-bezier(.2,.7,.3,1)",
          fill: "forwards",
        }
      );
    }
    const t = setTimeout(() => {
      onDone();
    }, 3200);
    return () => {
      clearTimeout(t);
      els.forEach((e) => e.remove());
    };
  }, [show, onDone]);

  if (!show) return null;
  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 90,
      }}
    >
      {/* bonus: napis */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translateX(-50%)",
          background: "rgba(255,255,255,0.9)",
          border: "1px solid #fecdd3",
          padding: "20px 45px",
          fontWeight: 900,
          fontSize: 120,
          color: "#DB0B33",
          boxShadow: "0 10px 40px rgba(2,6,23,.15)",
        }}
      >
        <h2
          style={{
            fontWeight: 900,
            fontSize: 120,
            color: "#DB0B33",
            margin: 0,
          }}
        >
          🏆 NOV REKORD!
        </h2>
      </div>
    </div>
  );
}

// HEX -> rgba()
function hexToRgba(hex: string, a: number) {
  const s = hex.replace("#", "");
  const r = parseInt(s.substring(0, 2), 16);
  const g = parseInt(s.substring(2, 4), 16);
  const b = parseInt(s.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function ZoneOverlay({
  show,
  color,
  alpha,
  duration,
  label,
}: {
  show: boolean;
  color: string;
  alpha: number; // 0..1
  duration: number; // ms
  label?: string;
}) {
  if (!show) return null;
  const bg = hexToRgba(color, alpha);
  const ring = hexToRgba(color, Math.min(alpha + 0.07, 0.35));

  return (
    <>
      <style jsx global>{`
        @keyframes zonePulse {
          0% {
            opacity: 0;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.015);
          }
          100% {
            opacity: 0;
            transform: scale(1);
          }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 45,
          background: bg,
          boxShadow: `inset 0 0 0 2px ${ring}`,
          animation: `zonePulse ${duration}ms ease-in-out infinite`,
          backdropFilter: "saturate(1.02) brightness(1.01)",
        }}
      />
      {/* mala značka zgoraj levo */}
      {/* <div
        style={{
          position: "fixed",
          left: 12,
          top: 12,
          zIndex: 46,
          background: "rgba(255,255,255,.9)",
          border: `1px solid ${ring}`,
          color: "#0f172a",
          padding: "6px 10px",
          borderRadius: 999,
          fontWeight: 800,
          boxShadow: "0 8px 30px rgba(2,6,23,.15)",
        }}
      >
        {label}
      </div> */}
    </>
  );
}
