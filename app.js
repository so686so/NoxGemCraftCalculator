// app.js

// --- Constants & Global Variables ---
const PROBS = [30, 40, 50, 60, 70, 80];
const P_INDEX = { 30: 0, 40: 1, 50: 2, 60: 3, 70: 4, 80: 5 };

// Flat DP arrays to avoid memory allocations and GC pauses
// Dimension size: 11^6 * 6 = 10,629,366
const DP_SIZE = 11 * 11 * 11 * 11 * 11 * 11 * 6;
let targetDpTable = null;
let targetBestActionTable = null;

// Small DP for Priority Mode (11 * 11 * 11 * 6 = 7,986)
let priorityBestAction = null;

// Sound Synthesizer Class
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playClick() {
    if (this.muted) return;
    this.init();
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch (e) { console.error(e); }
  }

  playSuccess() {
    if (this.muted) return;
    this.init();
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15); // C6

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(659.25, now); // E5
      osc2.frequency.exponentialRampToValueAtTime(1318.51, now + 0.15); // E6

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc1.start();
      osc2.start();
      osc1.stop(now + 0.22);
      osc2.stop(now + 0.22);
    } catch (e) { console.error(e); }
  }

  playFailure() {
    if (this.muted) return;
    this.init();
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(70, now + 0.22);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, now);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.start();
      osc.stop(now + 0.22);
    } catch (e) { console.error(e); }
  }

  playComplete() {
    if (this.muted) return;
    this.init();
    try {
      const now = this.ctx.currentTime;
      const chord = [523.25, 659.25, 783.99, 1046.50]; // C Major Chord
      chord.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.04, now + idx * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);

        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.4);
      });
    } catch (e) { console.error(e); }
  }
}

const audio = new AudioEngine();

// --- State Management ---
const state = {
  // Slots: 3 rows, 10 slots per row.
  // Values: null (empty), true (success), false (failure)
  slots: [
    Array(10).fill(null),
    Array(10).fill(null),
    Array(10).fill(null)
  ],
  // Number of carved slots per row
  progress: [0, 0, 0],
  // Cumulative successes per row (useful for fast indexing)
  successCount: [0, 0, 0],
  // Global probability
  currentProb: 70,
  // Mode: 'priority' or 'target'
  mode: 'priority',
  // Priority option: 'opt1' or 'opt2'
  priorityOpt: 'opt1',
  // Target values for Target Mode
  target: { opt1: 7, opt2: 7, opt3: 4 },
  // Run mode: 'calc' (calculator) or 'sim' (simulator)
  runMode: 'calc',
  // Carving history for undo
  history: [],
  // Auto carving interval
  autoInterval: null
};

// Helper: Get indices for flat DP table
function getDpIndex(r1, r2, r3, s1, s2, s3, pVal) {
  const pIdx = P_INDEX[pVal];
  return (((((r1 * 11 + r2) * 11 + r3) * 11 + s1) * 11 + s2) * 11 + s3) * 6 + pIdx;
}

// --- Dynamic Programming Solvers ---

