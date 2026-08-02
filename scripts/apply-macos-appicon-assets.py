#!/usr/bin/env python3
import argparse
import json
import os
import plistlib
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAURI_CONFIG = ROOT / "src-tauri" / "tauri.conf.json"
ICON_DOCUMENT = ROOT / "src-tauri" / "icons" / "AppIcon.icon"
ICON_ASSETS = ICON_DOCUMENT / "Assets"
COMPILED_ASSETS = ROOT / "src-tauri" / "icons" / "macos-appicon-build"


RDEVTOOL_SVG = """<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="tile" x1="512" y1="30" x2="512" y2="994" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#08090D"/>
    <stop offset="1" stop-color="#0C0D11"/>
  </linearGradient>
  <radialGradient id="sheen" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(330 220) rotate(36) scale(380 250)">
    <stop offset="0" stop-color="#38445C" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#38445C" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="tile-clip">
    <rect x="30" y="30" width="964" height="964" rx="220"/>
  </clipPath>
</defs>
<g clip-path="url(#tile-clip)">
  <rect x="30" y="30" width="964" height="964" rx="220" fill="url(#tile)"/>
  <ellipse cx="330" cy="220" rx="360" ry="245" fill="url(#sheen)"/>
</g>
<path d="M588.8 148.5L322.6 568.3H486.4L399.4 880.6L737.3 430.1H568.3L588.8 148.5Z" fill="#F8FAFF"/>
<rect x="614.4" y="629.8" width="189.4" height="35.8" rx="17.9" fill="#CDD6E5" fill-opacity="0.9"/>
<rect x="604.2" y="701.4" width="158.7" height="35.8" rx="17.9" fill="#B0BFD8" fill-opacity="0.87"/>
<rect x="588.8" y="773.1" width="133.1" height="35.8" rx="17.9" fill="#9BAECD" fill-opacity="0.82"/>
</svg>
"""


def run(cmd, *, env=None, check=True):
    print("+ " + " ".join(str(part) for part in cmd))
    return subprocess.run(cmd, cwd=ROOT, env=env, check=check)


def load_config():
    with TAURI_CONFIG.open() as fh:
        return json.load(fh)


def developer_env():
    env = os.environ.copy()
    if env.get("DEVELOPER_DIR"):
        return env
    xcode_developer = Path("/Applications/Xcode.app/Contents/Developer")
    if xcode_developer.exists():
        env["DEVELOPER_DIR"] = str(xcode_developer)
    return env


