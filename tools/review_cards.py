#!/usr/bin/env python3
"""RunClubTürkiye — 360° Yarış Değerlendirmesi Instagram post (1080x1350) + story (1080x1920).
Kullanım: python3 review_cards.py veri.json cikti_klasoru
veri.json: {"race":"Merrell İstanbul Ultra","date":"5 Eylül 2026","place":"Kemerburgaz, İstanbul",
            "score":"8.5","verdict":"Kısa karar cümlesi (en fazla ~120 karakter)","slug":"..."}
Gerekenler: fonttools, rsvg-convert. Fontlar ilk çalışmada GitHub'dan indirilir."""
import sys, os, json, math, subprocess, urllib.request, textwrap
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
FD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.fonts')
FONTS = {'Archivo.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf',
         'Inter.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf'}
OR, INK, W = '#E8622A', '#121010', '#FFFFFF'
R_PATH = 'M37 95V27h27c15 0 24 9 24 21s-9 21-24 21H37M61 69l25 26'
_c = {}
def font(name, **ax):
    os.makedirs(FD, exist_ok=True); p = os.path.join(FD, name)
    if not os.path.exists(p): urllib.request.urlretrieve(FONTS[name], p)
    k = (name, tuple(sorted(ax.items())))
    if k not in _c: _c[k] = instantiateVariableFont(TTFont(p), ax)
    return _c[k]
BX = lambda: font('Archivo.ttf', wght=900, wdth=118)
HV = lambda: font('Archivo.ttf', wght=800, wdth=125)
IN = lambda w=500: font('Inter.ttf', wght=w, opsz=28)
def tp(f, text, size, x=0, y=0, tracking=0, anchor='start'):
    gs = f.getGlyphSet(); cm = f.getBestCmap(); s = size / f['head'].unitsPerEm
    names = [cm.get(ord(c), cm.get(ord('?'))) for c in text]
    adv = [gs[n].width * s for n in names]; tot = sum(adv) + tracking * (len(text) - 1)
    if anchor == 'middle': x -= tot / 2
    elif anchor == 'end': x -= tot
    out = []; cx = x
    for n, a in zip(names, adv):
        pen = SVGPathPen(gs); gs[n].draw(TransformPen(pen, (s, 0, 0, -s, cx, y))); out.append(pen.getCommands()); cx += a + tracking
    return ' '.join(out), tot
def P(f, text, size, x, y, fill, anchor='start', tracking=0, op=1):
    d, _ = tp(f, text, size, x, y, tracking, anchor); return f'<path d="{d}" fill="{fill}" opacity="{op}"/>'
def wrapw(f, text, size, maxw):
    words = text.split(); lines = []; cur = ''
    for w_ in words:
        t = (cur + ' ' + w_).strip()
        if tp(f, t, size)[1] <= maxw: cur = t
        else: lines.append(cur); cur = w_
    if cur: lines.append(cur)
    return lines
def rmark(x, y, sz):
    k = sz / 120
    return (f'<g transform="translate({x},{y}) scale({k})"><rect width="120" height="120" rx="30" fill="{OR}"/><g fill="none" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{R_PATH}" stroke="#fff" stroke-width="25"/><path d="{R_PATH}" stroke="{OR}" stroke-width="14"/><path d="{R_PATH}" stroke="#fff" stroke-width="3" stroke-dasharray="6.5 5.5"/></g></g>')
def brand(x, y, h=56, anchor='start'):
    f = BX(); size = h / 0.70; d1, w1 = tp(f, 'RUNCLUB', size, tracking=-size * .02)
    s2 = size * .40; _, w2 = tp(HV(), 'TÜRKİYE', s2); tr = (w1 - w2) / 6
    d2, _ = tp(HV(), 'TÜRKİYE', s2, tracking=tr)
    icon = h * 1.55; tot = icon + icon * .2 + w1
    ox = x - tot / 2 if anchor == 'middle' else x
    g = rmark(ox, y - icon * .5, icon)
    tx = ox + icon * 1.2; ty = y + h * .1
    g += f'<path transform="translate({tx},{ty - h*0.35})" d="{d1}" fill="#fff"/><path transform="translate({tx},{ty - h*0.35 + s2*0.72 + size*0.16})" d="{d2}" fill="{OR}"/>'
    return g
