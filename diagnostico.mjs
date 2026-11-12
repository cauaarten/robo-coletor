// Coleta do diagnóstico de uma clínica: mapa de posições no Maps, ficha, site, Instagram e anúncios.
// Devolve os dados brutos e os prints; as conclusões são montadas pelo sistema.
import path from "node:path";
import { buscar, ficha, ehAnuncio } from "./mapas.mjs";
import { lerSite, perfilInstagram, velocidade } from "./sites.mjs";
import { anunciosMeta, anunciosGoogle } from "./anuncios.mjs";
import { contexto, esperar } from "./nav.mjs";

const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function mesmo(r, c) {
  if (c.place_id && r.placeId && c.place_id === r.placeId) return true;
  const a = normal(r.nome), b = normal(c.nome);
  return a === b || (a.length > 12 && b.startsWith(a.slice(0, 18))) || (b.length > 12 && a.startsWith(b.slice(0, 18)));
}

export async function diagnosticar({ clinica, termo, tamanho = 5 }, pasta, etapa, parcial) {
  const c = { ...clinica };
  const atualizar = {};
  const d = { termo, centro: null, grade: [], passoKm: 0.7, ranking: null, concorrentes: [], site: null, instagram: null, instagramDono: null, anunciosMeta: null, anunciosGoogle: null, nichoMeta: null, prints: {}, furos: [], fortes: [] };
  if (c.lat === null || c.lat === undefined) {
    await etapa("achando a clínica no Google Maps");
    const r = await buscar(`${c.nome} ${c.cidade || ""}`, { maximo: 3 });
    const achou = r.find((x) => mesmo(x, c)) || r[0];
    if (achou?.lat) {
      Object.assign(c, { lat: achou.lat, lng: achou.lng, place_id: c.place_id || achou.placeId, maps_url: c.maps_url || achou.url });
      Object.assign(atualizar, { lat: achou.lat, lng: achou.lng, place_id: c.place_id, maps_url: c.maps_url, nota: c.nota ?? achou.nota });
    }
  }
  if (c.lat !== null && c.lat !== undefined) {
    d.centro = { lat: c.lat, lng: c.lng };
    const meio = Math.floor(tamanho / 2);
    const pontos = [];
    for (let i = 0; i < tamanho; i++) for (let j = 0; j < tamanho; j++) pontos.push({ lat: c.lat + ((meio - i) * d.passoKm) / 111, lng: c.lng + ((j - meio) * d.passoKm) / (111 * Math.cos((c.lat * Math.PI) / 180)) });
    const conc = new Map();
    let k = 0;
    for (const pt of pontos) {
      await etapa(`mapa de posições no Google Maps (${++k}/${pontos.length})`);
      const centro = k === Math.ceil(pontos.length / 2);
      const res = await buscar(termo, { centro: { ...pt, zoom: 15 }, maximo: 20, print: centro ? path.join(pasta, "maps-busca.png") : undefined }).catch(() => []);
      if (centro && res.length) d.prints.mapsBusca = "maps-busca.png";
      const pos = res.findIndex((r) => mesmo(r, c));
      d.grade.push({ ...pt, pos: pos >= 0 ? pos + 1 : null });
      res.forEach((r, i) => {
        if (mesmo(r, c)) return;
        const chave = r.placeId || normal(r.nome);
        const a = conc.get(chave) || { nome: r.nome, placeId: r.placeId, nota: r.nota, top3: 0, media: null, vezes: 0, soma: 0, site: ehAnuncio(r.site) ? null : r.site, patrocinado: false, lat: r.lat, lng: r.lng };
        a.vezes++;
        a.soma += i + 1;
        if (i < 3) a.top3++;
        if (r.patrocinado) a.patrocinado = true;
        conc.set(chave, a);
      });
      await esperar(900 + Math.random() * 600);
    }
    const n = d.grade.length;
    const com = d.grade.filter((g) => g.pos !== null);
    const media = com.length ? com.reduce((s, g) => s + g.pos, 0) / com.length : null;
    const top3 = d.grade.filter((g) => g.pos !== null && g.pos <= 3).length / n;
    const primeira = com.length / n;
    d.ranking = { media, top3, primeiraPagina: primeira, invisivel: 1 - primeira, nota: Math.round(top3 * 60 + primeira * 25 + (media ? Math.max(0, (20 - media) / 20) * 15 : 0)) };
    d.concorrentes = [...conc.values()].map((x) => ({ ...x, media: x.vezes ? x.soma / x.vezes : null })).sort((a, b) => b.top3 - a.top3 || (a.media ?? 99) - (b.media ?? 99)).slice(0, 8)
      .map((x) => ({ nome: x.nome, placeId: x.placeId, nota: x.nota, top3: x.top3, media: x.media, vezes: x.vezes, site: x.site, patrocinado: x.patrocinado, lat: x.lat, lng: x.lng }));
    await etapa("desenhando o mapa de posições");
    await desenharGrade(d, c, path.join(pasta, "grade.png")).then(() => (d.prints.grade = "grade.png")).catch(() => undefined);
    await parcial(d);
  }
  if (c.maps_url) {
    await etapa("print da ficha no Google");
    const f = await ficha(c.maps_url, path.join(pasta, "ficha.png")).catch(() => null);
    if (f) {
      d.prints.ficha = "ficha.png";
      if (!c.site && f.site && !/instagram|facebook|wa\.me/.test(f.site)) c.site = atualizar.site = `https://${f.site.replace(/^https?:\/\//, "")}`;
      if (f.endereco && (!c.endereco || c.endereco.length < f.endereco.length)) atualizar.endereco = f.endereco;
    }
  }
  if (c.site) {
    await etapa("analisando o site");
    const s = await lerSite(c.site);
    const v = await velocidade(c.site);
    d.site = { ...s, velocidade: v?.nota ?? null, lcp: v?.lcp ?? null };
    await printSite(c.site, path.join(pasta, "site.png")).then((ok) => ok && (d.prints.site = "site.png")).catch(() => undefined);
    if (s.instagram && !c.instagram) c.instagram = atualizar.instagram = s.instagram;
  }
  if (c.instagram) {
    await etapa("lendo o Instagram");
    d.instagram = await perfilInstagram(c.instagram);
  }
  if (c.instagram_dono && c.instagram_dono !== c.instagram) d.instagramDono = await perfilInstagram(c.instagram_dono);
  await etapa("procurando anúncios no Meta");
  d.anunciosMeta = await anunciosMeta(c.instagram || c.nome, { print: path.join(pasta, "meta-ads.png"), filtroAnunciante: [c.nome, c.instagram || ""] }).catch(() => null);
  if (d.anunciosMeta?.print) d.prints.metaAds = "meta-ads.png";
  await etapa("anúncios dos concorrentes no Meta");
  d.nichoMeta = await anunciosMeta(`${termo} ${c.cidade || ""}`.trim(), { print: path.join(pasta, "meta-nicho.png"), maximo: 30 }).catch(() => null);
  if (d.nichoMeta?.print) d.prints.metaNicho = "meta-nicho.png";
  if (c.site) {
    await etapa("procurando anúncios no Google");
    d.anunciosGoogle = await anunciosGoogle(c.site, path.join(pasta, "google-ads.png")).catch(() => null);
    if (d.anunciosGoogle?.print) d.prints.googleAds = "google-ads.png";
  }
  for (const a of [d.anunciosMeta, d.nichoMeta, d.anunciosGoogle]) if (a) delete a.print;
  return { dados: d, atualizar };
}

