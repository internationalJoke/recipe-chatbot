# %% [markdown]
# Web Interface part 1: ICA
# 
# 
# 
# %%
shopping_list = ["tomat",
                 "lök",
                 "vitlök"]
# %%
print(type(shopping_list))
# %%

# %%
!playwright install chromium
# %%
"""
Fill the ICA.se shopping basket from a list and go to checkout.
Async version: works from a terminal AND from Jupyter/Spyder/IPython.

Setup:
    pip install playwright
    playwright install chromium

Run from a terminal:
    python ica_shopping.py

Run from Jupyter/Spyder/IPython (a loop is already running there):
    await main()
"""

import asyncio
import re
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

shopping_list = ["tomat",
                 "lök",
                 "vitlök",
                 "nötfärs",
                 "peppar",
                 "parmesanost"]

START_URL = "https://www.ica.se"


async def click_first_visible(locators, timeout=5000):
    """Try several locators in order and click the first one that appears."""
    for loc in locators:
        try:
            await loc.first.wait_for(state="visible", timeout=timeout)
            await loc.first.click()
            return True
        except PWTimeout:
            continue
    return False


async def accept_cookies(page):
    await click_first_visible([
        page.get_by_role("button", name=re.compile(r"(godkänn|acceptera|tillåt).*", re.I)),
        page.locator("#onetrust-accept-btn-handler"),
    ], timeout=4000)  # fine if no cookie banner shows up


async def login(page):
    if not await click_first_visible([
        page.get_by_role("button", name=re.compile(r"^logga in$", re.I)),
        page.get_by_role("link", name=re.compile(r"^logga in$", re.I)),
    ]):
        raise RuntimeError("Could not find the 'Logga in' button")

    await click_first_visible([
        page.get_by_role("button", name=re.compile(r"bankid", re.I)),
        page.get_by_role("link", name=re.compile(r"bankid", re.I)),
        page.get_by_text(re.compile(r"bankid", re.I)),
    ])

    print("\nOpen your BankID app and log in in the browser window.")
    await asyncio.to_thread(
        input, "When you are logged in, press Enter here to continue... ")


async def go_to_shop(page):
    if not await click_first_visible([
        page.get_by_role("link", name=re.compile(r"handla online", re.I)),
        page.get_by_role("button", name=re.compile(r"handla online", re.I)),
    ]):
        raise RuntimeError("Could not find 'Handla online'")
    await page.wait_for_load_state("domcontentloaded")


async def add_item(page, item):
    search = page.get_by_placeholder(re.compile(r"sök produkt", re.I)).first
    await search.wait_for(state="visible", timeout=15000)
    await search.click()
    await search.fill("")
    await search.fill(item)
    await search.press("Enter")
    await page.wait_for_load_state("networkidle")

    # first "Lägg till" button on the result list = first product
    add_btn = page.get_by_role("button", name=re.compile(r"lägg till", re.I)).first
    await add_btn.wait_for(state="visible", timeout=15000)
    await add_btn.click()
    await page.wait_for_timeout(1500)  # give the basket time to update
    print(f"Added: {item}")


async def checkout(page):
    if not await click_first_visible([
        page.get_by_role("button", name=re.compile(r"(varukorg|kundvagn)", re.I)),
        page.get_by_role("link", name=re.compile(r"(varukorg|kundvagn)", re.I)),
    ]):
        raise RuntimeError("Could not find the shopping basket button")

    if not await click_first_visible([
        page.get_by_role("button", name=re.compile(r"gå till kassan", re.I)),
        page.get_by_role("link", name=re.compile(r"gå till kassan", re.I)),
    ]):
        raise RuntimeError("Could not find 'Gå till kassan'")


