import asyncio
import random
import string
import os
import imaplib
import email
import re
import time
import urllib.parse
from playwright.async_api import async_playwright

# === KONFIGURASI EMAIL BARU ===
GMAIL_BASE = "maximus.sale1"
GMAIL_DOMAIN = "gmail.com"
GMAIL_USERNAME = "maximus.sale1@gmail.com" # Digunakan untuk login IMAP
GMAIL_PASSWORD = "etnv ileo azii egtb"

def generate_random_name(length=7):
    return ''.join(random.choices(string.ascii_letters, k=length)).capitalize()

def generate_random_email():
    """
    Menghasilkan email dengan fitur Gmail Plus Addressing.
    Contoh output: maximus.sale1+anjay123@gmail.com
    """
    # Menentukan panjang string acak antara 5 sampai 12 karakter
    length = random.randint(5, 12)
    # Menghasilkan string acak (kombinasi huruf kecil dan angka)
    random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))
    
    # Merangkai email dengan format [BASE]+[SUFFIX]@[DOMAIN]
    return f"{GMAIL_BASE}+{random_suffix}@{GMAIL_DOMAIN}"

async def type_like_human(page, selector, text):
    await page.locator(selector).wait_for(state="visible")
    await page.locator(selector).click()
    await page.keyboard.type(text, delay=random.randint(30, 100))

# === FUNGSI BARU: Mengambil Link Verifikasi via IMAP ===
def get_confirmation_link(username, password, target_email):
    try:
        print(f"  -> Menghubungkan ke IMAP untuk mencari email tujuan: {target_email}")
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(username, password)
        mail.select("inbox")
        
        # Polling selama 60 detik
        for attempt in range(1, 61):
            # Mencari email dari noreply@skills.google dengan subjek tertentu
            # Kita hilangkan kriteria UNSEEN agar lebih pasti ketemu
            search_query = '(FROM "noreply@skills.google" SUBJECT "Welcome to Google Skills")'
            status, messages = mail.search(None, search_query)
            
            if status == "OK" and messages[0]:
                mail_ids = messages[0].split()
                # Cek 3 email terbaru saja untuk efisiensi
                for m_id in reversed(mail_ids[-50:]):
                    _, msg_data = mail.fetch(m_id, "(RFC822)")
                    for response_part in msg_data:
                        if isinstance(response_part, tuple):
                            msg = email.message_from_bytes(response_part[1])
                            
                            # Ambil isi email (mendukung multipart)
                            content = ""
                            if msg.is_multipart():
                                for part in msg.walk():
                                    if part.get_content_type() in ["text/plain", "text/html"]:
                                        payload = part.get_payload(decode=True).decode(errors="ignore")
                                        content += payload
                            else:
                                content = msg.get_payload(decode=True).decode(errors="ignore")
                            
                            # Verifikasi apakah email ini ditujukan untuk akun yang baru dibuat
                            # Berdasarkan file .eml, alamat email muncul di dalam teks body [cite: 28]
                            if target_email.lower() in content.lower() or target_email.lower() in msg.get("To", "").lower():
                                # Regex untuk mengambil link konfirmasi murni 
                                link_pattern = r'https://www\.skills\.google/users/confirmation\?confirmation_token=[^"\'\s&>]+'
                                match = re.search(link_pattern, content)
                                
                                if match:
                                    link = match.group(0)
                                    # Tambahkan locale jika tidak ada untuk memastikan validitas
                                    if "locale=" not in link:
                                        link += "&locale=en"
                                    
                                    mail.logout()
                                    return link
            
            print(f"     (Percobaan {attempt}/12): Email belum ditemukan, menunggu 5 detik...")
            time.sleep(5)
            
        mail.logout()
    except Exception as e:
        print(f"  ✘ IMAP Error Detail: {e}")
    return None

