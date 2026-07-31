"""Typeset the ScholarPi whitepaper as a PDF, and emit a matching HTML fragment.

Both outputs are generated from whitepaper_content.py so the document embedded
in the Architecture tab and the downloadable PDF cannot drift apart.
"""
import html
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, ListFlowable,
                                ListItem, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import whitepaper_content as C  # noqa: E402

ACCENT = colors.HexColor("#2563eb")
INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#475569")
FAINT = colors.HexColor("#94a3b8")
RULE = colors.HexColor("#cbd5e1")
ABSTRACT_BG = colors.HexColor("#f6f9ff")
TABLE_HEAD = colors.HexColor("#eef4ff")


def styles():
    base = getSampleStyleSheet()
    s = {}
    s["title"] = ParagraphStyle(
        "title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=21,
        leading=26, textColor=INK, spaceAfter=6, alignment=TA_CENTER)
    s["subtitle"] = ParagraphStyle(
        "subtitle", parent=base["Normal"], fontName="Helvetica", fontSize=11.5,
        leading=15, textColor=MUTED, alignment=TA_CENTER, spaceAfter=14)
    s["byline"] = ParagraphStyle(
        "byline", parent=base["Normal"], fontName="Helvetica", fontSize=10,
        leading=14, textColor=INK, alignment=TA_CENTER, spaceAfter=2)
    s["affil"] = ParagraphStyle(
        "affil", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=9,
        leading=12, textColor=MUTED, alignment=TA_CENTER, spaceAfter=1)
    s["version"] = ParagraphStyle(
        "version", parent=base["Normal"], fontName="Helvetica", fontSize=8.5,
        leading=11, textColor=FAINT, alignment=TA_CENTER, spaceAfter=16)

    # The abstract is set as a distinct typographic object: tinted panel, accent
    # rule, narrower measure. It is the one section a reader may read alone, so
    # it should not look like body copy that happens to come first.
    s["abstract_head"] = ParagraphStyle(
        "abstract_head", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9,
        leading=12, textColor=ACCENT, spaceAfter=5)
    s["abstract"] = ParagraphStyle(
        "abstract", parent=base["Normal"], fontName="Helvetica", fontSize=9.5,
        leading=14.2, textColor=INK, alignment=TA_JUSTIFY)

    s["h1"] = ParagraphStyle(
        "h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=13,
        leading=17, textColor=INK, spaceBefore=17, spaceAfter=7)
    s["h2"] = ParagraphStyle(
        "h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=10.8,
        leading=14, textColor=ACCENT, spaceBefore=11, spaceAfter=5)
    s["body"] = ParagraphStyle(
        "body", parent=base["Normal"], fontName="Helvetica", fontSize=9.7,
        leading=14.4, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=8)
    s["bullet"] = ParagraphStyle(
        "bullet", parent=s["body"], spaceAfter=6, leading=14)
    s["cell"] = ParagraphStyle(
        "cell", parent=base["Normal"], fontName="Helvetica", fontSize=8.2,
        leading=11, textColor=INK)
    s["cellhead"] = ParagraphStyle(
        "cellhead", parent=s["cell"], fontName="Helvetica-Bold", textColor=INK)
    s["note"] = ParagraphStyle(
        "note", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8,
        leading=11, textColor=MUTED, spaceBefore=5, spaceAfter=8)
    s["ref"] = ParagraphStyle(
        "ref", parent=base["Normal"], fontName="Helvetica", fontSize=8.4,
        leading=12, textColor=INK, spaceAfter=6, leftIndent=15, firstLineIndent=-15)
    return s


class Doc(BaseDocTemplate):
    """Adds a running footer with page numbers."""

    def __init__(self, path, **kw):
        super().__init__(path, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm,
                         topMargin=19 * mm, bottomMargin=19 * mm, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="main")
        self.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=self._chrome)])

    def _chrome(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        y = self.bottomMargin - 6 * mm
        canvas.line(self.leftMargin, y, self.leftMargin + self.width, y)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(FAINT)
        canvas.drawString(self.leftMargin, y - 4.5 * mm, "ScholarPi Whitepaper v1.0")
        canvas.drawRightString(self.leftMargin + self.width, y - 4.5 * mm, f"Page {doc.page}")
        canvas.restoreState()


def abstract_block(s, width):
    """The abstract, set in a tinted panel with an accent rule."""
    inner = [
        Paragraph("ABSTRACT", s["abstract_head"]),
        Paragraph(C.ABSTRACT, s["abstract"]),
    ]
    t = Table([[inner]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ABSTRACT_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 13),
        ("RIGHTPADDING", (0, 0), (-1, -1), 13),
        ("TOPPADDING", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, ACCENT),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#dbeafe")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def rubric_table(spec, s, width):
    head = [Paragraph(h, s["cellhead"]) for h in spec["headers"]]
    rows = [[Paragraph(c, s["cell"]) for c in r] for r in spec["rows"]]
    col_w = [width * x for x in (0.07, 0.24, 0.53, 0.16)]
    t = Table([head] + rows, colWidths=col_w, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACCENT),
        ("GRID", (0, 0), (-1, -1), 0.25, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ALIGN", (3, 1), (3, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fbfcfe")]),
    ]))
    return t


