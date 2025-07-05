// ==UserScript==
// @name         Comfortable Gakujo
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  必ず読んでからご利用ください：https://github.com/woody-1227/Comfortable-Gakujo/blob/main/README.md
// @author       woody_1227
// @match        https://gakujo.shizuoka.ac.jp/*
// @grant        none
// @updateURL    https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/Comfortable_Gakujo.user.js
// @downloadURL  https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/Comfortable_Gakujo.user.js
// @icon         https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/icon.png
// ==/UserScript==

(function () {
    'use strict';

    if (document.title !== "課題・アンケートリスト") return;

    let processedSet = new WeakSet();

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

        const rows = Array.from(tbody.querySelectorAll("tr"));
        rows.sort((a, b) => getDeadlineDate(a) - getDeadlineDate(b)).forEach(row => {
            tbody.appendChild(row);
        });

        for (const row of rows) {
            if (processedSet.has(row)) continue;
            processedSet.add(row);

             const statusTd = row.querySelector('td[data-label="提出状況"]');
            if (statusTd) {
                const statusSpan = statusTd.querySelector('span');
                if (statusSpan) {
                    if (statusSpan.textContent.trim() === "未提出") {
                        statusSpan.style.color = "red";
                    } else if (statusSpan.textContent.trim() === "提出済") {
                        statusSpan.style.color = "green";
                    }
                }
            }
            
            const deadline = getDeadlineDate(row);
            const now = Date.now();

            if (deadline.getHours() < 12) {
                const tds = row.querySelectorAll("td");
                const last5 = tds[4].textContent.slice(-5);
                tds[4].innerHTML = tds[4].textContent.slice(0, -5) +
                    `<span style="color:red;font-weight:bold">${last5}</span>`;
            }

            const td = row.querySelector('td[data-label*="提出期間"]');
            if (!td) continue;

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
                if (days === 0) {
                    Object.assign(timer.style, {
                        color: "red", fontWeight: "bold", textDecoration: "underline"
                    });
                } else if (days <= 3) {
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
})();