def bg(w, h):
    s = f'<rect width="{w}" height="{h}" fill="{INK}"/>'
    for i in range(-h, w + h, 70): s += f'<line x1="{i}" y1="{h}" x2="{i + h * .55}" y2="0" stroke="#fff" stroke-opacity=".05" stroke-width="3"/>'
    s += f'<circle cx="{w * .9}" cy="{h * .08}" r="{w * .48}" fill="{OR}" opacity=".18"/>'
    return s
def score_ring(cx, cy, r, score):
    try: v = float(str(score).replace(',', '.'))
    except: v = 0
    frac = max(0, min(1, v / 10)); a = 2 * math.pi * frac - math.pi / 2
    x2 = cx + r * math.cos(a); y2 = cy + r * math.sin(a); large = 1 if frac > .5 else 0
    s = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="{r*.16}"/>'
    if frac > 0: s += f'<path d="M{cx} {cy - r} A{r} {r} 0 {large} 1 {x2:.1f} {y2:.1f}" fill="none" stroke="{OR}" stroke-width="{r*.16}" stroke-linecap="round"/>'
    s += P(BX(), str(score).replace('.', ','), r * .58, cx, cy + r * .16, '#fff', 'middle', tracking=-r * .02)
    s += P(IN(600), '/ 10', r * .17, cx, cy + r * .48, '#CFC6BF', 'middle')
    return s
def card(d, w, h, story=False):
    b = bg(w, h); m = 90
    top = 250 if story else 150
    b += P(HV(), '360° YARIŞ DEĞERLENDİRMESİ', 34, m, top, OR, tracking=4)
    lines = wrapw(BX(), d['race'], 104 if not story else 112, w - 2 * m)[:3]
    sz = 104 if not story else 112; y = top + 30 + sz
    for l in lines: b += P(BX(), l, sz, m, y, '#fff', tracking=-2); y += sz * 1.05
    b += P(IN(500), f"{d.get('date','')} · {d.get('place','')}".strip(' ·'), 38, m, y + 10, '#CFC6BF')
    cy = y + (300 if story else 230); r = 150 if story else 130
    b += score_ring(m + r, cy, r, d.get('score', ''))
    vx = m + 2 * r + 50; vlines = wrapw(IN(600), '“' + d.get('verdict', '') + '”', 36, w - vx - m + 10)[:5]
    vy = cy - (len(vlines) - 1) * 24 + 10
    for l in vlines: b += P(IN(600), l, 36, vx, vy, '#fff'); vy += 50
    by = cy + r + (150 if story else 110)
    sec = ['Organizasyon', 'Parkur', 'Atmosfer', 'SWOT']
    x = m
    for s_ in sec:
        _, tw = tp(IN(600), s_, 30); b += f'<rect x="{x}" y="{by-46}" width="{tw+44}" height="64" rx="32" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>' + P(IN(600), s_, 30, x + 22, by - 3, '#fff'); x += tw + 60
    if story:
        b += f'<rect x="{m}" y="{h-470}" width="{w-2*m}" height="130" rx="65" fill="{OR}"/>' + P(BX(), 'Raporun tamamı sitede', 50, w / 2, h - 388, '#fff', 'middle')
        b += P(IN(600), 'runclubturkiye.com · Linke dokun ↑', 36, w / 2, h - 290, '#CFC6BF', 'middle')
        b += brand(w / 2, h - 170, 54, 'middle')
    else:
        b += f'<rect x="{m}" y="{h-240}" width="{w-2*m}" height="110" rx="55" fill="{OR}"/>' + P(BX(), 'Tüm rapor runclubturkiye.com’da', 42, w / 2, h - 170, '#fff', 'middle')
        b += brand(w / 2, h - 70, 40, 'middle')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{b}</svg>'
if __name__ == '__main__':
    d = json.load(open(sys.argv[1], encoding='utf-8')); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
    base = d.get('slug') or 'yaris-degerlendirmesi'
    for nm, (w, h, st) in {'post': (1080, 1350, False), 'story': (1080, 1920, True)}.items():
        svg = card(d, w, h, st); sp = os.path.join(out, f'{base}-{nm}.svg'); open(sp, 'w').write(svg)
        subprocess.run(['rsvg-convert', '-w', str(w), '-h', str(h), sp, '-o', os.path.join(out, f'{base}-{nm}-{w}x{h}.png')], check=True); os.remove(sp)
    print('ok', out)