def bullets(items, s):
    return ListFlowable(
        [ListItem(Paragraph(f"<b>{lead}</b> {body}", s["bullet"]), leftIndent=14)
         for lead, body in items],
        bulletType="bullet", bulletFontSize=7, bulletOffsetY=1,
        leftIndent=13, bulletColor=ACCENT, spaceAfter=8,
    )


def build_pdf(path):
    s = styles()
    doc = Doc(path, title=C.TITLE, author=C.AUTHOR, subject="Research assessment framework")
    W = doc.width
    story = []

    story += [
        Paragraph(C.TITLE, s["title"]),
        Paragraph(C.SUBTITLE, s["subtitle"]),
        Paragraph(C.AUTHOR, s["byline"]),
        Paragraph(C.AFFILIATION, s["affil"]),
        Paragraph(C.VERSION, s["version"]),
        abstract_block(s, W),
        Spacer(1, 6),
    ]

    for sec in C.SECTIONS:
        story.append(Paragraph(f"{sec['n']}. {sec['title']}", s["h1"]))
        for p in sec.get("paras", []):
            story.append(Paragraph(p, s["body"]))
        if sec.get("bullets"):
            story.append(bullets(sec["bullets"], s))
        for sub in sec.get("subsections", []):
            story.append(Paragraph(f"{sub['n']} {sub['title']}", s["h2"]))
            for p in sub.get("paras", []):
                story.append(Paragraph(p, s["body"]))
        if sec.get("table"):
            story.append(KeepTogether([
                rubric_table(sec["table"], s, W),
                Paragraph(sec["table"]["note"], s["note"]),
            ]))
        for p in sec.get("after", []):
            story.append(Paragraph(p, s["body"]))

    story.append(Paragraph("References", s["h1"]))
    for i, ref in enumerate(C.REFERENCES, 1):
        story.append(Paragraph(f"[{i}]&nbsp;&nbsp;{ref}", s["ref"]))

    doc.build(story)
    return path


# ---------------------------------------------------------------------------
# HTML fragment for the Architecture tab
# ---------------------------------------------------------------------------
def esc(t):
    return html.escape(str(t), quote=False)


def build_html(path):
    out = ['<div class="wp">']
    out.append(f'<h2 class="wp-title">{esc(C.TITLE)}</h2>')
    out.append(f'<p class="wp-subtitle">{esc(C.SUBTITLE)}</p>')
    out.append(f'<p class="wp-byline">{esc(C.AUTHOR)} · <span>{esc(C.AFFILIATION)}</span></p>')
    out.append(f'<p class="wp-version">{esc(C.VERSION)}</p>')

    out.append('<section class="wp-abstract"><h3>Abstract</h3>'
               f'<p>{esc(C.ABSTRACT)}</p></section>')

    for sec in C.SECTIONS:
        out.append(f'<h3 class="wp-h1">{esc(sec["n"])}. {esc(sec["title"])}</h3>')
        for p in sec.get("paras", []):
            out.append(f"<p>{esc(p)}</p>")
        if sec.get("bullets"):
            out.append("<ul class='wp-list'>")
            for lead, body in sec["bullets"]:
                out.append(f"<li><strong>{esc(lead)}</strong> {esc(body)}</li>")
            out.append("</ul>")
        for sub in sec.get("subsections", []):
            out.append(f'<h4 class="wp-h2">{esc(sub["n"])} {esc(sub["title"])}</h4>')
            for p in sub.get("paras", []):
                out.append(f"<p>{esc(p)}</p>")
        if sec.get("table"):
            spec = sec["table"]
            out.append('<div class="table-scroll"><table class="data-table wp-table"><thead><tr>')
            out += [f"<th>{esc(h)}</th>" for h in spec["headers"]]
            out.append("</tr></thead><tbody>")
            for r in spec["rows"]:
                out.append("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>")
            out.append("</tbody></table></div>")
            out.append(f'<p class="wp-note">{esc(spec["note"])}</p>')
        for p in sec.get("after", []):
            out.append(f"<p>{esc(p)}</p>")

    out.append('<h3 class="wp-h1">References</h3><ol class="wp-refs">')
    out += [f"<li>{esc(r)}</li>" for r in C.REFERENCES]
    out.append("</ol></div>")

    doc = "\n".join(out)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(doc)
    return path


if __name__ == "__main__":
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    pdf = build_pdf(os.path.join(outdir, "ScholarPi_Whitepaper.pdf"))
    frag = build_html(os.path.join(outdir, "whitepaper.html"))
    print("wrote:", pdf)
    print("wrote:", frag)
