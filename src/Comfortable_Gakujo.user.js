// ==UserScript==
// @name         Comfortable Gakujo
// @namespace    http://tampermonkey.net/
// @version      1.11.0
// @description  READMEを必ず読んでからご利用ください：https://github.com/woody-1227/Comfortable-Gakujo/blob/main/README.md
// @author       woody_1227
// @match        https://gakujo.shizuoka.ac.jp/*
// @match        https://idp.shizuoka.ac.jp/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @updateURL    https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/Comfortable_Gakujo.user.js
// @downloadURL  https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/Comfortable_Gakujo.user.js
// @icon         https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/icon.png
// ==/UserScript==

(function () {
    'use strict';

    const version = "1.11.0";
    const updateURL = "https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/Comfortable_Gakujo.user.js";

    function waitForDomStability({
        timeout = 10000,
        stableTime = 500
    } = {}) {
        return new Promise((resolve, reject) => {
            let lastMutation = Date.now();

            const observer = new MutationObserver(() => {
                lastMutation = Date.now();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            const start = Date.now();

            const check = () => {
                const now = Date.now();

                if (now - lastMutation >= stableTime) {
                    observer.disconnect();
                    resolve();
                } else if (now - start > timeout) {
                    observer.disconnect();
                    reject(new Error("DOM stability timeout"));
                } else {
                    requestAnimationFrame(check);
                }
            };

            check();
        });
    }

    function waitForSelector(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();

            const timer = setInterval(() => {
                const el = document.querySelector(selector);
                if (el) {
                    clearInterval(timer);
                    resolve(el);
                } else if (Date.now() - start > timeout) {
                    clearInterval(timer);
                    reject(new Error(`Timeout: ${selector}`));
                }
            }, 50);
        });
    }

    window.addEventListener("load", async () => {
        sessionStorage.removeItem("cg_grade_nav");

        try {
            console.log("[CG] window load");

            await waitForDomStability();

            console.log("[CG] DOM stabilized");

            if (document.title === "ホーム画面（学生・保護者）") {
                await waitForSelector(".index-container");
            }

            if (document.title === "課題・アンケートリスト") {
                await waitForSelector("#dataTable01");
            }

            console.log("[CG] page ready → start");

            startComfortableGakujo();

        } catch (e) {
            console.warn("[CG] initialization failed:", e);
        }
    });

    const setCookie = (name, value, days = 365) => {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
    };

    const getCookie = (name) => {
        return document.cookie
            .split("; ")
            .find(row => row.startsWith(name + "="))
            ?.split("=")[1];
    };

    const deleteCookie = (name) => {
        document.cookie = `${name}=; max-age=0; path=/`;
    };

    // Resolve only known form submissions; never execute scripts from fetched HTML.
    function pageSubmission(doc, baseURL, control) {
        const source = `${control?.getAttribute("onclick") || ""} ${control?.getAttribute("href") || ""}`;
        const match = source.match(/postSubmit\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);
        if (!match && control?.matches("a[href]") && !/^(javascript:|#)/i.test(control.getAttribute("href"))) {
            const url = new URL(control.getAttribute("href"), baseURL);
            if (url.origin !== location.origin) throw new Error("学情以外への送信はできません。");
            return { url, data: new FormData(), method: "GET" };
        }
        const buttonMatch = source.match(/submitFormButton\(\s*\$\(this\)\s*,\s*['"]([^'"]+)['"]/);
        const formId = control?.getAttribute("formid") || control?.getAttribute("form");
        const form = match ? doc.getElementById(match[1]) : formId ? doc.getElementById(formId) : control?.closest("form");
        if (!form) throw new Error("送信フォームが見つかりません。");
        const action = match ? match[2] : buttonMatch ? buttonMatch[1] : control.getAttribute("formaction") || form.getAttribute("action");
        if (!action) throw new Error("送信先が見つかりません。");
        const url = new URL(action, baseURL);
        if (url.origin !== location.origin) throw new Error("学情以外への送信はできません。");
        const data = new FormData(form);
        if (!match && control.name) data.append(control.name, control.value);
        return { url, data, method: match || buttonMatch ? "POST" : (form.getAttribute("method") || "GET").toUpperCase() };
    }

    function explicitSubmission(doc, baseURL, formId, action) {
        const form = doc.getElementById(formId);
        if (!form) throw new Error("学情のフォームが見つかりません。");
        return { url: new URL(action, baseURL), data: new FormData(form), method: "POST" };
    }

    async function fetchPage(request) {
        const url = new URL(request.url);
        const options = { method: request.method, credentials: "same-origin", cache: "no-store" };
        const body = new URLSearchParams(request.data);
        if (request.method === "GET") {
            body.forEach((value, key) => url.searchParams.append(key, value));
        } else {
            options.body = body;
        }
        const response = await fetch(url, options);
        if (!response.ok || new URL(response.url).origin !== location.origin) {
            throw new Error("ページ取得に失敗しました。再ログインが必要な可能性があります。");
        }
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        return { doc, url: new URL(doc.querySelector("base[href]")?.getAttribute("href") || response.url, response.url).href };
    }

    async function openCreditInfo(button) {
        if (button.dataset.cgBusy) return;
        button.dataset.cgBusy = "1";
        try {
            const dashboard = await fetchPage(explicitSubmission(document, location.href, "emptyForm", "SC_15005B00_01/init"));
            if (dashboard.doc.title !== "成績ダッシュボード") throw new Error("成績ダッシュボードを取得できませんでした。");
            const info = await fetchPage(pageSubmission(dashboard.doc, dashboard.url, Array.from(dashboard.doc.querySelectorAll(".c-btn-submit01")).find(control => control.textContent.trim() === "成績情報詳細")));
            if (info.doc.title !== "成績情報") throw new Error("成績情報を取得できませんでした。");
            const request = pageSubmission(info.doc, info.url, Array.from(info.doc.querySelectorAll(".c-btn-submit01")).find(control => control.textContent.trim() === "単位修得情報照会"));
            // Only the destination is displayed, using fresh fields from the fetched page.
            const form = document.createElement("form");
            form.method = request.method;
            form.action = request.url.href;
            form.hidden = true;
            for (const [name, value] of request.data) {
                if (typeof value !== "string") continue;
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = name;
                input.value = value;
                form.appendChild(input);
            }
            document.body.appendChild(form);
            HTMLFormElement.prototype.submit.call(form);
            form.remove();
        } catch (error) {
            console.warn("[CG] 単位情報取得失敗", error);
            alert("単位情報を取得できませんでした。成績メニューから開くか、再ログイン後にお試しください。");
        } finally {
            delete button.dataset.cgBusy;
        }
    }

    function gradeSnapshot(doc) {
        const table = doc.getElementById("02");
        if (!table || !table.querySelector('td[data-label="成績報告時期"]')) {
            throw new Error("成績明細の表を確認できませんでした。");
        }
        // Ignore sorting, pagination controls, and presentation-only whitespace.
        return Array.from(table.querySelectorAll("tbody tr"), row =>
            Array.from(row.querySelectorAll("td[data-label]"), cell =>
                [cell.getAttribute("data-label"), cell.textContent.replace(/\s+/g, " ").trim()]
            )
        ).filter(row => row.length).map(row => JSON.stringify(row)).sort();
    }

    let gradeCheckRunning = false;
    async function checkGradeUpdates() {
        if (gradeCheckRunning || getCookie("cg_grade_save_enabled") !== "1") return;
        gradeCheckRunning = true;
        try {
            let page = await fetchPage(explicitSubmission(document, location.href, "SC_01002B00_Form", "SC_01002B00_01/studentRecordAnnouncementContentsLink"));
            const detail = Array.from(page.doc.querySelectorAll("a, button, input[type=submit]")).find(control =>
                (control.textContent || control.value || "").replace(/\s/g, "").includes("成績情報詳細"));
            if (detail) page = await fetchPage(pageSubmission(page.doc, page.url, detail));
            const hash = "detail-v1:" + await sha256(JSON.stringify(gradeSnapshot(page.doc)));
            if (getCookie("cg_grade_save_enabled") !== "1") return;
            const previous = decodeURIComponent(getCookie("cg_grade") || "");
            if (previous.startsWith("detail-v1:") && previous !== hash) setCookie("cg_grade_updated", "1");
            setCookie("cg_grade", hash);
            showUpdateNotice();
        } catch (error) {
            console.warn("[CG] 成績更新確認失敗（前回のデータを保持）", error);
        } finally {
            gradeCheckRunning = false;
        }
    }

    function showUpdateNotice() {
        if (getCookie("cg_grade_updated") !== "1") return (false);
        if (document.title !== "ホーム画面（学生・保護者）") return (false);
        if (document.getElementsByClassName("cg-grade-notice-container").length > 0) return (false);

        const indexContainer = document.getElementsByClassName("index-container")[0];
        const cContents = indexContainer?.getElementsByClassName("c-contents")[0];

        const notice = document.createElement("div");
        notice.className = "cg-grade-notice-container";
        notice.innerHTML = `<button class="cg-grade-notice-button c-main-menu-btn" onclick="showLoading();postSubmit('SC_01002B00_Form', 'SC_01002B00_01/studentRecordAnnouncementContentsLink')"><i class="c-icon-notice" aria-hidden="true" style="margin-right: 0.5em"></i>成績が更新されました</button>`;

        const style = document.createElement('style');
        style.textContent = `
                .cg-grade-notice-container {
                    margin-top: 10px;
                    margin-bottom: 40px;
                }

                .cg-grade-notice-button {
                    height: 5rem;
                    width: 100%;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    position: relative;
                    margin: 0 auto;
                    padding: 1em 2em;
                    overflow: hidden;
                    border: none;
                    border-radius: 0.5rem;
                    color: #fff;
                    font-weight: 600;
                    font-size: 2.4rem;
                    cursor: pointer;
                }

                .cg-grade-notice-button::before {
                    display: block;
                    position: absolute;
                    top: -50%;
                    left: -30%;
                    transform: rotate(30deg);
                    width: 70px;
                    height: 100px;
                    content: '';
                    background-image: linear-gradient(left, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 1) 50%, rgba(255, 255, 255, 0) 100%);
                    background-image: -webkit-gradient(linear, left bottom, right bottom, color-stop(0%, rgba(255, 255, 255, 0)), color-stop(50%, rgba(255, 255, 255, 1)), color-stop(100%, rgba(255, 255, 255, 0)));
                    animation: animation-cg-grade-notice-button 3s infinite linear;
                }

                @keyframes animation-cg-grade-notice-button {
                    17% {
                        left: 120%;
                    }
                    100% {
                        left: 120%;
                    }
                }

                .cg-grade-notice-button::after {
                    content: '';
                    transform: rotate(45deg);
                    width: 0.5em;
                    height: 0.5em;
                    margin-left: 0.5em;
                    border-top: 2px solid #fff;
                    border-right: 2px solid #fff;
                }
            `;

        if (!document.querySelector('style[data-cg-grade-notice]')) {
            style.setAttribute('data-cg-grade-notice', 'true');
            document.head.appendChild(style);
        }

        if (cContents) {
            cContents.insertBefore(notice, cContents.firstChild);
        }

        return (true);
    }

    async function sha256(text) {
        const uint8 = new TextEncoder().encode(text)
        const digest = await crypto.subtle.digest('SHA-256', uint8)
        return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('')
    }

    function formatTimeLeft(ms, precision = 0) {
        const d = Math.floor(ms / (1000 * 60 * 60 * 24));
        const h = Math.floor(ms / (1000 * 60 * 60)) % 24;
        const m = Math.floor(ms / (1000 * 60)) % 60;
        const s = Math.floor(ms / 1000) % 60;
        const dayStr = d > 0 ? `${d}日 ` : '';
        const digits = precision === true ? 1 : precision === 2 ? 2 : 0;
        const fraction = digits ? `.${Math.floor((ms % 1000) / (10 ** (3 - digits))).toString().padStart(digits, '0')}` : '';
        const seconds = s.toString().padStart(2, '0') + fraction;
        return `残り ${dayStr}${h.toString().padStart(2, '0')}時間 ${m.toString().padStart(2, '0')}分 ${seconds}秒`;
    }

    function renderDeadlineCountdown(timer, remaining, precision = 0) {
        const expired = remaining <= 0;
        timer.textContent = expired ? "締切済み" : formatTimeLeft(remaining, precision);
        Object.assign(timer.style, {
            color: remaining < 86400000 ? "red" : remaining < 3 * 86400000 ? "#FF8C00" : "",
            fontWeight: remaining < 3 * 86400000 ? "bold" : "",
            textDecoration: !expired && remaining < 86400000 ? "underline" : ""
        });
    }

    function homeTaskDeadline(text) {
        const normalized = text.normalize("NFKC");
        const dates = Array.from(normalized.matchAll(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?(?:\s*[（(][^）)]*[）)])?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/g));
        // A submission period contains both dates; its last date is the deadline.
        if (!dates.length) return NaN;
        const labelled = dates.find(match => /(?:締(?:め)?切(?:り)?(?:日時|日)?|提出期限)\s*[:：]?\s*$/.test(normalized.slice(0, match.index)));
        const [, year, month, day, hour, minute, second = "0"] = labelled || dates[dates.length - 1];
        if (+month < 1 || +month > 12 || +day < 1 || +day > 31 || +hour > 23 || +minute > 59 || +second > 59) return NaN;
        // University deadlines use Japan time, even if the browser uses another timezone.
        const value = Date.UTC(+year, +month - 1, +day, +hour - 9, +minute, +second);
        const local = new Date(value + 9 * 3600000);
        return local.getUTCMonth() === +month - 1 && local.getUTCDate() === +day ? value : NaN;
    }

    function nearestHomeDeadline(texts, now) {
        return texts.map(homeTaskDeadline).filter(deadline => Number.isFinite(deadline) && deadline > now)
            .reduce((nearest, deadline) => Math.min(nearest, deadline), Infinity);
    }

    function updateDeadlineBackground(visual, remaining) {
        if (!visual) return;
        const urgency = remaining > 0 && remaining < 86400000 ? "critical"
            : remaining > 0 && remaining < 3 * 86400000 ? "warning" : "";
        // Override only the presentation; the user's saved image stays untouched.
        if (urgency) {
            if (visual.dataset.cgDeadlineUrgency !== urgency) visual.dataset.cgDeadlineUrgency = urgency;
        } else if (visual.dataset.cgDeadlineUrgency !== undefined) {
            delete visual.dataset.cgDeadlineUrgency;
        }
    }

    function installHomeTaskCountdown() {
        if (document.getElementById("cg-home-task-countdown")) return;
        const notice = document.createElement("li");
        notice.id = "cg-home-task-countdown";
        notice.className = "index-notice-other-item";
        const style = document.createElement("style");
        style.textContent = `
            .index-notice-other-items.cg-notice-with-countdown {
                display: grid;
                grid-template-columns: var(--cg-task-card-width, 1fr) var(--cg-grade-card-width, 1fr);
                grid-template-rows: auto auto;
                align-content: start;
                align-items: stretch;
                width: 100%;
                height: auto;
                margin: 0;
                gap: 10px;
            }
            .cg-notice-with-countdown > .index-notice-other-item {
                width: auto;
                max-width: none;
                min-width: 0;
                height: auto;
                min-height: 0;
                max-height: none;
                margin: 0;
                box-sizing: border-box;
            }
            .cg-notice-with-countdown > .index-notice-other-item > .index-main-visual-notice-box,
            .cg-notice-with-countdown > .index-notice-other-item > .cg-index-main-visual-notice-box {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 6px;
                width: 100%;
                height: 100%;
                min-height: 100px;
                padding: 12px 20px;
                margin: 0;
                box-sizing: border-box;
            }
            .cg-notice-with-countdown .index-main-visual-notice-box > .title,
            .cg-notice-with-countdown .cg-index-main-visual-notice-box > .title {
                margin: 0;
            }
            .cg-notice-with-countdown .index-main-visual-notice-box > .content,
            .cg-notice-with-countdown .cg-index-main-visual-notice-box > .content {
                display: flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                height: auto;
                margin: 0;
            }
            .cg-notice-with-countdown .count { margin: 0; }
            .cg-notice-with-countdown > #cg-home-task-countdown {
                grid-column: 1 / -1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 12px;
                border: 2px solid #a1a1a1;
                border-radius: 4px;
                box-shadow: 0 0 3px 0 rgba(57, 57, 57, .15);
                background: #fff;
                box-sizing: border-box;
                color: #333;
                font-size: 1.4rem;
                line-height: 1.5;
                text-align: center;
            }
            #cg-home-task-countdown .cg-deadline-heading {
                color: #666;
                font-size: 1.2rem;
            }
            #cg-home-task-countdown .cg-deadline-clock {
                max-width: 100%;
                font-variant-numeric: tabular-nums;
                font-size: clamp(1.4rem, 1.5vw, 1.8rem);
                overflow-wrap: anywhere;
            }
            #cg-home-task-countdown[hidden] { display: none; }
            .index-main-visual[data-cg-deadline-urgency="warning"] .index-main-visual-bg {
                background-image: repeating-linear-gradient(135deg, transparent 0 32px, rgba(255, 165, 0, .14) 32px 64px),
                    linear-gradient(110deg, #49251b, #a74819 55%, #351b1b) !important;
            }
            .index-main-visual[data-cg-deadline-urgency="critical"] .index-main-visual-bg {
                background-image: repeating-linear-gradient(135deg, transparent 0 32px, rgba(255, 60, 60, .2) 32px 64px),
                    radial-gradient(ellipse at 60% 50%, #bb172c, #540b18 65%, #220910) !important;
            }
        `;
        document.head.appendChild(style);
        const title = document.createElement("div");
        title.textContent = "最も近い締め切り";
        title.className = "cg-deadline-heading";
        const timer = document.createElement("div");
        timer.className = "cg-deadline-clock";
        notice.append(title, timer);
        notice.hidden = true;

        let nextDeadline = Infinity;
        const updateBackground = remaining => updateDeadlineBackground(document.querySelector(".index-main-visual"), remaining);
        const renderClock = remaining => {
            renderDeadlineCountdown(timer, remaining, 2);
            updateBackground(remaining);
        };
        let layoutPanel;
        let layoutItems = [];
        const sizePanel = panel => {
            const items = Array.from(panel.children).filter(item => item !== notice).slice(0, 2);
            // Measure the site's original card widths before enabling our layout.
            panel.classList.remove("cg-notice-with-countdown");
            const widths = items.map(item => item.getBoundingClientRect().width);
            if (widths[0] > 0) panel.style.setProperty("--cg-task-card-width", `${widths[0]}px`);
            if ((widths[1] || widths[0]) > 0) panel.style.setProperty("--cg-grade-card-width", `${widths[1] || widths[0]}px`);
            panel.classList.add("cg-notice-with-countdown");
            layoutPanel = panel;
            layoutItems = items;
        };
        window.addEventListener("resize", () => {
            if (layoutPanel?.isConnected) sizePanel(layoutPanel);
        });

        const update = () => {
            const panel = document.querySelector(".index-notice-other-items");
            if (!panel) {
                notice.hidden = true;
                nextDeadline = Infinity;
                updateBackground(Infinity);
                return;
            }
            const items = Array.from(panel.children).filter(item => item !== notice).slice(0, 2);
            if (layoutPanel !== panel || items.length !== layoutItems.length || items.some((item, index) => item !== layoutItems[index])) {
                sizePanel(panel);
            }
            if (notice.parentElement !== panel || panel.lastElementChild !== notice) panel.appendChild(notice);
            const list = document.querySelector(".submissionList");
            if (!list) {
                notice.hidden = true;
                nextDeadline = Infinity;
                updateBackground(Infinity);
                return;
            }
            const texts = Array.from(list.querySelectorAll(".submissionList_item"))
                .filter(item => item.classList.contains("is-yet") || item.querySelector(".c-status-yet"))
                .map(item => item.querySelector(".deadline")?.textContent || "");
            const now = Date.now();
            const deadline = nearestHomeDeadline(texts, now);
            nextDeadline = deadline;
            notice.hidden = false;
            if (Number.isFinite(deadline)) {
                renderClock(deadline - now);
                timer.title = new Date(deadline).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
            } else {
                updateBackground(Infinity);
                timer.textContent = "締切前の課題はありません";
                Object.assign(timer.style, { color: "", fontWeight: "", textDecoration: "" });
                timer.removeAttribute("title");
            }
        };
        update();
        // Read task information once a second and paint hundredths with the browser's frames.
        setInterval(update, 1000);
        const frame = () => {
            if (!notice.hidden && Number.isFinite(nextDeadline)) {
                const remaining = nextDeadline - Date.now();
                if (remaining <= 0) update();
                else renderClock(remaining);
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    function formatClassPeriod(period) {
        const normalized = period.normalize("NFKC");
        const numbers = normalized.match(/\d+/g)?.map(Number);
        if (!numbers?.length || numbers.some(number => number < 1)) return period;
        const periods = numbers.length === 2 && /[～〜~−-]/.test(normalized) && numbers[1] >= numbers[0]
            ? Array.from({ length: numbers[1] - numbers[0] + 1 }, (_, index) => numbers[0] + index)
            : numbers;
        const classes = Array.from(new Set(periods.map(number => Math.ceil(number / 2))));
        return `${classes.join("・")}コマ`;
    }

    function collectTimetableOrder(doc) {
        const order = new Map();
        const slots = new Map();
        doc.querySelectorAll(".schedule-table tr").forEach(row => {
            const period = row.querySelector("th")?.textContent.normalize("NFKC").match(/\d+/);
            if (!period) return;
            row.querySelectorAll("td[id^=week]").forEach(cell => {
                const day = Number(cell.id.replace("week", "")) - 1;
                if (day < 0 || day > 6) return;
                const slot = day * 100 + Number(period[0]);
                cell.querySelectorAll("li[id]").forEach(course => {
                    // Registration IDs are year + subject code + class code.
                    const key = course.id.slice(4);
                    order.set(key, Math.min(order.get(key) ?? Infinity, slot));
                    if (!slots.has(key)) slots.set(key, []);
                    if (!slots.get(key).some(entry => entry.order === slot)) {
                        slots.get(key).push({ order: slot, day, period: row.querySelector("th").textContent.normalize("NFKC").replace(/\s+/g, "").trim() });
                    }
                });
            });
        });
        return {
            year: doc.querySelector(".stady-sec02-header .year")?.textContent.match(/\d{4}/)?.[0],
            semester: doc.querySelector(".stady-sec02-header .c-half-btn .is-active")?.textContent.trim(),
            order,
            slots
        };
    }

    function sortReferenceOptions(select, timetable, year, semester) {
        if (!select) return false;
        const valid = year === timetable.year && semester === timetable.semester && timetable.order.size > 0;
        const selected = select.value;
        const options = Array.from(select.options);
        const days = ["月", "火", "水", "木", "金", "土", "日"];
        const entries = options.map((option, index) => {
            if (option.dataset.cgOriginalLabel === undefined) {
                option.dataset.cgOriginalLabel = option.textContent;
                option.dataset.cgOriginalPosition = String(index);
            }
            const key = option.value.replace(/_/g, "");
            const order = valid ? timetable.order.get(key) : undefined;
            const meetings = (timetable.slots?.get(key) || []).slice().sort((a, b) => a.order - b.order);
            const day = order === undefined ? undefined : Math.floor(order / 100);
            const schedule = meetings.map(meeting => `${days[meeting.day]}曜 ${formatClassPeriod(meeting.period)}`).join("、");
            return {
                option,
                order: !valid ? Number(option.dataset.cgOriginalPosition) : !option.value ? -1 : order ?? Infinity,
                index,
                group: !valid || !option.value ? null : day === undefined ? "曜日・時限未確認" : `${days[day]}曜日`,
                label: schedule && valid ? `${schedule}｜${option.dataset.cgOriginalLabel}` : option.dataset.cgOriginalLabel
            };
        }).sort((a, b) => (a.order - b.order) || a.index - b.index);
        const unchanged = entries.every((entry, index) => entry.option === options[index] &&
            entry.option.textContent === entry.label &&
            (entry.option.parentElement?.tagName === "OPTGROUP" ? entry.option.parentElement.label : null) === entry.group);
        if (!unchanged) {
            const doc = select.ownerDocument;
            const fragment = doc.createDocumentFragment();
            const groups = new Map();
            entries.forEach(entry => {
                entry.option.textContent = entry.label;
                if (entry.group === null) {
                    fragment.appendChild(entry.option);
                } else {
                    if (!groups.has(entry.group)) {
                        const group = doc.createElement("optgroup");
                        group.label = entry.group;
                        groups.set(entry.group, group);
                        fragment.appendChild(group);
                    }
                    groups.get(entry.group).appendChild(entry.option);
                }
            });
            select.replaceChildren(fragment);
            select.value = selected;
        }
        return valid;
    }

    function installReferenceTimetableOrder() {
        if (!document.title.includes("授業参考情報")) return;
        void (async () => {
            try {
                const page = await fetchPage(explicitSubmission(document, location.href, "emptyForm", "SC_07002B00_01/initStudent"));
                if (page.doc.title !== "履修登録") throw new Error("履修時間割を取得できませんでした。");
                const timetable = collectTimetableOrder(page.doc);
                const sort = () => {
                    const year = document.getElementById("changeStartYearCmb")?.value;
                    const semester = document.getElementById("changeStartSemesterCmb")?.selectedOptions[0]?.textContent.trim();
                    sortReferenceOptions(document.getElementById("changeClassSubjectCmb"), timetable, year, semester);
                };
                sort();
                let timer;
                const observer = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(sort, 100);
                });
                observer.observe(document.body, { childList: true, subtree: true });
                document.addEventListener("change", event => {
                    if (["changeStartYearCmb", "changeStartSemesterCmb"].includes(event.target.id)) sort();
                });
            } catch (error) {
                console.warn("[CG] 授業参考情報の時間割順ソート失敗", error);
            }
        })();
    }

    function startComfortableGakujo() {
        console.log("[CG] startComfortableGakujo (page fully loaded)");
        installReferenceTimetableOrder();

        const getHiddenTasks = () => {
            let hiddenTasks = [];
            const cookies = document.cookie.split(';');

            cookies.forEach(cookie => {
                const trimmed = cookie.trim();
                if (trimmed.startsWith('cg_hidden_')) {
                    const equalIndex = trimmed.indexOf('=');
                    if (equalIndex > -1) {
                        const value = trimmed.substring(equalIndex + 1);
                        try {
                            const task = JSON.parse(decodeURIComponent(value));
                            hiddenTasks.push(task);
                        } catch (e) {

                        }
                    }
                }
            });

            return hiddenTasks;
        };

        const addHiddenTask = (submissionType, subject, title, submittalTerm, submittalStatus) => {
            const hiddenTasks = getHiddenTasks();
            const exists = hiddenTasks.some(task =>
                task.submissionType === submissionType &&
                task.subject === subject &&
                task.title === title);
            if (!exists) {
                const uuid = self.crypto.randomUUID();
                const cookieName = `cg_hidden_${uuid}`;
                const task = { submissionType, subject, title, submittalTerm, submittalStatus };
                setCookie(cookieName, JSON.stringify(task), 365);
            }
        };

        const removeHiddenTask = (submissionType, subject, title) => {
            const cookies = document.cookie.split(';');
            cookies.forEach(cookie => {
                const trimmed = cookie.trim();
                if (trimmed.startsWith('cg_hidden_')) {
                    const equalIndex = trimmed.indexOf('=');
                    if (equalIndex > -1) {
                        const cookieName = trimmed.substring(0, equalIndex);
                        const value = trimmed.substring(equalIndex + 1);
                        try {
                            const task = JSON.parse(decodeURIComponent(value));
                            if (task.submissionType === submissionType &&
                                task.subject === subject &&
                                task.title === title) {
                                deleteCookie(cookieName);
                            }
                        } catch (e) {

                        }
                    }
                }
            });
        };

        function cropHeaderImage(img) {
            const TARGET_W = 1500;
            const TARGET_H = 230;
            const TARGET_RATIO = TARGET_W / TARGET_H;

            let srcW = img.width;
            let srcH = img.height;

            let cropW, cropH;

            if (srcW >= TARGET_W && srcH >= TARGET_H) {

                const srcRatio = srcW / srcH;

                if (srcRatio > TARGET_RATIO) {
                    cropH = srcH;
                    cropW = Math.round(cropH * TARGET_RATIO);
                } else {
                    cropW = srcW;
                    cropH = Math.round(cropW / TARGET_RATIO);
                }

            }
            else {
                const srcRatio = srcW / srcH;

                if (srcRatio > TARGET_RATIO) {
                    cropH = srcH;
                    cropW = Math.round(cropH * TARGET_RATIO);
                } else {
                    cropW = srcW;
                    cropH = Math.round(cropW / TARGET_RATIO);
                }
            }

            const cropX = Math.floor((srcW - cropW) / 2);
            const cropY = Math.floor((srcH - cropH) / 2);

            let outW = cropW;
            let outH = cropH;

            if (cropW >= TARGET_W && cropH >= TARGET_H) {
                outW = TARGET_W;
                outH = TARGET_H;
            }

            const canvas = document.createElement("canvas");
            canvas.width = outW;
            canvas.height = outH;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(
                img,
                cropX, cropY, cropW, cropH,
                0, 0, outW, outH
            );

            return canvas;
        }


        if (document.title === "ホーム画面（学生・保護者）") {
            const indexMainVisualUserLastLogin = document.getElementsByClassName("index-main-visual-user-last-login")[0];
            indexMainVisualUserLastLogin.innerHTML += ` | <a href="${updateURL}" title="Comfortable Gakujo をアップデート"><span style="display: inline-block; text-decoration: underline; color: blue"">Comfortable Gakujo v${version}</span></a>`;

            const waitForCountElement = new MutationObserver((mutations, obs) => {
                const countElement = document.getElementsByClassName("count")[0];
                if (countElement) {
                    const countText = countElement.innerText;
                    const match = countText.match(/(\d+)件/);
                    let originalCount = 0;
                    if (match) {
                        originalCount = parseInt(match[1], 10);
                    }
                    obs.disconnect();
                    const hiddenTasks = getHiddenTasks();
                    const now = new Date();
                    let hiddenCount = 0;
                    hiddenTasks.forEach(task => {
                        const submittalTerm = new Date(task.submittalTerm.split("～")[1].trim());
                        if (submittalTerm > now && task.submittalStatus === "未提出") {
                            hiddenCount++;
                        }
                    });
                    if (hiddenCount > 0) {
                        countElement.innerHTML = `<span class="num">${originalCount - hiddenCount}</span>件 + <span style="color: gray;">${hiddenCount}件</span>`;
                    }
                }
            });
            waitForCountElement.observe(document.body, { childList: true, subtree: true });
            showUpdateNotice();
            void checkGradeUpdates();
            setInterval(() => {
                if (document.visibilityState === "visible") void checkGradeUpdates();
            }, 5 * 60 * 1000);
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible") void checkGradeUpdates();
            });

            const indexMainVisualNotice = document.getElementsByClassName("index-main-visual-notice")[0];
            if (!indexMainVisualNotice.querySelector(".index-main-visual-notice-other")) {
                const indexMainVisualNoticeOther = document.createElement("div");
                indexMainVisualNoticeOther.className = "index-main-visual-notice-other";
                const ul = document.createElement("ul");
                ul.className = "index-notice-other-items";
                indexMainVisualNoticeOther.appendChild(ul);
                indexMainVisualNotice.appendChild(indexMainVisualNoticeOther);
            }

            const indexNoticeOtherItems = document.getElementsByClassName("index-notice-other-items")[0];
            const li = document.createElement('li');
            li.className = 'index-notice-other-item';
            if (getCookie("cg_grade_save_enabled") === "1") {
                li.innerHTML = `
                    <div class="cg-index-main-visual-notice-box cg-index-notice-other-link">
                        <p class="title" style="text-align: center;">成績更新通知</p>
                        <div class="content">
                            <div class="cg-checkbox-wrapper-8">
                                <input type="checkbox" id="cg-grade-save-toggle" class="cg-tgl cg-tgl-skewed" checked>
                                <label for="cg-grade-save-toggle" data-tg-on="ON" data-tg-off="OFF" class="cg-tgl-btn"></label>
                            </div>
                        </div>
                    </div>
                    `;
            } else {
                li.innerHTML = `
                    <div class="cg-index-main-visual-notice-box cg-index-notice-other-link">
                        <p class="title" style="text-align: center;">成績更新通知</p>
                        <div class="content">
                            <div class="cg-checkbox-wrapper-8">
                                <input type="checkbox" id="cg-grade-save-toggle" class="cg-tgl cg-tgl-skewed">
                                <label for="cg-grade-save-toggle" data-tg-on="ON" data-tg-off="OFF" class="cg-tgl-btn"></label>
                            </div>
                        </div>
                    </div>
                    `;
            }
            const style = document.createElement('style');
            style.textContent = `
                .cg-index-main-visual-notice-box {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    justify-content: space-between;
                    position: relative;
                    padding: 0 12px;
                    border-radius: 4px;
                    box-shadow: 0 0 3px 0 rgba(57, 57, 57, .15);
                    border: 2px solid #a1a1a1;
                    background-color: #fff;
                }

                .cg-index-notice-other-link {
                    display: block;
                    height: 100%;
                    padding: 10px 5px;
                    text-align: center;
                    line-height: 1.2;
                    margin-bottom: 3px;
                }

                @media print, screen and (max-width: 560px) {
                    .cg-index-notice-other-link {
                        padding: 15px 15px 15px 5px;
                    }
                }

                .cg-index-main-visual-notice-box .title {
                    color: #333;
                    /*font-size: 1.6rem;*/
                    font-size: 1.5rem;
                }

                @media print, screen and (max-width: 560px) {
                    .cg-index-main-visual-notice-box .title {
                        font-size: 2.2rem;
                        margin-bottom: 5px;
                    }
                }

                .cg-checkbox-wrapper-8 .cg-tgl {
                    display: none;
                }

                .cg-checkbox-wrapper-8 .cg-tgl,
                .cg-checkbox-wrapper-8 .cg-tgl:after,
                .cg-checkbox-wrapper-8 .cg-tgl:before,
                .cg-checkbox-wrapper-8 .cg-tgl *,
                .cg-checkbox-wrapper-8 .cg-tgl *:after,
                .cg-checkbox-wrapper-8 .cg-tgl *:before,
                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn {
                    box-sizing: border-box;
                }

                .cg-checkbox-wrapper-8 .cg-tgl::-moz-selection,
                .cg-checkbox-wrapper-8 .cg-tgl:after::-moz-selection,
                .cg-checkbox-wrapper-8 .cg-tgl:before::-moz-selection,
                .cg-checkbox-wrapper-8 .cg-tgl *::-moz-selection,
                .cg-checkbox-wrapper-8 .cg-tgl *:after::-moz-selection,
                .cg-checkbox-wrapper-8 .cg-tgl *:before::-moz-selection,
                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn::-moz-selection,
                .cg-checkbox-wrapper-8 .cg-tgl::selection,
                .cg-checkbox-wrapper-8 .cg-tgl:after::selection,
                .cg-checkbox-wrapper-8 .cg-tgl:before::selection,
                .cg-checkbox-wrapper-8 .cg-tgl *::selection,
                .cg-checkbox-wrapper-8 .cg-tgl *:after::selection,
                .cg-checkbox-wrapper-8 .cg-tgl *:before::selection,
                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn::selection {
                    background: none;
                }

                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn {
                    outline: 0;
                    display: block;
                    width: 4em;
                    height: 2em;
                    position: relative;
                    cursor: pointer;
                    -webkit-user-select: none;
                    -moz-user-select: none;
                    -ms-user-select: none;
                    user-select: none;
                }

                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn:after,
                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn:before {
                    position: relative;
                    display: block;
                    content: "";
                    width: 50%;
                    height: 100%;
                }

                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn:after {
                    left: 0;
                }

                .cg-checkbox-wrapper-8 .cg-tgl + .cg-tgl-btn:before {
                    display: none;
                }

                .cg-checkbox-wrapper-8 .cg-tgl:checked + .cg-tgl-btn:after {
                    left: 50%;
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed + .cg-tgl-btn {
                    overflow: hidden;
                    transform: skew(-10deg);
                    -webkit-backface-visibility: hidden;
                    backface-visibility: hidden;
                    transition: all 0.2s ease;
                    font-family: sans-serif;
                    background: #888;
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed + .cg-tgl-btn:after,
                .cg-checkbox-wrapper-8 .cg-tgl-skewed + .cg-tgl-btn:before {
                    transform: skew(10deg);
                    display: inline-block;
                    transition: all 0.2s ease;
                    width: 100%;
                    text-align: center;
                    position: absolute;
                    line-height: 2em;
                    font-weight: bold;
                    color: #fff;
                    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed + .cg-tgl-btn:after {
                    left: 100%;
                    content: attr(data-tg-on);
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed + .cg-tgl-btn:before {
                    left: 0;
                    content: attr(data-tg-off);
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed + .cg-tgl-btn:active {
                    background: #888;
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed + .cg-tgl-btn:active:before {
                    left: -10%;
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed:checked + .cg-tgl-btn {
                    background: #86d993;
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed:checked + .cg-tgl-btn:before {
                    left: -100%;
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed:checked + .cg-tgl-btn:after {
                    left: 0;
                }

                .cg-checkbox-wrapper-8 .cg-tgl-skewed:checked + .cg-tgl-btn:active:after {
                    left: 10%;
                }
                `;
            document.head.appendChild(style);
            indexNoticeOtherItems.appendChild(li);
            installHomeTaskCountdown();

            window.addEventListener('change', (e) => {
                if (e.target.id === 'cg-grade-save-toggle') {
                    if (e.target.checked) {
                        setCookie("cg_grade_save_enabled", "1");
                        void checkGradeUpdates();
                    } else {
                        deleteCookie("cg_grade_save_enabled");
                        deleteCookie("cg_grade");
                        deleteCookie("cg_grade_updated");
                        document.getElementsByClassName("cg-grade-notice-container")[0]?.remove();
                    }
                }
            });

            const indexMainVisualBg = document.getElementsByClassName("index-main-visual-bg")[0];
            const savedImage = localStorage.getItem("cg-header-image");

            if (savedImage) {
                indexMainVisualBg.style.backgroundImage = `url(${savedImage})`;
            }

            const contents = document.getElementsByClassName("index-main-visual")[0];
            if (!contents || document.getElementById("cg-header-uploader")) return;

            const uploaderWrapper = document.createElement("div");
            uploaderWrapper.id = "cg-header-uploader";
            uploaderWrapper.style.position = "absolute";
            uploaderWrapper.style.top = "1rem";
            uploaderWrapper.style.right = "1rem";
            uploaderWrapper.style.zIndex = "20";

            uploaderWrapper.style.width = "fit-content";

            const uploadBtn = document.createElement("button");
            uploadBtn.type = "button";
            uploadBtn.id = "cg-header-uploader-btn";
            uploadBtn.className = "c-btn c-btn-line";
            uploadBtn.style.minWidth = "auto";
            uploadBtn.style.display = "inline-block";
            uploadBtn.innerHTML = `
                <span class="c-btn-link">
                    <i class="c-icon-edit" style="margin: 0;" aria-hidden="true"></i>
                </span>
            `;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.id = "cg-header-remove-btn";
            removeBtn.className = "c-btn c-btn-line";
            removeBtn.style.marginLeft = "0.5rem";
            removeBtn.style.minWidth = "auto";
            removeBtn.style.display = "inline-block";
            removeBtn.innerHTML = `
                <span class="c-btn-link">
                    <i class="c-icon-close" style="margin: 0;" aria-hidden="true"></i>
                </span>
            `;

            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.id = "cg-header-file";
            fileInput.accept = ".png,.jpg,.jpeg,.gif";
            fileInput.hidden = true;

            uploadBtn.addEventListener("click", (e) => {
                fileInput.click();
            }, true);

            uploaderWrapper.appendChild(uploadBtn);
            uploaderWrapper.appendChild(removeBtn);
            uploaderWrapper.appendChild(fileInput);
            contents.appendChild(uploaderWrapper);

            fileInput.addEventListener("change", (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = cropHeaderImage(img);
                        const base64 = canvas.toDataURL("image/png");
                        const sizeMB = base64.length / (1024 * 1024);

                        if (sizeMB > 3) {
                            alert("画像サイズは3MB以下にしてください");
                            return;
                        }

                        localStorage.setItem("cg-header-image", base64);

                        const bg = document.getElementsByClassName("index-main-visual-bg")[0];
                        if (bg) {
                            bg.style.backgroundImage = `url(${base64})`;
                        }

                        console.log("[CG] Header image updated");
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(file);

                fileInput.value = "";
            });

            removeBtn.addEventListener("click", (e) => {
                localStorage.removeItem("cg-header-image");
                const bg = document.getElementsByClassName("index-main-visual-bg")[0];
                if (bg) {
                    bg.style.backgroundImage = `url(./img/bg_mv01.jpg)`;
                }
            });
        } else if (document.title === "課題・アンケートリスト") {
            let processedSet = new WeakSet();
            let hiddenCount = 0;

            const addHideButtonColumn = () => {
                const table = document.getElementById("dataTable01");
                if (!table) return;

                const thead = table.querySelector("thead");
                if (thead && !thead.querySelector('.hidebutton-header')) {
                    const th = document.createElement('th');
                    th.className = 'hidebutton-header';
                    th.style.width = "32px";
                    th.innerHTML = "非表示<br>にする"
                    thead.querySelector("tr").insertBefore(th, thead.querySelector("tr").firstChild);
                }

                const tbody = table.querySelector("tbody");
                if (tbody) {
                    tbody.querySelectorAll("tr").forEach(row => {
                        if (!row.querySelector('.row-hidebutton')) {
                            const td = document.createElement('td');
                            td.style.textAlign = 'center';

                            const btn = document.createElement('input');
                            btn.type = 'button';
                            btn.name = 'row-hidebutton';
                            btn.value = '−';
                            btn.className = 'row-hidebutton';
                            btn.style.width = '24px';
                            btn.style.height = '24px';
                            btn.style.fontSize = '18px';
                            btn.style.cursor = 'pointer';
                            btn.style.border = 'none';
                            btn.style.background = '#eee';
                            btn.style.borderRadius = '4px';
                            btn.style.transition = 'background 0.2s';

                            btn.addEventListener('mouseenter', () => {
                                btn.style.background = '#ccc';
                            });
                            btn.addEventListener('mouseleave', () => {
                                btn.style.background = '#eee';
                            });
                            btn.addEventListener('click', (e) => {
                                const row = e.target.closest('tr');
                                row.style.display = 'none';
                                const hiddenTasksTable = document.getElementById("hiddenTasksTable");
                                if (!hiddenTasksTable) return;
                                const hiddenRow = hiddenTasksTable.querySelector('#' + row.id);
                                if (hiddenRow) hiddenRow.style.display = '';
                                addHiddenTask(
                                    hiddenRow.querySelector('td[data-label*="提出物種別"]')?.textContent?.trim() || "",
                                    hiddenRow.querySelector('td[data-label*="講義名"]')?.innerHTML?.split('<br>')[0]?.trim() || "",
                                    hiddenRow.querySelector('td[data-label*="タイトル"]')?.textContent?.trim() || "",
                                    hiddenRow.querySelector('td[data-label*="提出期間"]')?.textContent?.trim() || "",
                                    hiddenRow.querySelector('td[data-label*="提出状況"]')?.textContent?.trim() || ""
                                );
                                const hiddenCountSpan = document.getElementById("hiddenCount");
                                if (hiddenCountSpan) {
                                    hiddenCount++;
                                    hiddenCountSpan.textContent = `(${hiddenCount})`;
                                }
                            });

                            td.appendChild(btn);
                            row.insertBefore(td, row.firstChild);
                        }
                    });
                }
            }

            const addHiddenTasksTable = () => {
                const originalTable = document.getElementById("dataTable01");
                if (!originalTable) return;
                const hiddenTasksTable = originalTable.cloneNode(true);
                if (!hiddenTasksTable) return;
                hiddenTasksTable.id = "hiddenTasksTable";
                hiddenTasksTable.style.marginTop = "2em";

                hiddenTasksTable.querySelectorAll('.row-hidebutton').forEach(btn => {
                    btn.value = '+';
                    btn.addEventListener('click', (e) => {
                        const row = e.target.closest('tr');
                        row.style.display = 'none';
                        const originalTable = document.getElementById("dataTable01");
                        if (!originalTable) return;
                        const hiddenRow = originalTable.querySelector('#' + row.id);
                        if (hiddenRow) hiddenRow.style.display = '';
                        removeHiddenTask(
                            row.querySelector('td[data-label*="提出物種別"]')?.textContent?.trim() || "",
                            row.querySelector('td[data-label*="講義名"]')?.innerHTML?.split('<br>')[0]?.trim() || "",
                            row.querySelector('td[data-label*="タイトル"]')?.textContent?.trim() || ""
                        );
                        const hiddenCountSpan = document.getElementById("hiddenCount");
                        if (hiddenCountSpan) {
                            hiddenCount--;
                            hiddenCountSpan.textContent = `(${hiddenCount})`;
                        }
                    });
                });
                hiddenTasksTable.querySelectorAll('.hidebutton-header').forEach(th => {
                    th.innerHTML = "表示<br>する";
                });

                hiddenTasksTable.querySelectorAll("tr").forEach(row => {
                    if (!row.querySelector('th')) {
                        row.style.display = 'none';
                    }
                });

                const hiddenTasks = getHiddenTasks();
                hiddenTasks.forEach(task => {
                    const rows = hiddenTasksTable.querySelectorAll("tr");
                    rows.forEach(row => {
                        const submissionType = row.querySelector('td[data-label*="提出物種別"]')?.textContent?.trim() || "";
                        const subject = row.querySelector('td[data-label*="講義名"]')?.innerHTML?.split('<br>')[0]?.trim() || "";
                        const title = row.querySelector('td[data-label*="タイトル"]')?.textContent?.trim() || "";

                        if (submissionType === task.submissionType && subject === task.subject && title === task.title) {
                            hiddenCount++;
                            row.style.display = '';
                            const originalRow = document.getElementById("dataTable01").querySelector('#' + row.id);
                            if (originalRow) {
                                originalRow.style.display = 'none';
                            }
                            const submittalTerm = row.querySelector('td[data-label*="提出期間"]')?.textContent?.trim() || "";
                            const submittalStatus = row.querySelector('td[data-label*="提出状況"]')?.textContent?.trim() || "";
                            if (submittalTerm !== task.submittalTerm || submittalStatus !== task.submittalStatus) {
                                removeHiddenTask(submissionType, subject, title);
                                addHiddenTask(submissionType, subject, title, submittalTerm, submittalStatus);
                            }
                        }
                    });
                });

                const details = document.createElement('details');
                details.style.marginTop = "2em";
                const summary = document.createElement('summary');
                summary.textContent = "非表示にした課題・アンケート ";
                summary.style.cursor = "pointer";
                summary.style.fontWeight = "bold";
                summary.style.fontSize = "1.1em";
                const countSpan = document.createElement('span');
                countSpan.id = "hiddenCount";
                countSpan.textContent = `(${hiddenCount})`;
                summary.appendChild(countSpan);
                details.appendChild(summary);
                details.appendChild(hiddenTasksTable);
                const pagination = document.getElementsByClassName("c-pagination")[1];
                document.getElementById("dataTable01_wrapper").getElementsByClassName("c-contents-body")[0].insertBefore(details, pagination);
            }

            const getDeadlineDate = (row) => {
                const td = row.querySelector('td[data-label*="提出期間"]');
                const text = td?.textContent?.trim();
                const match = text?.match(/～\s*([\d/]+)\s+([\d:]+)/);
                if (!match) return new Date(0);
                const dateStr = match[1].replace(/\//g, "-") + "T" + match[2];
                const date = new Date(dateStr);
                return isNaN(date.getTime()) ? new Date(0) : date;
            };

            const processTable = () => {
                const table = document.getElementById("dataTable01");
                const tbody = table?.querySelector("tbody");
                if (!tbody) return;

                tbody.querySelectorAll("tr").forEach((row, index) => {
                    row.id = `cg-task-row-${index}`;
                });

                const rows = Array.from(tbody.querySelectorAll("tr"));
                rows.sort((a, b) => getDeadlineDate(a) - getDeadlineDate(b)).forEach(row => {
                    tbody.appendChild(row);
                });

                addHideButtonColumn();
                addHiddenTasksTable();

                for (const row of rows) {
                    if (processedSet.has(row)) continue;
                    processedSet.add(row);

                    const statusCell = row.querySelector('td[data-label*="提出状況"]');
                    if (statusCell && statusCell.textContent.includes("提出済")) {
                        row.style.backgroundColor = "#e5ffe5";
                        row.addEventListener('mouseover', () => {
                            row.style.backgroundColor = "#d1ffd1";
                        });
                        row.addEventListener('mouseout', () => {
                            row.style.backgroundColor = "#e5ffe5";
                        });
                    }

                    const deadline = getDeadlineDate(row);
                    const now = Date.now();

                    const td = row.querySelector('td[data-label*="提出期間"]');
                    if (!td) continue;

                    if (deadline.getHours() < 12) {
                        const last5 = td.textContent.slice(-5);
                        td.innerHTML = td.textContent.slice(0, -5) +
                            `<span style="color:red;font-weight:bold">${last5}</span>`;
                    }

                    let timer = td.querySelector('.timer');
                    if (!timer) {
                        timer = document.createElement('div');
                        timer.className = 'timer';
                        timer.style.textAlign = 'center';
                        td.appendChild(timer);
                    }

                    timer.dataset.deadline = deadline.getTime().toString();
                }
            };

            const debounce = (fn, delay = 300) => {
                let timer = null;
                return function (...args) {
                    clearTimeout(timer);
                    timer = setTimeout(() => fn.apply(this, args), delay);
                };
            };

            const triggerLengthChangeAndWait = () => {
                const lengthSelect = document.querySelector('select[name="dataTable01_length"]');
                const table = document.getElementById("dataTable01");
                const tbody = table?.querySelector("tbody");

                if (!lengthSelect || !tbody) return;

                const observer = new MutationObserver((mutations, obs) => {
                    for (const m of mutations) {
                        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
                            obs.disconnect();
                            processedSet = new WeakSet();
                            processTable();
                            break;
                        }
                    }
                });

                observer.observe(tbody, { childList: true });

                lengthSelect.value = "-1";
                lengthSelect.dispatchEvent(new Event("change", { bubbles: true }));
            };

            const waitForTable = new MutationObserver((_m, obs) => {
                const table = document.getElementById("dataTable01");
                const tbody = table?.querySelector("tbody");
                const lengthSelect = document.querySelector('select[name="dataTable01_length"]');

                if (table && tbody && tbody.querySelectorAll("tr").length > 0 && lengthSelect) {
                    obs.disconnect();
                    triggerLengthChangeAndWait();
                }
            });

            waitForTable.observe(document.body, { childList: true, subtree: true });

            setInterval(() => {
                const now = Date.now();
                document.querySelectorAll('.timer').forEach(timer => {
                    const deadline = Number(timer.dataset.deadline);
                    const remaining = deadline - now;

                    renderDeadlineCountdown(timer, remaining);
                });
            }, 1000);

            if (sessionStorage.getItem("cg_return_to_task") != null) {
                const { title: taskTitle, subject: subjectName } = JSON.parse(sessionStorage.getItem("cg_return_to_task"));
                sessionStorage.removeItem("cg_return_to_task");

                const rows = document.querySelectorAll("#dataTable01 tbody tr");

                console.log(`[CG] Returning to task: ${subjectName} - ${taskTitle}`);

                for (const row of rows) {
                    const subjectCell = row.querySelector('td[data-label^="講義名"]');
                    const titleCell = row.querySelector('td[data-label="タイトル"]');

                    if (!subjectCell || !titleCell) continue;

                    const subjectText = subjectCell.innerText.split("\n")[0].trim();
                    const titleText = titleCell.innerText.trim();

                    if (subjectText.includes(subjectName) && titleText === taskTitle) {
                        row.childNodes[1].click();
                        return true;
                    }
                }
            }
        } else if (document.title === "課題・アンケート詳細") {
            const btn = document.getElementsByClassName("c-btn-submit02")[0];
            if (btn && !btn.dataset.cgHooked) {
                btn.dataset.cgHooked = "1";
                btn.addEventListener("click", () => {
                    const title = document.getElementsByClassName("c-heading")[0].innerText.trim();
                    const subject = document.getElementsByClassName("submission_subject")[0].childNodes[3].innerText.trim();
                    sessionStorage.setItem("cg_return_to_task", JSON.stringify({ title, subject }));
                }, true);
            }


        } else if (document.title === "成績情報" || document.title === "成績情報詳細") {
            deleteCookie("cg_grade_updated");

            function collectYearSemesters() {
                const years = new Set();
                const yearSemesters = new Set();

                const table = document.getElementById("02");
                if (!table) return { years: [], yearSemesters: [] };

                table.querySelectorAll("tbody tr").forEach(tr => {
                    const cell = tr.querySelector('td[data-label="成績報告時期"]');
                    const text = cell?.innerText.trim();
                    if (!text) return;

                    const m = text.match(/(\d{4})年度\s*(前期|後期)/);
                    if (!m) return;

                    years.add(m[1]);
                    yearSemesters.add(`${m[1]}-${m[2]}`);
                });

                return {
                    years: Array.from(years).sort(),
                    yearSemesters: Array.from(yearSemesters).sort((a, b) => {
                        const [ya, sa] = a.split("-");
                        const [yb, sb] = b.split("-");
                        if (ya !== yb) return ya - yb;
                        return sa === "前期" ? -1 : 1;
                    })
                };
            }

            function applyYearSemesterFilter(value) {
                const table = document.getElementById("02");
                if (!table) return;

                table.querySelectorAll("tbody tr").forEach(tr => {
                    const cell = tr.querySelector('td[data-label="成績報告時期"]');
                    const text = cell?.innerText || "";

                    if (value === "all") {
                        tr.style.display = "";
                        return;
                    }

                    if (/^\d{4}$/.test(value)) {
                        tr.style.display = text.includes(`${value}年度`) ? "" : "none";
                        return;
                    }

                    const [y, s] = value.split("-");
                    tr.style.display =
                        text.includes(`${y}年度`) && text.includes(s)
                            ? ""
                            : "none";
                });
            }

            function getDefaultYearSemester() {
                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth() + 1;

                if (month >= 2 && month <= 7) {
                    return `${year - 1}-後期`;
                }

                if (month >= 8) {
                    return `${year}-前期`;
                }

                return `${year - 1}-前期`;
            }

            function initYearSemesterFilter() {
                const table = document.getElementById("02");
                if (!table) return;

                const upper = document.getElementsByClassName("seiseki-marker-contents-body")[0];
                if (!upper) return;
                if (document.getElementById("cg-year-semester-box")) return;

                const { years, yearSemesters } = collectYearSemesters();
                if (years.length === 0) return;

                upper.style.display = "flex";
                upper.style.justifyContent = "space-between";

                const box = document.createElement("div");
                box.className = "c-form-box u-w100per-sp";
                box.id = "cg-year-semester-box";

                box.appendChild(document.createTextNode("年度・期："));

                const wrapper = document.createElement("div");
                wrapper.className = "select_wrapper u-w100per-sp";

                const select = document.createElement("select");
                select.className = "select u-w260-pc u-w100per-sp js-select";

                select.appendChild(new Option("すべて表示", "all"));

                years.forEach(y => {
                    select.appendChild(new Option(`${y}年度`, y));
                });

                yearSemesters.forEach(v => {
                    const [y, s] = v.split("-");
                    select.appendChild(new Option(`${y}年度 ${s}`, v));
                });

                select.addEventListener("change", () => {
                    applyYearSemesterFilter(select.value);
                });

                wrapper.appendChild(select);
                box.appendChild(wrapper);
                upper.appendChild(box);

                const defaultValue = getDefaultYearSemester();

                if ([...select.options].some(o => o.value === defaultValue)) {
                    select.value = defaultValue;
                    applyYearSemesterFilter(defaultValue);
                } else {
                    applyYearSemesterFilter("all");
                }

                console.log("[CG] Year/Semester filter initialized");
            }

            const waitTable = new MutationObserver((_m, obs) => {
                const table = document.getElementById("02");
                const tbody = table?.querySelector("tbody tr");
                if (table && tbody) {
                    obs.disconnect();
                    initYearSemesterFilter();
                    const reportDate = document.getElementById("reportDate");
                    if (reportDate) {
                        reportDate.click();
                    }
                }
            });

            waitTable.observe(document.body, { childList: true, subtree: true });
        } else if (document.title === "連絡一覧") {
            const cPageNation = document.getElementsByClassName("c-pagination")[0];
            if (cPageNation) {
                const markAsRead = document.createElement('div');
                markAsRead.className = "c-filter_box c-form-box";
                markAsRead.style.left = "20px";
                markAsRead.innerHTML = `<button type="button" id="cg-mark-as-read" dialogtype="" reportoutputconfirm="true" loading="true" class="c-btn c-btn-submit01" filetype="null"><span class="c-btn-link"><span class="c-btn-text ">すべて既読にする</span></span></button>`;
                cPageNation.childNodes[0].insertBefore(markAsRead, cPageNation.childNodes[0].firstChild);

                document.getElementById("cg-mark-as-read").addEventListener("click", () => {
                    const lengthSelect = document.querySelector('select[name="dataTable01_length"]');
                    if (lengthSelect) {
                        lengthSelect.value = "-1";
                        lengthSelect.dispatchEvent(new Event("change", { bubbles: true }));
                        setTimeout(() => {
                            const checkAll = document.getElementById("checkAllId");
                            if (checkAll) {
                                checkAll.click();
                                setTimeout(() => {
                                    const cBtnSubmit01 = document.getElementsByClassName("c-btn-submit01")[1];
                                    if (cBtnSubmit01) {
                                        cBtnSubmit01.click();
                                    }
                                }, 500);
                            }
                        }, 500);
                    }
                });
            }
        }

        if (location.hostname === "idp.shizuoka.ac.jp") {
            if (document.body.innerText.includes("過去のリクエスト")) {
                location.href = "https://gakujo.shizuoka.ac.jp/";
            } else {
                const btn = document.getElementsByName("_eventId_proceed")[0];

                if (btn) {
                    console.log("[CG] Auto login click");
                    btn.click();
                }
            }
        } else if (location.href === "https://gakujo.shizuoka.ac.jp/lcu-web/" && document.referrer == "https://idp.shizuoka.ac.jp/") {
            const btn = document.getElementById("btnSsoStart");
            if (btn) {
                console.log("[CG] Auto SSO start click");
                btn.click();
            }
        }

        const previewMimeTypes = {
            pdf: "application/pdf",
            txt: "text/plain",
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            bmp: "image/bmp",
            avif: "image/avif"
        };
        const getPreviewType = link => {
            const extensionPattern = /\.(pdf|txt|png|jpe?g|gif|webp|bmp|avif)(?=$|[\s?#&])/i;
            const textMatch = link.innerText.trim().match(extensionPattern);
            const hrefMatch = (link.href || "").match(extensionPattern);
            const match = textMatch || hrefMatch;
            return match ? previewMimeTypes[match[1].toLowerCase()] : null;
        };
        const fileLinks = Array.from(document.querySelectorAll("a")).filter(a => getPreviewType(a));

        fileLinks.forEach(link => {
            if (link.dataset.cgFilePreviewed) return;
            link.dataset.cgFilePreviewed = "1";

            const wrapper = document.createElement("div");
            wrapper.className = "cg-preview-wrapper";
            wrapper.style.marginTop = "10px";
            wrapper.style.marginBottom = "20px";
            wrapper.style.width = "100%";
            wrapper.style.border = "1px solid #ccc";
            wrapper.style.borderRadius = "4px";
            wrapper.style.overflow = "hidden";
            wrapper.style.display = "none";

            const iframe = document.createElement("iframe");
            iframe.style.width = "100%";
            iframe.style.height = "600px";
            iframe.style.border = "none";
            iframe.style.display = "block";
            iframe.src = "about:blank";
            wrapper.appendChild(iframe);

            const showPreview = blob => {
                const type = getPreviewType(link) || blob.type;
                const url = URL.createObjectURL(new Blob([blob], { type }));
                if (type.startsWith("image/")) {
                    const image = document.createElement("img");
                    image.alt = link.innerText.trim();
                    image.style.display = "block";
                    image.style.maxWidth = "100%";
                    image.style.maxHeight = "600px";
                    image.style.width = "auto";
                    image.style.height = "auto";
                    image.style.margin = "0 auto";
                    image.onload = image.onerror = () => URL.revokeObjectURL(url);
                    image.src = url;
                    iframe.style.display = "none";
                    wrapper.style.width = "fit-content";
                    wrapper.style.maxWidth = "100%";
                    wrapper.appendChild(image);
                } else {
                    iframe.src = url;
                }
            };

            const insertWrapper = (shouldScroll) => {
                const historyBlock = link.closest(".histry-my-block, .history-my-block");
                if (historyBlock) {
                    historyBlock.appendChild(wrapper);
                } else {
                    const blockParent = link.closest("table, ul, dl, .c-form-box, .c-contents-body");
                    const insertTarget = blockParent ? blockParent : link;

                    let next = insertTarget.nextSibling;
                    while (next && next.classList && next.classList.contains("cg-preview-wrapper")) {
                        next = next.nextSibling;
                    }
                    if (next) {
                        insertTarget.parentNode.insertBefore(wrapper, next);
                    } else {
                        insertTarget.parentNode.appendChild(wrapper);
                    }
                }

                if (shouldScroll) {
                    setTimeout(() => wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                }
            };

            if (link.href && link.href.startsWith("javascript:")) {
                iframe.name = "file_preview_" + Math.random().toString(36).substr(2, 9);

                const previewBtn = document.createElement("button");
                previewBtn.innerText = "ファイルをプレビュー";
                previewBtn.type = "button";
                previewBtn.className = "c-btn c-btn-line c-btn-sm";
                previewBtn.style.marginTop = "5px";
                previewBtn.style.marginBottom = "5px";
                previewBtn.style.display = "block";

                previewBtn.addEventListener("click", () => {
                    wrapper.style.display = "block";
                    previewBtn.style.display = "none";
                    insertWrapper(true);

                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (doc) doc.body.innerHTML = "<div style='font-family: sans-serif; padding: 20px;'>読み込み中...</div>";

                    const originalJqSubmit = window.jQuery ? window.jQuery.fn.submit : null;
                    const originalNativeSubmit = HTMLFormElement.prototype.submit;
                    let submittedForm = null;

                    if (originalJqSubmit) {
                        window.jQuery.fn.submit = function () {
                            submittedForm = this[0];
                            return this;
                        };
                    }
                    HTMLFormElement.prototype.submit = function () {
                        submittedForm = this;
                    };

                    link.click();

                    setTimeout(async () => {
                        if (originalJqSubmit) window.jQuery.fn.submit = originalJqSubmit;
                        HTMLFormElement.prototype.submit = originalNativeSubmit;

                        if (typeof isSubmit !== 'undefined') window.isSubmit = false;
                        if (typeof closeLoading === 'function') window.closeLoading();

                        if (submittedForm) {
                            try {
                                const formData = new FormData(submittedForm);
                                const response = await fetch(submittedForm.action, {
                                    method: submittedForm.method || "POST",
                                    body: formData
                                });
                                const blob = await response.blob();
                                showPreview(blob);
                            } catch (e) {
                                const doc2 = iframe.contentDocument || iframe.contentWindow.document;
                                if (doc2) doc2.body.innerHTML = "<div style='font-family: sans-serif; padding: 20px; color: red;'>読み込みに失敗しました。</div>";
                            }
                        } else {
                            const doc2 = iframe.contentDocument || iframe.contentWindow.document;
                            if (doc2) doc2.body.innerHTML = "<div style='font-family: sans-serif; padding: 20px; color: red;'>フォームの送信を検知できませんでした。</div>";
                        }
                    }, 50);
                });

                link.parentNode.insertBefore(previewBtn, link.nextSibling);
            } else {
                wrapper.style.display = "block";
                insertWrapper(false);

                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (doc) doc.body.innerHTML = "<div style='font-family: sans-serif; padding: 20px;'>読み込み中...</div>";

                fetch(link.href)
                    .then(res => res.blob())
                    .then(blob => {
                        showPreview(blob);
                    })
                    .catch(e => {
                        const doc2 = iframe.contentDocument || iframe.contentWindow.document;
                        if (doc2) doc2.body.innerHTML = "<div style='font-family: sans-serif; padding: 20px; color: red;'>読み込みに失敗しました。</div>";
                    });
            }
        });

        document.addEventListener("click", event => {
            const button = event.target.closest("#cg-credit-info");
            if (!button) return;
            event.preventDefault();
            void openCreditInfo(button);
        });

        const cMainMenu = document.getElementsByClassName("c-main-menu")[0];
        if (cMainMenu) {
            const sidebar = document.createElement('nav');
            sidebar.classList = "c-gnav";
            sidebar.id = "cg-sidebar";
            cMainMenu.appendChild(sidebar);
            const style = document.createElement('style');
            style.textContent = `
                #cg-sidebar {
                    display: block;
                    top: 0;
                    z-index: 2;
                    width: 76px;
                    height: 100vh;
                    padding-top: 76px;
                }
                #cg-sidebar a {
                    display: block;
                    text-align: center;
                    height: 76px;
                    padding: 15px;
                    text-decoration: none;
                    border-top: 1px solid #ccc;
                    border-bottom: 1px solid #ccc;
                    font-size: 10px;
                }
                .c-container {
                    padding-left: 76px;
                }
                @media print, screen and (max-width: 560px) {
                    #cg-sidebar {
                        display: none;
                    }
                    .c-container {
                        padding-left: 0;
                    }
                }
                .c-page-back-link {
                    border-top: 1px solid #ccc;
                    border-bottom: 1px solid #ccc;
                    border-right: 1px solid #ccc;
                }
                .cg-gnav-link i {
                    display: block;
                    font-size: 24px;
                    margin-bottom: 8px;
                }
                `;
            document.head.appendChild(style);
            sidebar.innerHTML = `
                    <a href="javascript:void(0);" onclick="javascript:ClearStorage(); javascript:postSubmit('emptyForm', 'SC_06001B00_01/init')" class="c-gnav-link cg-gnav-link"><i class="c-icon-search" aria-hidden="true"></i>シラバス</a>
                    <a href="javascript:void(0);" onclick="javascript:ClearStorage(); javascript:postSubmit('emptyForm', 'SC_12001B00_01/initFromHome')" class="c-gnav-link cg-gnav-link"><i class="c-icon-edit" aria-hidden="true"></i>授業情報</a>
                    <a href="javascript:void(0);" onclick="javascript:ClearStorage(); javascript:postSubmit('emptyForm', 'SC_14002B00_01/init')" class="c-gnav-link cg-gnav-link"><i class="c-icon-uploaed" aria-hidden="true"></i>課題提出</a>
                    <a href="javascript:void(0);" onclick="javascript:ClearStorage(); javascript:postSubmit('emptyForm', 'SC_07002B00_01/initStudent')" class="c-gnav-link cg-gnav-link"><i class="c-icon-submission" aria-hidden="true"></i>履修登録</a>
                    <a href="javascript:void(0);" onclick="javascript:ClearStorage(); javascript:postSubmit('emptyForm', 'SC_15005B00_01/init')" class="c-gnav-link cg-gnav-link"><i class="c-icon-graph" aria-hidden="true"></i>成績</a>
                    <a href="javascript:void(0);" id="cg-credit-info" class="c-gnav-link cg-gnav-link"><i class="c-icon-check" aria-hidden="true"></i>単位情報</a>
                `;
        }
    }
})();