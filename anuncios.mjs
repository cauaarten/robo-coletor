import { contexto, esperar } from "./nav.mjs";
import { readFileSync } from "node:fs";

// Municípios do IBGE ([nome sem acento, UF]) para saber se um anúncio é da região da clínica.
const CIDADES = JSON.parse(readFileSync(new URL("./cidades.json", import.meta.url), "utf8"));
const semAcento = (s) => ` ${(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

// Nomes de cidade que também são palavras comuns em anúncio: no texto, não contam como cidade.
const COMUNS = new Set(["harmonia", "esperanca", "concordia", "liberdade", "progresso", "primavera", "diamante", "paraiso", "vitoria", "estrela", "triunfo", "alegria", "sorriso", "formosa", "encanto", "central", "cristal", "florida"]);
const UFS = new Set(CIDADES.map(([, u]) => u.toLowerCase()));

// true = cita a cidade ou outra do mesmo estado; false = cita só cidade de outro estado; null = não dá para saber.
export function daRegiao(anuncio, cidade) {
  const alvo = semAcento(cidade).trim();
  const uf = CIDADES.find(([n]) => n === alvo)?.[1];
  if (!alvo || !uf) return null;
  // 1) Nome da página: só o trecho depois de um separador ("HUFF LIFE - Lajeado", "Clínica X | Floripa SC").
  //    Sem separador não olha, porque sobrenome também é cidade (Castro, Chaves, Gonzaga).
  const trechos = (anuncio.anunciante || "").split(/\s[-–|·]\s?|[-–|·,/]\s/).slice(1);
  for (const tr of trechos) {
    const p = semAcento(tr).trim().split(" ");
    if (p.length > 1 && UFS.has(p[p.length - 1])) p.pop();
    const nome = p.join(" ");
    if (nome === alvo) return true;
    const achou = CIDADES.find(([n]) => n === nome);
    if (achou) return achou[1] === uf;
  }
  // 2) Texto do anúncio: nomes de 8+ letras, fora as palavras comuns.
  const t = semAcento(`${anuncio.anunciante} ${anuncio.texto}`);
  if (t.includes(` ${alvo} `)) return true;
  let fora = false;
  for (const [n, u] of CIDADES) {
    if (n.length < 8 || COMUNS.has(n) || !t.includes(` ${n} `)) continue;
    if (u === uf) return true;
    fora = true;
  }
  return fora ? false : null;
}

const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
function dataBR(s) {
  const m = s.match(/(\d{1,2}) de (\w{3})\w* de (\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (mes === undefined) return null;
  return new Date(Date.UTC(Number(m[3]), mes, Number(m[1]))).toISOString().slice(0, 10);
}
const normal = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export const linkBibliotecaMeta = (termo) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q=${encodeURIComponent(termo)}&search_type=keyword_unordered&media_type=all`;

export async function anunciosMeta(termo, opcoes = {}) {
  const link = linkBibliotecaMeta(termo);
  const ctx = await contexto({ largura: 1300, altura: 1000 });
  try {
    const p = await ctx.newPage();
    await p.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForFunction(() => /resultado|Nenhum anúncio|Não encontramos/i.test(document.body.innerText), null, { timeout: 25000 }).catch(() => undefined);
    await esperar(2500);
    const maximo = opcoes.maximo || 12;
    for (let i = 0; i < Math.ceil(maximo / 6); i++) {
      await p.mouse.wheel(0, 2500);
      await esperar(1200);
    }
    if (opcoes.print) {
      await p.evaluate(() => window.scrollTo(0, 0));
      await esperar(500);
      await p.screenshot({ path: opcoes.print });
    }
    const r = await p.evaluate(() => {
      const t = document.body.innerText;
      const total = t.match(/[~≈]?\s?([\d.]+)\s+resultados?/i);
      // Cada cartão começa em "Identificação da biblioteca".
      const partes = t.split(/Identificação da biblioteca:\s*/).slice(1);
      const imgs = [...document.querySelectorAll('img[src*="scontent"]')].map((i) => i.src).filter((s) => !/s60x60|p60x60/.test(s));
      return { total: total ? Number(total[1].replace(/\./g, "")) : /Nenhum anúncio|Não encontramos/i.test(t) ? 0 : null, partes, imgs, videos: document.querySelectorAll("video").length };
    });
    const anuncios = r.partes.slice(0, maximo).map((bloco, i) => {
      const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
      const id = linhas[0]?.match(/\d+/)?.[0] || "";
      const iniTxt = linhas.find((l) => /Veiculação iniciada/i.test(l)) || "";
      const inicio = dataBR(iniTxt);
      const iDet = linhas.findIndex((l) => /Ver detalhes do anúncio|Ver detalhes do resumo/i.test(l));
      const anunciante = iDet >= 0 ? linhas[iDet + 1] || "" : "";
      const iPat = linhas.findIndex((l) => l === "Patrocinado");
      const texto = linhas.slice(iPat >= 0 ? iPat + 1 : iDet + 2, (iPat >= 0 ? iPat : iDet) + 12).filter((l) => !/^(Saiba mais|Enviar mensagem|Agendar|Cadastre-se|Ver detalhes|Abrir menu suspenso|Este anúncio tem várias versões)/i.test(l)).join("\n").slice(0, 900);
      return {
        id, anunciante, inicio, dias: inicio ? Math.max(1, Math.round((Date.now() - new Date(inicio).getTime()) / 864e5)) : null, texto,
        plataformas: [/Plataformas/i.test(bloco) ? "meta" : ""].filter(Boolean), video: /0:\d\d|\d:\d\d \/ \d:\d\d/.test(bloco), imagem: r.imgs[i] || null,
      };
    });
    let foraDaRegiao = 0;
    if (opcoes.cidade) {
      // A busca por palavra traz anúncio de qualquer lugar ("Florianópolis" puxa Petrópolis-RJ):
      // tira quem só cita cidade de outro estado e põe primeiro quem cita a região.
      for (const a of anuncios) a.regiao = daRegiao(a, opcoes.cidade);
      foraDaRegiao = anuncios.filter((a) => a.regiao === false).length;
      const vistos = new Set();
      const ficam = anuncios
        .filter((a) => a.regiao !== false)
        .sort((x, y) => (y.regiao === true) - (x.regiao === true))
        .filter((a) => { const k = normal(a.anunciante); if (!k) return true; if (vistos.has(k)) return false; vistos.add(k); return true; });
      anuncios.splice(0, anuncios.length, ...ficam);
    }
    const filtros = (opcoes.filtroAnunciante || []).map(normal).filter((x) => x.length >= 4);
    const daClinica = filtros.length ? anuncios.filter((a) => filtros.some((f) => normal(a.anunciante).includes(f.slice(0, 14)) || f.includes(normal(a.anunciante).slice(0, 14)))).length : anuncios.length;
    return { termo, total: r.total, daClinica, anuncios, foraDaRegiao, print: opcoes.print, link };
  } finally {
    await ctx.close();
  }
}

