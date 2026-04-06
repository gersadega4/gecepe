import asyncio
import random
import string
import os
import re
import html
import urllib.parse
import tempfile
import shutil
from playwright.async_api import async_playwright

# === 1. LOGIKA DOMAIN (Dynamic) ===
def load_domains(file_path="domain.txt"):
    fallback = ["hotmailvip.tokyo", "d4ngerssquy.info"]
    if not os.path.exists(file_path):
        return fallback
    with open(file_path, "r") as f:
        domains = [line.strip() for line in f if line.strip()]
    return domains if domains else fallback

LIST_DOMAIN = load_domains()

# === 2. LOGIKA PROXY ===
def get_proxy_config():
    proxy_file = "proxy.txt"
    if not os.path.exists(proxy_file):
        print("  ⚠  proxy.txt tidak ditemukan — berjalan tanpa proxy.")
        return None
    try:
        with open(proxy_file, "r") as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith('#')]
            if not lines: return None
            proxy_str = lines[0]

        parsed = urllib.parse.urlparse(proxy_str)
        server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
        config = {"server": server}
        
        if parsed.username:
            config["username"] = urllib.parse.unquote(parsed.username)
        if parsed.password:
            config["password"] = urllib.parse.unquote(parsed.password)
            
        print(f"  ✔ Proxy Aktif: {server}")
        return config
    except Exception as e:
        print(f"  ✘ Gagal memproses proxy: {e}")
        return None

def generate_random_name(length=7):
    return ''.join(random.choices(string.ascii_letters, k=length)).capitalize()

def generate_random_email():
    length = random.randint(7, 12)
    random_user = ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))
    domain = random.choice(LIST_DOMAIN)
    return f"{random_user}@{domain}"

async def type_like_human(page, selector, text):
    await page.locator(selector).wait_for(state="visible")
    await page.locator(selector).click()
    await page.keyboard.type(text, delay=random.randint(40, 110))

# === 3. SCRAPER EMAIL ===
async def get_confirmation_link_web(context, target_email):
    page = await context.new_page()
    try:
        print(f"  -> Membuka inbox: {target_email}")
        await context.add_cookies([{"name": "embx", "value": f"[%22{target_email}%22]", "domain": ".generator.email", "path": "/"}])
        await page.goto(f"https://generator.email/{target_email}", wait_until="domcontentloaded")
        
        for attempt in range(1, 16):
            print(f"     (Percobaan {attempt}/15): Memindai inbox...")
            content = await page.content()
            raw_link = r'https://www\.skills\.google/users/confirmation\?confirmation_token=[^"\'\s&>]+'
            redirect_link = r'https://notifications\.googleapis\.com/email/redirect\?[^"\'\s>]+'
            
            match = re.search(raw_link, content) or re.search(redirect_link, content)
            if match:
                link = html.unescape(match.group(0))
                if "locale=" not in link: link += "&locale=en"
                print("  ✔ Tautan verifikasi ditemukan!")
                return link
            await asyncio.sleep(6)
            await page.reload(wait_until="domcontentloaded")
    except Exception as e:
        print(f"  ✘ Error Scraper: {e}")
    finally:
        await page.close()
    return None