// 1. Solve Priority Mode DP (maximize expected score)
function solvePriorityDP() {
  const w1 = state.priorityOpt === 'opt1' ? 1.05 : 1.0;
  const w2 = state.priorityOpt === 'opt2' ? 1.05 : 1.0;
  const w3 = 1.0;

  // dp[r1][r2][r3][pIdx]
  const dp = Array.from({ length: 11 }, () =>
    Array.from({ length: 11 }, () =>
      Array.from({ length: 11 }, () => new Float64Array(6))
    )
  );

  priorityBestAction = Array.from({ length: 11 }, () =>
    Array.from({ length: 11 }, () =>
      Array.from({ length: 11 }, () => new Uint8Array(6))
    )
  );

  // Bottom-up DP by remaining slots count R
  for (let R = 1; R <= 30; R++) {
    for (let r1 = 0; r1 <= 10; r1++) {
      for (let r2 = 0; r2 <= 10; r2++) {
        const r3 = R - r1 - r2;
        if (r3 < 0 || r3 > 10) continue;

        for (let pIdx = 0; pIdx < 6; pIdx++) {
          const pVal = PROBS[pIdx] / 100;
          let bestVal = -Infinity;
          let bestAct = -1;

          // Opt 1
          if (r1 > 0) {
            const nextP_succ = P_INDEX[Math.max(30, PROBS[pIdx] - 10)];
            const nextP_fail = P_INDEX[Math.min(80, PROBS[pIdx] + 10)];
            const val = pVal * (w1 + dp[r1 - 1][r2][r3][nextP_succ]) +
                        (1 - pVal) * dp[r1 - 1][r2][r3][nextP_fail];
            if (val > bestVal) {
              bestVal = val;
              bestAct = 0;
            }
          }

          // Opt 2
          if (r2 > 0) {
            const nextP_succ = P_INDEX[Math.max(30, PROBS[pIdx] - 10)];
            const nextP_fail = P_INDEX[Math.min(80, PROBS[pIdx] + 10)];
            const val = pVal * (w2 + dp[r1][r2 - 1][r3][nextP_succ]) +
                        (1 - pVal) * dp[r1][r2 - 1][r3][nextP_fail];
            if (val > bestVal) {
              bestVal = val;
              bestAct = 1;
            }
          }

          // Opt 3
          if (r3 > 0) {
            const nextP_succ = P_INDEX[Math.max(30, PROBS[pIdx] - 10)];
            const nextP_fail = P_INDEX[Math.min(80, PROBS[pIdx] + 10)];
            const val = pVal * (-w3 + dp[r1][r2][r3 - 1][nextP_succ]) +
                        (1 - pVal) * dp[r1][r2][r3 - 1][nextP_fail];
            if (val > bestVal) {
              bestVal = val;
              bestAct = 2;
            }
          }

          dp[r1][r2][r3][pIdx] = bestVal;
          priorityBestAction[r1][r2][r3][pIdx] = bestAct;
        }
      }
    }
  }
}

// 2. Solve Target Mode DP (maximize probability of hitting target)
function solveTargetDP() {
  const t1 = state.target.opt1;
  const t2 = state.target.opt2;
  const t3 = state.target.opt3;

  // Lazily allocate DP tables
  if (!targetDpTable) {
    targetDpTable = new Float32Array(DP_SIZE);
    targetBestActionTable = new Uint8Array(DP_SIZE);
  } else {
    // Reset/Clear tables
    targetDpTable.fill(0);
    targetBestActionTable.fill(0);
  }

  // Set terminal values (R = 0, i.e., r1 = r2 = r3 = 0)
  for (let s1 = 0; s1 <= 10; s1++) {
    for (let s2 = 0; s2 <= 10; s2++) {
      for (let s3 = 0; s3 <= 10; s3++) {
        const isSuccess = (s1 >= t1 && s2 >= t2 && s3 <= t3) ? 1.0 : 0.0;
        for (let pIdx = 0; pIdx < 6; pIdx++) {
          const idx = (((((0 * 11 + 0) * 11 + 0) * 11 + s1) * 11 + s2) * 11 + s3) * 6 + pIdx;
          targetDpTable[idx] = isSuccess;
        }
      }
    }
  }

  // Bottom-up DP by remaining slots count R
  for (let R = 1; R <= 30; R++) {
    for (let r1 = 0; r1 <= 10; r1++) {
      for (let r2 = 0; r2 <= 10; r2++) {
        const r3 = R - r1 - r2;
        if (r3 < 0 || r3 > 10) continue;

        // Iterate over valid success counts
        for (let s1 = 0; s1 <= 10 - r1; s1++) {
          for (let s2 = 0; s2 <= 10 - r2; s2++) {
            for (let s3 = 0; s3 <= 10 - r3; s3++) {
              for (let pIdx = 0; pIdx < 6; pIdx++) {
                const pVal = PROBS[pIdx] / 100;
                let bestProb = -1.0;
                let bestAct = -1;

                const pIdx_succ = P_INDEX[Math.max(30, PROBS[pIdx] - 10)];
                const pIdx_fail = P_INDEX[Math.min(80, PROBS[pIdx] + 10)];

                // Option 1
                if (r1 > 0) {
                  const idx_succ = ((((( (r1-1)*11 + r2)*11 + r3)*11 + (s1+1))*11 + s2)*11 + s3)*6 + pIdx_succ;
                  const idx_fail = ((((( (r1-1)*11 + r2)*11 + r3)*11 + s1)*11 + s2)*11 + s3)*6 + pIdx_fail;
                  const val = pVal * targetDpTable[idx_succ] + (1 - pVal) * targetDpTable[idx_fail];
                  if (val > bestProb) {
                    bestProb = val;
                    bestAct = 0;
                  }
                }

                // Option 2
                if (r2 > 0) {
                  const idx_succ = ((((( r1*11 + (r2-1))*11 + r3)*11 + s1)*11 + (s2+1))*11 + s3)*6 + pIdx_succ;
                  const idx_fail = ((((( r1*11 + (r2-1))*11 + r3)*11 + s1)*11 + s2)*11 + s3)*6 + pIdx_fail;
                  const val = pVal * targetDpTable[idx_succ] + (1 - pVal) * targetDpTable[idx_fail];
                  if (val > bestProb) {
                    bestProb = val;
                    bestAct = 1;
                  }
                }

                // Option 3
                if (r3 > 0) {
                  const idx_succ = ((((( r1*11 + r2)*11 + (r3-1))*11 + s1)*11 + s2)*11 + (s3+1))*6 + pIdx_succ;
                  const idx_fail = ((((( r1*11 + r2)*11 + (r3-1))*11 + s1)*11 + s2)*11 + s3)*6 + pIdx_fail;
                  const val = pVal * targetDpTable[idx_succ] + (1 - pVal) * targetDpTable[idx_fail];
                  if (val > bestProb) {
                    bestProb = val;
                    bestAct = 2;
                  }
                }

                const currentIdx = ((((( r1*11 + r2)*11 + r3)*11 + s1)*11 + s2)*11 + s3)*6 + pIdx;
                targetDpTable[currentIdx] = bestProb;
                targetBestActionTable[currentIdx] = bestAct;
              }
            }
          }
        }
      }
    }
  }
}

