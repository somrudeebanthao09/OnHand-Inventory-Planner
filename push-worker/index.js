import http from "http";
import webpush from "web-push";

const PORT = Number(process.env.PORT || 3000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const GAS_API_URL =
  process.env.PART_REQ_GAS_API_URL ||
  "https://script.google.com/macros/s/AKfycbwMkhvWJ3koge4dzElzg25YlMjSIePFeUmXeOp5H6Y-YqAqlTAenfBtgXqvq0yTsdrM/exec";
const GAS_USERNAME = process.env.PART_REQ_GAS_USERNAME || "wh";
const GAS_PASSWORD = process.env.PART_REQ_GAS_PASSWORD || "1234";

const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:h9-planner@local";

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("[PushWorker] Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY env vars!");
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let initializedBaseline = false;
const knownByReqId = new Map();
const sentEventKeys = new Set();

function parseMs(val) {
  if (!val) return 0;
  const t = Date.parse(String(val));
  return Number.isFinite(t) ? t : 0;
}

async function callGasApi(fields) {
  const res = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, requestId: "worker-" + Date.now() })
  });
  const text = await res.text();
  const m = text.match(/\\x22userHtml\\x22:\\x22([\s\S]*?)\\x22,\\x22ncc\\x22/);
  if (m) {
    const step1 = JSON.parse('"' + m[1].replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1") + '"');
    const htmlStr = JSON.parse('"' + step1 + '"');
    const pm = htmlStr.match(/postMessage\((\{.*?\}),\s*"\*"\)/);
    if (pm) return JSON.parse(pm[1]);
  }
  return null;
}

async function getGasToken() {
  if (cachedToken && cachedTokenExpiresAt > Date.now() + 60000) {
    return cachedToken;
  }
  const login = await callGasApi({
    action: "login",
    username: GAS_USERNAME,
    password: GAS_PASSWORD
  });
  if (login?.ok && login.token) {
    cachedToken = login.token;
    cachedTokenExpiresAt = Date.now() + Number(login.expiresIn || 21600) * 1000;
    return cachedToken;
  }
  return null;
}

async function sendWebPush(targets, payloadObj, token) {
  if (!targets.length) return 0;
  const payload = JSON.stringify(payloadObj);
  let sent = 0;
  for (const entry of targets) {
    try {
      await webpush.sendNotification(entry.subscription, payload, {
        TTL: 3600,
        urgency: "high"
      });
      sent++;
    } catch (err) {
      const status = Number(err?.statusCode || 0);
      if (status === 404 || status === 410) {
        callGasApi({
          action: "push_unsubscribe",
          token,
          endpoint: entry.endpoint
        }).catch(() => {});
      } else {
        console.warn("[PushWorker] Send warn:", status || err.message);
      }
    }
  }
  return sent;
}

async function dispatchForRecord(prevItem, nextItem, subs, token) {
  if (!nextItem || nextItem.deleted) return 0;
  const isNewPending = !prevItem && nextItem.status !== "issued";
  const isNewlyIssued =
    nextItem.status === "issued" && (!prevItem || prevItem.status !== "issued");
  if (!isNewPending && !isNewlyIssued) return 0;

  const eventKey = `${nextItem.reqId}:${isNewlyIssued ? "issued" : "pending"}`;
  if (sentEventKeys.has(eventKey)) return 0;
  sentEventKeys.add(eventKey);
  if (sentEventKeys.size > 5000) sentEventKeys.clear();

  // Only push recent items (within 15 minutes) to prevent old backlog floods on restart
  const rawTime = isNewlyIssued
    ? nextItem.issuedAt || nextItem.updatedAt
    : nextItem.requestedAt || nextItem.requestDate;
  const ts = parseMs(rawTime);
  if (!ts || Date.now() - ts > 15 * 60 * 1000) return 0;

  if (isNewPending) {
    const targets = subs.filter(s => s.role === "warehouse" || s.role === "admin");
    return sendWebPush(
      targets,
      {
        title: `🔔 มีใบเบิก Part ใหม่ (${nextItem.materialCode || "-"})`,
        body: `จำนวน ${nextItem.requestQty || 0} ${nextItem.unit || "PCS"} · MO: ${nextItem.moNumber || "-"}\nผู้เบิก: ${nextItem.requesterName || "-"} (${nextItem.shift || "-"})`,
        tag: `part-req-pending-${nextItem.reqId}`,
        reqId: nextItem.reqId,
        kind: "pending",
        url: "./#part-issue"
      },
      token
    );
  }

  const reqNameLower = String(nextItem.requesterName || "").trim().toLowerCase();
  const targets = subs.filter(s => {
    if (s.role === "admin") return true;
    if (s.role !== "requester") return false;
    const subStaff = String(s.staffName || "").trim().toLowerCase();
    return !subStaff || !reqNameLower || subStaff === reqNameLower;
  });
  return sendWebPush(
    targets,
    {
      title: `✅ คลังจ่าย Part ให้แล้ว (${nextItem.materialCode || "-"})`,
      body: `จ่าย ${nextItem.issuedQty || nextItem.requestQty || 0} ${nextItem.unit || "PCS"} · MO: ${nextItem.moNumber || "-"}\nผู้จ่าย: ${nextItem.issuerName || "Warehouse"}`,
      tag: `part-req-issued-${nextItem.reqId}`,
      reqId: nextItem.reqId,
      kind: "issued",
      url: "./#part-requisition"
    },
    token
  );
}

