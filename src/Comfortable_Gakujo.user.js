// ==UserScript==
// @name         Comfortable Gakujo
// @namespace    http://tampermonkey.net/
// @version      1.9.1
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

    const version = "1.9.1";
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
        const step = sessionStorage.getItem("cg_grade_nav");

        if (step === "dashboard") {
            if (document.title === "成績ダッシュボード") {
                sessionStorage.setItem("cg_grade_nav", "detail");
                const btn = document.getElementsByClassName("c-btn-submit01")[0];
                btn.click();
            } else {
                sessionStorage.removeItem("cg_grade_nav");
            }
        } else if (step === "detail") {
            if (document.title === "成績情報") {
                sessionStorage.removeItem("cg_grade_nav");
                const btn = document.getElementsByClassName("c-btn-submit01")[1];
                btn.click();
            } else {
                sessionStorage.removeItem("cg_grade_nav");
            }
        }

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

    const seenCharts = new WeakSet();

    function installChartHook() {
        if (!window.Chart || !Chart.prototype) return false;
        if (Chart.prototype._gakujo_grade_hooked) return true;

        Chart.prototype._gakujo_grade_hooked = true;

        const originalUpdate = Chart.prototype.update;

        Chart.prototype.update = function (...args) {
            try {
                const labels = this.data?.labels;
                const datasets = this.data?.datasets;

                if (
                    !Array.isArray(labels) ||
                    !Array.isArray(datasets) ||
                    datasets.length === 0 ||
                    !datasets.some(ds => Array.isArray(ds.data) && ds.data.length > 0)
                ) {
                    return originalUpdate.apply(this, args);
                }

                if (seenCharts.has(this)) {
                    return originalUpdate.apply(this, args);
                }
                seenCharts.add(this);

                if (getChartTitle(this).includes("年度別修得評価")) {
                    gradeJson = normalizeGradeChart(labels, datasets);
                    console.log("[CG] Grade chart detected:", gradeJson);
                    if (getCookie("cg_grade_save_enabled") === "1") {
                        saveGradeJson(gradeJson);
                    }
                } else {
                }
            } catch (e) {
                console.warn("[CG] Chart hook error", e);
            }

            return originalUpdate.apply(this, args);
        };

        console.log("[CG] Chart.js hook installed");
        return true;
    }

    const waitTimer = setInterval(() => {
        if (installChartHook()) clearInterval(waitTimer);
    }, 50);

    function normalizeGradeChart(labels, datasets) {
        const result = {};

        labels.forEach(label => {
            result[label] = {
                grades: {}
            };
        });

        datasets.forEach(ds => {
            const name = ds.label;
            const values = ds.data.map(v => Number(v));

            if (!name.includes("GPA")) {
                labels.forEach((label, i) => {
                    if (!isNaN(values[i])) {
                        result[label].grades[name] = values[i];
                    }
                });
            }
        });

        return result;
    }

    let gradeJson = "";

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

    async function saveGradeJson(newJson) {
        const prev = getCookie("cg_grade");
        console.log("[CG] Saving grade JSON:", newJson, "Previous:", prev);
        const newStr = await sha256(JSON.stringify(newJson));

        if (prev && decodeURIComponent(prev) !== newStr) {
            setCookie("cg_grade_updated", "1");
        }

        setCookie("cg_grade", newStr);
    }

    function getChartTitle(chart) {
        // Chart.js v3+
        const t3 = chart.options?.plugins?.title?.text;
        if (typeof t3 === "string") return t3;
        if (Array.isArray(t3)) return t3.join("");

        // Chart.js v2
        const t2 = chart.options?.title?.text;
        if (typeof t2 === "string") return t2;
        if (Array.isArray(t2)) return t2.join("");

        return "";
    }

    (function watchCookie() {
        let last = getCookie("cg_grade_updated");

        const intervalId = setInterval(() => {
            const now = getCookie("cg_grade_updated");
            if (now !== last) {
                last = now;
                if (showUpdateNotice()) {
                    clearInterval(intervalId);
                }
            }
        }, 500);
    })();

    async function sha256(text) {
        const uint8 = new TextEncoder().encode(text)
        const digest = await crypto.subtle.digest('SHA-256', uint8)
        return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('')
    }

    function startComfortableGakujo() {
        console.log("[CG] startComfortableGakujo (page fully loaded)");

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
                        <div class="content" style="width: fit-content; margin: auto; margin-top: 1em;">
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
                        <div class="content" style="width: fit-content; margin: auto; margin-top: 1em;">
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

            window.addEventListener('change', (e) => {
                if (e.target.id === 'cg-grade-save-toggle') {
                    if (e.target.checked) {
                        setCookie("cg_grade_save_enabled", "1");
                        location.reload();
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

            const formatTimeLeft = (ms) => {
                const d = Math.floor(ms / (1000 * 60 * 60 * 24));
                const h = Math.floor(ms / (1000 * 60 * 60)) % 24;
                const m = Math.floor(ms / (1000 * 60)) % 60;
                const s = Math.floor(ms / 1000) % 60;
                const dayStr = d > 0 ? `${d}日 ` : '';
                return `残り ${dayStr}${h.toString().padStart(2, '0')}時間 ${m.toString().padStart(2, '0')}分 ${s.toString().padStart(2, '0')}秒`;
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

                    if (remaining <= 0) {
                        timer.textContent = "締切済み";
                        Object.assign(timer.style, { color: "red", fontWeight: "bold" });
                    } else {
                        timer.textContent = formatTimeLeft(remaining);
                        const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
                        if (days < 1) {
                            Object.assign(timer.style, {
                                color: "red", fontWeight: "bold", textDecoration: "underline"
                            });
                        } else if (days < 3) {
                            Object.assign(timer.style, {
                                color: "#FF8C00", fontWeight: "bold", textDecoration: "none"
                            });
                        } else {
                            timer.style.color = "";
                            timer.style.fontWeight = "";
                            timer.style.textDecoration = "";
                        }
                    }
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
            if (!btn || btn.dataset.cgHooked) return;

            btn.dataset.cgHooked = "1";

            btn.addEventListener("click", () => {
                const title = document.getElementsByClassName("c-heading")[0].innerText.trim();
                const subject = document.getElementsByClassName("submission_subject")[0].childNodes[3].innerText.trim();
                sessionStorage.setItem("cg_return_to_task", JSON.stringify({ title, subject }));
            }, true);
        } else if (document.title === "成績ダッシュボード") {
            deleteCookie("cg_grade_updated");
        } else if (document.title === "成績情報") {
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
                    <a href="javascript:void(0);" onclick="javascript:ClearStorage(); javascript:sessionStorage.setItem('cg_grade_nav', 'dashboard'); javascript:postSubmit('emptyForm', 'SC_15005B00_01/init')" class="c-gnav-link cg-gnav-link"><i class="c-icon-check" aria-hidden="true"></i>単位情報</a>
                `;
        }
    }
})();