import asyncio
import random
import string
import os
import re
import time
import urllib.parse
import html
from playwright.async_api import async_playwright

# === FUNGSI BARU: Membaca Domain dari File ===
def get_domains(file_path="domain.txt"):
    """
    Membaca domain dari file TXT. 
    Secara otomatis membuat file dan memberikan fallback jika file tidak ada.
    """
    fallback_domains = ["hotmailvip.tokyo", "d4ngerssquy.info"]
    
    if not os.path.exists(file_path):
        print(f"  ⚠ File {file_path} tidak ditemukan. Membuat file baru dengan domain bawaan...")
        try:
            with open(file_path, "w") as f:
                for d in fallback_domains:
                    f.write(f"{d}\n")
        except Exception as e:
            print(f"  ✘ Gagal membuat file {file_path}: {e}")
        return fallback_domains

    with open(file_path, "r") as f:
        # Membaca file, membuang spasi/newline (.strip()), dan mengabaikan baris kosong
        domains = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]

    if not domains:
        print(f"  ⚠ File {file_path} kosong! Menggunakan domain fallback.")
        return fallback_domains

    return domains

# Inisialisasi daftar domain saat skrip dimuat
DOMAINS_LIST = get_domains()

def generate_random_name(length=7):
    return ''.join(random.choices(string.ascii_letters, k=length)).capitalize()

def generate_random_email():
    """
    Menghasilkan email acak dengan memanggil domain dari variabel global DOMAINS_LIST.
    """
    length = random.randint(7, 12)
    random_user = ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))
    domain = random.choice(DOMAINS_LIST)
    return f"{random_user}@{domain}"

async def type_like_human(page, selector, text):
    await page.locator(selector).wait_for(state="visible")
    await page.locator(selector).click()
    await page.keyboard.type(text, delay=random.randint(30, 100))

# === FUNGSI BARU: Mengambil Link Verifikasi via Web (generator.email) ===
async def get_confirmation_link_web(context, target_email):
    """
    Membuka tab baru, mengakses generator.email, dan melakukan polling
    hingga email konfirmasi ditemukan, mendukung format link raw maupun redirect Google.
    """
    page = await context.new_page()
    try:
        print(f"  -> Membuka tab baru untuk cek inbox: {target_email}")
        
        # Injeksi cookie 'embx' (sering dibutuhkan generator.email untuk me-load inbox spesifik)
        await context.add_cookies([{
            "name": "embx", 
            "value": f"[%22{target_email}%22]", 
            "domain": ".generator.email", 
            "path": "/"
        }])
        
        await page.goto(f"https://generator.email/{target_email}", wait_until="domcontentloaded")
        
        # Polling selama 60 detik (12 percobaan x 5 detik)
        for attempt in range(1, 13):
            print(f"     (Percobaan {attempt}/12): Memindai halaman kotak masuk...")
            
            # Ambil seluruh source HTML halaman
            content = await page.content()
            
            # Pola 1: Format link redirect Google (Sesuai log error terbaru)
            link_pattern_redirect = r'https://notifications\.googleapis\.com/email/redirect\?[^"\'\s>]+'
            
            # Pola 2: Format link murni (Sebagai backup)
            link_pattern_raw = r'https://www\.skills\.google/users/confirmation\?confirmation_token=[^"\'\s&>]+'
            
            # Coba cari pola redirect terlebih dahulu
            match = re.search(link_pattern_redirect, content)
            
            # Jika tidak ada, coba cari pola murni
            if not match:
                match = re.search(link_pattern_raw, content)
            
            if match:
                # Membersihkan entitas HTML (misal: merubah &amp; kembali menjadi &)
                raw_link = html.unescape(match.group(0))
                
                # Hanya tambahkan parameter locale jika itu adalah tautan murni (bukan redirect)
                if "skills.google" in raw_link and "locale=" not in raw_link:
                    raw_link += "&locale=en"
                    
                print("  ✔ Tautan verifikasi ditemukan di kotak masuk!")
                return raw_link
            
            # Jika belum ketemu, refresh halaman
            await asyncio.sleep(5)
            await page.reload(wait_until="domcontentloaded")
            
    except Exception as e:
        print(f"  ✘ Error Scraping Web Email: {e}")
    finally:
        await page.close() # Pastikan tab ekstra selalu ditutup
        
    return None

def get_proxy(file_path="proxy.txt"):
    if not os.path.exists(file_path):
        return None
    with open(file_path, "r") as f:
        lines = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]
    if not lines:
        return None
    raw_proxy = random.choice(lines)
    try:
        parsed = urllib.parse.urlparse(raw_proxy)
        proxy_dict = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
        if parsed.username and parsed.password:
            proxy_dict["username"] = urllib.parse.unquote(parsed.username)
            proxy_dict["password"] = urllib.parse.unquote(parsed.password)
        return proxy_dict
    except Exception as e:
        print(f"  ⚠ Gagal memparsing proxy: {e}")
        return None

async def main():
    extension_path = os.path.abspath("Humans")
    user_data_dir = os.path.abspath("./chrome_profile")
    
    proxy_config = get_proxy()
    if proxy_config:
        print(f"  -> Menjalankan browser DENGAN Proxy: {proxy_config['server']}")
    else:
        print("  -> Menjalankan browser TANPA Proxy.")
    
    async with async_playwright() as p:
