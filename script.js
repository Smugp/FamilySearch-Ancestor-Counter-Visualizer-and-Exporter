// ==UserScript==
// @name         FamilySearch Ancestor Counter Visualizer and Exporter
// @namespace    https://github.com/HaroldPetersInskipp
// @version      0.0.2
// @homepageURL  https://github.com/HaroldPetersInskipp/FamilySearch-Ancestor-Counter-Visualizer-and-Exporter
// @supportURL   https://github.com/HaroldPetersInskipp/FamilySearch-Ancestor-Counter-Visualizer-and-Exporter/issues
// @downloadURL  https://gist.github.com/HaroldPetersInskipp/3fb1733305d78531b111c0f78dda8d40/raw/familysearch-ancestor-counter-visualizer-and-exporter.user.js
// @updateURL    https://gist.github.com/HaroldPetersInskipp/3fb1733305d78531b111c0f78dda8d40/raw/familysearch-ancestor-counter-visualizer-and-exporter.user.js
// @description  Counts total unique ancestors found in the FamilySearch pedigree page allowing you to visualize and export the stored data.
// @author       Inskipp
// @copyright    2026+, HaroldPetersInskipp (https://github.com/HaroldPetersInskipp)
// @license      MIT
// @match        https://www.familysearch.org/en/tree/pedigree/portrait/*
// @grant        none
// @icon         https://raw.githubusercontent.com/HaroldPetersInskipp/FamilySearch-Ancestor-Counter-Visualizer-and-Exporter/main/icon.png
// ==/UserScript==