let inFlight = null;
async function syncAndPushOnce(triggerReqId = "") {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const token = await getGasToken();
    if (!token) return { ok: false, reason: "no_token", sent: 0 };

    const listRes = await callGasApi({ action: "list", token });
    if (!listRes?.ok || !Array.isArray(listRes.items)) {
      return { ok: false, reason: "list_failed", sent: 0 };
    }

    if (!initializedBaseline) {
      let triggeredItem = null;
      for (const item of listRes.items) {
        if (!item?.reqId) continue;
        knownByReqId.set(item.reqId, item);
        if (triggerReqId && item.reqId === triggerReqId) {
          triggeredItem = item;
        }
      }
      initializedBaseline = true;
      let sent = 0;
      if (triggeredItem) {
        const subRes = await callGasApi({ action: "push_list", token });
        const subs = Array.isArray(subRes?.subscriptions)
          ? subRes.subscriptions.filter(s => s?.endpoint && s?.subscription?.keys)
          : [];
        const syntheticPrev =
          triggeredItem.status === "issued"
            ? { ...triggeredItem, status: "pending" }
            : null;
        sent = await dispatchForRecord(syntheticPrev, triggeredItem, subs, token);
      }
      return { ok: true, baseline: knownByReqId.size, sent };
    }

    const changes = [];
    for (const item of listRes.items) {
      if (!item?.reqId) continue;
      const prev = knownByReqId.get(item.reqId) || null;
      const changed =
        !prev ||
        prev.status !== item.status ||
        prev.updatedAt !== item.updatedAt;
      if (changed) {
        knownByReqId.set(item.reqId, item);
        changes.push({ prev, next: item });
      }
    }

    let sent = 0;
    if (changes.length) {
      const subRes = await callGasApi({ action: "push_list", token });
      const subs = Array.isArray(subRes?.subscriptions)
        ? subRes.subscriptions.filter(s => s?.endpoint && s?.subscription?.keys)
        : [];
      for (const ev of changes) {
        sent += await dispatchForRecord(ev.prev, ev.next, subs, token);
      }
    }
    return { ok: true, checked: listRes.items.length, changed: changes.length, sent };
  })()
    .catch(err => {
      console.warn("[PushWorker] Poll error:", err.message);
      return { ok: false, error: err.message, sent: 0 };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/trigger") {
    const reqId = String(url.searchParams.get("reqId") || "").trim();
    const result = await syncAndPushOnce(reqId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      service: "h9-part-push-worker",
      initialized: initializedBaseline,
      tracked: knownByReqId.size
    })
  );
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[PushWorker] Listening on 0.0.0.0:${PORT}`);
  syncAndPushOnce().then(r => console.log("[PushWorker] Initial sync:", r));
  setInterval(() => {
    syncAndPushOnce().then(r => {
      if (r?.sent > 0) console.log("[PushWorker] Sent Web Push:", r);
    });
  }, POLL_INTERVAL_MS);
});
