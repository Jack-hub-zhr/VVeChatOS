#!/usr/bin/env python3
"""生成 VVeChat 官方封面壁纸（iOS 15-18 官方系统壁纸那种抽象渐变）。

用法：python3 tools/make-covers.py [输出目录]

做法：每个封面 = 若干条流动的「丝带」，每条丝带是一组控制点上的
平滑曲线，用 numpy 在整张画布上算距离场，取高斯衰减得到颜色权重，
最后按权重做颜色混合 + 竖直渐变 + 轻微噪点。
看着像流体丝绸，和 iOS 官方壁纸是一个路子。
"""
import sys, os, math
import numpy as np
from PIL import Image, ImageFilter

W, H = 1600, 900


def smooth(t):
    return t * t * (3 - 2 * t)


def ribbon(w, h, y0, amp, freq, phase, width, tilt):
    """一条从左到右流动的丝带，返回 (X, Y, dist) —— dist 是到丝带的距离。"""
    xs = np.linspace(0, 1, w)
    # 丝带中线：几个正弦叠加，看起来像布料被风推着走
    cy = (y0
          + amp * np.sin(2 * np.pi * freq * xs + phase)
          + amp * 0.45 * np.sin(2 * np.pi * freq * 2.3 * xs + phase * 1.7 + 1.1)
          + tilt * (xs - 0.5))
    cy = cy * h
    X, Y = np.meshgrid(np.arange(w), np.arange(h))
    # 竖直方向距离丝带中线多远
    dist = np.abs(Y - cy[None, :])
    # 丝带厚度沿 x 缓慢变化，避免机械的等宽
    tw = width * (0.75 + 0.5 * np.sin(2 * np.pi * (freq * 0.7) * xs + phase))
    return X, Y, dist / (tw[None, :] + 1e-6)


def make_cover(name, palette, bg, ribbons, vignette=0.30, grain=3.0):
    w, h = W, H
    yy = np.linspace(0, 1, h)[:, None]
    base = np.zeros((h, w, 3), dtype=np.float64)
    for i in range(3):
        base[:, :, i] = bg[i] * (1 - 0.35 * yy) + bg[i] * 0.25 * yy

    weights = []
    for rb in ribbons:
        X, Y, d = ribbon(w, h, **rb)
        # 高斯软边：中心权重 1，边缘趋 0
        g = np.exp(-(d ** 2))
        # 丝带内部再加一点横向明暗起伏，像布料的褶皱
        g = g * (0.75 + 0.25 * np.sin(X * 0.012 + rb.get('phase', 0)))
        weights.append(g)

    for g, col in zip(weights, palette):
        wgt = g[..., None]
        # 用 "screen" 一样的加色混合，避免颜色叠脏
        base = 1.0 - (1.0 - base) * (1.0 - np.clip(wgt, 0, 1) * np.array(col)[None, None, :])

    # 暗角：把注意力收到中间
    X, Y = np.meshgrid(np.linspace(-1, 1, w), np.linspace(-1, 1, h))
    r = np.sqrt(X ** 2 + (Y * 0.85) ** 2)
    base *= (1 - vignette * np.clip(r - 0.35, 0, None) ** 1.6)[..., None]

    # 轻噪点，去掉塑料感
    rng = np.random.default_rng(abs(hash(name)) % (2 ** 31))
    base += rng.normal(0, grain / 255.0, base.shape)

    img = Image.fromarray(np.clip(base * 255, 0, 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    return img


COVERS = [
    dict(name='cover-01-midnight', bg=(0.05, 0.07, 0.16),
         palette=[(0.10, 0.35, 0.95), (0.05, 0.72, 0.78), (0.35, 0.18, 0.90)],
         ribbons=[dict(y0=0.30, amp=0.13, freq=1.1, phase=0.4, width=150, tilt=0.30),
                  dict(y0=0.62, amp=0.16, freq=0.85, phase=2.1, width=190, tilt=-0.22),
                  dict(y0=0.86, amp=0.10, freq=1.4, phase=4.0, width=120, tilt=0.18)]),
    dict(name='cover-02-sunset', bg=(0.12, 0.06, 0.16),
         palette=[(1.00, 0.52, 0.28), (0.96, 0.32, 0.52), (0.62, 0.32, 0.92)],
         ribbons=[dict(y0=0.28, amp=0.15, freq=0.95, phase=1.2, width=175, tilt=0.26),
                  dict(y0=0.58, amp=0.18, freq=1.25, phase=3.0, width=210, tilt=-0.20),
                  dict(y0=0.84, amp=0.11, freq=0.8, phase=5.2, width=130, tilt=0.14)]),
    dict(name='cover-03-mint', bg=(0.03, 0.11, 0.12),
         palette=[(0.25, 0.92, 0.68), (0.12, 0.72, 0.86), (0.55, 0.95, 0.80)],
         ribbons=[dict(y0=0.32, amp=0.14, freq=1.05, phase=2.4, width=160, tilt=-0.28),
                  dict(y0=0.66, amp=0.15, freq=0.9, phase=0.8, width=195, tilt=0.24),
                  dict(y0=0.90, amp=0.10, freq=1.35, phase=3.6, width=125, tilt=-0.16)]),
    dict(name='cover-04-graphite', bg=(0.07, 0.08, 0.10),
         palette=[(0.62, 0.66, 0.74), (0.30, 0.38, 0.52), (0.86, 0.90, 0.98)],
         ribbons=[dict(y0=0.34, amp=0.13, freq=0.95, phase=1.8, width=170, tilt=0.20),
                  dict(y0=0.64, amp=0.16, freq=1.2, phase=4.4, width=185, tilt=-0.24),
                  dict(y0=0.88, amp=0.09, freq=1.45, phase=2.0, width=115, tilt=0.12)]),
    dict(name='cover-05-aurora', bg=(0.09, 0.04, 0.18),
         palette=[(0.95, 0.30, 0.72), (0.52, 0.34, 0.98), (0.24, 0.80, 0.95)],
         ribbons=[dict(y0=0.26, amp=0.16, freq=1.15, phase=0.9, width=180, tilt=0.30),
                  dict(y0=0.58, amp=0.17, freq=0.85, phase=3.7, width=205, tilt=-0.26),
                  dict(y0=0.85, amp=0.12, freq=1.3, phase=5.5, width=140, tilt=0.20)]),
    dict(name='cover-06-sky', bg=(0.06, 0.12, 0.22),
         palette=[(0.42, 0.72, 1.00), (0.86, 0.94, 1.00), (0.30, 0.55, 0.95)],
         ribbons=[dict(y0=0.30, amp=0.15, freq=0.9, phase=1.5, width=185, tilt=-0.24),
                  dict(y0=0.63, amp=0.14, freq=1.25, phase=4.1, width=165, tilt=0.28),
                  dict(y0=0.88, amp=0.11, freq=1.0, phase=0.3, width=150, tilt=-0.14)]),
]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else \
        os.path.join(os.path.dirname(__file__), '..', 'frontend', 'assets', 'covers')
    out = os.path.abspath(out)
    os.makedirs(out, exist_ok=True)
    for spec in COVERS:
        img = make_cover(spec['name'], spec['palette'], spec['bg'], spec['ribbons'])
        path = os.path.join(out, spec['name'] + '.jpg')
        img.save(path, 'JPEG', quality=88, optimize=True)
        print('写好了', path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    main()