// --- Action Recommendations Logic ---
function getRecommendation() {
  const r1 = 10 - state.progress[0];
  const r2 = 10 - state.progress[1];
  const r3 = 10 - state.progress[2];

  if (r1 === 0 && r2 === 0 && r3 === 0) return -1; // Finished

  const s1 = state.successCount[0];
  const s2 = state.successCount[1];
  const s3 = state.successCount[2];

  if (state.mode === 'target') {
    // Check if target is still achievable. If target success probability is 0,
    // we fall back to priority mode recommendations so the user gets sensible actions.
    const currentIdx = getDpIndex(r1, r2, r3, s1, s2, s3, state.currentProb);
    const targetProb = targetDpTable[currentIdx];
    
    if (targetProb > 0) {
      return targetBestActionTable[currentIdx];
    }
  }

  // Fallback to Priority Mode recommendation
  const pIdx = P_INDEX[state.currentProb];
  return priorityBestAction[r1][r2][r3][pIdx];
}

// --- Core Actions ---

// Carve a row with a given result (success: true, failure: false)
function carve(rowIdx, isSuccess) {
  if (state.progress[rowIdx] >= 10) return;

  const prevProb = state.currentProb;
  const slotIdx = state.progress[rowIdx];

  // Update slots state
  state.slots[rowIdx][slotIdx] = isSuccess;
  state.progress[rowIdx]++;
  if (isSuccess) {
    state.successCount[rowIdx]++;
  }

  // Update global probability
  if (isSuccess) {
    state.currentProb = Math.max(30, state.currentProb - 10);
  } else {
    state.currentProb = Math.min(80, state.currentProb + 10);
  }

  // Push to history for undo
  state.history.push({ rowIdx, slotIdx, isSuccess, prevProb });

  // Sound effects
  if (isSuccess) {
    audio.playSuccess();
  } else {
    audio.playFailure();
  }

  // Check if fully completed
  const totalRemaining = 30 - (state.progress[0] + state.progress[1] + state.progress[2]);
  if (totalRemaining === 0) {
    audio.playComplete();
  }

  updateUI();
}

// Simulate carving (roll randomly based on current prob)
function simulateCarve(rowIdx) {
  if (state.progress[rowIdx] >= 10) return;
  const roll = Math.random() * 100;
  const isSuccess = roll < state.currentProb;
  carve(rowIdx, isSuccess);
}

// Undo last carve action
function undo() {
  if (state.history.length === 0) return;
  audio.playClick();
  const lastAction = state.history.pop();
  
  const { rowIdx, slotIdx, isSuccess, prevProb } = lastAction;
  
  // Revert slots state
  state.slots[rowIdx][slotIdx] = null;
  state.progress[rowIdx]--;
  if (isSuccess) {
    state.successCount[rowIdx]--;
  }

  // Revert probability
  state.currentProb = prevProb;

  // Stop auto play if running
  stopAutoPlay();

  updateUI();
}

