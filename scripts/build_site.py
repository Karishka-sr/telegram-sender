"""Собирает статичную версию сайта для GitHub Pages в docs/.

FastAPI-версия рендерит шаблон на сервере, а Pages умеет отдавать только статику,
поэтому шаблон рендерится заранее, пути к ассетам делаются относительными
(сайт живёт в подкаталоге /<repo>/), а адрес бэкенда кладётся в config.js.

    python3 scripts/build_site.py --api-base https://example.com --apk-url https://.../app.apk
"""

import argparse
import os
import shutil

from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES = os.path.join(ROOT, "static", "templates")
STATIC = os.path.join(ROOT, "static")
APK_SRC = os.path.join(ROOT, "downloads", "TelegramSender.apk")

CONFIG_JS = """// Сгенерировано scripts/build_site.py — правьте через повторную сборку.
window.APP_CONFIG = {
    apiBase: "%API_BASE%",
    apkUrl: "%APK_URL%",
};
"""


def build(out_dir: str, api_base: str, apk_url: str) -> None:
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(os.path.join(out_dir, "static", "css"))
    os.makedirs(os.path.join(out_dir, "static", "js"))

    env = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=select_autoescape(["html"]),
    )
    page = env.get_template("index.html").render(configured=True)

    page = page.replace('href="/static/', 'href="static/')
    page = page.replace('src="/static/', 'src="static/')
    page = page.replace('href="/downloads/TelegramSender.apk"', f'href="{apk_url}"')

    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(page)

    shutil.copy(os.path.join(STATIC, "css", "style.css"), os.path.join(out_dir, "static", "css"))
    shutil.copy(os.path.join(STATIC, "js", "app.js"), os.path.join(out_dir, "static", "js"))

    with open(os.path.join(out_dir, "static", "js", "config.js"), "w", encoding="utf-8") as fh:
        fh.write(
            CONFIG_JS.replace("%API_BASE%", api_base.rstrip("/")).replace("%APK_URL%", apk_url)
        )

    # без этого Jekyll выбрасывает файлы, начинающиеся с подчёркивания
    open(os.path.join(out_dir, ".nojekyll"), "w").close()

    # APK кладём рядом со страницей: ссылка остаётся относительной и не зависит от Releases
    if os.path.exists(APK_SRC):
        os.makedirs(os.path.join(out_dir, "downloads"), exist_ok=True)
        shutil.copy(APK_SRC, os.path.join(out_dir, "downloads"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="", help="адрес бэкенда, например https://example.com")
    parser.add_argument("--apk-url", default="TelegramSender.apk", help="ссылка на APK")
    parser.add_argument("--out", default=os.path.join(ROOT, "docs"))
    args = parser.parse_args()

    build(args.out, args.api_base, args.apk_url)
    print(f"Готово: {args.out}")


if __name__ == "__main__":
    main()