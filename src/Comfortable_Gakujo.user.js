// ==UserScript==
// @name         Comfortable Gakujo
// @namespace    http://tampermonkey.net/
// @version      1.4.0
// @description  READMEを必ず読んでからご利用ください：https://github.com/woody-1227/Comfortable-Gakujo/blob/main/README.md
// @author       woody_1227
// @match        https://gakujo.shizuoka.ac.jp/*
// @match        https://idp.shizuoka.ac.jp/*
// @grant        none
// @updateURL    https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/Comfortable_Gakujo.user.js
// @downloadURL  https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/Comfortable_Gakujo.user.js
// @icon         https://github.com/woody-1227/Comfortable-Gakujo/raw/main/src/icon.png
// ==/UserScript==

(function () {
    'use strict';

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
            document.cookie = cookieName + "=" + encodeURIComponent(JSON.stringify(task)) + "; path=/; max-age=31536000";
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
                            document.cookie = cookieName + "=; path=/; max-age=0";
                        }
                    } catch (e) {

                    }
                }
            }
        });
    };

    if (document.title === "ホーム画面（学生・保護者）") {
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
    }

    if (location.hostname === "idp.shizuoka.ac.jp") {
        const btn = document.getElementsByName("_eventId_proceed")[0];

        if (btn) {
            console.log("[Comfortable Gakujo] Auto login click");
            btn.click();
        }
    }
})();