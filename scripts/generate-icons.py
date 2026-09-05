#!/usr/bin/env python3
import sys
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "src-tauri" / "icons"
PREVIEW_DIR = ROOT / "design-previews"

TILE = (11, 12, 16, 255)
TILE_HI = (18, 20, 27, 255)
WHITE = (248, 250, 255, 255)
RAIL = (205, 214, 229, 230)
RAIL_SOFT = (176, 191, 216, 222)
RAIL_MUTED = (155, 174, 205, 210)


def scale_points(points, size):
    return [(round(x * size), round(y * size)) for x, y in points]


def rounded_tile_mask(size):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    margin = round(size * 0.032)
    radius = round(size * 0.215)
    draw.rounded_rectangle(
        (margin, margin, size - 1 - margin, size - 1 - margin),
        radius=radius,
        fill=255,
    )
    return mask


def vertical_gradient(size, top, bottom):
    strip = Image.new("RGBA", (1, size))
    pixels = strip.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        pixels[0, y] = (*color, 255)
    return strip.resize((size, size), Image.Resampling.BICUBIC)


def add_soft_highlight(image, mask):
    size = image.size[0]
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.ellipse(
        (
            round(size * 0.05),
            round(size * 0.03),
            round(size * 0.70),
            round(size * 0.48),
        ),
        fill=(56, 68, 92, 16),
    )
    overlay.putalpha(Image.composite(overlay.getchannel("A"), Image.new("L", image.size, 0), mask))
    return Image.alpha_composite(image, overlay)


def draw_app_icon(size=1024):
    scale = 4
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    mask = rounded_tile_mask(canvas)
    tile = vertical_gradient(canvas, (8, 9, 13), (12, 13, 17))
    tile.putalpha(mask)
    image = Image.alpha_composite(image, add_soft_highlight(tile, mask))

    draw = ImageDraw.Draw(image)

    bolt = [
        (0.575, 0.145),
        (0.315, 0.555),
        (0.475, 0.555),
        (0.390, 0.860),
        (0.720, 0.420),
        (0.555, 0.420),
    ]
    draw.polygon(scale_points(bolt, canvas), fill=WHITE)

    rail_height = round(canvas * 0.035)
    rail_radius = round(rail_height * 0.5)
    rails = [
        (0.600, 0.615, 0.785, RAIL),
        (0.590, 0.685, 0.745, RAIL_SOFT),
        (0.575, 0.755, 0.705, RAIL_MUTED),
    ]
    for x0, y, x1, color in rails:
        draw.rounded_rectangle(
            (
                round(x0 * canvas),
                round(y * canvas),
                round(x1 * canvas),
                round(y * canvas) + rail_height,
            ),
            radius=rail_radius,
            fill=color,
        )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def draw_opaque_app_icon(size):
    background = vertical_gradient(size, (8, 9, 13), (12, 13, 17))
    icon = draw_app_icon(size)
    background.alpha_composite(icon)
    return background


def draw_tray_icon(size=32):
    scale = 8
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    bolt = [
        (0.600, 0.040),
        (0.215, 0.565),
        (0.465, 0.565),
        (0.355, 0.965),
        (0.800, 0.365),
        (0.555, 0.365),
    ]
    draw.polygon(scale_points(bolt, canvas), fill=(255, 255, 255, 255))

    rail_height = round(canvas * 0.065)
    rail_radius = round(rail_height * 0.5)
    rails = [
        (0.610, 0.620, 0.865),
        (0.590, 0.725, 0.805),
        (0.570, 0.830, 0.735),
    ]
    for x0, y, x1 in rails:
        draw.rounded_rectangle(
            (
                round(x0 * canvas),
                round(y * canvas),
                round(x1 * canvas),
                round(y * canvas) + rail_height,
            ),
            radius=rail_radius,
            fill=(255, 255, 255, 255),
        )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def make_preview(app_icon, tray_32, tray_64):
    preview = Image.new("RGBA", (960, 420), (30, 32, 38, 255))
    draw = ImageDraw.Draw(preview)
    x = 48
    for label, size in [("128", 128), ("64", 64), ("32", 32)]:
        sample = app_icon.resize((size, size), Image.Resampling.LANCZOS)
        preview.alpha_composite(sample, (x, 70 + (128 - size) // 2))
        draw.text((x, 220), f"app {label}px", fill=(220, 226, 236, 255))
        x += 190

    x = 48
    for label, size in [("16", 16), ("22", 22), ("32", 32), ("64", 64)]:
        source = tray_64 if size == 64 else tray_32.resize((size, size), Image.Resampling.LANCZOS)
        tile = Image.new("RGBA", (96, 96), (237, 238, 241, 255))
        tile.alpha_composite(source, ((96 - size) // 2, (96 - size) // 2))
        preview.alpha_composite(tile, (x, 292))
        draw.text((x, 392), f"tray {label}px", fill=(220, 226, 236, 255))
        x += 140
    return preview


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    post_export = "--post-export" in sys.argv
    if post_export:
        for path in sorted((ICONS_DIR / "ios").glob("*.png")):
            with Image.open(path) as existing:
                size = existing.size
            draw_opaque_app_icon(size[0]).save(path)
            print(path)
        return

    app_icon = draw_app_icon()
    tray_32 = draw_tray_icon(32)
    tray_64 = draw_tray_icon(64)

    app_icon.save(ICONS_DIR / "rdevtool-app-icon-source.png")
    tray_32.save(ICONS_DIR / "tray-icon.png")
    tray_64.save(ICONS_DIR / "tray-icon@2x.png")
    make_preview(app_icon, tray_32, tray_64).save(PREVIEW_DIR / "rdevtool-icon-preview.png")

    print(ICONS_DIR / "rdevtool-app-icon-source.png")
    print(ICONS_DIR / "tray-icon.png")
    print(ICONS_DIR / "tray-icon@2x.png")
    print(PREVIEW_DIR / "rdevtool-icon-preview.png")


if __name__ == "__main__":
    main()