# Tentukan string User-Agent yang ingin digunakan
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

        browser_context = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=False,
            no_viewport=True, 
            proxy=proxy_config,
            args=[
                "--start-maximized", 
                f"--disable-extensions-except={extension_path}",
                f"--load-extension={extension_path}",
                "--disable-blink-features=AutomationControlled"
            ]
        )
        
        pages = browser_context.pages
        page = pages[0] if pages else await browser_context.new_page()
        
        print("Membuka halaman pendaftaran...")
        await page.goto("https://www.skills.google/users/sign_up")
        
        print("Step 1: Klik email button")
        await page.locator("#use-email-and-password-button").wait_for(state="visible")
        await page.locator("#use-email-and-password-button").click()
        await asyncio.sleep(2)
        
        print("Step 2-5: Input Data Diri")
        first_name = generate_random_name()
        last_name = generate_random_name()
        company = generate_random_name()
        email_address = generate_random_email()
        
        await type_like_human(page, "#user_first_name", first_name)
        await type_like_human(page, "#user_last_name", last_name)
        await type_like_human(page, "#user_email", email_address)
        print(f"  -> Email yang dipakai: {email_address}")
        await type_like_human(page, "#user_company_name", company)
        
        print("Step 6: Input Passwords & DOB")
        await type_like_human(page, "#user_password", "Blink1997")
        await type_like_human(page, "#user_password_confirmation", "Blink1997")
        
        random_day = str(random.randint(1, 28))
        random_year = str(random.randint(1926, 2000))
        await type_like_human(page, "#dob_day", random_day)
        await type_like_human(page, "#dob_year", random_year)
        await asyncio.sleep(2)
        
        print("Step 7 & 8: Menangani reCAPTCHA...")
        await page.keyboard.press("PageDown")
        await asyncio.sleep(1)
        
        clicked = False
        for frame in page.frames:
            url = frame.url
            if "recaptcha" in url and "anchor" in url and "invisible" not in url:
                try:
                    checkbox = frame.locator("#recaptcha-anchor, .recaptcha-checkbox-border").first
                    await checkbox.wait_for(state="visible", timeout=5000)
                    await checkbox.click()
                    print("  ✔ Checkbox reCAPTCHA diklik via frame object!")
                    clicked = True
                    break
                except Exception: pass

        if not clicked:
            try:
                iframes = page.locator('iframe[src*="recaptcha"][src*="anchor"]')
                count = await iframes.count()
                for i in range(count):
                    src = await iframes.nth(i).get_attribute("src")
                    if src and "invisible" in src: continue
                    try:
                        frame_loc = page.frame_locator(f'iframe[src="{src}"]')
                        checkbox = frame_loc.locator("#recaptcha-anchor").first
                        await checkbox.click(timeout=5000)
                        clicked = True
                        break
                    except Exception: continue
            except Exception: pass

        await asyncio.sleep(3) 
        
        bframe = None
        for f in page.frames:
            if "bframe" in f.url:
                bframe = f
                break

        if bframe:
            print("  -> Memicu ekstensi 'Humans'...")
            for attempt in range(1, 4):
                try:
                    ext_button = bframe.locator('.help-button-holder').first
                    await ext_button.wait_for(state="visible", timeout=10000)
                    await ext_button.click()
                    
                    success = False
                    for _ in range(40):
                        await asyncio.sleep(0.5)
                        try:
                            token = await page.evaluate('document.getElementById("g-recaptcha-response")?.value')
                            if token: success = True; break
                        except: pass
                        
                        try:
                            for af in page.frames:
                                if "recaptcha" in af.url and "anchor" in af.url and "invisible" not in af.url:
                                    is_checked = await af.evaluate('document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true"')
                                    if is_checked: success = True; break
                            if success: break
                        except: pass

                    if success: break
                    else:
                        if attempt < 3:
                            try:
                                reload_btn = bframe.locator('#recaptcha-reload-button').first
                                await reload_btn.click(timeout=5000)
                                await asyncio.sleep(3)
                            except: pass
                except Exception: pass
        
        await asyncio.sleep(2)

        print("Step 9: Klik Create account")
        create_btn = page.locator("button[data-analytics-action='clicked_create_account']").first
        await create_btn.scroll_into_view_if_needed()
        await create_btn.wait_for(state="visible")
        
        # Eksekusi JS click untuk mem-bypass elemen yang menutupi tombol
        await create_btn.evaluate("node => node.click()")
        
        # === Step 10: Verifikasi via Web ===
        print("Step 10: Menunggu sistem mengirim email (Jeda 7 detik)...")
        await asyncio.sleep(7) 
        
        # Memanggil fungsi scraper web dengan melemparkan browser_context
        link_verifikasi = await get_confirmation_link_web(browser_context, email_address)

        if link_verifikasi:
            print(f"  ✔ Mengeksekusi link verifikasi...")
            await page.goto(link_verifikasi)
            await page.wait_for_load_state("networkidle")
            
            try:
                with open("akun.txt", "a") as file:
                    file.write(f"{email_address}:Blink1997\n")
                print(f"  ✔ Akun {email_address} diverifikasi & disimpan ke akun.txt")
            except Exception as e:
                print(f"  ✘ Gagal menyimpan ke file: {e}")
        else:
            print("  ✘ Gagal verifikasi: Waktu tunggu habis / Link tidak ditemukan di generator.email.")

        print("\nSkrip selesai.")
        await asyncio.sleep(5)
        await browser_context.close()

if __name__ == "__main__":
    asyncio.run(main())