# === 4. MAIN PROCESS (Single Run) ===
async def main():
    print(f"\n{'='*45}")
    print("🚀 MEMULAI PROSES REGISTRASI (SINGLE RUN)")
    print(f"{'='*45}")

    extension_path = os.path.abspath("Humans")
    
    # Buat direktori profil sementara
    temp_profile_dir = tempfile.mkdtemp(prefix="chrome_profile_single_")
    proxy_config = get_proxy_config()
    browser_context = None

    async with async_playwright() as p:
        try:
            # no_viewport=True memaksa ukuran jendela penuh
            browser_context = await p.chromium.launch_persistent_context(
                user_data_dir=temp_profile_dir,
                headless=False,
                proxy=proxy_config,
                no_viewport=True, 
                args=[
                    "--start-maximized", 
                    f"--disable-extensions-except={extension_path}",
                    f"--load-extension={extension_path}",
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox"
                ]
            )
            
            page = browser_context.pages[0] if browser_context.pages else await browser_context.new_page()
            
            print("Membuka pendaftaran...")
            await page.goto("https://www.skills.google/users/sign_up")
            
            await page.locator("#use-email-and-password-button").click()
            email_addr = generate_random_email()
            print(f"  → Data Akun: {email_addr}")
            
            await type_like_human(page, "#user_first_name", generate_random_name())
            await type_like_human(page, "#user_last_name", generate_random_name())
            await type_like_human(page, "#user_email", email_addr)
            await type_like_human(page, "#user_company_name", generate_random_name())
            await type_like_human(page, "#user_password", "Blink1997")
            await type_like_human(page, "#user_password_confirmation", "Blink1997")
            await type_like_human(page, "#dob_day", str(random.randint(1, 28)))
            await type_like_human(page, "#dob_year", str(random.randint(1970, 2000)))
            
            print("Step 7: Scrolling reCAPTCHA...")
            await page.keyboard.press("PageDown")
            await asyncio.sleep(2)

            for frame in page.frames:
                if "recaptcha" in frame.url and "anchor" in frame.url:
                    try: await frame.locator("#recaptcha-anchor").click(timeout=5000); break
                    except: pass
            
            await asyncio.sleep(3)

            # Deteksi awal apakah ada challenge gambar
            initial_bframe = next((f for f in page.frames if "bframe" in f.url), None)
            captcha_solved = False

            if initial_bframe:
                print("  → Image challenge terdeteksi — memulai loop retry (3x)...")
                max_retries = 3
                for attempt in range(1, max_retries + 1):
                    try:
                        # [KUNCI LOGIKA FIX]: Cari ulang iframe di setiap iterasi
                        current_bframe = next((f for f in page.frames if "bframe" in f.url), None)
                        
                        if not current_bframe:
                            print(f"  ⚠ [Attempt {attempt}] Frame captcha hilang, mencari kembali...")
                            await asyncio.sleep(2)
                            continue

                        ext_button = current_bframe.locator('.help-button-holder').first
                        await ext_button.wait_for(state="visible", timeout=10000)
                        await ext_button.click()
                        print(f"  ✔ [Attempt {attempt}] Ekstensi diklik...")

                        success_inner = False
                        for _ in range(40): # Polling bypass sukses selama 20 detik
                            await asyncio.sleep(0.5)
                            token = await page.evaluate('document.getElementById("g-recaptcha-response")?.value')
                            if token and len(token) > 10:
                                success_inner = True; break
                            
                            for af in page.frames:
                                if "recaptcha" in af.url and "anchor" in af.url:
                                    is_checked = await af.evaluate('document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true"')
                                    if is_checked: success_inner = True; break
                            if success_inner: break
                        
                        if success_inner:
                            print("  ✔ reCAPTCHA Berhasil (Bypass).")
                            captcha_solved = True
                            break # Bypass sukses, keluar dari loop retry
                        else:
                            print(f"  ✘ [Attempt {attempt}] Ekstensi gagal memproses gambar.")
                            if attempt < max_retries:
                                try:
                                    print("  ↻ Memuat ulang gambar reCAPTCHA...")
                                    await current_bframe.locator('#recaptcha-reload-button').click(timeout=5000)
                                    await asyncio.sleep(4) # Waktu tunggu kritis
                                except Exception as e:
                                    print(f"  ⚠ Gagal menekan tombol reload: {str(e).splitlines()[0][:40]}")
                    except Exception as e:
                        print(f"  ✘ Error Attempt {attempt}: {str(e).splitlines()[0][:60]}")
            else:
                print("  ✔ Tidak ada tantangan gambar (Auto-pass).")
                captcha_solved = True 

            if not captcha_solved:
                print("  ✘ FATAL: Gagal reCAPTCHA. Proses dihentikan.")
                return 

            print("Step 9: Klik Create account")
            create_btn = page.locator("button[data-analytics-action='clicked_create_account']").first
            await create_btn.scroll_into_view_if_needed()
            await create_btn.evaluate("node => node.click()")

            reg_ok = False
            try:
                await page.wait_for_url(lambda url: "sign_up" not in url, timeout=20000)
                print(f"  ✔ BERHASIL: Redirect ke {page.url}")
                reg_ok = True
            except:
                print("  ✘ GAGAL: Registrasi ditolak sistem.")

            if reg_ok:
                print("Step 10: Menunggu email verifikasi (Maks 60 detik)...")
                await asyncio.sleep(10)
                link = await get_confirmation_link_web(browser_context, email_addr)

                if link:
                    try:
                        print(f"  -> Mengeksekusi link verifikasi (Fast Mode)...")
                        await page.goto(link, wait_until="commit", timeout=30000)
                        print(f"  ✔ Sinyal verifikasi terkirim via Proxy.")
                        
                        with open("akun.txt", "a") as f:
                            f.write(f"{email_addr}:Blink1997\n")
                        print(f"  ✔ Akun {email_addr} sukses tersimpan.")
                        await asyncio.sleep(5) 
                    except:
                        print(f"  ⚠ Navigasi timeout, akun tetap disimpan sebagai fallback.")
                        with open("akun.txt", "a") as f:
                            f.write(f"{email_addr}:Blink1997\n")
                else:
                    print("  ✘ Gagal: Link tidak ditemukan di generator.email.")

        finally:
            # Pembersihan Resource secara Mutlak
            if browser_context:
                await browser_context.close()
            
            try:
                shutil.rmtree(temp_profile_dir, ignore_errors=True)
                print(f"  🧹 Clean up: Temporary profile dihapus secara permanen.")
                print(f"{'='*45}\n")
            except Exception as e:
                print(f"  ⚠ Gagal menghapus folder profil sementara: {e}")

if __name__ == "__main__":
    asyncio.run(main())
