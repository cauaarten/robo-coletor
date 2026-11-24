"""Preenche um modelo .docx: troca os campos «...» pelos valores recebidos e marca a opção escolhida.

Uso: uv run --with python-docx python3 preencher_contrato.py modelo.docx dados.json saida.docx
dados.json: {"campos": {"NOME OU RAZÃO SOCIAL": "...", ...}, "plano": "start|black"}
Campos sem valor continuam amarelos para preencher à mão.
"""
import json
import re
import sys

from docx import Document
from docx.enum.text import WD_COLOR_INDEX

modelo, arq_dados, saida = sys.argv[1:4]
dados = json.load(open(arq_dados, encoding="utf-8"))
campos = {k: v for k, v in dados.get("campos", {}).items() if v}
plano = dados.get("plano", "")
NOMES = {"start": "LIFT Start", "black": "LIFT Black", "pro": "LIFT Black"}

doc = Document(modelo)


def paragrafos(d):
    for p in d.paragraphs:
        yield p
    for t in d.tables:
        for r in t.rows:
            for c in r.cells:
                yield from c.paragraphs
    for s in d.sections:
        for parte in (s.header, s.footer):
            yield from parte.paragraphs


faltando = set()
for p in paragrafos(doc):
    for run in p.runs:
        t = run.text
        if "«" in t:
            def troca(m):
                chave = m.group(1)
                if chave in campos:
                    return campos[chave]
                faltando.add(chave)
                return m.group(0)
            novo = re.sub(r"«([^»]+)»", troca, t)
            if novo != t:
                run.text = novo
                if "«" not in novo:
                    run.font.highlight_color = None
        if plano and "☐" in run.text and NOMES.get(plano, "@@") in run.text:
            linhas = run.text.split("\n")
            run.text = "\n".join(l.replace("☐", "☒") if NOMES[plano] in l else l for l in linhas)

doc.save(saida)
print(json.dumps({"faltando": sorted(faltando)}, ensure_ascii=False))
