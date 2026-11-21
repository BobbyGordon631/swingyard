// Owns every InputSource and the link to the phones (see net/screenLink.js).
// Games subscribe here:  input.on('button', (source, name, down) => ...)
//                        input.on('swing',  (source, swing) => ...)
//                        input.on('join' | 'leave', (phoneSource) => ...)
import { CONFIG } from '../config.js';
import { Emitter } from './inputSource.js';
import { KeyboardSource } from './keyboardSource.js';
import { PhoneSource } from './phoneSource.js';
import { createScreenLink } from '../net/screenLink.js';

export class InputManager extends Emitter {
  constructor(config = CONFIG) {
    super();
    this.config = config;
    this.keyboard = new KeyboardSource(config);
    this.phones = [0, 1, 2, 3].map((i) => new PhoneSource(i, (msg) => this._send(msg), config));
    for (const source of [this.keyboard, ...this.phones]) {
      source.on('button', (name, down) => this.emit('button', source, name, down));
      source.on('swing', (swing) => this.emit('swing', source, swing));
      source.on('swingstart', (info) => this.emit('swingstart', source, info));
    }
    this.link = null;
  }

  attach(win, canvas) {
    this.keyboard.attach(win, canvas);
    this.ready = createScreenLink(
      (msg) => this._onMessage(msg),
      (link) => this.emit('room', link),
    ).then((link) => {
      this.link = link;
      this.emit('room', link);
      return link;
    });
  }

  get online() {
    return !!(this.link && this.link.online);
  }

  _onMessage(msg) {
    if (msg.t === 'm') {
      const phone = this.phones[msg.p];
      if (phone && phone.connected) phone.handleMessage(msg, performance.now());
    } else if (msg.t === 'hello') {
      const present = new Set(msg.players.map((pl) => pl.p));
      for (const phone of this.phones) {
        if (phone.connected && !present.has(phone.slot)) this._leave(phone);
      }
      for (const pl of msg.players) this._join(pl);
    } else if (msg.t === 'join') {
      this._join(msg);
    } else if (msg.t === 'leave') {
      if (this.phones[msg.p]) this._leave(this.phones[msg.p]);
    }
  }

  _join({ p, ios }) {
    const phone = this.phones[p];
    if (!phone) return;
    phone.ios = !!ios;
    if (phone.connected) return;
    phone.connected = true;
    phone._status = null; // a fresh page knows nothing yet
    this.emit('join', phone);
  }

  _leave(phone) {
    phone.connected = false;
    phone.reset();
    this.emit('leave', phone);
  }

  _send(msg) {
    if (this.link) this.link.send(msg);
  }

  update(now) {
    this.keyboard.update(now);
  }

  /** All sources that can currently produce input. */
  get sources() {
    return [this.keyboard, ...this.phones.filter((p) => p.connected)];
  }

  /** Sources allowed to control player `index`: their phone (if connected) and the keyboard. */
  sourcesFor(index) {
    const phone = this.phones[index];
    return phone && phone.connected ? [phone, this.keyboard] : [this.keyboard];
  }

  isFor(source, index) {
    return source === this.keyboard || source === this.phones[index];
  }

  /** Treat every phone's current pointing direction as "at the screen". */
  recenterAll() {
    for (const p of this.phones) if (p.connected) p.recenter();
  }

  vibrateAll(pattern) {
    for (const p of this.phones) if (p.connected) p.vibrate(pattern);
  }
}
