// The game screen's link to the phones. Two ways to run Swingyard:
//
//  - LAN mode (`npm start` on a computer): the Node server relays phone packets over a WebSocket
//    and the phone page is served over HTTPS from the computer's Wi-Fi address.
//  - Online mode (a static host such as GitHub Pages, e.g. kksolve.com/swingyard): there is no
//    server of our own. Each game screen opens a room with a short code; phones connect straight
//    to the screen over WebRTC (peer to peer, so motion data never leaves your network when both
//    are on the same Wi-Fi). The free PeerJS broker is only used to introduce the two devices.
//
// Either way the rest of the game sees the same messages:
//   in:  { t: 'join', p, ios } · { t: 'leave', p } · { t: 'm', p, ... } motion · { t: 'hello', players }
//   out: { t: 'vibrate' | 'status', p?, ... }
const MAX_PLAYERS = 4;
const ROOM_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

/** Peer id for a room code (PeerJS ids: letters, digits, - and _). */
export const peerIdFor = (room) => `swingyard-${room.toLowerCase()}`;

function newRoomCode() {
  let s = '';
  const rnd = new Uint32Array(5);
  crypto.getRandomValues(rnd);
  for (const r of rnd) s += ROOM_CHARS[r % ROOM_CHARS.length];
  return s;
}

/** The URL of this page's folder (works at / and at /swingyard/). */
export function baseUrl() {
  return new URL('.', location.href).href;
}

/** LAN mode if our Node server answers /api/info, otherwise online mode. */
export async function detectMode() {
  if (document.querySelector('meta[name="swingyard-mode"][content="online"]')) return { mode: 'online' };
  try {
    const res = await fetch('api/info', { cache: 'no-store' });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) return { mode: 'lan', info: await res.json() };
  } catch {
    /* static host */
  }
  return { mode: 'online' };
}

export function qrDataUrl(text) {
  if (typeof window.qrcode !== 'function') return null;
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 2);
}

// ------------------------------------------------------------------ LAN (WebSocket relay)
class WsLink {
  constructor(onMessage) {
    this.mode = 'lan';
    this.onMessage = onMessage;
    this.online = false;
    this.ws = null;
    this._connect();
  }

  _connect() {
    const url = new URL('ws?role=screen', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => (this.online = true);
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      this.online = false;
      this.onMessage({ t: 'hello', players: [] }); // everyone is gone until we reconnect
      setTimeout(() => this._connect(), 1000);
    };
    ws.onerror = () => {};
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}

// ------------------------------------------------------------------ online (WebRTC, peer to peer)
// The screen is the hub the Node server used to be: it hands out player slots, keeps a phone's
// slot when it reconnects, and turns away a fifth phone.
class PeerLink {
  constructor(onMessage, onRoom) {
    this.mode = 'online';
    this.onMessage = onMessage;
    this.onRoom = onRoom;
    this.online = false;
    this.slots = new Array(MAX_PLAYERS).fill(null); // { id, ios, ctl, m }
    this.lastSlotById = new Map();
    this.pending = new Map(); // phone id -> motion channel that arrived before its control channel
    // Keep the room across reloads of this tab, so phones reconnect by themselves.
    this.room = sessionStorage.getItem('swingyard-room') || newRoomCode();
    this._idTaken = 0;
    this._open();
  }

  _open() {
    if (typeof window.Peer !== 'function') {
      this.error = 'Could not load the phone link library.';
      this.onRoom(this);
      return;
    }
    sessionStorage.setItem('swingyard-room', this.room);
    const peer = new window.Peer(peerIdFor(this.room), { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      this.online = true;
      this.error = null;
      this._idTaken = 0;
      this.onRoom(this);
    });
    peer.on('connection', (conn) => this._onConnection(conn));
    // Lost the broker (not the phones): live data channels keep working; re-register for new joins.
    peer.on('disconnected', () => {
      this.online = false;
      this.onRoom(this);
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Usually our own previous page still holding the code for a moment after a reload.
        peer.destroy();
        if (++this._idTaken > 3) this.room = newRoomCode();
        setTimeout(() => this._open(), 1500);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.online = false;
        this.error = 'Waiting for the internet connection…';
        this.onRoom(this);
        peer.destroy();
        setTimeout(() => this._open(), 3000);
      }
      // 'peer-unavailable' etc. concern a single phone; its own channel events handle it.
    });
  }

