import dns from 'node:dns';

/** Prefer IPv4 when a hostname has A and AAAA (Supabase direct hosts are often v6-only). */
dns.setDefaultResultOrder('ipv4first');