# === FUNGSI BARU: Mengambil dan Memparsing Proxy dari File ===
def get_proxy(file_path="proxy.txt"):
    if not os.path.exists(file_path):
        return None
    
    with open(file_path, "r") as f:
        # Baca per baris, abaikan baris kosong atau baris komentar (#)
        lines = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]
    
    if not lines:
        return None
        
    # Mengambil satu proxy secara acak (berguna jika ada banyak baris)
    raw_proxy = random.choice(lines)
    
    try:
        # Memecah format http://user:pass@host:port untuk Playwright
        parsed = urllib.parse.urlparse(raw_proxy)
        proxy_dict = {
            "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
        }
        # Masukkan kredensial jika ada
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
    
    # --- Panggil dan siapkan proxy ---
    proxy_config = get_proxy()
    if proxy_config:
        print(f"  -> Menjalankan browser DENGAN Proxy: {proxy_config['server']}")
    else:
        print("  -> Menjalankan browser TANPA Proxy (Gunakan IP Lokal).")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=False,
            no_viewport=True, 
            proxy=proxy_config,  # <--- INJEKSI PROXY DI SINI
            args=[
                "--start-maximized", 
                f"--disable-extensions-except={extension_path}",
                f"--load-extension={extension_path}",
                "--disable-blink-features=AutomationControlled"
            ]
        )
        
        pages = browser.pages
        page = pages[0] if pages else await browser.new_page()
        
        print("Membuka halaman pendaftaran...")
        await page.goto("https://www.skills.google/users/sign_up")
        
        print("Step 1: Klik email button")
        await page.locator("#use-email-and-password-button").wait_for(state="visible")
        await page.locator("#use-email-and-password-button").click()
        await asyncio.sleep(2)
        
        print("Step 2: Input First Name")
        first_name = generate_random_name()
        await type_like_human(page, "#user_first_name", first_name)
        await asyncio.sleep(1.5)
        
        print("Step 3: Input Last Name")
        last_name = generate_random_name()
        await type_like_human(page, "#user_last_name", last_name)
        await asyncio.sleep(1.5)
        
        print("Step 4: Input Email")
        email_address = generate_random_email() # Variabel diubah agar tidak bentrok dengan modul 'email'
        await type_like_human(page, "#user_email", email_address)
        print(f"  -> Email yang dipakai: {email_address}")
        await asyncio.sleep(1.5)
        
        print("Step 5: Input Company")
        company = generate_random_name()
        await type_like_human(page, "#user_company_name", company)
        await asyncio.sleep(1.5)
        
        print("Step 6: Input Passwords")
        await type_like_human(page, "#user_password", "Blink1997")
        await asyncio.sleep(1)
        await type_like_human(page, "#user_password_confirmation", "Blink1997")
        await asyncio.sleep(2)
        
        print("Step 6.5: Input Date of Birth")
        random_day = str(random.randint(1, 31))
        await type_like_human(page, "#dob_day", random_day)
        await asyncio.sleep(1)
        
        random_year = str(random.randint(1926, 2000))
        await type_like_human(page, "#dob_year", random_year)
        await asyncio.sleep(2)
        
        print("Step 7: Scrolling untuk memicu DOM reCAPTCHA...")
        await page.keyboard.press("PageDown")
        await asyncio.sleep(1)
        await page.keyboard.press("PageDown")
        await asyncio.sleep(2)

        print("  -> Mencari iframe reCAPTCHA dan klik checkbox...")
        clicked = False
        for frame in page.frames:
            url = frame.url
            if "recaptcha" in url and "anchor" in url and "invisible" not in url:
                try:
                    checkbox = frame.locator("#recaptcha-anchor, .recaptcha-checkbox-border").first
                    await checkbox.wait_for(state="visible", timeout=5000)
                    await asyncio.sleep(random.uniform(0.5, 1.5))
                    await checkbox.click()
                    print("  ✔ Checkbox reCAPTCHA diklik via frame object!")
                    clicked = True
                    break
                except Exception as e:
                    pass

        if not clicked:
            try:
                iframes = page.locator('iframe[src*="recaptcha"][src*="anchor"]')
                count = await iframes.count()
                for i in range(count):
                    src = await iframes.nth(i).get_attribute("src")
                    if src and "invisible" in src:
                        continue
                    try:
                        frame_loc = page.frame_locator(f'iframe[src="{src}"]')
                        checkbox = frame_loc.locator("#recaptcha-anchor").first
                        await checkbox.click(timeout=5000)
                        print(f"  ✔ Checkbox diklik via locator (iframe {i})!")
                        clicked = True
                        break
                    except Exception:
                        continue
            except Exception as e:
                pass

        await asyncio.sleep(3) 
        
        print("Step 8: Memeriksa dan memicu ekstensi Humans...")
        bframe = None
        for f in page.frames:
            if "bframe" in f.url:
                bframe = f
                break

        if bframe:
            print("  -> Image challenge muncul — memicu ekstensi 'Humans'...")
            max_retries = 3
            success = False
            
            for attempt in range(1, max_retries + 1):
                try:
                    ext_button = bframe.locator('.help-button-holder').first
                    await ext_button.wait_for(state="visible", timeout=10000)
                    await ext_button.click()
                    print(f"  ✔ [Attempt {attempt}] Tombol ekstensi diklik, menunggu bypass (Maks 20 detik)...")

                    success = False
                    for _ in range(40): # Loop 20 detik
                        await asyncio.sleep(0.5)
                        try:
                            token = await page.evaluate('document.getElementById("g-recaptcha-response")?.value')
                            if token:
                                print("  ✔ Sukses! Token reCAPTCHA terdeteksi di latar belakang.")
                                success = True
                                break
                        except: pass
                        
                        try:
                            for af in page.frames:
                                if "recaptcha" in af.url and "anchor" in af.url and "invisible" not in af.url:
                                    is_checked = await af.evaluate('document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true"')
                                    if is_checked:
                                        print("  ✔ Sukses! Centang hijau reCAPTCHA terverifikasi.")
                                        success = True
                                        break
                            if success:
                                break
                        except: pass

                    if success:
                        break # Jika sukses, keluar dari loop retry
                    else:
                        print(f"  ✘ [Attempt {attempt}] Waktu tunggu habis. Ekstensi gagal ngesolve.")
                        if attempt < max_retries:
                            print("  -> Mencoba reload CAPTCHA...")
                            try:
                                reload_btn = bframe.locator('#recaptcha-reload-button').first
                                await reload_btn.click(timeout=5000)
                                await asyncio.sleep(3) # Tunggu gambar baru termuat sebelum loop mengulang klik ekstensi
                            except Exception as err:
                                print(f"  ⚠ Gagal klik tombol reload: {str(err)[:50]}")
                except Exception as e:
                    print(f"  ✘ Gagal memicu ekstensi: {str(e)[:80]}")
                    
            if not success:
                print("  ✘ Gagal melewati reCAPTCHA setelah 3 kali percobaan.")
                # Anda bisa menambahkan exception di sini agar tidak memaksakan klik Create Account
        else:
            print("  ✔ Tidak ada tantangan gambar yang muncul di layar (Auto-pass).")

        await asyncio.sleep(2)

        # === Step 9: Klik Create account ===
        print("Step 9: Klik Create account")
        create_btn = page.locator("button[data-analytics-action='clicked_create_account']").first
        await create_btn.scroll_into_view_if_needed()
        await create_btn.wait_for(state="visible")
        await create_btn.click()
        print("  ✔ Tombol Create Account diklik.")

        # === Step 10: Verifikasi Email via IMAP (Full Revised) ===
        print("Step 10: Menunggu email verifikasi masuk ke Gmail (Maks 60 detik)...")
        
        # Jeda awal 7 detik untuk memberi waktu bagi sistem forwarding email
        await asyncio.sleep(7) 
        
        # Memanggil fungsi IMAP di thread terpisah agar Playwright tetap responsif
        link_verifikasi = await asyncio.to_thread(get_confirmation_link, GMAIL_USERNAME, GMAIL_PASSWORD, email_address)

        if link_verifikasi:
            print(f"  ✔ Link verifikasi ditemukan: {link_verifikasi}")
            print("  -> Membuka link verifikasi di tab yang sama...")
            
            # Membuka link verifikasi di tab browser yang aktif
            await page.goto(link_verifikasi)
            
            # Menunggu hingga halaman verifikasi termuat sepenuhnya (networkidle)
            await page.wait_for_load_state("networkidle")
            print("  ✔ Halaman verifikasi berhasil dimuat.")
            
            # Simpan detail akun (Email dan Password) ke file akun.txt
            try:
                with open("akun.txt", "a") as file:
                    file.write(f"{email_address}:Blink1997\n")
                print(f"  ✔ Akun {email_address} berhasil diverifikasi dan disimpan ke akun.txt")
            except Exception as e:
                print(f"  ✘ Gagal menyimpan ke akun.txt: {e}")
        else:
            print("  ✘ Gagal mendapatkan link verifikasi. Waktu tunggu habis atau email tidak ditemukan.")

        # Penutup sesuai permintaan: Jeda 5 detik sebelum menutup browser
        print("\nSkrip selesai.")
        await asyncio.sleep(5)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
