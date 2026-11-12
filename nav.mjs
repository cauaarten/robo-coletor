// Navegador compartilhado (Chromium do Playwright).
import { chromium } from "playwright";
let b = null;
export async function navegador() {
  if (!b) b = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  return b;
}
export async function contexto(o = {}) {
  return (await navegador()).newContext({ locale: "pt-BR", viewport: { width: o.largura || 1400, height: o.altura || 900 }, deviceScaleFactor: o.escala || 1 });
}
export async function fechar() {
  if (b) await b.close();
  b = null;
}
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
