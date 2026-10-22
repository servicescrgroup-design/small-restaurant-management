import type { Staff, StaffRole } from './types';
import { uid } from './utils';

// ---------- PIN hashing ----------
// PINs are never stored in plain text. This is a local deterrent (a 4-digit PIN can't be strong
// against someone with the device's data), not bank-grade security.

function cyrb53(str: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashPin(pin: string, salt: string) {
  let h = `${salt}:${pin}`;
  for (let i = 0; i < 1000; i++) h = cyrb53(h + salt, i).toString(36);
  return h;
}

export const makePinCreds = (pin: string) => {
  const pinSalt = uid();
  return { pinSalt, pinHash: hashPin(pin, pinSalt) };
};

export const findByPin = (staff: Staff[], pin: string) =>
  staff.find((s) => s.active && hashPin(pin, s.pinSalt) === s.pinHash);

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);

export const newStaff = (name: string, role: StaffRole, pin: string): Staff => ({ id: uid(), name, role, active: true, ...makePinCreds(pin) });