  _onConnection(conn) {
    const meta = conn.metadata || {};
    const id = String(meta.id || '').slice(0, 64);
    if (!id) {
      conn.close();
      return;
    }
    if (conn.label === 'm') {
      // Motion channel (unreliable, unordered: a late packet is useless, a re-sent one worse).
      conn.on('open', () => {
        const p = this.slots.findIndex((s) => s && s.id === id);
        if (p >= 0) this._attachMotion(p, conn);
        else this.pending.set(id, conn);
      });
      conn.on('close', () => this.pending.get(id) === conn && this.pending.delete(id));
      return;
    }
    // Control channel (reliable): joining, leaving, status text, vibration.
    conn.on('open', () => this._join(conn, id, !!meta.ios));
  }

  _join(ctl, id, ios) {
    let p = this.slots.findIndex((s) => s && s.id === id); // same phone reconnecting
    if (p >= 0) {
      const old = this.slots[p];
      this.slots[p] = null;
      try {
        old.ctl.close();
        old.m?.close();
      } catch {
        /* already gone */
      }
    } else {
      const prev = this.lastSlotById.get(id);
      p = prev !== undefined && !this.slots[prev] ? prev : this.slots.findIndex((s) => !s);
    }
    if (p < 0) {
      ctl.send({ t: 'full' });
      setTimeout(() => ctl.close(), 300);
      return;
    }
    const slot = { id, ios, ctl, m: null };
    this.slots[p] = slot;
    this.lastSlotById.set(id, p);
    ctl.send({ t: 'slot', p, screen: true });
    this.onMessage({ t: 'join', p, ios });
    ctl.on('data', (data) => this._onData(p, slot, data));
    ctl.on('close', () => this._leave(p, slot));
    ctl.on('error', () => this._leave(p, slot));
    const m = this.pending.get(id);
    if (m) {
      this.pending.delete(id);
      this._attachMotion(p, m);
    }
  }

  _attachMotion(p, m) {
    const slot = this.slots[p];
    if (!slot) return;
    slot.m = m;
    m.on('data', (data) => this._onData(p, slot, data));
  }

  _onData(p, slot, data) {
    if (this.slots[p] !== slot) return;
    let msg = data;
    if (typeof data === 'string') {
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'm') {
      msg.p = p;
      this.onMessage(msg);
    } else if (msg.t === 'ping') {
      slot.ctl.send({ t: 'pong', ts: msg.ts }); // lets the phone show its round-trip time
    }
  }

  _leave(p, slot) {
    if (this.slots[p] !== slot) return; // replaced by a reconnect
    this.slots[p] = null;
    try {
      slot.m?.close();
    } catch {
      /* gone */
    }
    this.onMessage({ t: 'leave', p });
  }

  send(msg) {
    const targets = Number.isInteger(msg.p) ? [this.slots[msg.p]] : this.slots;
    for (const s of targets) if (s && s.ctl.open) s.ctl.send(msg);
  }

  /** Phone page URL for this room (what the QR code holds). */
  get controllerUrl() {
    return `${baseUrl()}controller.html?room=${this.room}`;
  }
}

/**
 * @param {(msg: object) => void} onMessage  messages from phones (see top of file)
 * @param {(link: object) => void} [onRoom]  online mode: room ready / changed / broker lost
 */
export async function createScreenLink(onMessage, onRoom = () => {}) {
  const { mode, info } = await detectMode();
  if (mode === 'lan') {
    const link = new WsLink(onMessage);
    link.info = info;
    return link;
  }
  return new PeerLink(onMessage, onRoom);
}
