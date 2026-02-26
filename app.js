(function () {
    'use strict';

    // --- CONFIGURATION ---
    const CONFIG = {
        DEFAULT_PERIOD_MINUTES: 25,
        DEFAULT_BREAK_MINUTES: 5,
        DEFAULT_TIMEOUT_SECONDS: 60,
        ANNOUNCEMENT_DURATION: 4000,
        LONG_PRESS_DURATION: 600,
        INITIAL_FOUL_THRESHOLD: 10,
        FOUL_THRESHOLD_INCREMENT: 5,
        MAX_TIME_MINUTES: 99,
        MAX_TIME_SECONDS: 59,
        MAX_BREAK_MINUTES: 30,
        MIN_BREAK_MINUTES: 1,
        BLUE_CARD_DURATION: 120, // 2 minutes in seconds
        RED_CARD_DURATION: 240 // 4 minutes in seconds
    };

    const CARD_YELLOW = 'Yellow Card';
    const CARD_BLUE = 'Blue Card';
    const CARD_RED = 'Red Card';
    const FOUL_STANDARD = 'Standard Foul';

    // --- PREDEFINED TEAMS ---
    const teamDatabase = {
        "Isfiya HC": { name: "Isfiya HC", color: "#3b82f6", players: ["1 - Golan (GK)", "5 - Perez", "8 - Levi", "10 - Cohen", "12 - Mizrahi"] },
        "Haifa Rollers": { name: "Haifa Rollers", color: "#ef4444", players: ["3 - Katz", "7 - Avraham", "9 - Ben David", "11 - Friedman", "99 - Dahan (GK)"] },
        "Tel Aviv Strikers": { name: "Tel Aviv Strikers", color: "#eab308", players: ["0 - Vardi (GK)", "4 - Ronen", "6 - Shapira", "14 - Golan", "88 - Carmel"] },
        "Jerusalem Kings": { name: "Jerusalem Kings", color: "#8b5cf6", players: ["2 - Cohen", "5 - Levi", "10 - Sabag", "13 - Malka", "33 - Tal (GK)"] }
    };

    function loadPreset(side) {
        const selectEl = document.getElementById('preset' + side);
        const teamKey = selectEl.value;
        if (teamKey && teamDatabase[teamKey]) {
            const team = teamDatabase[teamKey];
            document.getElementById('inputName' + side).value = team.name;
            document.getElementById('inputColor' + side).value = team.color;
            document.getElementById('inputPlayers' + side).value = team.players.join(', ');
        }
    }

    // --- IOS AUDIO API UNLOCKER & SYNTHESIZER ---
    let audioCtx;
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playBuzzer() {
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        const duration = 1.5;

        const masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);

        // Softer envelope to prevent popping and reduce abrasive onset
        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(0.7, now + 0.05);
        masterGain.gain.setValueAtTime(0.7, now + duration - 0.1);
        masterGain.gain.linearRampToValueAtTime(0, now + duration);

        // Lowpass filter to remove piercing highs
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.connect(masterGain);

        // Thicker, more harmonious chord for a stadium horn sound (Power chord/perfect fifths)
        [150, 225, 300, 450].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            osc.type = i % 2 === 0 ? 'sawtooth' : 'square';
            osc.frequency.setValueAtTime(freq, now);
            osc.detune.setValueAtTime((i % 2 === 0 ? 5 : -5), now); // Detune for thickness
            osc.connect(filter);
            osc.start(now);
            osc.stop(now + duration);
        });
    }

    // --- STATE MANAGEMENT ---
    const periods = ["1st Half", "2nd Half", "OT 1", "OT 2", "Final"];

    let state = {
        matchData: {
            A: { name: "HOME", color: "#3b82f6", players: ["1", "2", "3", "4", "5"], score: 0, fouls: 0, playerFouls: {} },
            B: { name: "AWAY", color: "#ef4444", players: ["1", "2", "3", "4", "5"], score: 0, fouls: 0, playerFouls: {} }
        },
        penalties: { A: [], B: [] }, // Tracks active blue/red card timers
        timeouts: { A: 2, B: 2 }, // Each team has 2 timeouts per half
        timeLeft: CONFIG.DEFAULT_PERIOD_MINUTES * 60,
        periodDuration: CONFIG.DEFAULT_PERIOD_MINUTES * 60,
        currentPeriodIndex: 0,
        breakDuration: CONFIG.DEFAULT_BREAK_MINUTES * 60,
        timeoutDuration: CONFIG.DEFAULT_TIMEOUT_SECONDS,
        isBreak: false,
        events: []
    };

    let animationFrameId = null;
    let isRunning = false;
    let targetEndTime = null;
    let lastTickTime = null;
    let timeoutLeft = CONFIG.DEFAULT_TIMEOUT_SECONDS;
    let timeoutInterval = null;
    let announcementTimer = null;
    let currentAction = null;
    let activeTeam = null;
    let goalScorer = null;
    let foulPlayer = null;

    // --- LOCAL STORAGE ---
    function saveState() {
        localStorage.setItem('rinkHockeyData', JSON.stringify(state));
    }

    function loadState() {
        const saved = localStorage.getItem('rinkHockeyData');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                
                // Deep merge helper
                const defaultState = {
                    matchData: {
                        A: { name: "HOME", color: "#3b82f6", players: ["1", "2", "3", "4", "5"], score: 0, fouls: 0, playerFouls: {} },
                        B: { name: "AWAY", color: "#ef4444", players: ["1", "2", "3", "4", "5"], score: 0, fouls: 0, playerFouls: {} }
                    },
                    penalties: { A: [], B: [] },
                    timeouts: { A: 2, B: 2 },
                    timeLeft: CONFIG.DEFAULT_PERIOD_MINUTES * 60,
                    periodDuration: CONFIG.DEFAULT_PERIOD_MINUTES * 60,
                    currentPeriodIndex: 0,
                    breakDuration: CONFIG.DEFAULT_BREAK_MINUTES * 60,
                    timeoutDuration: CONFIG.DEFAULT_TIMEOUT_SECONDS,
                    isBreak: false,
                    events: []
                };

                state = {
                    ...defaultState,
                    ...parsed,
                    matchData: {
                        A: { ...defaultState.matchData.A, ...(parsed.matchData?.A || {}) },
                        B: { ...defaultState.matchData.B, ...(parsed.matchData?.B || {}) }
                    },
                    penalties: parsed.penalties || defaultState.penalties,
                    timeouts: parsed.timeouts || defaultState.timeouts,
                    periodDuration: parsed.periodDuration || parsed.timeLeft || defaultState.periodDuration,
                    timeoutDuration: parsed.timeoutDuration || defaultState.timeoutDuration
                };

            } catch (error) {
                console.error("Saved game data corrupted", error);
                localStorage.removeItem('rinkHockeyData');
            }
        }
        refreshUI();
    }

    async function hardReset() {
        if (await showConfirm("🚨 Are you completely sure? This will delete the current score, log, and timer to start a fresh game!")) {
            localStorage.removeItem('rinkHockeyData');
            location.reload();
        }
    }

    function getNextFoulThreshold(f) {
        return (f < CONFIG.INITIAL_FOUL_THRESHOLD) ? CONFIG.INITIAL_FOUL_THRESHOLD : Math.floor(f / CONFIG.FOUL_THRESHOLD_INCREMENT) * CONFIG.FOUL_THRESHOLD_INCREMENT + CONFIG.FOUL_THRESHOLD_INCREMENT;
    }

    // --- UI UPDATES ---
    function refreshUI() {
        document.getElementById('nameA').textContent = state.matchData.A.name;
        document.getElementById('nameB').textContent = state.matchData.B.name;
        document.getElementById('scoreA').textContent = state.matchData.A.score;
        document.getElementById('scoreB').textContent = state.matchData.B.score;
        document.getElementById('foulsA').textContent = state.matchData.A.fouls;
        document.getElementById('foulsB').textContent = state.matchData.B.fouls;

        const timerDisplay = document.getElementById('timerDisplay');
        if (state.isBreak) {
            document.getElementById('periodDisplay').textContent = "Halftime";
            timerDisplay.className = 'timer break';
        } else {
            document.getElementById('periodDisplay').textContent = periods[state.currentPeriodIndex];
            timerDisplay.className = isRunning ? 'timer running' : 'timer paused';
        }

        document.getElementById('colorLineA').style.backgroundColor = state.matchData.A.color;
        document.getElementById('colorLineB').style.backgroundColor = state.matchData.B.color;

        updateFoulVisuals();
        updateTimerDisplay();
        updatePenaltiesUI();
        updateTimeoutsUI();
        updateTimeoutButton();
        renderMatchLog();
    }

    function updateTimeoutButton() {
        const timeoutBtn = document.getElementById('btnOpenTimeout');
        if (timeoutBtn) {
            timeoutBtn.disabled = isRunning;
        }
    }

    function updateTimerDisplay() {
        const m = Math.floor(state.timeLeft / 60);
        const s = state.timeLeft % 60;
        const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        document.getElementById('timerDisplay').textContent = timeStr;
        return timeStr;
    }

    function updateFoulVisuals() {
        ['A', 'B'].forEach(team => {
            const f = state.matchData[team].fouls;
            const max = getNextFoulThreshold(f);
            const prevMax = max === CONFIG.INITIAL_FOUL_THRESHOLD ? 0 : max - CONFIG.FOUL_THRESHOLD_INCREMENT;
            const progress = f - prevMax;
            const totalSteps = max - prevMax;
            const percentage = (progress / totalSteps) * 100;

            document.getElementById('foulMax' + team).textContent = ` / ${max}`;
            const barFill = document.getElementById('foulBar' + team);
            const section = document.getElementById('foulSection' + team);

            barFill.style.width = percentage + '%';
            section.className = 'foul-section';

            if (progress === totalSteps) {
                section.classList.add('foul-danger');
            } else if (progress === totalSteps - 1) {
                section.classList.add('foul-warning');
            } else {
                barFill.style.backgroundColor = state.matchData[team].color;
            }
        });
    }

    function updatePenaltiesUI() {
        ['A', 'B'].forEach(team => {
            const container = document.getElementById('penalties' + team);
            container.innerHTML = '';
            state.penalties[team].forEach(p => {
                const m = Math.floor(p.timeLeft / 60);
                const s = p.timeLeft % 60;
                const timeStr = `${m}:${s.toString().padStart(2, '0')}`;

                const pill = document.createElement('div');
                pill.className = 'penalty-pill';
                pill.style.backgroundColor = p.type === 'red' ? 'var(--accent-red)' : 'var(--accent-blue)';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = p.player;

                const timeSpan = document.createElement('span');
                timeSpan.className = 'penalty-time';
                timeSpan.textContent = timeStr;

                pill.appendChild(nameSpan);
                pill.appendChild(timeSpan);

                // Tap to dismiss early
                pill.addEventListener('click', async () => {
                    if (await showConfirm(`Cancel penalty for ${p.player} early?`)) {
                        state.penalties[team] = state.penalties[team].filter(pen => pen.id !== p.id);
                        saveState();
                        refreshUI();
                    }
                });

                container.appendChild(pill);
            });
        });
    }

    function updateTimeoutsUI() {
        ['A', 'B'].forEach(team => {
            const container = document.getElementById('timeouts' + team);
            container.innerHTML = '';
            const timeoutsRemaining = state.timeouts[team] || 0;
            
            // Show 2 timeout circles, filled if available, empty if used
            for (let i = 0; i < 2; i++) {
                const circle = document.createElement('div');
                circle.className = i < timeoutsRemaining ? 'timeout-circle active' : 'timeout-circle used';
                container.appendChild(circle);
            }
        });
    }

    // --- CUSTOM CONFIRM MODAL ---
    function showConfirm(message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            document.getElementById('confirmModalTitle').textContent = message;

            const btnOk = document.getElementById('btnConfirmOk');
            const btnCancel = document.getElementById('btnConfirmCancel');

            const cleanup = () => {
                btnOk.removeEventListener('click', onOk);
                btnCancel.removeEventListener('click', onCancel);
                modal.style.display = 'none';
            };

            const onOk = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };

            btnOk.addEventListener('click', onOk);
            btnCancel.addEventListener('click', onCancel);

            modal.style.display = 'flex';
        });
    }

    // --- SETUP MODAL ---
    function openSetup() {
        document.getElementById('setupModal').style.display = 'flex';
        document.getElementById('inputMin').value = Math.floor(state.timeLeft / 60);
        document.getElementById('inputSec').value = state.timeLeft % 60;
        document.getElementById('inputBreakMin').value = Math.floor(state.breakDuration / 60);
        document.getElementById('inputTimeoutSec').value = state.timeoutDuration;
        ['A', 'B'].forEach(t => {
            document.getElementById('inputName' + t).value = state.matchData[t].name;
            document.getElementById('inputColor' + t).value = state.matchData[t].color;
            document.getElementById('inputPlayers' + t).value = state.matchData[t].players.join(', ');
        });
    }

    function closeSetup() {
        document.getElementById('setupModal').style.display = 'none';
    }

    function applySetup() {
        let isValid = true;
        ['A', 'B'].forEach(t => {
            const name = document.getElementById('inputName' + t).value.trim();
            if (!name) {
                alert(`Team ${t} name cannot be empty!`);
                isValid = false;
                return;
            }
            state.matchData[t].name = name;
            state.matchData[t].color = document.getElementById('inputColor' + t).value;

            const players = document.getElementById('inputPlayers' + t).value.split(',').map(p => p.trim()).filter(p => p);
            if (players.length === 0) {
                alert(`Team ${t} must have at least one player!`);
                isValid = false;
                return;
            }
            state.matchData[t].players = players;
        });

        if (!isValid) return;

        let newMin = parseInt(document.getElementById('inputMin').value, 10) || 0;
        let newSec = parseInt(document.getElementById('inputSec').value, 10) || 0;
        if (newMin < 0) newMin = 0; if (newMin > CONFIG.MAX_TIME_MINUTES) newMin = CONFIG.MAX_TIME_MINUTES;
        if (newSec < 0) newSec = 0; if (newSec > CONFIG.MAX_TIME_SECONDS) newSec = CONFIG.MAX_TIME_SECONDS;

        const totalSeconds = (newMin * 60) + newSec;
        if (totalSeconds === 0) {
            alert('Time cannot be zero!');
            return;
        }

        state.timeLeft = totalSeconds;
        state.periodDuration = totalSeconds;

        let newBreakMin = parseInt(document.getElementById('inputBreakMin').value, 10) || CONFIG.DEFAULT_BREAK_MINUTES;
        if (newBreakMin < CONFIG.MIN_BREAK_MINUTES) newBreakMin = CONFIG.MIN_BREAK_MINUTES;
        if (newBreakMin > CONFIG.MAX_BREAK_MINUTES) newBreakMin = CONFIG.MAX_BREAK_MINUTES;
        state.breakDuration = newBreakMin * 60;

        let newTimeoutSec = parseInt(document.getElementById('inputTimeoutSec').value, 10) || CONFIG.DEFAULT_TIMEOUT_SECONDS;
        if (newTimeoutSec < 1) newTimeoutSec = 1;
        if (newTimeoutSec > 999) newTimeoutSec = 999;
        state.timeoutDuration = newTimeoutSec;

        // Unlock iOS audio context on direct user tap
        initAudio();
        if (audioCtx && audioCtx.state === 'running') {
             const osc = audioCtx.createOscillator();
             const gain = audioCtx.createGain();
             gain.gain.value = 0; // Silent oscillator
             osc.connect(gain);
             gain.connect(audioCtx.destination);
             osc.start(audioCtx.currentTime);
             osc.stop(audioCtx.currentTime + 0.01);
        }

        saveState();
        refreshUI();
        closeSetup();
    }

    // --- TIMER LOGIC (Drift-Proof + Sleep Protection) ---
    function cyclePeriod() {
        if (state.isBreak) {
            state.isBreak = false;
            state.timeLeft = state.periodDuration;
            if (isRunning) {
                cancelAnimationFrame(animationFrameId);
                isRunning = false;
            }
        }
        
        const previousPeriod = state.currentPeriodIndex;
        state.currentPeriodIndex = (state.currentPeriodIndex + 1) % periods.length;
        
        // Reset timeouts at the start of second half (index 1)
        if (state.currentPeriodIndex === 1) {
            state.timeouts.A = 2;
            state.timeouts.B = 2;
            showAnnouncement("2nd Half", "Timeouts have been reset for both teams");
        }
        // No timeouts in OT periods (index 2 = OT 1, index 3 = OT 2)
        else if (state.currentPeriodIndex === 2 || state.currentPeriodIndex === 3) {
            state.timeouts.A = 0;
            state.timeouts.B = 0;
            showAnnouncement(periods[state.currentPeriodIndex], "No timeouts available in overtime");
        }
        
        saveState();
        refreshUI();
    }

    function timerTick() {
        if (!targetEndTime) return;
        const now = Date.now();

        // Sleep Protection: If device went to sleep (tick took > 2 seconds), pause the timer effectively by bumping target time
        const delta = now - lastTickTime;
        if (delta > 2000) {
            targetEndTime += (delta - 200); // 200ms is the expected tick interval
        }
        lastTickTime = now;

        const remainingMs = targetEndTime - now;

        if (remainingMs > 0) {
            const newTimeLeft = Math.ceil(remainingMs / 1000);
            if (newTimeLeft !== state.timeLeft) {
                const diff = state.timeLeft - newTimeLeft;
                state.timeLeft = newTimeLeft;

                if (diff > 0 && !state.isBreak) {
                    ['A', 'B'].forEach(team => {
                        let i = state.penalties[team].length;
                        while (i--) {
                            state.penalties[team][i].timeLeft -= diff;
                            if (state.penalties[team][i].timeLeft <= 0) {
                                state.penalties[team].splice(i, 1);
                            }
                        }
                    });
                }

                updateTimerDisplay();
                updatePenaltiesUI();
                if (remainingMs % 1000 < 200) saveState();
            }
        } else {
            state.timeLeft = 0;
            cancelAnimationFrame(animationFrameId);
            playBuzzer();
            if (state.isBreak) {
                state.isBreak = false;
                isRunning = false;
                state.currentPeriodIndex = (state.currentPeriodIndex + 1) % periods.length;
                state.timeLeft = state.periodDuration;
                if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
            } else {
                state.isBreak = true;
                state.timeLeft = state.breakDuration;
                if (navigator.vibrate) navigator.vibrate(1000);
                startTimer();
            }
            saveState();
            refreshUI();
        }
    }

    function startTimer() {
        initAudio();
        if (!state.isBreak && state.timeLeft === state.periodDuration) playBuzzer();
        isRunning = true;
        targetEndTime = Date.now() + (state.timeLeft * 1000);
        lastTickTime = Date.now();
        if (animationFrameId) cancelAnimationFrame(animationFrameId);

        const tick = () => {
            if (!isRunning) return;
            timerTick();
            if (isRunning) animationFrameId = requestAnimationFrame(tick);
        };
        animationFrameId = requestAnimationFrame(tick);
        refreshUI();
    }

    // --- UNIFIED ACTION MODAL (GOALS & FOULS/CARDS) ---
    function initiateAction(type, team) {
        currentAction = type;
        activeTeam = team;
        goalScorer = null;
        foulPlayer = null;

        const titleEl = document.getElementById('actionModalTitle');
        titleEl.textContent = type === 'goal' ? `Who scored?` : `Who committed the foul?`;
        titleEl.style.color = type === 'goal' ? "var(--text-main)" : "var(--accent-red)";

        document.getElementById('playerGrid').style.display = 'grid';
        document.getElementById('foulTypeGrid').style.display = 'none';
        document.getElementById('skipBtnPlayer').style.display = type === 'foul' ? 'block' : 'none';
        document.getElementById('skipBtnAssist').style.display = 'none';

        const grid = document.getElementById('playerGrid');
        grid.innerHTML = '';
        state.matchData[team].players.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'btn-player';
            btn.textContent = p;

            if (type === 'foul' && state.matchData[team].playerFouls[p]) {
                const foulSpan = document.createElement('span');
                foulSpan.style.fontSize = 'clamp(0.7rem, 1.5vh, 1rem)';
                foulSpan.style.color = 'var(--accent-red)';
                foulSpan.style.display = 'block';
                foulSpan.textContent = `(${state.matchData[team].playerFouls[p]} fouls)`;
                btn.appendChild(document.createElement('br'));
                btn.appendChild(foulSpan);
            }
            btn.style.borderBottom = `3px solid ${state.matchData[team].color}`;
            btn.addEventListener('click', () => selectPlayer(p));
            grid.appendChild(btn);
        });
        document.getElementById('actionModal').style.display = 'flex';
    }

    function selectPlayer(p) {
        if (currentAction === 'goal') {
            if (!goalScorer) {
                goalScorer = p;
                document.getElementById('actionModalTitle').textContent = `Assist by?`;
                document.getElementById('skipBtnAssist').style.display = 'block';
            } else {
                finalizeGoal(goalScorer, p);
            }
        } else {
            foulPlayer = p;
            document.getElementById('actionModalTitle').textContent = `Select Infraction`;
            document.getElementById('playerGrid').style.display = 'none';
            document.getElementById('skipBtnPlayer').style.display = 'none';
            document.getElementById('foulTypeGrid').style.display = 'grid';
        }
    }

    function showAnnouncement(primaryText, secondaryText) {
        clearTimeout(announcementTimer);
        const ann = document.getElementById('announcement');
        const annText = document.getElementById('annText');
        annText.innerHTML = ''; // Clear previous

        const elPrimary = document.createElement('div');
        elPrimary.textContent = primaryText;
        annText.appendChild(elPrimary);

        if (secondaryText) {
            const elSecondary = document.createElement('div');
            elSecondary.style.fontSize = 'clamp(1rem, 2.5vh, 1.8rem)';
            elSecondary.style.color = '#94a3b8';
            elSecondary.style.fontWeight = '500';
            elSecondary.textContent = secondaryText;
            annText.appendChild(elSecondary);
        }

        ann.style.display = 'block';
        announcementTimer = setTimeout(() => {
            ann.style.display = 'none';
        }, CONFIG.ANNOUNCEMENT_DURATION);
    }

    function hideAnnouncement() {
        document.getElementById('announcement').style.display = 'none';
    }

    function finalizeGoal(scorer, assist) {
        document.getElementById('actionModal').style.display = 'none';
        state.matchData[activeTeam].score++;

        const eventId = Date.now();
        state.events.push({
            id: eventId,
            type: 'Goal',
            team: activeTeam,
            teamName: state.matchData[activeTeam].name,
            scorer: scorer,
            assist: assist,
            time: updateTimerDisplay(),
            period: state.isBreak ? "Halftime" : periods[state.currentPeriodIndex]
        });

        saveState();
        refreshUI();

        let primary = `Goal: ${scorer}`;
        let secondary = assist !== 'None' ? `Assist: ${assist}` : null;
        showAnnouncement(primary, secondary);
    }

    function finalizeInfraction(infractionType, countsAsTeamFoul) {
        document.getElementById('actionModal').style.display = 'none';

        if (countsAsTeamFoul) {
            state.matchData[activeTeam].fouls++;
        }
        if (foulPlayer !== 'None') {
            if (!state.matchData[activeTeam].playerFouls[foulPlayer]) {
                state.matchData[activeTeam].playerFouls[foulPlayer] = 0;
            }
            state.matchData[activeTeam].playerFouls[foulPlayer]++;
        }

        const eventId = Date.now();

        // --- PENALTY TIMER LOGIC ---
        if (infractionType === CARD_BLUE) {
            state.penalties[activeTeam].push({ id: eventId, player: foulPlayer, timeLeft: CONFIG.BLUE_CARD_DURATION, type: 'blue' });
        } else if (infractionType === CARD_RED) {
            state.penalties[activeTeam].push({ id: eventId, player: foulPlayer, timeLeft: CONFIG.RED_CARD_DURATION, type: 'red' });
        }

        state.events.push({
            id: eventId,
            type: 'Infraction',
            infractionType: infractionType,
            isFoul: countsAsTeamFoul,
            team: activeTeam,
            teamName: state.matchData[activeTeam].name,
            player: foulPlayer,
            time: updateTimerDisplay(),
            period: state.isBreak ? "Halftime" : periods[state.currentPeriodIndex]
        });
        saveState();
        refreshUI();

        if (infractionType !== FOUL_STANDARD) {
            let icon = infractionType === CARD_YELLOW ? '🟨' : infractionType === CARD_BLUE ? '🟦' : '🟥';
            let primary = `${icon} ${infractionType}`;
            let secondary = foulPlayer;
            showAnnouncement(primary, secondary);
        }
    }

    function cancelAction() {
        document.getElementById('actionModal').style.display = 'none';
    }

    function undoLastAction() {
        if (state.events.length === 0) {
            showAnnouncement("Nothing to undo.");
            return;
        }
        const lastEvent = state.events.pop();
        const team = lastEvent.team;

        if (lastEvent.type === 'Goal') {
            state.matchData[team].score = Math.max(0, state.matchData[team].score - 1);
            showAnnouncement(`⟲ Undid ${state.matchData[team].name} Goal`);
        } else if (lastEvent.type === 'Infraction') {
            if (lastEvent.isFoul) {
                state.matchData[team].fouls = Math.max(0, state.matchData[team].fouls - 1);
            }
            if (lastEvent.player !== 'None' && state.matchData[team].playerFouls[lastEvent.player] > 0) {
                state.matchData[team].playerFouls[lastEvent.player]--;
            }

            // Undo penalty timer if it was a card, matching the event id
            if (lastEvent.infractionType === CARD_BLUE || lastEvent.infractionType === CARD_RED) {
                state.penalties[team] = state.penalties[team].filter(p => p.id !== lastEvent.id);
            }
            showAnnouncement(`⟲ Undid ${state.matchData[team].name} ${lastEvent.infractionType}`);
        } else if (lastEvent.type === 'timeout') {
            // Restore the timeout for the team
            if (state.timeouts[team] < 2) {
                state.timeouts[team]++;
                showAnnouncement(`⟲ Undid ${state.matchData[team].name} Timeout`);
            }
        }
        saveState();
        refreshUI();
    }

    function renderMatchLog() {
        const container = document.getElementById('matchLogDisplay');
        container.innerHTML = '';
        if (state.events.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.color = 'var(--text-muted)';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.padding = '20px';
            emptyMsg.textContent = 'No events recorded yet.';
            container.appendChild(emptyMsg);
            return;
        }

        [...state.events].reverse().forEach(ev => {
            const div = document.createElement('div');
            div.className = 'log-item';

            const contentWrapper = document.createElement('div');

            const timeSpan = document.createElement('span');
            timeSpan.style.color = 'var(--text-muted)';
            timeSpan.style.fontVariantNumeric = 'tabular-nums';
            timeSpan.style.marginRight = '10px';
            timeSpan.textContent = `[${ev.time}]`;
            contentWrapper.appendChild(timeSpan);

            const detailsSpan = document.createElement('span');
            if (ev.type === 'Goal') {
                const bText = document.createElement('b');
                bText.textContent = `${ev.teamName} Goal: `;
                detailsSpan.appendChild(bText);

                detailsSpan.appendChild(document.createTextNode(ev.scorer + ' '));

                const astSpan = document.createElement('span');
                astSpan.style.color = 'var(--text-muted)';
                astSpan.style.fontSize = 'clamp(0.7rem, 1.5vh, 1rem)';
                astSpan.textContent = `(Ast: ${ev.assist})`;
                detailsSpan.appendChild(astSpan);
            } else if (ev.type === 'timeout') {
                const bText = document.createElement('b');
                bText.textContent = `⏸ ${ev.teamName} Timeout`;
                detailsSpan.appendChild(bText);
            } else {
                let icon = ev.infractionType === CARD_YELLOW ? '🟨' : ev.infractionType === CARD_BLUE ? '🟦' : ev.infractionType === CARD_RED ? '🟥' : '🛑';

                const bText = document.createElement('b');
                bText.textContent = `${icon} ${ev.teamName} ${ev.infractionType}: `;
                detailsSpan.appendChild(bText);

                detailsSpan.appendChild(document.createTextNode(ev.player + ' '));

                const foulTag = document.createElement('span');
                foulTag.style.fontSize = 'clamp(0.7rem, 1.5vh, 1rem)';
                if (ev.isFoul) {
                    foulTag.style.color = 'var(--accent-red)';
                    foulTag.textContent = '(+1 Foul)';
                } else {
                    foulTag.style.color = 'var(--text-muted)';
                    foulTag.textContent = '(No Foul)';
                }
                detailsSpan.appendChild(foulTag);
            }

            contentWrapper.appendChild(detailsSpan);
            div.appendChild(contentWrapper);

            const btnDel = document.createElement('button');
            btnDel.className = 'btn-del';
            btnDel.textContent = '✖';
            btnDel.addEventListener('click', () => deleteEvent(ev.id));
            div.appendChild(btnDel);

            container.appendChild(div);
        });
    }

    function deleteEvent(id) {
        const index = state.events.findIndex(e => e.id === id);
        if (index > -1) {
            const ev = state.events[index];
            if (ev.type === 'Goal') {
                state.matchData[ev.team].score = Math.max(0, state.matchData[ev.team].score - 1);
            } else if (ev.type === 'Infraction') {
                if (ev.isFoul) {
                    state.matchData[ev.team].fouls = Math.max(0, state.matchData[ev.team].fouls - 1);
                }
                if (ev.player !== 'None' && state.matchData[ev.team].playerFouls[ev.player] > 0) {
                    state.matchData[ev.team].playerFouls[ev.player]--;
                }
                // Fix Log Deletion Bug: Remove penalty timer if log event matches a card
                if (ev.infractionType === CARD_BLUE || ev.infractionType === CARD_RED) {
                    state.penalties[ev.team] = state.penalties[ev.team].filter(p => p.id !== id);
                }
            } else if (ev.type === 'timeout') {
                // Restore the timeout for the team
                if (state.timeouts[ev.team] < 2) {
                    state.timeouts[ev.team]++;
                }
            }
            state.events.splice(index, 1);
            saveState();
            refreshUI();
        }
    }

    function downloadJSON() {
        const exportData = {
            dateExported: new Date().toISOString(),
            teams: state.matchData,
            finalScore: `${state.matchData.A.name} ${state.matchData.A.score} - ${state.matchData.B.score} ${state.matchData.B.name}`,
            matchEvents: state.events
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `rink_hockey_match_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(dlAnchorElem);
        dlAnchorElem.click();
        dlAnchorElem.remove();
    }

    function openTimeout() {
        initAudio();
        
        // Check if either team has timeouts available
        if (state.timeouts.A === 0 && state.timeouts.B === 0) {
            showAnnouncement("No Timeouts Available", "Both teams have used all their timeouts!");
            return;
        }
        
        if (isRunning) {
            clearInterval(timerInterval);
            isRunning = false;
            saveState();
            refreshUI();
        }
        
        // Update team names on buttons
        document.getElementById('btnTimeoutTeamA').textContent = state.matchData.A.name;
        document.getElementById('btnTimeoutTeamB').textContent = state.matchData.B.name;
        
        // Update button states based on available timeouts
        const btnTeamA = document.getElementById('btnTimeoutTeamA');
        const btnTeamB = document.getElementById('btnTimeoutTeamB');
        
        if (state.timeouts.A === 0) {
            btnTeamA.disabled = true;
            btnTeamA.style.opacity = '0.4';
            btnTeamA.textContent = state.matchData.A.name + ' (No Timeouts)';
        } else {
            btnTeamA.disabled = false;
            btnTeamA.style.opacity = '1';
            btnTeamA.textContent = state.matchData.A.name + ` (${state.timeouts.A} left)`;
        }
        
        if (state.timeouts.B === 0) {
            btnTeamB.disabled = true;
            btnTeamB.style.opacity = '0.4';
            btnTeamB.textContent = state.matchData.B.name + ' (No Timeouts)';
        } else {
            btnTeamB.disabled = false;
            btnTeamB.style.opacity = '1';
            btnTeamB.textContent = state.matchData.B.name + ` (${state.timeouts.B} left)`;
        }
        
        // Show team selection, hide timer
        document.getElementById('teamSelectionTimeout').style.display = 'flex';
        document.getElementById('timeoutTimer').style.display = 'none';
        document.getElementById('timeoutModal').style.display = 'flex';
    }

    function startTimeoutTimer(team) {
        // Reduce timeout count for the team
        if (state.timeouts[team] > 0) {
            state.timeouts[team]--;
            
            // Log the timeout event
            const now = Date.now();
            const timeStr = updateTimerDisplay();
            state.events.push({
                id: now,
                type: 'timeout',
                team: team,
                teamName: state.matchData[team].name,
                time: timeStr,
                period: periods[state.currentPeriodIndex],
                timestamp: now
            });
            
            saveState();
            refreshUI();
        }
        
        // Show announcement
        showAnnouncement("Timeout", `${state.matchData[team].name} - ${state.timeouts[team]} timeout(s) remaining`);
        
        // Hide team selection, show timer
        document.getElementById('teamSelectionTimeout').style.display = 'none';
        document.getElementById('timeoutTimer').style.display = 'block';
        
        timeoutLeft = state.timeoutDuration;
        document.getElementById('timeoutDisplay').textContent = timeoutLeft;

        if (timeoutInterval) clearInterval(timeoutInterval);
        timeoutInterval = setInterval(() => {
            if (timeoutLeft > 0) {
                timeoutLeft--;
                document.getElementById('timeoutDisplay').textContent = timeoutLeft;
            } else {
                clearInterval(timeoutInterval);
                document.getElementById('timeoutDisplay').textContent = "00";
                playBuzzer();
                if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
            }
        }, 1000);
    }

    function closeTimeout() {
        if (timeoutInterval) clearInterval(timeoutInterval);
        timeoutInterval = null;
        document.getElementById('timeoutModal').style.display = 'none';
    }

    // --- INTERACTION HANDLERS ---
    function addInteraction(elementId, onShortTap, onLongPress) {
        const element = document.getElementById(elementId);
        if (!element) return;
        let pressTimer;
        let isLongPress = false;

        element.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                onLongPress();
                if (navigator.vibrate) navigator.vibrate(50);
            }, CONFIG.LONG_PRESS_DURATION);
        });

        element.addEventListener('pointerup', () => {
            clearTimeout(pressTimer);
            if (!isLongPress) onShortTap();
        });

        element.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    }

    // --- DOM READY BINDING ---
    window.addEventListener('DOMContentLoaded', function () {
        // Lock screen orientation to landscape on mobile devices
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(err => {
                console.log('Orientation lock not supported or failed:', err);
            });
        }
        
        // Setup options
        const selectA = document.getElementById('presetA');
        const selectB = document.getElementById('presetB');
        for (const teamKey in teamDatabase) {
            selectA.add(new Option(teamKey, teamKey));
            selectB.add(new Option(teamKey, teamKey));
        }

        // Event Listeners (Replacing inline onclicks)
        document.getElementById('btnOpenSetup').addEventListener('click', openSetup);
        document.getElementById('periodDisplay').addEventListener('click', cyclePeriod);
        document.getElementById('btnUndo').addEventListener('click', undoLastAction);
        document.getElementById('btnOpenTimeout').addEventListener('click', openTimeout);
        document.getElementById('announcement').addEventListener('click', hideAnnouncement);

        document.getElementById('btnCloseTimeout').addEventListener('click', closeTimeout);
        document.getElementById('btnTimeoutTeamA').addEventListener('click', () => startTimeoutTimer('A'));
        document.getElementById('btnTimeoutTeamB').addEventListener('click', () => startTimeoutTimer('B'));

        document.getElementById('presetA').addEventListener('change', () => loadPreset('A'));
        document.getElementById('presetB').addEventListener('change', () => loadPreset('B'));
        document.getElementById('btnCloseSetup').addEventListener('click', closeSetup);
        document.getElementById('btnApplySetup').addEventListener('click', applySetup);
        document.getElementById('btnDownloadJson').addEventListener('click', downloadJSON);
        document.getElementById('btnHardReset').addEventListener('click', hardReset);

        document.getElementById('skipBtnPlayer').addEventListener('click', () => selectPlayer('None'));
        document.getElementById('skipBtnAssist').addEventListener('click', () => finalizeGoal(goalScorer, 'None'));

        document.getElementById('btnFoulStd').addEventListener('click', () => finalizeInfraction(FOUL_STANDARD, true));
        document.getElementById('btnCardYellow').addEventListener('click', () => finalizeInfraction(CARD_YELLOW, false));
        document.getElementById('btnCardYellowFoul').addEventListener('click', () => finalizeInfraction(CARD_YELLOW, true));
        document.getElementById('btnCardBlue').addEventListener('click', () => finalizeInfraction(CARD_BLUE, false));
        document.getElementById('btnCardBlueFoul').addEventListener('click', () => finalizeInfraction(CARD_BLUE, true));
        document.getElementById('btnCardRed').addEventListener('click', () => finalizeInfraction(CARD_RED, false));
        document.getElementById('btnCardRedFoul').addEventListener('click', () => finalizeInfraction(CARD_RED, true));

        document.getElementById('btnCancelAction').addEventListener('click', cancelAction);

        // Interactions (Long/Short press)
        addInteraction('timerDisplay',
            () => {
                if (isRunning) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                    isRunning = false;
                    saveState();
                    refreshUI();
                } else {
                    startTimer();
                }
            },
            () => {
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
                isRunning = false;
                state.isBreak = false;
                state.timeLeft = state.periodDuration;
                saveState();
                refreshUI();
            }
        );

        addInteraction('scoreA', () => initiateAction('goal', 'A'), () => undoLastAction());
        addInteraction('scoreB', () => initiateAction('goal', 'B'), () => undoLastAction());
        addInteraction('foulSectionA', () => initiateAction('foul', 'A'), () => undoLastAction());
        addInteraction('foulSectionB', () => initiateAction('foul', 'B'), () => undoLastAction());

        loadState();
    });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .catch(err => console.error('Service worker registration failed:', err));
        });
    }

})();