// Reset all carving states
function reset() {
  audio.playClick();
  state.slots = [
    Array(10).fill(null),
    Array(10).fill(null),
    Array(10).fill(null)
  ];
  state.progress = [0, 0, 0];
  state.successCount = [0, 0, 0];
  state.currentProb = 70;
  state.history = [];
  stopAutoPlay();
  updateUI();
}

// Auto play algorithm execution
function startAutoPlay() {
  if (state.autoInterval) return;
  
  const totalRemaining = 30 - (state.progress[0] + state.progress[1] + state.progress[2]);
  if (totalRemaining === 0) return;

  audio.playClick();
  document.getElementById('auto-btn').innerHTML = '<i class="fa-solid fa-pause"></i> 일시 정지';
  document.getElementById('auto-btn').className = 'global-btn btn-secondary';

  state.autoInterval = setInterval(() => {
    const recommendedRow = getRecommendation();
    if (recommendedRow !== -1) {
      // In simulator mode, simulate roll. In calculator mode, we also simulate for auto-play!
      simulateCarve(recommendedRow);
    } else {
      stopAutoPlay();
    }
  }, 350); // Fast but visible animation speed
}

function stopAutoPlay() {
  if (!state.autoInterval) return;
  clearInterval(state.autoInterval);
  state.autoInterval = null;
  document.getElementById('auto-btn').innerHTML = '<i class="fa-solid fa-play"></i> 자동 세공';
  document.getElementById('auto-btn').className = 'global-btn btn-primary';
}

function toggleAutoPlay() {
  if (state.autoInterval) {
    stopAutoPlay();
  } else {
    startAutoPlay();
  }
}

// --- UI Rendering ---

// Render the 10 slots of a row
function renderRowSlots(rowIdx, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  let successCumulative = 0;
  
  for (let colIdx = 0; colIdx < 10; colIdx++) {
    const slotState = state.slots[rowIdx][colIdx];
    const isNext = colIdx === state.progress[rowIdx];
    
    const slotDiv = document.createElement('div');
    slotDiv.className = 'slot';
    if (isNext) slotDiv.classList.add('active-next');
    
    const innerSpan = document.createElement('span');
    innerSpan.className = 'slot-inner';
    
    if (slotState === true) {
      slotDiv.classList.add('success');
      successCumulative++;
      innerSpan.textContent = successCumulative;
    } else if (slotState === false) {
      slotDiv.classList.add('fail');
      innerSpan.textContent = '•';
    } else {
      innerSpan.textContent = '';
    }
    
    slotDiv.appendChild(innerSpan);
    container.appendChild(slotDiv);
  }
}