def ensure_actool(env):
    try:
        subprocess.run(
            ["xcrun", "--find", "actool"],
            cwd=ROOT,
            env=env,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        sys.stderr.write(error.stderr)
        raise SystemExit("Xcode actool is required. Install Xcode and select it or set DEVELOPER_DIR.")


def generate_icon_document():
    ICON_ASSETS.mkdir(parents=True, exist_ok=True)
    for name in ["light.svg", "dark.svg"]:
        (ICON_ASSETS / name).write_text(RDEVTOOL_SVG)

    contents = {
        "fill": {
            "solid": "srgb:0.03137,0.03529,0.05098,1.00000",
        },
        "groups": [
            {
                "blur-material": None,
                "layers": [
                    {
                        "blend-mode-specializations": [
                            {
                                "appearance": "dark",
                                "value": "normal",
                            }
                        ],
                        "glass": False,
                        "hidden": False,
                        "image-name-specializations": [
                            {
                                "value": "light.svg",
                            },
                            {
                                "appearance": "dark",
                                "value": "dark.svg",
                            },
                        ],
                        "name": "rDevTool",
                        "position": {
                            "scale": 1,
                            "translation-in-points": [
                                0,
                                0,
                            ],
                        },
                    }
                ],
                "shadow": {
                    "kind": "none",
                    "opacity": 0,
                },
                "specular": False,
                "translucency": {
                    "enabled": False,
                    "value": 0,
                },
            }
        ],
        "supported-platforms": {
            "circles": [
                "watchOS",
            ],
            "squares": "shared",
        },
    }
    with (ICON_DOCUMENT / "icon.json").open("w") as fh:
        json.dump(contents, fh, indent=2)
        fh.write("\n")


def compile_assets(env):
    ensure_actool(env)
    shutil.rmtree(COMPILED_ASSETS, ignore_errors=True)
    COMPILED_ASSETS.mkdir(parents=True, exist_ok=True)
    partial_info = COMPILED_ASSETS / "partial-info.plist"

    run(
        [
            "xcrun",
            "actool",
            str(ICON_DOCUMENT),
            "--compile",
            str(COMPILED_ASSETS),
            "--app-icon",
            "AppIcon",
            "--include-all-app-icons",
            "--enable-on-demand-resources",
            "NO",
            "--development-region",
            "en",
            "--target-device",
            "mac",
            "--platform",
            "macosx",
            "--minimum-deployment-target",
            "10.13",
            "--standalone-icon-behavior",
            "none",
            "--output-partial-info-plist",
            str(partial_info),
            "--warnings",
            "--errors",
        ],
        env=env,
    )

    assets_car = COMPILED_ASSETS / "Assets.car"
    if not assets_car.exists():
        raise SystemExit(f"actool did not create {assets_car}")
    return assets_car, partial_info


def bundle_root(target):
    root = ROOT / "target"
    if target:
        root /= target
    return root / "release" / "bundle"


def app_path(product_name, target):
    return bundle_root(target) / "macos" / f"{product_name}.app"


def merge_plist(info_plist, partial_info):
    with info_plist.open("rb") as fh:
        info = plistlib.load(fh)

    if partial_info.exists():
        with partial_info.open("rb") as fh:
            partial = plistlib.load(fh)
        info.update(partial)

    info["CFBundleIconName"] = "AppIcon"
    info.setdefault("CFBundleIconFile", "icon.icns")

    with info_plist.open("wb") as fh:
        plistlib.dump(info, fh, sort_keys=False)


def patch_app(product_name, assets_car, partial_info, target):
    app = app_path(product_name, target)
    if not app.exists():
        raise SystemExit(f"Missing built app: {app}")

    resources = app / "Contents" / "Resources"
    resources.mkdir(parents=True, exist_ok=True)
    shutil.copy2(assets_car, resources / "Assets.car")
    merge_plist(app / "Contents" / "Info.plist", partial_info)

    run(["codesign", "--force", "--sign", "-", "--deep", str(app)])


def arch_suffix(target):
    if target:
        if target.startswith("aarch64-"):
            return "aarch64"
        if target.startswith("x86_64-"):
            return "x64"
    machine = platform.machine()
    if machine == "arm64":
        return "aarch64"
    if machine in {"x86_64", "amd64"}:
        return "x64"
    return machine


def detach_image_for_path(image_path):
    result = subprocess.run(
        ["hdiutil", "info", "-plist"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        check=True,
    )
    info = plistlib.loads(result.stdout)
    for image in info.get("images", []):
        mounted_image_path = image.get("image-path")
        if not mounted_image_path or Path(mounted_image_path).resolve() != image_path.resolve():
            continue
        for entity in image.get("system-entities", []):
            mount_point = entity.get("mount-point")
            if mount_point:
                run(["hdiutil", "detach", "-force", mount_point], check=False)


def finalize_rw_dmg(output_dmg, dmg_dir):
    rw_images = list(dmg_dir.glob("rw.*.dmg"))
    if not rw_images:
        return False

    rw_image = max(rw_images, key=lambda path: path.stat().st_mtime)
    detach_image_for_path(rw_image)
    output_dmg.unlink(missing_ok=True)
    run(["hdiutil", "convert", str(rw_image), "-format", "UDZO", "-o", str(output_dmg)])
    rw_image.unlink(missing_ok=True)
    return True


def rebuild_dmg(product_name, version, target):
    root = bundle_root(target)
    dmg_dir = root / "dmg"
    macos_dir = root / "macos"
    bundle_script = dmg_dir / "bundle_dmg.sh"
    volume_icon = dmg_dir / "icon.icns"
    output_dmg = dmg_dir / f"{product_name}_{version}_{arch_suffix(target)}.dmg"

    if not bundle_script.exists():
        print(f"Skipping DMG rebuild: missing {bundle_script}")
        return

    output_dmg.unlink(missing_ok=True)
    cmd = [
        str(bundle_script),
        "--volname",
        product_name,
        "--volicon",
        str(volume_icon),
        "--window-size",
        "500",
        "350",
        "--icon-size",
        "96",
        "--text-size",
        "16",
        "--icon",
        f"{product_name}.app",
        "125",
        "170",
        "--hide-extension",
        f"{product_name}.app",
        "--app-drop-link",
        "375",
        "170",
        str(output_dmg),
        str(macos_dir),
    ]

    try:
        run(cmd)
    except subprocess.CalledProcessError:
        if not finalize_rw_dmg(output_dmg, dmg_dir):
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate-only", action="store_true")
    parser.add_argument("--rebuild-dmg", action="store_true")
    parser.add_argument("--target")
    args = parser.parse_args()

    config = load_config()
    product_name = config["productName"]
    version = config["version"]
    env = developer_env()

    generate_icon_document()
    assets_car, partial_info = compile_assets(env)

    if not args.generate_only:
        patch_app(product_name, assets_car, partial_info, args.target)
        if args.rebuild_dmg:
            rebuild_dmg(product_name, version, args.target)

    print("macOS app icon asset catalog is ready.")


if __name__ == "__main__":
    main()
