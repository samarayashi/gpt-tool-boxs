from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


SIZES = (16, 48, 128)
OUTPUT_DIR = Path(__file__).parent


def lerp(a, b, t):
    return int(a + (b - a) * t)


def gradient_background(size):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    start = (15, 23, 42)
    mid = (20, 184, 166)
    end = (37, 99, 235)

    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            if t < 0.55:
                k = t / 0.55
                color = tuple(lerp(start[i], mid[i], k) for i in range(3))
            else:
                k = (t - 0.55) / 0.45
                color = tuple(lerp(mid[i], end[i], k) for i in range(3))
            image.putpixel((x, y), (*color, 255))

    return image


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_icon(size):
    scale = 4
    canvas_size = size * scale
    radius = int(canvas_size * 0.22)

    base = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    inset = int(canvas_size * 0.055)
    shadow_draw.rounded_rectangle(
        (inset, inset, canvas_size - inset, canvas_size - inset),
        radius=radius,
        fill=(0, 0, 0, 90),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(canvas_size * 0.025))
    base.alpha_composite(shadow)

    bg = gradient_background(canvas_size)
    mask = rounded_mask(canvas_size, radius)
    base.alpha_composite(Image.composite(bg, Image.new("RGBA", bg.size), mask))

    draw = ImageDraw.Draw(base)

    # Chat bubble.
    bubble = (
        int(canvas_size * 0.20),
        int(canvas_size * 0.22),
        int(canvas_size * 0.72),
        int(canvas_size * 0.66),
    )
    bubble_radius = int(canvas_size * 0.09)
    draw.rounded_rectangle(bubble, radius=bubble_radius, fill=(255, 255, 255, 245))
    draw.polygon(
        [
            (int(canvas_size * 0.34), int(canvas_size * 0.64)),
            (int(canvas_size * 0.25), int(canvas_size * 0.78)),
            (int(canvas_size * 0.46), int(canvas_size * 0.66)),
        ],
        fill=(255, 255, 255, 245),
    )

    line_color = (31, 41, 55, 160)
    line_width = max(1, int(canvas_size * 0.035))
    x1 = int(canvas_size * 0.31)
    x2 = int(canvas_size * 0.61)
    for y in (0.36, 0.48):
        yy = int(canvas_size * y)
        draw.rounded_rectangle(
            (x1, yy, x2, yy + line_width),
            radius=line_width // 2,
            fill=line_color,
        )

    # Delete badge.
    badge_center = (int(canvas_size * 0.68), int(canvas_size * 0.68))
    badge_radius = int(canvas_size * 0.19)
    draw.ellipse(
        (
            badge_center[0] - badge_radius,
            badge_center[1] - badge_radius,
            badge_center[0] + badge_radius,
            badge_center[1] + badge_radius,
        ),
        fill=(239, 68, 68, 255),
    )

    minus_width = max(2, int(canvas_size * 0.045))
    minus_half = int(canvas_size * 0.095)
    draw.rounded_rectangle(
        (
            badge_center[0] - minus_half,
            badge_center[1] - minus_width // 2,
            badge_center[0] + minus_half,
            badge_center[1] + minus_width // 2,
        ),
        radius=minus_width,
        fill=(255, 255, 255, 255),
    )

    return base.resize((size, size), Image.Resampling.LANCZOS)


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    for size in SIZES:
        draw_icon(size).save(OUTPUT_DIR / f"icon{size}.png")


if __name__ == "__main__":
    main()
