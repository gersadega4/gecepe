require('dotenv').config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");
const { getRandomFingerprint, applyFingerprint } = require("./fingerprint");

// === 1. KONFIGURASI UTAMA ===
const CONFIG = {
    AKUN_URL: "https://gitlab.com/barbieanay003/seger/-/raw/main/akun.txt",
    SIGNIN_URL: "https://www.skills.google/users/sign_in",
    LAB_URL: "https://www.skills.google/focuses/86502?parent=catalog",
    PROFILES_DIR: path.resolve(__dirname, "profiles"),
    CREDENTIALS_FILE: path.resolve(__dirname, "akun.txt"),
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    DEFAULT_PASS: "Blink1997",
    MIN_DELAY: 2000,
    MAX_DELAY: 5000,
};

// === 2. HELPER DOWNLOADER ===
let LIST_AKUN = []; 

async function loadAccounts() {
    const akunPath = CONFIG.CREDENTIALS_FILE;

    try {
        console.log(`  ↓ Mengunduh akun.txt dari GitLab...`);
        const response = await axios.get(CONFIG.AKUN_URL);
        fs.writeFileSync(akunPath, response.data, 'utf-8');
        console.log(`  ✔ Berhasil menyimpan akun.txt lokal.`);
    } catch (error) {
        console.log(`  ⚠ Gagal mengunduh akun: ${error.message}. Menggunakan file lokal jika ada.`);
    }

    if (!fs.existsSync(akunPath)) throw new Error("File akun.txt tidak ditemukan dan gagal diunduh!");
    
    const lines = fs.readFileSync(akunPath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    const parsedAccounts = lines.map(line => {
        const parts = line.split(':');
        return {
            email: parts[0],
            password: parts[1] || CONFIG.DEFAULT_PASS
        };
    });

    return parsedAccounts;
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
    } catch (e) {}
}

