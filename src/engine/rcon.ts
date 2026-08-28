// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The Source RCON wire format (what Minecraft servers speak): little-endian framing,
 * auth then exec. Pure codec — the socket lives in whatever host runs it (the dev
 * bridge's Node process today, the Tauri Rust side later).
 *
 * Packet: int32 length (of everything after itself), int32 id, int32 type,
 * body bytes, then two NUL terminators. Auth failure comes back as id −1.
 */

export const RCON_AUTH = 3;
export const RCON_EXEC = 2;
export const RCON_RESPONSE = 0;
export const RCON_AUTH_RESPONSE = 2;

export interface RconPacket {
  id: number;
  type: number;
  body: string;
}

export function encodePacket(packet: RconPacket): Uint8Array {
  const body = new TextEncoder().encode(packet.body);
  const length = 4 + 4 + body.length + 2;
  const out = new Uint8Array(4 + length);
  const view = new DataView(out.buffer);

  view.setInt32(0, length, true);
  view.setInt32(4, packet.id, true);
  view.setInt32(8, packet.type, true);
  out.set(body, 12);
  // Two trailing NULs are already zero-initialised.
  return out;
}

/**
 * Decodes the first complete packet in the buffer, or null if more bytes are needed.
 * Returns the packet and how many bytes it consumed.
 */
export function decodePacket(bytes: Uint8Array): { packet: RconPacket; consumed: number } | null {
  if (bytes.length < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getInt32(0, true);
  if (bytes.length < 4 + length) return null;

  const body = new TextDecoder().decode(bytes.subarray(12, 4 + length - 2));
  return {
    packet: { id: view.getInt32(4, true), type: view.getInt32(8, true), body },
    consumed: 4 + length,
  };
}