const BLOQUEAR = [/google-analytics\.com/, /analytics\.google\.com/, /googletagmanager\.com\/.*collect/, /facebook\.com\/tr/, /googleadservices\.com/, /doubleclick\.net/, /clarity\.ms\/collect/, /analytics\.tiktok\.com/];
async function printSite(url, arquivo) {
  if (ehAnuncio(url)) return false;
  const ctx = await contexto({ largura: 390, altura: 844, escala: 2 });
  try {
    await ctx.route("**/*", (r) => (BLOQUEAR.some((b) => b.test(r.request().url())) ? r.abort() : r.continue()));
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await esperar(3500);
    await p.screenshot({ path: arquivo });
    return true;
  } finally {
    await ctx.close();
  }
}

async function desenharGrade(d, c, arquivo) {
  const cor = (pos) => (pos === null ? "#9b1c1c" : pos <= 3 ? "#1f9d55" : pos <= 10 ? "#d4a015" : "#e0661b");
  const pts = d.grade.map((g) => ({ ...g, cor: cor(g.pos), txt: g.pos === null ? "20+" : String(g.pos) }));
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{margin:0;width:1200px;height:760px;font-family:Arial,sans-serif}.tiles{filter:grayscale(1) contrast(.9) brightness(1.05)}
.b{width:44px;height:44px;border-radius:50%;color:#fff;font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.pin{width:22px;height:22px;border-radius:50% 50% 50% 0;background:#FFD100;border:3px solid #111;transform:rotate(-45deg)}</style></head>
<body><div id="m"></div><script>
const m=L.map('m',{zoomControl:false,attributionControl:true,zoomSnap:0.1});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19,className:'tiles'}).addTo(m);
const pts=${JSON.stringify(pts)};m.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lng])).pad(0.08));
pts.forEach(p=>L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div class="b" style="background:'+p.cor+'">'+p.txt+'</div>',iconSize:[44,44],iconAnchor:[22,22]})}).addTo(m));
L.marker([${c.lat},${c.lng}],{icon:L.divIcon({className:'',html:'<div class="pin"></div>',iconSize:[22,22],iconAnchor:[11,22]})}).addTo(m);
window.pronto=false;setTimeout(()=>window.pronto=true,2500);</script></body></html>`;
  const ctx = await contexto({ largura: 1200, altura: 760, escala: 2 });
  try {
    const p = await ctx.newPage();
    await p.setContent(html, { waitUntil: "networkidle", timeout: 45000 });
    await p.waitForFunction(() => window.pronto, null, { timeout: 15000 });
    await p.screenshot({ path: arquivo });
  } finally {
    await ctx.close();
  }
}