export async function anunciosGoogle(site, print) {
  const dominio = site.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const link = `https://adstransparency.google.com/?region=BR&domain=${encodeURIComponent(dominio)}`;
  const ctx = await contexto({ largura: 1300, altura: 900 });
  try {
    const p = await ctx.newPage();
    await p.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForFunction(() => /\d+\s+anúncios?|Nenhum anúncio/i.test(document.body.innerText), null, { timeout: 25000 }).catch(() => undefined);
    await esperar(1500);
    if (print) await p.screenshot({ path: print });
    const t = await p.evaluate(() => document.body.innerText);
    const m = t.match(/(?:Mais de\s+)?([\d.]+)\s+anúncios?/i);
    return { dominio, total: m ? Number(m[1].replace(/\./g, "")) : 0, link, print };
  } finally {
    await ctx.close();
  }
}

// Anúncios ativos de um anunciante (busca pelo nome e fica só com os cartões em que ele é o anunciante).
// Lê cada cartão pelo próprio DOM para pegar a imagem (ou a capa do vídeo) daquele anúncio.
export async function anunciosDoAnunciante(nome, opcoes = {}) {
  const link = linkBibliotecaMeta(nome);
  const ctx = await contexto({ largura: 1300, altura: 1000 });
  try {
    const p = await ctx.newPage();
    await p.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForFunction(() => /resultado|Nenhum anúncio|Não encontramos/i.test(document.body.innerText), null, { timeout: 25000 }).catch(() => undefined);
    await esperar(2500);
    const maximo = opcoes.maximo || 18;
    for (let i = 0; i < Math.ceil(maximo / 6); i++) {
      await p.mouse.wheel(0, 2500);
      await esperar(1200);
    }
    const cartoes = await p.evaluate(() => {
      const conta = (t) => (t.match(/Identificação da biblioteca/g) || []).length;
      const ids = [...document.querySelectorAll("span, div")].filter((e) => e.childElementCount === 0 && /Identificação da biblioteca/.test(e.textContent || ""));
      return ids.map((s) => {
        let el = s;
        while (el.parentElement && conta(el.parentElement.innerText || "") <= 1) el = el.parentElement;
        const v = el.querySelector("video");
        const img = [...el.querySelectorAll("img")].filter((i) => i.getBoundingClientRect().width >= 150 || i.naturalWidth >= 300).map((i) => i.src)[0];
        return { texto: el.innerText, video: !!v, imagem: v?.poster || img || null };
      });
    });
    const alvo = normal(nome);
    const anuncios = [];
    for (const c of cartoes) {
      const linhas = c.texto.split("\n").map((l) => l.trim()).filter(Boolean);
      const id = (linhas.find((l) => /Identificação da biblioteca/.test(l)) || "").match(/\d{6,}/)?.[0] || "";
      if (!id || anuncios.some((a) => a.id === id)) continue;
      const inicio = dataBR(linhas.find((l) => /Veiculação iniciada/i.test(l)) || "");
      const iDet = linhas.findIndex((l) => /Ver detalhes do anúncio|Ver detalhes do resumo/i.test(l));
      const anunciante = iDet >= 0 ? linhas[iDet + 1] || "" : "";
      const a = normal(anunciante);
      if (alvo.length < 4 || !a || !(a.includes(alvo.slice(0, 14)) || alvo.includes(a.slice(0, 14)))) continue;
      const iPat = linhas.findIndex((l) => l === "Patrocinado");
      const texto = linhas.slice(iPat >= 0 ? iPat + 1 : iDet + 2, (iPat >= 0 ? iPat : iDet) + 10)
        .filter((l) => !/^(Saiba mais|Enviar mensagem|Agendar|Cadastre-se|Ver detalhes|Abrir menu suspenso|Este anúncio tem várias versões|Fale conosco|Enviar mensagem pelo WhatsApp)/i.test(l)).join("\n").slice(0, 600);
      const versoes = Number(c.texto.match(/(\d+)\s+anúncios? usa/i)?.[1] || 1);
      anuncios.push({ id, anunciante, inicio, dias: inicio ? Math.max(1, Math.round((Date.now() - new Date(inicio).getTime()) / 864e5)) : null, texto, video: c.video, imagem: c.imagem, versoes });
    }
    anuncios.sort((x, y) => (y.dias || 0) - (x.dias || 0));
    return { nome, total: anuncios.length, anuncios, link };
  } finally {
    await ctx.close();
  }
}
