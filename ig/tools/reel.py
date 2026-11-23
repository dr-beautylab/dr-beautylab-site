"""당신을그리다 이미지형 릴스 제작기 (09 톤 규격).
사용: python3 reel.py spec.json out.mp4 [--frames DIR]
장면 종류:
  photo : 사진 + (title 상단 | card 하단) + labels
  outro : #FDEFF1 배경 결론
"""
import json, sys, os, subprocess, math, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
BG = (0xFD, 0xEF, 0xF1)
INK = (0x3A, 0x2F, 0x2F)
SUB = (0x9A, 0x8A, 0x8B)
CORAL = (0xE0, 0x5F, 0x49)
LINE = (0xF2, 0xCF, 0xD3)
FD = '/usr/share/fonts/opentype/noto/'


def font(w, size):
    f = {'b': 'NotoSerifCJK-Bold.ttc', 'm': 'NotoSerifCJK-Medium.ttc',
         'r': 'NotoSerifCJK-Regular.ttc', 's': 'NotoSerifCJK-SemiBold.ttc'}[w]
    return ImageFont.truetype(FD + f, size, index=1)


def spaced(d, cx, y, text, fnt, fill, track=8):
    ws = [d.textbbox((0, 0), c, font=fnt)[2] for c in text]
    tot = sum(ws) + track * (len(text) - 1)
    x = cx - tot / 2
    for c, w in zip(text, ws):
        d.text((x, y), c, font=fnt, fill=fill)
        x += w + track


def rich_line(d, cx, y, parts, fnt, maxw=None):
    """parts: [(text, color)] 한 줄을 가운데 정렬. 폭 반환."""
    widths = [d.textlength(t, font=fnt) for t, _ in parts]
    tot = sum(widths)
    if maxw:
        assert tot <= maxw, f'줄이 너무 깁니다: {"".join(t for t,_ in parts)} ({tot:.0f}>{maxw})'
    x = cx - tot / 2
    for (t, c), w in zip(parts, widths):
        d.text((x, y), t, font=fnt, fill=c)
        x += w
    return tot


def parse(line):
    """'흰 드레스는 [[코랄]]' -> [(text,color)]"""
    out, i = [], 0
    while i < len(line):
        a = line.find('[[', i)
        if a < 0:
            out.append((line[i:], INK)); break
        if a > i:
            out.append((line[i:a], INK))
        b = line.find(']]', a)
        out.append((line[a + 2:b], CORAL))
        i = b + 2
    return [p for p in out if p[0]]


def line_h(d, fnt):
    b = d.textbbox((0, 0), '가나다Ag', font=fnt)
    return b[3] - b[1], b[1]


def text_block(d, box, rows, pad=40):
    """rows: [(parts, font, gap_after)] 박스 안에 세로·가로 가운데. 넘치면 실패."""
    x0, y0, x1, y1 = box
    hs = [line_h(d, f) for _, f, _ in rows]
    total = sum(h for h, _ in hs) + sum(g for _, _, g in rows[:-1])
    assert total <= (y1 - y0) - 2 * pad * 0.6, f'카드 안 글자가 너무 큽니다: {rows[0][0]}'
    y = y0 + ((y1 - y0) - total) / 2
    for (parts, f, g), (h, off) in zip(rows, hs):
        rich_line(d, (x0 + x1) / 2, y - off, parts, f, maxw=(x1 - x0) - 2 * pad)
        y += h + g


def cover(img, zoom=1.0, focus_y=0.5):
    s = max(W / img.width, H / img.height) * zoom
    r = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    left = (r.width - W) // 2
    top = int((r.height - H) * focus_y)
    return r.crop((left, top, left + W, top + H))


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


