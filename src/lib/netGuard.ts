import { isIP } from "node:net";

/**
 * Shared private/special-range detection for outbound-connection gates
 * (Playwright target validation, AI provider base URLs).
 *
 * This is NOT a DNS-rebinding defense: a hostname can resolve to a public address
 * at check time and a private one at connect time. It blocks literal-IP targets and
 * hostnames whose *current* DNS answers are non-public — raise that limitation only
 * with an egress proxy or firewall in front of the process.
 */

const RE_V4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

const blockedV4 = (parts: number[]): boolean => {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // current network / private / loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 (IETF, incl. 192.0.0.0/29 special use)
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224/4) and reserved (240/4), incl. 255.255.255.255
  return false;
};

const blockedV6 = (ip: string): boolean => {
  const s = ip.toLowerCase();
  if (s === "::" || s === "::1") return true; // unspecified / loopback
  const mapped = RE_V4_MAPPED.exec(s);
  if (mapped) return blockedV4(mapped[1].split(".").map(Number));
  const first = s.split(":")[0];
  const firstNum = parseInt(first, 16);
  if (Number.isNaN(firstNum)) return true;
  if (firstNum >= 0xfe80 && firstNum <= 0xfebf) return true; // fe80::/10 link-local
  if ((firstNum & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstNum & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (s.startsWith("64:ff9b::") || s.startsWith("64:ff9b:1::")) return true; // NAT64 well-known prefixes (can embed private v4)
  if (s.startsWith("2001:db8:")) return true; // documentation range
  return false;
};

/** True when the string is an IP literal in a private/loopback/link-local/reserved range. */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return blockedV4(ip.split(".").map(Number));
  if (version === 6) return blockedV6(ip);
  return false;
}

const STRIP_BRACKETS = /^\[(.*)\]$/;

/** True when the hostname is an obviously non-public literal or a well-known internal name. */
export function isPrivateHostname(hostname: string): boolean {
  let h = hostname.trim().toLowerCase();
  if (!h) return true;
  const bracket = STRIP_BRACKETS.exec(h);
  if (bracket) h = bracket[1];
  if (isIP(h)) return isPrivateIp(h);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google" || h === "metadata.google.internal") return true; // GCE metadata
  if (h === "169.254.169.254") return true;
  return false;
}

/**
 * Tri-state policy for allowing private targets:
 *   unset / "auto" → loopback allowed (local dev /demo-target), everything else private blocked (default)
 *   "1" / "true"   → all private ranges allowed (trusted LAN staging)
 *   "0" / "false"  → all private ranges blocked, including loopback
 */
export type PrivatePolicy = "loopback-only" | "allow-all" | "block-all";
export function privatePolicy(envValue: string | undefined): PrivatePolicy {
  const v = (envValue ?? "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "allow") return "allow-all";
  if (v === "0" || v === "false" || v === "block") return "block-all";
  return "loopback-only";
}

export function isLoopbackIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return ip.startsWith("127.");
  if (version === 6) {
    const s = ip.toLowerCase();
    if (s === "::1") return true;
    const mapped = RE_V4_MAPPED.exec(s);
    return mapped ? mapped[1].startsWith("127.") : false;
  }
  return false;
}

export function isLoopbackHostname(hostname: string): boolean {
  let h = hostname.trim().toLowerCase();
  const bracket = STRIP_BRACKETS.exec(h);
  if (bracket) h = bracket[1];
  if (isIP(h)) return isLoopbackIp(h);
  return h === "localhost" || h.endsWith(".localhost");
}

/**
 * Returns null when the host is allowed by policy, otherwise a short reason string.
 * `resolved` should contain the DNS answers for the hostname when available.
 */
export function blockedReason(hostname: string, resolved: string[], envValue: string | undefined): string | null {
  const policy = privatePolicy(envValue);
  if (policy === "allow-all") return null;
  if (policy === "block-all") {
    if (isPrivateHostname(hostname)) return "Hostname is in a private/reserved range";
    for (const addr of resolved) if (isPrivateIp(addr)) return "Hostname resolves to a private/reserved address";
    return null;
  }
  // loopback-only (default)
  if (isPrivateHostname(hostname) && !isLoopbackHostname(hostname)) return "Hostname is in a private/reserved range";
  for (const addr of resolved) {
    if (isPrivateIp(addr) && !isLoopbackIp(addr)) return "Hostname resolves to a private/reserved address";
  }
  return null;
}