// Core UI update function
function updateUI() {
  // Render slots for each option
  renderRowSlots(0, 'slots-opt1');
  renderRowSlots(1, 'slots-opt2');
  renderRowSlots(2, 'slots-opt3');

  // Update success counts
  document.getElementById('success-count-opt1').textContent = `${state.successCount[0]} 성공`;
  document.getElementById('success-count-opt2').textContent = `${state.successCount[1]} 성공`;
  document.getElementById('success-count-opt3').textContent = `${state.successCount[2]} 성공`;

  // Update remaining counts
  const totalCarved = state.progress[0] + state.progress[1] + state.progress[2];
  document.getElementById('remaining-count').textContent = `${30 - totalCarved} / 30`;

  // Update probability dial & text
  document.getElementById('current-prob-text').textContent = `${state.currentProb}%`;
  
  const probMeterFill = document.getElementById('prob-meter-fill');
  const dashOffset = 283 * (1 - state.currentProb / 100);
  probMeterFill.style.strokeDashoffset = dashOffset;
  
  // Set dial color based on probability
  if (state.currentProb >= 70) {
    probMeterFill.style.stroke = '#00f2fe';
    probMeterFill.style.filter = 'drop-shadow(0 0 6px rgba(0, 242, 254, 0.6))';
  } else if (state.currentProb >= 50) {
    probMeterFill.style.stroke = '#8b5cf6';
    probMeterFill.style.filter = 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.6))';
  } else {
    probMeterFill.style.stroke = '#ff416c';
    probMeterFill.style.filter = 'drop-shadow(0 0 6px rgba(255, 65, 108, 0.6))';
  }

  // Update Target Success Rate
  const targetRateValue = document.getElementById('target-success-rate');
  const r1 = 10 - state.progress[0];
  const r2 = 10 - state.progress[1];
  const r3 = 10 - state.progress[2];
  
  const currentIdx = getDpIndex(r1, r2, r3, state.successCount[0], state.successCount[1], state.successCount[2], state.currentProb);
  const targetProb = targetDpTable ? targetDpTable[currentIdx] : 0;
  
  if (state.mode === 'target') {
    if (targetProb > 0) {
      targetRateValue.textContent = `${(targetProb * 100).toFixed(2)}%`;
      targetRateValue.className = 'status-value'; // default green glowing
    } else {
      targetRateValue.textContent = '달성 불가';
      targetRateValue.className = 'status-value text-red';
    }
  } else {
    // Show priority Mode expected value or just target prob as helper
    if (targetProb > 0) {
      targetRateValue.textContent = `${(targetProb * 100).toFixed(2)}%`;
      targetRateValue.className = 'status-value text-muted';
    } else {
      targetRateValue.textContent = '달성 불가';
      targetRateValue.className = 'status-value text-red';
    }
  }

  // Update Recommendations & Highlights
  const recommendedRow = getRecommendation();
  
  // Clear previous recommendations
  document.querySelectorAll('.stone-row').forEach(row => {
    row.classList.remove('recommended');
  });

  if (recommendedRow !== -1) {
    const rowId = `row-opt${recommendedRow + 1}`;
    document.getElementById(rowId).classList.add('recommended');
  }

  // Disable/Enable Action Buttons depending on Row completion & Run Mode
  for (let row = 0; row < 3; row++) {
    const isCompleted = state.progress[row] >= 10;
    const rowContainer = document.getElementById(`row-opt${row + 1}`);
    
    const successBtn = rowContainer.querySelector('.success-btn');
    const failBtn = rowContainer.querySelector('.fail-btn');
    const simBtn = rowContainer.querySelector('.sim-carve-btn');

    if (state.runMode === 'calc') {
      successBtn.classList.remove('hidden');
      failBtn.classList.remove('hidden');
      simBtn.classList.add('hidden');
      
      successBtn.disabled = isCompleted || (state.autoInterval !== null);
      failBtn.disabled = isCompleted || (state.autoInterval !== null);
    } else {
      successBtn.classList.add('hidden');
      failBtn.classList.add('hidden');
      simBtn.classList.remove('hidden');
      
      simBtn.disabled = isCompleted || (state.autoInterval !== null);
    }
  }

  // Undo button state
  document.getElementById('undo-btn').disabled = state.history.length === 0;
  
  // Auto button state
  const isFinished = totalCarved >= 30;
  document.getElementById('auto-btn').disabled = isFinished;
}

// --- Event Handlers & Initializers ---

