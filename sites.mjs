// Leitura de sites (só HTML), CNPJ na Receita (BrasilAPI) e perfil público do Instagram.
import { ehAnuncio } from "./mapas.mjs";
const IG_FORA = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "sharer", "share", "instagram"]);
const so = (s) => s.replace(/\D/g, "");
export const formatarCnpj = (s) => so(s).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
export function validarCnpj(s) {
  const c = so(s);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dig = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((t, p, i) => t + Number(c[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dig(12) === Number(c[12]) && dig(13) === Number(c[13]);
}

export async function lerSite(url) {
  const alvo = url.startsWith("http") ? url : `https://${url}`;
  if (ehAnuncio(alvo)) return { ok: false, erro: "link de anúncio ignorado" };
  const t0 = Date.now();
  try {
    const r = await fetch(alvo, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "accept-language": "pt-BR,pt;q=0.9" } });
    const html = (await r.text()).slice(0, 2_000_000);
    const igs = [...new Set([...html.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/g)].map((m) => m[1].replace(/\.$/, "").toLowerCase()).filter((u) => !IG_FORA.has(u)))];
    const cnpj = html.match(/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/)?.[1] || null;
    const wa = html.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\/?\?phone=)(\d{10,13})/)?.[1] || null;
    return {
      ok: r.ok, urlFinal: r.url, https: r.url.startsWith("https"), tempoMs: Date.now() - t0, instagrams: igs, instagram: igs[0] || null,
      cnpj: cnpj && validarCnpj(cnpj) ? formatarCnpj(cnpj) : null, whatsapp: wa, temWhatsapp: !!wa || /whatsapp/i.test(html),
      pixelMeta: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(['"]init/.test(html),
      googleAnalytics: /gtag\/js\?id=G-|google-analytics\.com\/analytics\.js/.test(html),
      googleAds: /gtag\/js\?id=AW-|googleadservices|['"]AW-\d+/.test(html), gtm: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(html),
    };
  } catch (e) {
    return { ok: false, erro: String(e.message || e).slice(0, 200), tempoMs: Date.now() - t0 };
  }
}

export async function consultarCnpj(cnpj) {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${so(cnpj)}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d = await r.json();
    const porte = String(d.porte || d.descricao_porte || "").toUpperCase();
    return {
      razao: d.razao_social || null, porte: /MICRO EMPRESA|^ME$|MICROEMPRESA/.test(porte) ? "ME" : /PEQUENO PORTE|EPP/.test(porte) ? "EPP" : porte ? "DEMAIS" : null,
      abertura: d.data_inicio_atividade || null, socios: (d.qsa || []).map((s) => ({ nome: s.nome_socio, qualificacao: s.qualificacao_socio })),
    };
  } catch {
    return null;
  }
}

const num = (s) => {
  if (!s) return null;
  const t = s.trim().toUpperCase().replace(/\s/g, "");
  const m = t.match(/^([\d.,]+)([KM]|MIL|MI)?$/);
  if (!m) return null;
  let n = Number(m[1].replace(/,(?=\d{3}\b)/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (m[2] === "K" || m[2] === "MIL") n *= 1e3;
  if (m[2] === "M" || m[2] === "MI") n *= 1e6;
  return Math.round(n);
};
const dec = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&").replace(/&quot;/g, '"');
export async function perfilInstagram(usuario) {
  const u = usuario.replace(/^@/, "").trim();
  try {
    const r = await fetch(`https://www.instagram.com/${encodeURIComponent(u)}/`, { headers: { "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" }, signal: AbortSignal.timeout(15000) });
    const d = dec((await r.text()).match(/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]+)"/)?.[1] || "");
    const seg = d.match(/([\d.,]+\s?[KM]?|[\d.,]+\s?mil)\s+(Followers|seguidores)/i)?.[1];
    const sig = d.match(/([\d.,]+\s?[KM]?|[\d.,]+\s?mil)\s+(Following|seguindo)/i)?.[1];
    const pos = d.match(/([\d.,]+\s?[KM]?|[\d.,]+\s?mil)\s+(Posts|publicações|posts)/i)?.[1];
    return { usuario: u, seguidores: num(seg), seguindo: num(sig), posts: num(pos), nome: d.match(/from (.+?) \(@/)?.[1] || null, ok: !!seg };
  } catch {
    return { usuario: u, seguidores: null, seguindo: null, posts: null, nome: null, ok: false };
  }
}

export async function velocidade(url) {
  try {
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance`, { signal: AbortSignal.timeout(70000) });
    if (!r.ok) return null;
    const j = await r.json();
    const nota = j?.lighthouseResult?.categories?.performance?.score;
    const lcp = j?.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue;
    return nota === undefined ? null : { nota: Math.round(nota * 100), lcp: lcp ? Math.round(lcp / 100) / 10 : null };
  } catch {
    return null;
  }
}
