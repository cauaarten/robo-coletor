// Robô de coleta. Recebe só o número de um pedido; busca os detalhes na API (com o token do cofre),
// executa e devolve o resultado. Não escreve nos registros o que pesquisou nem o que encontrou.
//   node robo.mjs <pedido>      executa um pedido
//   node robo.mjs --fila        fica pegando pedidos parados na fila (uso como reserva)
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buscar, ficha, ehAnuncio } from "./mapas.mjs";
import { lerSite, consultarCnpj } from "./sites.mjs";
import { anunciosMeta, anunciosDoAnunciante, linkBibliotecaMeta } from "./anuncios.mjs";
import { diagnosticar } from "./diagnostico.mjs";
import { contexto, esperar, fechar } from "./nav.mjs";

const API = process.env.ARTEN_API;
const TOKEN = process.env.ROBO_TOKEN;
if (!API || !TOKEN) {
  console.log("faltam variáveis de ambiente");
  process.exit(1);
}
const H = { "x-robo-token": TOKEN, "content-type": "application/json" };
const api = async (caminho, corpo) => {
  const r = await fetch(`${API}${caminho}`, corpo === undefined ? { headers: H } : { method: "POST", headers: H, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`api ${r.status}`);
  return r.json();
};
async function enviar(url, arquivo, tipo) {
  const r = await fetch(url, { method: "PUT", headers: { "content-type": tipo, "x-upsert": "true" }, body: readFileSync(arquivo) });
  if (!r.ok) throw new Error(`envio ${r.status}`);
}

const TAREFAS = {
  async achar(t, etapa) {
    // Busca rápida no Maps para escolher uma clínica (só a lista; o diagnóstico lê o resto depois).
    await etapa("buscando no Google Maps");
    const res = await buscar(t.dados.termo, { maximo: 8 });
    return { resultados: res.map((r) => ({ ...r, site: r.site && !ehAnuncio(r.site) ? r.site : null })) };
  },
  async busca(t, etapa) {
    await etapa("buscando no Google Maps");
    const res = await buscar(`${t.dados.termo} em ${t.dados.cidade}`, { maximo: t.dados.quantas || 20 });
    let i = 0;
    for (const r of res) {
      await etapa(`lendo sites (${++i}/${res.length})`);
      // Na nuvem a lista às vezes vem sem o botão do site: abre a ficha para pegar.
      if (!r.site && !r.patrocinado) {
        const f = await ficha(r.url).catch(() => null);
        let site = f?.site || null;
        if (site && /google\.[^/]+\/url/.test(site)) site = new URL(site).searchParams.get("q");
        if (site) r.site = /^https?:/.test(site) ? site : `https://${site}`;
        if (!r.telefone && f?.telefone) r.telefone = f.telefone;
        await esperar(600);
      }
      if (r.patrocinado || ehAnuncio(r.site)) {
        r.patrocinado = true;
        const f = await ficha(r.url).catch(() => null);
        r.site = f?.site && !/instagram|facebook|wa\.me/.test(f.site) ? `https://${f.site.replace(/^https?:\/\//, "")}` : null;
        await esperar(800);
      }
      if (r.site && /instagram\.com/.test(r.site)) {
        r.instagram = r.site.match(/instagram\.com\/([A-Za-z0-9_.]+)/)?.[1]?.toLowerCase() || null;
        r.site = null;
      }
      if (r.site && /facebook\.com|wa\.me|linktr\.ee/.test(r.site)) r.site = null;
      r.siteInfo = r.site ? await lerSite(r.site) : null;
      const cnpj = r.siteInfo?.cnpj;
      r.cnpjInfo = cnpj ? await consultarCnpj(cnpj) : null;
    }
    return { resultados: res };
  },
  async diagnostico(t, etapa) {
    const pasta = mkdtempSync(path.join(tmpdir(), "diag-"));
    const r = await diagnosticar(t.dados, pasta, etapa, async () => undefined);
    await etapa("enviando os prints");
    for (const [chave, nome] of Object.entries(r.dados.prints)) {
      if (t.envios[nome] && existsSync(path.join(pasta, nome))) await enviar(t.envios[nome], path.join(pasta, nome), "image/png");
      else delete r.dados.prints[chave];
    }
    return r;
  },
  async nicho(t, etapa) {
    const anuncios = [];
    let i = 0;
    for (const termo of t.dados.termos) {
      await etapa(`${++i}/${t.dados.termos.length}`);
      const r = await anunciosMeta(termo, { maximo: 30 }).catch(() => null);
      if (r) for (const a of r.anuncios) anuncios.push({ ...a, termo });
      await esperar(1500);
    }
    return { anuncios };
  },
  async raiox(t, etapa) {
    // Anúncios ativos de cada concorrente no Meta; as 2 primeiras imagens de cada um vão para o armazenamento
    // (o link da Biblioteca expira em poucos dias).
    const pasta = mkdtempSync(path.join(tmpdir(), "raiox-"));
    const nomes = t.dados.nomes || [];
    const concorrentes = [];
    for (const [i, nome] of nomes.entries()) {
      await etapa(`concorrente ${i + 1} de ${nomes.length}`);
      const r = await anunciosDoAnunciante(nome, { maximo: 18 }).catch(() => null);
      if (!r) {
        concorrentes.push({ nome, total: null, videos: 0, maisAntigo: null, anuncios: [], link: linkBibliotecaMeta(nome) });
        continue;
      }
      const anuncios = r.anuncios.slice(0, 6);
      for (const [j, a] of anuncios.slice(0, 2).entries()) {
        const arq = `raiox-${i + 1}-${j + 1}.jpg`;
        if (!a.imagem || !t.envios[arq]) continue;
        try {
          const b = await fetch(a.imagem);
          if (!b.ok) continue;
          writeFileSync(path.join(pasta, arq), Buffer.from(await b.arrayBuffer()));
          await enviar(t.envios[arq], path.join(pasta, arq), "image/jpeg");
          a.arquivo = arq;
        } catch {
          /* fica sem imagem */
        }
      }
      for (const a of anuncios) delete a.imagem;
      concorrentes.push({ nome, total: r.total, videos: r.anuncios.filter((a) => a.video).length, maisAntigo: r.anuncios[0]?.dias ?? null, anuncios, link: r.link });
      await esperar(1500);
    }
    return { concorrentes };
  },
  async slides(t, etapa) {
    await etapa("desenhando os slides");
    const pasta = mkdtempSync(path.join(tmpdir(), "slides-"));
    const ctx = await contexto({ largura: 1920, altura: 1080 });
    const arquivos = [];
    try {
      const p = await ctx.newPage();
      const html = await (await fetch(t.dados.html_url)).text();
      await p.setContent(html, { waitUntil: "networkidle", timeout: 60000 });
      await p.evaluate(() => document.fonts.ready);
      await esperar(800);
      const ids = await p.evaluate(() => [...document.querySelectorAll("section.s")].map((s) => s.id));
      for (const [i, id] of ids.entries()) {
        const nome = `slide-${String(i + 1).padStart(2, "0")}.png`;
        if (!t.envios[nome]) break;
        await (await p.$(`#${id}`)).screenshot({ path: path.join(pasta, nome) });
        await enviar(t.envios[nome], path.join(pasta, nome), "image/png");
        arquivos.push({ nome, id });
      }
    } finally {
      await ctx.close();
    }
    return { arquivos };
  },
  async pdf(t, etapa) {
    // Junta os slides do deck (base + diagnóstico da clínica) num PDF 16:9, uma imagem por página.
    await etapa("juntando o PDF");
    const imgs = t.dados.imagens || [];
    if (!imgs.length) throw new Error("deck sem slides");
    const pasta = mkdtempSync(path.join(tmpdir(), "pdf-"));
    const arq = path.join(pasta, "apresentacao.pdf");
    const ctx = await contexto({ largura: 1920, altura: 1080 });
    try {
      const p = await ctx.newPage();
      const html = `<!doctype html><html><head><style>@page{size:1920px 1080px;margin:0}html,body{margin:0}img{display:block;width:1920px;height:1080px;object-fit:cover;page-break-after:always}img:last-child{page-break-after:auto}</style></head><body>${imgs.map((u) => `<img src="${u}">`).join("")}</body></html>`;
      await p.setContent(html, { waitUntil: "networkidle", timeout: 120000 });
      const faltando = await p.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src));
      if (faltando.length) throw new Error(`${faltando.length} slide(s) não carregaram`);
      await p.pdf({ path: arq, width: "1920px", height: "1080px", printBackground: true });
    } finally {
      await ctx.close();
    }
    await enviar(t.envios["apresentacao.pdf"], arq, "application/pdf");
    return { paginas: imgs.length };
  },
  async contrato(t, etapa) {
    await etapa("preenchendo o contrato");
    const pasta = mkdtempSync(path.join(tmpdir(), "doc-"));
    const modelo = path.join(pasta, "modelo.docx"), dados = path.join(pasta, "dados.json"), saida = path.join(pasta, "saida.docx");
    writeFileSync(modelo, Buffer.from(await (await fetch(t.dados.modelo_url)).arrayBuffer()));
    writeFileSync(dados, JSON.stringify({ campos: t.dados.campos, plano: t.dados.plano }));
    const out = execFileSync("python3", [path.join(path.dirname(new URL(import.meta.url).pathname), "preencher.py"), modelo, dados, saida]).toString();
    await enviar(t.envios["contrato.docx"], saida, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    return JSON.parse(out.trim().split("\n").pop() || "{}");
  },
};

async function executar(id) {
  const t = await api(`/api/robo/trabalho?id=${encodeURIComponent(id)}`);
  if (!t || !TAREFAS[t.tipo]) return;
  const etapa = (e) => api("/api/robo/etapa", { id, etapa: e }).catch(() => undefined);
  try {
    const resultado = await TAREFAS[t.tipo](t, etapa);
    await api("/api/robo/resultado", { id, resultado });
    console.log("pedido concluído");
  } catch (e) {
    await api("/api/robo/resultado", { id, erro: String(e?.message || e).slice(0, 300) }).catch(() => undefined);
    console.log("pedido falhou");
  }
}

if (process.argv[2] === "--fila") {
  for (;;) {
    try {
      const p = await api("/api/robo/proximo");
      if (p?.id) await executar(p.id);
      else await esperar(30000);
    } catch {
      await esperar(60000);
    }
  }
} else {
  await executar(process.argv[2]);
  await fechar();
}
