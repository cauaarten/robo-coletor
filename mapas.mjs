// Busca no Google Maps (visão sem login) e ficha de um lugar.
import { contexto, esperar } from "./nav.mjs";

const coord = (href) => {
  const m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: null, lng: null };
};
const idLugar = (href) => href.match(/!19s(ChIJ[\w-]+)/)?.[1] || href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)?.[1] || null;
export const ehAnuncio = (u) => !!u && /google\.[a-z.]+\/aclk|googleadservices\.com|doubleclick\.net|\/pagead\//.test(u);

export async function buscar(termo, { centro, maximo = 20, print } = {}) {
  const ctx = await contexto();
  const p = await ctx.newPage();
  try {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(termo)}${centro ? `/@${centro.lat},${centro.lng},${centro.zoom || 15}z` : ""}?hl=pt-BR`;
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const temLista = await p.waitForSelector('div[role="feed"] a.hfpxzc', { timeout: 15000 }).then(() => true).catch(() => false);
    if (!temLista) {
      const h1 = await p.$("h1.DUwDvf");
      if (!h1) return [];
      const href = p.url();
      return [{ nome: (await h1.textContent())?.trim() || termo, url: href, placeId: idLugar(href), ...coord(href), nota: null, categoria: null, endereco: null, telefone: null, site: null, patrocinado: false }];
    }
    const feed = await p.$('div[role="feed"]');
    for (let i = 0; i < 12; i++) {
      const n = await p.$$eval('div[role="feed"] a.hfpxzc', (a) => a.length);
      if (n >= maximo) break;
      await feed.evaluate((e) => e.scrollBy(0, 4000));
      await esperar(1300);
      if (await p.$('div[role="feed"] span.HlvSq')) break;
    }
    if (print) await p.screenshot({ path: print });
    const itens = await p.$$eval('div[role="feed"] a.hfpxzc', (as) =>
      as.map((a) => {
        const card = a.closest('div[role="article"]') || a.parentElement;
        const nota = card.querySelector('span[role="img"][aria-label*="estrela"]')?.getAttribute("aria-label") || "";
        const linhas = [...card.querySelectorAll(".W4Efsd .W4Efsd")].map((e) => e.innerText);
        const partes = (linhas[0] || "").split("·").map((x) => x.trim()).filter(Boolean);
        return {
          nome: a.getAttribute("aria-label") || "", url: a.href, notaTxt: nota, categoria: partes[0] || null, endereco: partes.length > 1 ? partes[partes.length - 1] : null,
          telefone: card.querySelector(".UsdlK")?.textContent || null, site: card.querySelector('a[data-value="Website"], a[data-value="Site"], a[aria-label^="Visitar o site"], a[aria-label^="Visit"]')?.href || null, patrocinado: /Patrocinado/i.test(card.innerText),
        };
      }),
    );
    return itens.slice(0, maximo).map((i) => {
      const n = i.notaTxt.match(/(\d+[.,]\d)/);
      return { nome: i.nome, url: i.url.split("?")[0], placeId: idLugar(i.url), ...coord(i.url), nota: n ? Number(n[1].replace(",", ".")) : null, categoria: i.categoria, endereco: i.endereco, telefone: i.telefone, site: i.site, patrocinado: i.patrocinado };
    });
  } finally {
    await ctx.close();
  }
}

export async function ficha(url, print) {
  const ctx = await contexto();
  const p = await ctx.newPage();
  try {
    await p.goto(url.includes("hl=") ? url : `${url}${url.includes("?") ? "&" : "?"}hl=pt-BR`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForSelector("h1.DUwDvf", { state: "attached", timeout: 20000 });
    await esperar(1200);
    if (print) await p.screenshot({ path: print });
    return await p.evaluate(() => {
      const aria = (re) => [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") || "").find((a) => re.test(a));
      const tira = (s, pre) => (s ? s.replace(pre, "").trim() : null);
      return { nome: document.querySelector("h1.DUwDvf")?.textContent?.trim() || null, endereco: tira(aria(/^Endereço:/), "Endereço:"), site: document.querySelector('a[data-item-id="authority"]')?.href || tira(aria(/^(Website|Site):/), /^(Website|Site):/), telefone: tira(aria(/^Telefone:/), "Telefone:") };
    });
  } finally {
    await ctx.close();
  }
}