// === 4. FUNGSI EKSEKUSI CLOUD SHELL ===
async function runCloudShell(context, consoleLink, password, projectId, studentEmail = '', studentPassword = '') {
    console.log('\n┌─────────────────────────────────────────');
    console.log('│  Tahap 3 — Eksekusi Cloud Shell');
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
    console.log(`\n🚀 MEMULAI PIPELINE ALL-IN-ONE (MODE GITHUB ACTIONS)`);

    try {
        LIST_AKUN = await loadAccounts();
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
    
    console.log(`  ✔ Ditemukan ${LIST_AKUN.length} akun dalam file.`);

    if (LIST_AKUN.length === 0) {
        console.error("  ✘ Tidak ada akun yang dapat dieksekusi. Keluar.");
        process.exit(1);
    }

    const useHeadless = false; 

    // Fungsi dimodifikasi untuk mereturn nilai (SUCCESS, ERROR, atau ALREADY_RUNNING)
    async function processSinglePipeline(label, email, password) {
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`  ${label}`);
        console.log(`  Data Akun : ${email}`);
        console.log(`${'═'.repeat(50)}`);

        const randomString = Math.random().toString(36).substring(2, 7);
        const emailSlug = email.replace(/[@.]/g, '_') + '_' + Date.now() + '_' + randomString;
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
                "--disable-gpu", 
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
            // TAHAP 1: LOGIN AKUN
            // ==========================================
            console.log(`\n[${label}] ┌─────────────────────────────────────────`);
            console.log(`[${label}] │  Tahap 1 — Login Akun`);
            console.log(`[${label}] └─────────────────────────────────────────`);
            await page.goto(CONFIG.SIGNIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
            await randomDelay(2000, 3000);

            const emailBtn = page.locator('#use-email-and-password-button');
            if (await emailBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                await emailBtn.click();
                await randomDelay(1000, 2000);

                const emailField = page.locator('input[type="email"], input[name="user[email]"], input#user_email');
                await emailField.waitFor({ state: "visible" });
                await emailField.click();
                await humanType(emailField, email);
                await randomDelay(800, 1500);

                const passwordField = page.locator('input[type="password"], input[name="user[password]"], input#user_password');
                await passwordField.click();
                await humanType(passwordField, password);
                await randomDelay(800, 1500);

                const signInBtn = page.locator('ql-button[type="submit"][data-analytics-action="clicked_sign_in"]');
                await signInBtn.click();

                try {
                    await page.waitForURL(url => !url.href.includes("sign_in"), { timeout: 20000 });
                    console.log(`[${label}]  ✔ Login sukses! Redirect ke ${page.url()}`);
                } catch (e) {
                    console.log(`[${label}]  ⚠ Timeout redirect login, asumsikan berhasil dan lanjut ke Lab...`);
                }
            } else {
                console.log(`[${label}]  ✔ Sesi sudah login (tombol login tidak muncul).`);
            }
            await randomDelay(2000, 3000);

            // ==========================================
            // TAHAP 2: BUKA LAB & PENGAWASAN
            // ==========================================
            console.log(`\n[${label}] ┌─────────────────────────────────────────`);
            console.log(`[${label}] │  Tahap 2 — Pengawasan & Ekstrak`);
            console.log(`[${label}] └─────────────────────────────────────────`);
            await page.goto(CONFIG.LAB_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
            await randomDelay(2000, 3000);

            console.log(`[${label}]  ~ Menunggu DOM Lab...`);
            await page.waitForSelector('ql-lab-control-panel', { state: 'attached', timeout: 30000 });
            
            // ----------------------------------------------------
            // BARU: PENGAWAS (WATCHER) STATUS LAB
            // ----------------------------------------------------
            console.log(`[${label}]  ~ Memeriksa apakah Lab sebelumnya masih berjalan...`);
            const isLabAlreadyRunning = await page.evaluate(() => {
                // 1. Cek elemen timer secara visual (pastikan offsetWidth > 0 / tampil di layar)
                const timerDirect = document.querySelector('ql-lab-timer#lab-timer, .lab-timer-container');
                if (timerDirect && timerDirect.offsetWidth > 0 && timerDirect.offsetHeight > 0) {
                    return true;
                }

                // 2. Cek teks "=== Lab Results ===" di seluruh body (Permintaan tambahan)
                // Menggunakan innerText agar hanya merespons teks yang benar-benar terlihat
                if (document.body.innerText && document.body.innerText.includes('=== Lab Results ===')) {
                    return true;
                }

                // 3. Membedah Shadow DOM menggunakan innerText (BUKAN textContent)
                const panel = document.querySelector('ql-lab-control-panel');
                if (!panel) return false;
                
                if (panel.shadowRoot) {
                    // innerText mengabaikan elemen dengan display: none
                    const visibleText = panel.shadowRoot.innerText || ''; 
                    
                    if (visibleText.includes('Batas waktu') || 
                        visibleText.includes('Akhiri Lab') || 
                        visibleText.includes('End Lab') || 
                        visibleText.includes('Time remaining') ||
                        visibleText.includes('=== Lab Results ===')) {
                        return true;
                    }
                }

                // 4. (Opsional) Cek state JSON bawaan Google di atribut elemen
                const attr = panel.getAttribute('labcontrolbutton');
                if (attr) {
                    try {
                        const s = JSON.parse(attr);
                        // Jika JSON state secara eksplisit mengatakan 'running'
                        if (s.running === true) return true;
                    } catch (e) {}
                }

                return false;
            });

            if (isLabAlreadyRunning) {
                console.log(`[${label}]  ⛔ PENGHENTIAN: Lab di akun ini masih BERJALAN/AKTIF!`);
                return "ALREADY_RUNNING"; // Memicu pergantian akun di fungsi utama
            }

            console.log(`[${label}]  ✔ Lab dalam status bersih (belum dimulai). Melanjutkan eksekusi...`);
            // ----------------------------------------------------

            console.log(`[${label}]  → Klik Start Lab...`);
            await page.evaluate(() => {
                const panel = document.querySelector('ql-lab-control-panel');
                if (!panel || !panel.shadowRoot) return;
                const controlBtn = panel.shadowRoot.querySelector('ql-lab-control-button, #lab-control-button');
                if (!controlBtn || !controlBtn.shadowRoot) return;
                const qlBtn = controlBtn.shadowRoot.querySelector('ql-button');
                if (qlBtn) qlBtn.click();
            });

            await randomDelay(3000, 4000);
            
            console.log(`[${label}]  ~ Memeriksa apakah CAPTCHA Lab diperlukan...`);
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
                    console.log(`[${label}]  ✔ Lab mulai berjalan — tidak perlu CAPTCHA!`);
                    labAlreadyStarting = true;
                    break;
                }

                const anchorFrame = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor') && !f.url().includes('invisible'));
                if (anchorFrame) {
                    console.log(`[${label}]  ✔ reCAPTCHA Lab terdeteksi!`);
                    needsCaptcha = true;
                    break;
                }
            }

            if (needsCaptcha) {
                console.log(`[${label}]  → Mengklik checkbox reCAPTCHA Lab...`);
                let clicked = false;
                
                for (const frame of page.frames()) {
                    if (frame.url().includes("recaptcha") && frame.url().includes("anchor")) {
                        try {
                            await frame.locator("#recaptcha-anchor").click({ timeout: 5000 });
                            clicked = true;
                            break;
                        } catch (e) {}
                    }
                }

                if (!clicked) {
                    try {
                        const frameLoc = page.frameLocator('iframe[src*="recaptcha"][src*="anchor"]').first();
                        await frameLoc.locator('#recaptcha-anchor').click({ timeout: 5000 });
                        clicked = true;
                    } catch (e) {}
                }

                await randomDelay(2000, 3000);
                let bframeExists = page.frames().some(f => f.url().includes('bframe'));
                
                if (bframeExists) {
                    console.log(`[${label}]  → Image challenge muncul — memicu ekstensi "Human"...`);
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
                            console.log(`[${label}]  ✔ [Attempt ${attempt}] Tombol ekstensi diklik, menunggu bypass...`);

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
                                console.log(`[${label}]  ✔ Ekstensi berhasil merespons! (Mode: ${bypassOutcome})`);
                                extSolved = true;
                                
                                if (await launchLabLocator.isVisible().catch(() => false)) {
                                    await launchLabLocator.click({ timeout: 5000 }).catch(()=>{});
                                    console.log(`[${label}]  ✔ Tombol modal "Launch Lab" diklik!`);
                                }
                                break; 
                            } else {
                                if (attempt < maxRetries) {
                                    try {
                                        const reloadBtn = page.frameLocator('iframe[src*="bframe"]').first().locator('#recaptcha-reload-button');
                                        if (await reloadBtn.isVisible().catch(()=>false)) {
                                            await reloadBtn.click({ timeout: 5000 });
                                            await randomDelay(3000, 4000);
                                        } else {
                                            extSolved = true; 
                                            break;
                                        }
                                    } catch (err) {}
                                }
                            }
                        } catch (e) {}
                    }
                    if (!extSolved) throw new Error('CAPTCHA gagal dilalui ekstensi');
                } else {
                     const launchLabLocator = page.locator('.js-launch-button.js-lab-access-modal-button, button:has-text("Launch with")').first();
                     if (await launchLabLocator.isVisible({timeout: 2000}).catch(()=>false)) {
                         await launchLabLocator.click();
                     }
                }
            }

            console.log(`[${label}]  ~ Memeriksa status provisioning lab...`);
            let labStarted = false;
            let timeWaited = 0;
            let maxWait = 300000; 
            let smartWaitTriggered = false;

            while (timeWaited < maxWait) {
                try {
                    const domState = await page.evaluate(() => {
                        const result = { isReady: false, estimatedMinutes: 0, isQuotaError: false };
                        const panel = document.querySelector('ql-lab-control-panel');
                        if (!panel) return result; 

                        function analyzeDOM(root) {
                            if (!root) return 0;
                            const text = root.textContent || "";
                            
                            // 1. Cek Error Limit / Kuota (Fail-Fast)
                            const textLower = text.toLowerCase();
                            if (textLower.includes('quota exceeded') || textLower.includes('kuota') || textLower.includes('terlampaui')) {
                                result.isQuotaError = true;
                            }

                            // 2. Ekstrak Waktu (Support 'minute' dan 'menit')
                            const banner = root.querySelector('.provisioning-banner');
                            if (banner) {
                                const match = (banner.textContent || "").match(/(\d+)\s*(minute|menit)/i);
                                if (match) return parseInt(match[1], 10);
                            }
                            
                            const els = root.querySelectorAll('*');
                            for (const el of els) {
                                if (el.shadowRoot) {
                                    const mins = analyzeDOM(el.shadowRoot);
                                    if (mins > 0) return mins;
                                }
                            }
                            return 0;
                        }
                        
                        result.estimatedMinutes = analyzeDOM(panel.shadowRoot || panel);

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
                        }
                        return result;
                    });

                    // 1. Jika terdeteksi Limit Kuota -> Langsung hentikan
                    if (domState.isQuotaError) {
                        console.log(`\n[${label}]  ⛔ Terdeteksi Limit Kuota Google (Quota Exceeded). Membatalkan tunggu...`);
                        throw new Error("QUOTA_EXCEEDED");
                    }

                    // 2. Jika Kredensial Muncul -> Sukses
                    if (domState.isReady) {
                        labStarted = true;
                        process.stdout.write(`\r[${label}]  ✔ Lab berhasil siap dalam waktu ${timeWaited / 1000} detik!        \n`);
                        break; 
                    }

                    // 3. Jika Provisioning Banner Muncul -> Aktifkan Smart Wait
                    if (domState.estimatedMinutes > 0 && !smartWaitTriggered) {
                        smartWaitTriggered = true;
                        const waitMs = (domState.estimatedMinutes * 60 * 1000) + 15000; 
                        console.log(`\n[${label}]  ~ Banner Provisioning Terdeteksi! Estimasi: ${domState.estimatedMinutes} menit.`);
                        console.log(`[${label}]  ~ Skrip akan beristirahat selama ${(waitMs / 1000).toFixed(0)} detik...`);
                        await randomDelay(waitMs, waitMs + 1000);
                        timeWaited += waitMs;
                        maxWait += waitMs; // Perpanjang maxWait agar tidak putus di tengah jalan
                        continue; 
                    }

                } catch (err) {
                    // Tangkap error jika itu berasal dari throw QUOTA_EXCEEDED yang kita buat
                    if (err.message === "QUOTA_EXCEEDED") {
                        throw err; 
                    }
                }

                await randomDelay(2000, 2000);
                timeWaited += 2000;
                
                if (!smartWaitTriggered && timeWaited % 10000 === 0) {
                    process.stdout.write(`\r[${label}]  ~ Menunggu provisioning... (${timeWaited / 1000}s / ${maxWait / 1000}s)`);
                }
            }

            if (!labStarted) {
                console.log("\n");
                throw new Error("Gagal memuat Lab setelah batas maksimal atau limit Quota.");
            }

            let consoleLink = null, username = null, labPassword = null, projectId = null;

            console.log(`[${label}]  → Mengekstrak info lab...`);
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

            console.log(`\n[${label}]  ┌─ Hasil Ekstraksi ──────────────────────`);
            console.log(`[${label}]  │  Console Link : ${consoleLink ? 'OK' : 'FAIL'}`);
            console.log(`[${label}]  │  Username     : ${username || 'FAIL'}`);
            console.log(`[${label}]  │  Password     : ${labPassword || 'FAIL'}`);
            console.log(`[${label}]  │  Project ID   : ${projectId || 'FAIL'}`);
            console.log(`[${label}]  └────────────────────────────────────────`);

            // ==========================================
            // TAHAP 3: RE-LAUNCH TANPA PROXY & EKSEKUSI
            // ==========================================
            if (consoleLink) {
                console.log(`\n[${label}]  → [Sistem] Menghentikan browser ber-proxy...`);
                await context.close();
                await randomDelay(2000, 3000);

                console.log(`[${label}]  → [Sistem] Merestart browser TANPA PROXY untuk Cloud Shell...`);
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

            console.log(`\n[${label}] ┌─────────────────────────────────────────`);
            console.log(`[${label}] │  Selesai! Pipeline Sukses.`);
            console.log(`[${label}] └─────────────────────────────────────────`);
            return "SUCCESS";

        } catch (err) {
            console.error(`[${label}]  ✘ Pipeline Error:`, err.message);
            return "ERROR";
        } finally {
            if (context) await context.close().catch(() => {});
            try {
                if (fs.existsSync(profileDir)) {
                    fs.rmSync(profileDir, { recursive: true, force: true });
                    console.log(`[${label}]  🧹 Clean up: Profile dihapus.`);
                }
            } catch (cleanupErr) {}
        }
    }

    // -----------------------------------------------------------------
    // LOOP EKSEKUSI (RETRY MECHANISM)
    // Akan terus mencari akun acak baru sampai mendapatkan "SUCCESS"
    // atau mencapai batas maksimal (MAX_RETRIES) agar tidak infinite loop
    // -----------------------------------------------------------------
    let isFinished = false;
    let attemptCount = 0;
    const MAX_RETRIES = 15; // Batas aman untuk GitHub Actions

    while (!isFinished && attemptCount < MAX_RETRIES) {
        attemptCount++;
        
        const randomIndex = Math.floor(Math.random() * LIST_AKUN.length);
        const targetAccount = LIST_AKUN[randomIndex];
        
        console.log(`\n================================================================`);
        console.log(` 🔄 ATTEMPT ${attemptCount}/${MAX_RETRIES} | Memilih Akun: ${targetAccount.email}`);
        console.log(`================================================================`);

        const resultStatus = await processSinglePipeline(`Action-Run`, targetAccount.email, targetAccount.password);

        if (resultStatus === "SUCCESS") {
            console.log(`\n  ✔ Operasi eksekusi berhasil pada percobaan ke-${attemptCount}.`);
            isFinished = true;
        } 
        else if (resultStatus === "ALREADY_RUNNING") {
            console.log(`\n  ⚠ Lab pada akun ini sedang berjalan. Skrip akan merestart browser dan mencari akun lain...`);
            await randomDelay(3000, 5000);
        } 
        else {
            console.log(`\n  ✘ Terjadi Error (Timeout/Captcha dll). Skrip akan merestart browser dan mencoba akun lain...`);
            await randomDelay(3000, 5000);
        }
    }

    if (!isFinished) {
        console.log(`\n  ❌ Gagal menyelesaikan pipeline setelah ${MAX_RETRIES} percobaan beruntun. Workflow dihentikan.`);
        process.exit(1);
    }
})();