(function () {
    'use strict';

    ////////////////////////////////////////////////////////////
    // Persistent Global Storage
    ////////////////////////////////////////////////////////////

    if (!window.ancestorStore) {

        const stored = JSON.parse(localStorage.getItem("ancestorData") || "{}");

        window.ancestorStore = {

            people: stored.people || {},   // { pid: { name, depth } }
            scanned: new Set(stored.scanned || []),
            queue: stored.queue || [],     // { pid, depth }

            save() {
                localStorage.setItem("ancestorData", JSON.stringify({
                    people: this.people,
                    scanned: [...this.scanned],
                    queue: this.queue
                }));
            },

            clear() {
                this.people = {};
                this.scanned.clear();
                this.queue = [];
                this.save();
                document.getElementById('total').textContent =
                    "Total Unique Ancestors: 0";
                console.log("Ancestor store cleared.");
            },

            hasPerson(pid) {
                return !!this.people[pid];
            },

            hasScanned(pid) {
                return this.scanned.has(pid);
            },

            addPerson(pid, name, depth) {

                if (!this.people[pid]) {
                    this.people[pid] = {
                        name: name || "Unknown",
                        depth
                    };
                } else {
                    // If discovered again at lower depth, keep smallest
                    if (depth < this.people[pid].depth) {
                        this.people[pid].depth = depth;
                    }
                }
            },

            markScanned(pid) {
                this.scanned.add(pid);
            }
        };
    }

    ////////////////////////////////////////////////////////////////
    // UI Box
    ////////////////////////////////////////////////////////////////

    const box = document.createElement('div');
    Object.assign(box.style, {
        position: 'fixed',
        top: '15px',
        left: (window.innerWidth - 290) + 'px',
        background: 'rgba(0,0,0,0.9)',
        color: '#fff',
        padding: '14px',
        borderRadius: '10px',
        fontSize: '13px',
        fontFamily: 'Arial, sans-serif',
        zIndex: '999999',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        lineHeight: '1.5',
        width: '260px'
    });

    box.innerHTML = `
        <div id="boxHeader" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
            <div id="dragHandle" style="cursor:move;">
                <strong>Total Ancestor Counter</strong>
            </div>
            <span id="toggleBox">−</span>
        </div>

        <div id="boxContent">
            <div id="status">Status: Idle</div>
            <div id="total" style="margin-top:6px;">
                Total Unique Ancestors: ${Object.keys(ancestorStore.people).length}
            </div>
            <div style="margin-top:8px;">
                <button id="scan">Start</button>
                <button id="stop">Stop</button>
                <button id="clear">Clear</button>
                <button id="visualize">Visualize</button>
            </div>
        </div>
    `;

    document.body.appendChild(box);

    ////////////////////////////////////////////////////////////
    // Dragging Logic
    ////////////////////////////////////////////////////////////

    (function makeDraggable(element, handle) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.addEventListener("mousedown", (e) => {
            isDragging = true;

            const rect = element.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            element.style.transition = "none"; // disable animation while dragging
            document.body.style.userSelect = "none";
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;

            element.style.left = `${e.clientX - offsetX}px`;
            element.style.top = `${e.clientY - offsetY}px`;
            element.style.right = "auto"; // override original right positioning
        });

        document.addEventListener("mouseup", () => {
            if (!isDragging) return;
            isDragging = false;
            document.body.style.userSelect = "auto";
        });

    })(box, document.getElementById("dragHandle"));

    let minimized = false;

    document.getElementById('boxHeader')
        .addEventListener('click', () => {

        minimized = !minimized;

        const content = document.getElementById('boxContent');
        const toggle = document.getElementById('toggleBox');

        if (minimized) {
            content.style.display = "none";
            toggle.textContent = "+";
            box.style.width = "160px";
        } else {
            content.style.display = "block";
            toggle.textContent = "−";
            box.style.width = "260px";
        }
    });

    ////////////////////////////////////////////////////////////////
    // Helpers
    ////////////////////////////////////////////////////////////////

    function getRootPID() {
        const segments = window.location.pathname
            .split('/')
            .filter(Boolean);

        return segments.length
            ? segments[segments.length - 1]
            : null;
    }

    async function fetchNine(pid) {
        const response = await fetch(
            `/service/tree/tree-data/r9/portrait-pedigree/${pid}?numGenerations=1`,
            { credentials: 'include' }
        );

        if (!response.ok) throw new Error("API request failed");
        return response.json();
    }

    ////////////////////////////////////////////////////////////////
    // Traversal
    ////////////////////////////////////////////////////////////////

    let stopRequested = false;

    async function traverseAll(rootPID) {

    if (ancestorStore.queue.length === 0) {
        ancestorStore.queue.push({ pid: rootPID, depth: 0 });
        ancestorStore.addPerson(rootPID, "Root (THIS IS YOU)", 0);
    }

    while (ancestorStore.queue.length > 0) {

        if (stopRequested) break;

        const { pid: currentPID, depth } = ancestorStore.queue.shift();

        if (ancestorStore.hasScanned(currentPID)) continue;

        document.getElementById('status').textContent =
            `Scanning ${currentPID} (Gen ${depth + 1})...`;

        try {
            const data = await fetchNine(currentPID);
            if (!data?.ancestors) continue;

            const lastGeneration =
                data.ancestors[data.ancestors.length - 1];

            lastGeneration.forEach(couple => {

                const p1 = couple.parent1;
                const p2 = couple.parent2;

                const nextDepth = depth + 1;

                if (p1?.id) {
                    ancestorStore.addPerson(p1.id, p1.name, nextDepth);

                    if (!ancestorStore.hasScanned(p1.id)) {
                        ancestorStore.queue.push({
                            pid: p1.id,
                            depth: nextDepth
                        });
                    }
                }

                if (p2?.id) {
                    ancestorStore.addPerson(p2.id, p2.name, nextDepth);

                    if (!ancestorStore.hasScanned(p2.id)) {
                        ancestorStore.queue.push({
                            pid: p2.id,
                            depth: nextDepth
                        });
                    }
                }
            });

        } catch (err) {
            console.error(err);
        }

        ancestorStore.markScanned(currentPID);
        ancestorStore.save();

        const total =
            Object.keys(ancestorStore.people).length - 1;

        document.getElementById('total').textContent =
            `Total Unique Ancestors: ${total}`;

        await new Promise(r => setTimeout(r, 5));
    }

    ancestorStore.save();

    return Object.keys(ancestorStore.people)
        .filter(pid => pid !== rootPID).length;
    }

    ////////////////////////////////////////////////////////////////
    // Buttons
    ////////////////////////////////////////////////////////////////

    document.getElementById('scan').addEventListener('click', async () => {

        const pid = getRootPID();
        if (!pid) return alert("Could not find root PID.");

        stopRequested = false;
        document.getElementById('status').textContent = "Status: Starting...";

        const total = await traverseAll(pid);

        document.getElementById('status').textContent =
            stopRequested ? "Status: Stopped" : "Status: Complete";

        document.getElementById('total').textContent =
            `Total Unique Ancestors Found: ${total}`;
    });

    document.getElementById('stop').addEventListener('click', () => {
        stopRequested = true;
        document.getElementById('status').textContent = "Status: Stopping...";
    });

    document.getElementById('clear').addEventListener('click', () => {
        ancestorStore.clear();
    });

    ////////////////////////////////////////////////////////////
    // Visualization Modal
    ////////////////////////////////////////////////////////////

    document.getElementById('visualize').addEventListener('click', () => {

        if (!Object.keys(ancestorStore.people).length) {
            alert("No stored PIDs to visualize.");
            return;
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = "ancestorOverlay";

        overlay.innerHTML = `
        <div class="modal">
            <div class="modalHeader">
                <div>
                    <h2>Ancestors Found Visualizer</h2>
                    <div class="count">${Object.keys(ancestorStore.people).length - 1} Unique Ancestors</div>
                </div>
                    <div style="display:flex;gap:8px;">
                    <button class="exportBtn">Export to JSON</button>
                    <button class="closeBtn">✕</button>
                </div>
            </div>

            <input class="searchBox" placeholder="Search by name and/or PID..." />

            <div class="grid"></div>
        </div>
    `;

        document.body.appendChild(overlay);

        ////////////////////////////////////////////////////////////
        // Inject CSS
        ////////////////////////////////////////////////////////////

        const style = document.createElement('style');
        style.textContent = `
        #ancestorOverlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.75);
            backdrop-filter: blur(8px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999999;
            animation: fadeIn .3s ease;
        }

        .modal {
            width: 85%;
            height: 85%;
            background: linear-gradient(145deg,#111,#1b1b1b);
            border-radius: 20px;
            padding: 25px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 25px 60px rgba(0,0,0,.6);
            color: white;
            font-family: system-ui;
        }

        .modalHeader {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .modalHeader h2 {
            margin: 0;
            font-weight: 600;
        }

        .count {
            font-size: 13px;
            opacity: .6;
            margin-top: 4px;
        }

        .closeBtn {
            background: #ff4d4d;
            border: none;
            border-radius: 8px;
            padding: 6px 10px;
            cursor: pointer;
            color: white;
            font-weight: bold;
        }

        .exportBtn {
            background: linear-gradient(145deg,#3a7cff,#1f5eff);
            border: none;
            border-radius: 8px;
            padding: 6px 12px;
            cursor: pointer;
            color: white;
            font-weight: 600;
            transition: transform .15s ease, box-shadow .15s ease;
        }

        .exportBtn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 15px rgba(0,0,0,.5);
        }

        .searchBox {
            margin: 15px 0;
            padding: 10px;
            border-radius: 10px;
            border: none;
            background: #222;
            color: white;
            outline: none;
        }

        .grid {
            flex: 1;
            overflow: auto;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 12px;
        }

        .pidCard {
            background: linear-gradient(145deg,#1f1f1f,#292929);
            padding: 12px;
            border-radius: 14px;
            text-align: center;
            font-size: 13px;
            transition: transform .2s ease, box-shadow .2s ease;
            cursor: pointer;
            box-shadow: 0 5px 15px rgba(0,0,0,.4);
        }

        .pidCard:hover {
            transform: translateY(-4px);
            box-shadow: 0 10px 25px rgba(0,0,0,.7);
        }

        @keyframes fadeIn {
            from { opacity: 0 }
            to { opacity: 1 }
        }
    `;

        document.head.appendChild(style);

        ////////////////////////////////////////////////////////////
        // Populate Grid
        ////////////////////////////////////////////////////////////

        const grid = overlay.querySelector('.grid');

        function render(filter = "") {
            grid.innerHTML = "";

            Object.entries(ancestorStore.people)
                .filter(([pid, person]) =>
                        pid.toLowerCase().includes(filter.toLowerCase()) ||
                        person.name.toLowerCase().includes(filter.toLowerCase())
                       )
                .sort((a, b) => {
                    if (a[1].depth !== b[1].depth) {
                        return a[1].depth - b[1].depth;
                    }
                    return (a[1].name || "").localeCompare(b[1].name || "");
                })
                .forEach(([pid, person]) => {

                const card = document.createElement('div');
                card.className = "pidCard";

                const hue = (person.depth * 35) % 360;

                card.style.border = `2px solid hsl(${hue},70%,50%)`;

                card.innerHTML = `
        <div style="font-weight:600;">${pid}</div>
        <div style="font-size:12px;opacity:.7;margin-top:4px;">
            ${person.name}
        </div>
        <div style="font-size:11px;margin-top:6px;color:hsl(${hue},70%,60%);">
            Generation ${person.depth}
        </div>
    `;

                card.addEventListener('click', () => {
                    window.open(
                        `https://www.familysearch.org/tree/person/details/${pid}`,
                        "_blank"
                    );
                });

                grid.appendChild(card);
            });
        }

        render();

        ////////////////////////////////////////////////////////////
        // Search
        ////////////////////////////////////////////////////////////

        overlay.querySelector('.searchBox')
            .addEventListener('input', e => {
            render(e.target.value);
        });

        ////////////////////////////////////////////////////////////
        // Export
        ////////////////////////////////////////////////////////////

        overlay.querySelector('.exportBtn')
            .addEventListener('click', () => {

            const exportData = {
                totalAncestors: Object.keys(ancestorStore.people).length - 1,
                exportedAt: new Date().toISOString(),
                people: ancestorStore.people
            };

            const blob = new Blob(
                [JSON.stringify(exportData, null, 2)],
                { type: "application/json" }
            );

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ancestors_${Date.now()}.json`;
            a.click();

            URL.revokeObjectURL(url);
        });

        ////////////////////////////////////////////////////////////
        // Close
        ////////////////////////////////////////////////////////////

        overlay.querySelector('.closeBtn')
            .addEventListener('click', () => {
            overlay.remove();
            style.remove();
        });

    });

})();
