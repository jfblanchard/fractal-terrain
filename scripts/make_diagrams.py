#!/usr/bin/env python3
"""Generate the tutorial diagrams into docs/img/.

Clean/minimal per house style: no chartjunk, labels only where they earn
their place. Run from the repo root:

    python3 scripts/make_diagrams.py
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

OUT = "docs/img"
INK = "#e8eef4"
DIM = "#93a4b3"
BG = "#0c121a"
ACCENT = "#6fd0a7"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG,
    "text.color": INK, "axes.edgecolor": DIM,
    "xtick.color": DIM, "ytick.color": DIM,
    "font.family": "DejaVu Sans", "font.size": 11,
})


def fig_path(name):
    import os
    os.makedirs(OUT, exist_ok=True)
    return f"{OUT}/{name}"


# ---------- 1. fBm: octaves stack into a mountain ----------

def octave_stack():
    x = np.linspace(0, 1, 800)
    rng = np.random.default_rng(7)

    def smooth_noise(freq):
        knots = rng.uniform(-1, 1, freq + 1)
        xi = np.linspace(0, freq, 800)
        raw = np.interp(xi, np.arange(freq + 1), knots)
        win = max(1, 800 // (freq * 4))          # smooth harder for low freq
        return np.convolve(raw, np.ones(win) / win, mode="same")

    octaves = [smooth_noise(f) * 0.55 ** i for i, f in enumerate([3, 6, 12, 24])]
    total = sum(octaves)

    fig, axes = plt.subplots(5, 1, figsize=(7, 5.5), sharex=True)
    fig.subplots_adjust(hspace=0.55, left=0.13, right=0.97, top=0.93, bottom=0.08)
    labels = ["octave 1: the big shape", "octave 2: ridges",
              "octave 3: bumps", "octave 4: texture", "sum: a mountain profile"]
    for i, (ax, o) in enumerate(zip(axes[:4], octaves)):
        ax.plot(x, o, color=DIM, lw=1.1)
        ax.set_ylabel(f"×{0.55**i:.2f}", rotation=0, labelpad=22,
                      va="center", color=DIM, fontsize=9)
        ax.set_title(labels[i], fontsize=10, color=INK, loc="left", pad=2)
        ax.set_yticks([]); ax.set_xticks([])
    axes[4].plot(x, total, color=ACCENT, lw=1.8)
    axes[4].fill_between(x, total, total.min() - 0.05, color=ACCENT, alpha=0.15)
    axes[4].set_title(labels[4], fontsize=10, color=ACCENT, loc="left", pad=2)
    axes[4].set_yticks([]); axes[4].set_xticks([])
    fig.savefig(fig_path("fbm_octaves.png"), dpi=160)
    plt.close(fig)


# ---------- 2. diamond-square: three steps on a 9x9 lattice ----------

def diamond_square():
    fig, axes = plt.subplots(1, 3, figsize=(9, 3.2))
    fig.subplots_adjust(wspace=0.08, left=0.03, right=0.97, top=0.88, bottom=0.06)

    def lattice(ax, n=8):
        for i in range(n + 1):
            ax.axhline(i, color=DIM, lw=0.4, alpha=0.5)
            ax.axvline(i, color=DIM, lw=0.4, alpha=0.5)
        ax.set_xlim(-0.4, 8.4); ax.set_ylim(-0.4, 8.4)
        ax.set_xticks([]); ax.set_yticks([]); ax.set_aspect("equal")
        ax.invert_yaxis()

    def dot(ax, x, y, new=False, s=42):
        ax.plot(x, y, "o", color=ACCENT if new else INK,
                markersize=s / 8, zorder=3)

    # step 1: corners only
    lattice(axes[0])
    for x, y in [(0, 0), (8, 0), (0, 8), (8, 8)]:
        dot(axes[0], x, y)
    axes[0].set_title("1. seed the corners", fontsize=10, loc="center")

    # step 2: diamond step fills center (avg of 4 corners + jitter)
    lattice(axes[1])
    for x, y in [(0, 0), (8, 0), (0, 8), (8, 8)]:
        dot(axes[1], x, y)
    for x, y in [(0, 0), (8, 0), (0, 8), (8, 8)]:
        axes[1].plot([x, 4], [y, 4], color=DIM, lw=0.7, ls=":")
    dot(axes[1], 4, 4, new=True)
    axes[1].set_title("2. diamond: center =\navg of 4 corners + jitter",
                      fontsize=10, loc="center")

    # step 3: square step fills edge midpoints (avg of 3-4 neighbors)
    lattice(axes[2])
    for x, y in [(0, 0), (8, 0), (0, 8), (8, 8), (4, 4)]:
        dot(axes[2], x, y)
    for x, y in [(4, 0), (0, 4), (8, 4), (4, 8)]:
        axes[2].plot([x - 4, x, x + 4 if x else 4, x],
                     [y, y - 4 if y else 4, y, y + 4],
                     color=DIM, lw=0.7, ls=":")
        dot(axes[2], x, y, new=True)
    axes[2].set_title("3. square: edges =\navg of neighbors + jitter",
                      fontsize=10, loc="center")
    fig.savefig(fig_path("diamond_square.png"), dpi=160)
    plt.close(fig)


# ---------- 3. height bands colormap ----------

def bands():
    stops = [(0.00, "#8a7a5a", "submerged"), (0.30, "#c2b280", "beach"),
             (0.38, "#4e7d3a", "grass"), (0.62, "#6e6a5e", "rock"),
             (0.82, "#b9b4a8", "scree"), (0.94, "#f4f6f8", "snow")]
    fig, ax = plt.subplots(figsize=(7, 1.5))
    fig.subplots_adjust(left=0.02, right=0.98, top=0.98, bottom=0.32)
    for (t0, c0, _), (t1, c1, _) in zip(stops, stops[1:] + [(1, "#f4f6f8", "")]):
        grad = np.linspace(0, 1, 100).reshape(1, -1)
        from matplotlib.colors import LinearSegmentedColormap
        ax.imshow(grad, extent=[t0, t1, 0, 1], aspect="auto",
                  cmap=LinearSegmentedColormap.from_list("b", [c0, c1]))
    for t, c, name in stops[1:]:
        ax.annotate(name, (t, -0.12), ha="center", va="top",
                    fontsize=9, color=INK, annotation_clip=False)
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    fig.savefig(fig_path("height_bands.png"), dpi=160)
    plt.close(fig)


octave_stack()
diamond_square()
bands()
print("wrote docs/img/{fbm_octaves,diamond_square,height_bands}.png")