function initEventHandlers() {
  // Tabs
  document.getElementById('mode-tab-priority').addEventListener('click', (e) => {
    audio.playClick();
    document.getElementById('mode-tab-priority').classList.add('active');
    document.getElementById('mode-tab-target').classList.remove('active');
    document.getElementById('priority-settings').classList.remove('hidden');
    document.getElementById('target-settings').classList.add('hidden');
    state.mode = 'priority';
    updateUI();
  });

  document.getElementById('mode-tab-target').addEventListener('click', (e) => {
    audio.playClick();
    document.getElementById('mode-tab-priority').classList.remove('active');
    document.getElementById('mode-tab-target').classList.add('active');
    document.getElementById('priority-settings').classList.add('hidden');
    document.getElementById('target-settings').classList.remove('hidden');
    state.mode = 'target';
    updateUI();
  });

  // Priority Radios
  document.querySelectorAll('input[name="priority-opt"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      audio.playClick();
      state.priorityOpt = e.target.value;
      solvePriorityDP();
      updateUI();
    });
  });

  // Target Inputs
  const handleTargetChange = () => {
    const opt1Val = Math.min(10, Math.max(0, parseInt(document.getElementById('target-opt1').value) || 0));
    const opt2Val = Math.min(10, Math.max(0, parseInt(document.getElementById('target-opt2').value) || 0));
    const opt3Val = Math.min(10, Math.max(0, parseInt(document.getElementById('target-opt3').value) || 0));
    
    document.getElementById('target-opt1').value = opt1Val;
    document.getElementById('target-opt2').value = opt2Val;
    document.getElementById('target-opt3').value = opt3Val;

    state.target = { opt1: opt1Val, opt2: opt2Val, opt3: opt3Val };

    // Sync presets buttons active state
    document.querySelectorAll('.preset-btn').forEach(btn => {
      const t1 = parseInt(btn.dataset.t1);
      const t2 = parseInt(btn.dataset.t2);
      const t3 = parseInt(btn.dataset.t3);
      if (t1 === opt1Val && t2 === opt2Val && t3 === opt3Val) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    solveTargetDP();
    updateUI();
  };

  document.getElementById('target-opt1').addEventListener('input', handleTargetChange);
  document.getElementById('target-opt2').addEventListener('input', handleTargetChange);
  document.getElementById('target-opt3').addEventListener('input', handleTargetChange);

  // Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      audio.playClick();
      const t1 = parseInt(e.target.dataset.t1);
      const t2 = parseInt(e.target.dataset.t2);
      const t3 = parseInt(e.target.dataset.t3);

      document.getElementById('target-opt1').value = t1;
      document.getElementById('target-opt2').value = t2;
      document.getElementById('target-opt3').value = t3;

      state.target = { opt1: t1, opt2: t2, opt3: t3 };
      
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      solveTargetDP();
      updateUI();
    });
  });

  // Run Mode Toggles
  document.getElementById('run-mode-calc').addEventListener('click', (e) => {
    audio.playClick();
    document.getElementById('run-mode-calc').classList.add('active');
    document.getElementById('run-mode-sim').classList.remove('active');
    document.getElementById('run-mode-desc').textContent = '인게임 세공 결과를 직접 입력(성공/실패 클릭)하며 최적의 추천을 받습니다.';
    state.runMode = 'calc';
    stopAutoPlay();
    updateUI();
  });

  document.getElementById('run-mode-sim').addEventListener('click', (e) => {
    audio.playClick();
    document.getElementById('run-mode-calc').classList.remove('active');
    document.getElementById('run-mode-sim').classList.add('active');
    document.getElementById('run-mode-desc').textContent = '인게임과 동일한 성공 확률로 무작위 세공을 테스트하고 연습합니다.';
    state.runMode = 'sim';
    stopAutoPlay();
    updateUI();
  });

  // Success / Failure Buttons (Manual Carve)
  document.querySelectorAll('.action-buttons .success-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIdx = parseInt(e.target.closest('.action-btn').dataset.row);
      carve(rowIdx, true);
    });
  });

  document.querySelectorAll('.action-buttons .fail-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIdx = parseInt(e.target.closest('.action-btn').dataset.row);
      carve(rowIdx, false);
    });
  });

  // Sim Carve Buttons (Simulation Carve)
  document.querySelectorAll('.action-buttons .sim-carve-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIdx = parseInt(e.target.closest('.action-btn').dataset.row);
      simulateCarve(rowIdx);
    });
  });

  // Global actions
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('reset-btn').addEventListener('click', reset);
  document.getElementById('auto-btn').addEventListener('click', toggleAutoPlay);

  // Keyboard Shortcuts (Undo - Ctrl+Z, Row 1, 2, 3 - 1, 2, 3 keys in sim mode)
  window.addEventListener('keydown', (e) => {
    // Ctrl + Z to undo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (state.history.length > 0) undo();
    }
    
    // In Simulation mode, support keys '1', '2', '3' to carve options
    if (state.runMode === 'sim' && !state.autoInterval) {
      if (e.key === '1') {
        e.preventDefault();
        simulateCarve(0);
      } else if (e.key === '2') {
        e.preventDefault();
        simulateCarve(1);
      } else if (e.key === '3') {
        e.preventDefault();
        simulateCarve(2);
      }
    }
  });

  // Sound Toggle
  const soundBtn = document.getElementById('sound-toggle-btn');
  soundBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    if (audio.muted) {
      soundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
      soundBtn.title = "음소거 해제";
    } else {
      soundBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      soundBtn.title = "음소거";
      audio.playClick();
    }
  });

  // Help Modal Toggle
  const helpModal = document.getElementById('help-modal');
  document.getElementById('help-btn').addEventListener('click', () => {
    audio.playClick();
    helpModal.classList.remove('hidden');
  });

  document.getElementById('close-modal-btn').addEventListener('click', () => {
    audio.playClick();
    helpModal.classList.add('hidden');
  });

  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      audio.playClick();
      helpModal.classList.add('hidden');
    }
  });
}

// --- Initialization ---

function init() {
  // Pre-solve DP models
  solvePriorityDP();
  solveTargetDP();
  
  // Set preset-btn for 7/7/4 active on startup
  document.querySelector('.preset-btn[data-t1="7"][data-t2="7"][data-t3="4"]').classList.add('active');

  initEventHandlers();
  updateUI();
}

window.addEventListener('DOMContentLoaded', init);
