#!/usr/bin/env python3
"""Render docs/architecture.html to docs/architecture.png (3200x2320). Needs playwright (tests/requirements.txt)."""
import asyncio
import os

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1600, "height": 1160}, device_scale_factor=2)
        await pg.goto("file://" + os.path.join(HERE, "architecture.html"))
        await pg.wait_for_timeout(1500)
        await pg.evaluate("document.fonts.ready")
        await (await pg.query_selector("#d")).screenshot(path=os.path.join(HERE, "architecture.png"))
        await b.close()

asyncio.run(main())