async def main():
    async with async_playwright() as p:
        # Persistent profile keeps cookies/login between runs
        context = await p.chromium.launch_persistent_context(
            user_data_dir="./ica_profile",
            headless=False,          # BankID login needs a visible browser
            locale="sv-SE",
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(START_URL)

        await accept_cookies(page)
        await login(page)
        await go_to_shop(page)

        for item in shopping_list:
            try:
                await add_item(page, item)
            except Exception as e:
                print(f"Could not add '{item}': {e}")

        closed = asyncio.Event()
        context.on("close", lambda _: closed.set())

        await checkout(page)
        print("\nYou are at the checkout. Finish your order in the browser.")
        print("Close the browser window when you are done.")
        await closed.wait()  # keeps the browser open until you close it


if __name__ == "__main__":
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(main())          # normal terminal
    else:
        # A loop is already running (Jupyter/Spyder). Use: await main()
        print("Event loop detected. Run this in a cell with:  await main()")

# %%
await main()

# %% [markdown]
# Web Interface part 2: Willy's
# %%
"""
Fill the Willys.se shopping basket from a list and go to checkout.
Async version: works from a terminal AND from Jupyter/Spyder/IPython.

Setup:
    pip install playwright
    playwright install chromium

Run from a terminal:
    python willys_shopping.py

Run from Jupyter/Spyder/IPython (a loop is already running there):
    await main()
"""

import asyncio
import re
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

shopping_list = ["tomat",
                 "lök",
                 "vitlök"]

START_URL = "https://www.willys.se"


async def click_first_visible(locators, timeout=5000):
    """Try several locators in order and click the first one that appears."""
    for loc in locators:
        try:
            await loc.first.wait_for(state="visible", timeout=timeout)
            await loc.first.click()
            return True
        except PWTimeout:
            continue
    return False


async def accept_cookies(page):
    await click_first_visible([
        page.get_by_role("button", name=re.compile(r"(godkänn|acceptera|tillåt).*", re.I)),
        page.locator("#onetrust-accept-btn-handler"),
    ], timeout=4000)  # fine if no cookie banner shows up


async def login(page):
    if not await click_first_visible([
        page.get_by_role("button", name=re.compile(r"^logga in$", re.I)),
        page.get_by_role("link", name=re.compile(r"^logga in$", re.I)),
        page.get_by_text(re.compile(r"^logga in$", re.I)),
    ]):
        print("No 'Logga in' button found - you may already be logged in.")
        return

    await click_first_visible([
        page.get_by_role("button", name=re.compile(r"bankid", re.I)),
        page.get_by_role("link", name=re.compile(r"bankid", re.I)),
        page.get_by_text(re.compile(r"bankid", re.I)),
    ])

    print("\nOpen your BankID app and log in in the browser window.")
    await asyncio.to_thread(
        input, "When you are logged in, press Enter here to continue... ")


async def add_item(page, item):
    search = page.get_by_placeholder(re.compile(r"sök", re.I)).first
    await search.wait_for(state="visible", timeout=15000)
    await search.click()
    await search.fill("")
    await search.fill(item)
    await search.press("Enter")
    await page.wait_for_load_state("networkidle")

    # first "+" button on the result list = first product
    if not await click_first_visible([
        page.get_by_role("button", name=re.compile(r"(öka|plus|lägg till|\+)", re.I)),
        page.locator("button[aria-label*='öka' i]"),
        page.locator("button[aria-label*='plus' i]"),
        page.locator("button:has-text('+')"),
    ], timeout=15000):
        raise RuntimeError("Could not find the + button")
    await page.wait_for_timeout(1500)  # give the basket time to update
    print(f"Added: {item}")


async def checkout(page):
    if not await click_first_visible([
        page.get_by_role("button", name=re.compile(r"(varukorg|kundvagn)", re.I)),
        page.get_by_role("link", name=re.compile(r"(varukorg|kundvagn)", re.I)),
    ]):
        raise RuntimeError("Could not find the shopping basket button")

    if not await click_first_visible([
        page.get_by_role("button", name=re.compile(r"(gå )?till kassan", re.I)),
        page.get_by_role("link", name=re.compile(r"(gå )?till kassan", re.I)),
    ]):
        raise RuntimeError("Could not find 'Till kassan'")


async def main():
    async with async_playwright() as p:
        # Persistent profile keeps cookies/login between runs
        context = await p.chromium.launch_persistent_context(
            user_data_dir="./willys_profile",
            headless=False,          # BankID login needs a visible browser
            locale="sv-SE",
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(START_URL)

        await accept_cookies(page)
        await login(page)

        for item in shopping_list:
            try:
                await add_item(page, item)
            except Exception as e:
                print(f"Could not add '{item}': {e}")

        closed = asyncio.Event()
        context.on("close", lambda _: closed.set())

        await checkout(page)
        print("\nYou are at the checkout. Finish your order in the browser.")
        print("Close the browser window when you are done.")
        await closed.wait()  # keeps the browser open until you close it


if __name__ == "__main__":
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(main())          # normal terminal
    else:
        # A loop is already running (Jupyter/Spyder). Use: await main()
        print("Event loop detected. Run this in a cell with:  await main()")

# %%
await main()