class Scene:
    def __init__(self, spec, base):
        self.s = spec
        self.img = Image.open(os.path.join(base, spec['image'])).convert('RGB') if 'image' in spec else None

    def frame(self, t):
        s = self.s
        dur = s['dur']
        if s['type'] == 'outro':
            return self.outro(t)
        z0, z1 = s.get('zoom', [1.0, 1.04])
        z = z0 + (z1 - z0) * (t / dur)
        im = cover(self.img, z, s.get('focus_y', 0.5))
        top_wash = s.get('top_wash')
        if top_wash:  # 상단만 살짝 흰 덮개 (제목 가독성)
            ov = Image.new('L', (W, H), 0)
            od = ImageDraw.Draw(ov)
            y_end = top_wash
            for y in range(y_end):
                a = int(255 * 0.55 * (1 - (y / y_end) ** 2))
                od.line([(0, y), (W, y)], fill=a)
            im = Image.composite(Image.new('RGB', (W, H), (255, 255, 255)), im, ov)
        im = im.convert('RGBA')
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        # 상단 상호
        spaced(d, W / 2, 70, '당신을 그리다', font('r', 26), SUB + (255,), 8)

        if 'title' in s:
            a = 1.0 if s.get('title_static') else ease(t / 0.3)
            fy = s.get('title_y', 170)
            ft = font('b', s.get('title_size', 64))
            h, off = line_h(d, ft)
            if s.get('kicker'):
                spaced(d, W / 2, fy, s['kicker'], font('m', 32), CORAL + (int(255 * a),), 6)
                fy += 70
            for i, ln in enumerate(s['title']):
                parts = [(p, c + (int(255 * a),)) for p, c in parse(ln)]
                rich_line(d, W / 2, fy - off + i * (h + 26), parts, ft, maxw=W - 120)

        for lab in s.get('labels', []):
            la = ease((t - lab.get('at', 0)) / 0.3)
            if la <= 0:
                continue
            f = font('m', 34)
            b = d.textbbox((0, 0), lab['text'], font=f)
            w, hh = b[2] - b[0], b[3] - b[1]
            cx, cy = lab['x'], lab['y']
            box = (cx - w / 2 - 30, cy, cx + w / 2 + 30, cy + hh + 32)
            d.rounded_rectangle(box, radius=(hh + 32) / 2, fill=(255, 255, 255, int(235 * la)))
            col = (CORAL if lab.get('coral', True) else INK) + (int(255 * la),)
            d.text((cx - w / 2 - b[0], cy + 16 - b[1]), lab['text'], font=f, fill=col)

        if 'card' in s:
            c = s['card']
            at = c.get('at', 0.15)
            p = ease((t - at) / 0.4)
            if p > 0:
                x0, y0, x1, y1 = c.get('box', [70, 1400, 1010, 1760])
                dy = (1 - p) * 50
                card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
                cd = ImageDraw.Draw(card)
                box = (x0, y0 + dy, x1, y1 + dy)
                cd.rounded_rectangle(box, radius=28, fill=(255, 255, 255, int(242 * p)))
                rows = []
                if c.get('label'):
                    rows.append(([(c['label'], CORAL + (int(255 * p),))], font('m', 34), 26))
                fb = font('b', c.get('size', 48))
                for i, ln in enumerate(c['lines']):
                    parts = [(tx, col + (int(255 * p),)) for tx, col in parse(ln)]
                    rows.append((parts, fb, 20))
                text_block(cd, box, rows)
                layer = Image.alpha_composite(layer, card)
        im = Image.alpha_composite(im, layer)
        return im.convert('RGB')

    def outro(self, t):
        s = self.s
        im = Image.new('RGB', (W, H), BG)
        d = ImageDraw.Draw(im)
        a = ease(t / 0.35)
        spaced(d, W / 2, 70, '당신을 그리다', font('r', 26), SUB, 8)
        ft = font('b', 60)
        h, off = line_h(d, ft)
        n = len(s['lines'])
        block = n * h + (n - 1) * 28
        y = 820 - block / 2
        d.rectangle([W / 2 - 60, y - 90, W / 2 + 60, y - 87], fill=CORAL)
        for i, ln in enumerate(s['lines']):
            rich_line(d, W / 2, y - off + i * (h + 28), parse(ln), ft, maxw=W - 140)
        if s.get('note'):
            fn = font('r', 36)
            hh, oo = line_h(d, fn)
            yy = y + block + 110
            for j, nl in enumerate(s['note']):
                col = CORAL if j == len(s['note']) - 1 and s.get('note_coral_last') else SUB
                rich_line(d, W / 2, yy - oo + j * (hh + 18), [(nl, col)], fn, maxw=W - 140)
        spaced(d, W / 2, 1790, '당신을 그리다 · 서울 마곡', font('r', 26), SUB, 8)
        if a < 1:
            im = Image.blend(Image.new('RGB', (W, H), BG), im, a)
        return im


def chime(sr, f=1318.5, dur=0.9, vol=0.12):
    t = np.arange(int(sr * dur)) / sr
    env = np.exp(-t * 5)
    return vol * env * (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2 * t))


def main():
    spec_path, out = sys.argv[1], sys.argv[2]
    frames_dir = sys.argv[sys.argv.index('--frames') + 1] if '--frames' in sys.argv else None
    spec = json.load(open(spec_path))
    base = os.path.dirname(os.path.abspath(spec_path))
    scenes = [Scene(s, base) for s in spec['scenes']]
    if frames_dir:  # 확인용 정지 화면
        os.makedirs(frames_dir, exist_ok=True)
        for i, sc in enumerate(scenes):
            for tt in sc.s.get('check', [sc.s['dur'] - 0.05]):
                sc.frame(tt).save(f'{frames_dir}/s{i+1}_{tt:.2f}.jpg', quality=88)
        return
    tmp = out + '.parts'
    os.makedirs(tmp, exist_ok=True)
    lst = []
    for i, sc in enumerate(scenes):
        part = f'{tmp}/p{i}.mp4'
        n = round(sc.s['dur'] * FPS)
        p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                              '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast',
                              '-crf', '18', '-pix_fmt', 'yuv420p', part + '.tmp.mp4'], stdin=subprocess.PIPE)
        for k in range(n):
            p.stdin.write(sc.frame(k / FPS).tobytes())
        p.stdin.close(); assert p.wait() == 0
        os.replace(part + '.tmp.mp4', part)
        lst.append(f"file '{os.path.abspath(part)}'")
    open(f'{tmp}/list.txt', 'w').write('\n'.join(lst))
    # 효과음: 카드·라벨 등장 시 작은 종소리
    sr = 44100
    total = sum(s.s['dur'] for s in scenes)
    audio = np.zeros(int(sr * (total + 1)))
    t0 = 0
    for sc in scenes:
        hits = []
        if 'card' in sc.s: hits.append(sc.s['card'].get('at', 0.15))
        for lab in sc.s.get('labels', []): hits.append(lab.get('at', 0))
        if sc.s['type'] == 'outro': hits.append(0.05)
        for k, h in enumerate(sorted(set(hits))):
            c = chime(sr, 1318.5 if k % 2 == 0 else 1568.0)
            st = int((t0 + h) * sr); audio[st:st + len(c)] += c[:len(audio) - st]
        t0 += sc.s['dur']
    audio = np.clip(audio[:int(sr * total)], -1, 1)
    with wave.open(f'{tmp}/a.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((audio * 32767).astype(np.int16).tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', f'{tmp}/list.txt',
                    '-i', f'{tmp}/a.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
                    '-shortest', '-movflags', '+faststart', out + '.tmp.mp4'], check=True)
    os.replace(out + '.tmp.mp4', out)


if __name__ == '__main__':
    main()
