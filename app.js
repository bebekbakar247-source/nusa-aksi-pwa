/* ==========================================================================
   NUSA-AKSI — OFFLINE-FIRST CIVIC-TECH PROTOTYPE
   --------------------------------------------------------------------------
   Architecture:
     01. Configuration & application state
     02. IndexedDB persistence with graceful fallback
     03. Local identity / cryptographic demonstration
     04. Single-page navigation and responsive shell
     05. 5W1H reporting wizard
     06. Image validation and client-side compression
     07. Cognitive-friction intervention (Nudge Theory)
     08. Offline outbox and simulated background synchronization
     09. Civic credit and contribution history
     10. Local demonstration feed
     11. Rendering, notifications and accessibility
     12. Application initialization

   IMPORTANT SECURITY BOUNDARIES:
     - This file does not make network requests.
     - IndexedDB is local persistence, not encrypted storage.
     - The identity flow is NOT a production zk-SNARK implementation.
     - The sync flow is NOT a real server upload or Service Worker sync.
     - Never store NIK or sensitive identifying information in report records.
   ========================================================================== */

(() => {
  "use strict";

  /* ========================================================================
     01. CONFIGURATION & APPLICATION STATE
     ======================================================================== */

  const CONFIG = Object.freeze({
    appName: "NUSA-AKSI",
    databaseName: "nusaAksiPrototypeDB",
    databaseVersion: 1,
    objectStoreName: "appState",
    stateRecordKey: "primary-state",
    localStorageKey: "nusaAksiPrototypeFallbackV1",

    maxNIKLength: 16,
    minNarrativeLength: 80,
    maxNarrativeLength: 4000,
    maxTitleLength: 120,

    maxOriginalImageBytes: 12 * 1024 * 1024,
    maxImageDimension: 1280,
    imageQuality: 0.78,

    reflectiveDelayMs: 10_000,
    toastDurationMs: 4600,
    syncDelayMs: 520,
    terminalLineDelayMs: 260,

    pointsPerSimulatedReport: 25,

    /*
     * This is a client-side simulation. The application intentionally has no
     * API endpoint, no upload destination and no remote identity verifier.
     */
    hasRemoteBackend: false,
  });

  const CATEGORY_ICONS = Object.freeze({
    "Air dan Sanitasi": "fa-droplet",
    Pendidikan: "fa-graduation-cap",
    Kesehatan: "fa-heart-pulse",
    Infrastruktur: "fa-road",
    Lingkungan: "fa-leaf",
    "Layanan Publik": "fa-landmark",
    Ketenagakerjaan: "fa-briefcase",
    "Akses Digital": "fa-tower-broadcast",
    Lainnya: "fa-circle-nodes",
  });

  const TOXIC_WORD_PATTERN =
    /\b(?:bodoh|bangsat|anjing|tolol|goblok|hancur)\b/gi;

  const ALLOWED_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  const RANKS = Object.freeze([
    {
      name: "Saksi Warga",
      threshold: 0,
      description: "Awal dari partisipasi yang bermakna.",
      icon: "fa-eye",
    },
    {
      name: "Penggerak Bale",
      threshold: 100,
      description: "Aktif menyusun laporan yang konstruktif.",
      icon: "fa-seedling",
    },
    {
      name: "Pahlawan Akar Rumput",
      threshold: 300,
      description: "Menumbuhkan budaya partisipasi bersama.",
      icon: "fa-people-group",
    },
    {
      name: "Penjaga Kepentingan Publik",
      threshold: 700,
      description: "Membangun kebiasaan advokasi berbasis bukti.",
      icon: "fa-landmark",
    },
  ]);

  const DEMO_FEED = [
    {
      id: "demo-water-access",
      title: "Contoh isu: akses air bersih musiman",
      category: "Air dan Sanitasi",
      location: "Wilayah ilustratif — NTT",
      summary:
        "Warga membutuhkan pencatatan jadwal distribusi air dan usulan koordinasi pemeliharaan sarana air bersih.",
      createdAt: "2026-10-01T08:00:00.000Z",
      isDemo: true,
    },
    {
      id: "demo-education-materials",
      title: "Contoh isu: kebutuhan bahan belajar",
      category: "Pendidikan",
      location: "Wilayah ilustratif — NTT",
      summary:
        "Contoh usulan inventarisasi bahan belajar dan koordinasi berbagi sumber belajar di sekolah.",
      createdAt: "2026-10-03T08:00:00.000Z",
      isDemo: true,
    },
    {
      id: "demo-road-light",
      title: "Contoh isu: penerangan jalur warga",
      category: "Infrastruktur",
      location: "Wilayah ilustratif — NTT",
      summary:
        "Contoh laporan mengenai pencatatan titik jalur gelap, waktu penggunaan jalur, dan pilihan perbaikan penerangan.",
      createdAt: "2026-10-05T08:00:00.000Z",
      isDemo: true,
    },
    {
      id: "demo-digital-access",
      title: "Contoh isu: keterbatasan konektivitas",
      category: "Akses Digital",
      location: "Wilayah ilustratif — NTT",
      summary:
        "Contoh gagasan titik akses bersama dan pendataan waktu ketika warga paling membutuhkan koneksi.",
      createdAt: "2026-10-07T08:00:00.000Z",
      isDemo: true,
    },
    {
      id: "demo-environment",
      title: "Contoh isu: pengelolaan sampah lingkungan",
      category: "Lingkungan",
      location: "Wilayah ilustratif — NTT",
      summary:
        "Contoh usulan pemetaan lokasi penumpukan sampah, jadwal pengangkutan, dan pembagian tanggung jawab.",
      createdAt: "2026-10-09T08:00:00.000Z",
      isDemo: true,
    },
  ];

  const state = {
    // Proof remains in memory and is never written to the persistence layer.
    proof: null,
    authenticated: false,
    proofGenerating: false,

    // Storage state.
    db: null,
    storageMode: "initializing",
    storageWarningShown: false,
    persistPromise: Promise.resolve(),

    // Reporting and civic-credit data.
    outbox: [],
    sent: [],
    creditPoints: 0,
    creditHistory: [],

    // Image state.
    photoBlob: null,
    photoFileName: "",
    originalPhotoSize: 0,
    compressedPhotoSize: 0,
    previewObjectUrl: null,
    listObjectUrls: new WeakMap(),

    // Navigation and wizard state.
    currentView: "dashboard",
    wizardStep: 1,
    submitting: false,

    // Location is an intentionally artificial map coordinate.
    coordinates: null,

    // Nudge Theory / reflective delay state.
    isEmotional: false,
    nudgeTriggered: false,
    cooldownEndsAt: 0,
    nudgeModalShown: false,
    nudgeInterval: null,
    returnFocusElement: null,

    // Simulated connectivity.
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    networkMode: "browser",
    syncing: false,

    // Toast cleanup handles.
    toastTimers: new Set(),
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const wait = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  function makeId(prefix = "na") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }

    const randomPart = Math.random().toString(36).slice(2, 11);
    return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
  }

  function localDateISO() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;

    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function formatDate(value, options = {}) {
    if (!value) {
      return "Belum tersedia";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Tanggal tidak tersedia";
    }

    const formatOptions = {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...options,
    };

    return new Intl.DateTimeFormat("id-ID", formatOptions).format(date);
  }

  function formatDateTime(value) {
    if (!value) {
      return "Belum tersedia";
    }

    return formatDate(value, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "Ukuran tidak tersedia";
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function setText(selector, value) {
    const element = $(selector);

    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
      element.className = className;
    }

    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }

    return element;
  }

  function createIcon(iconName) {
    const icon = document.createElement("i");
    icon.className = `fa-solid ${iconName}`;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function setVisible(element, visible) {
    if (!element) {
      return;
    }

    element.hidden = !visible;
  }

  function categoryIcon(category) {
    const iconName = CATEGORY_ICONS[category] || "fa-circle-nodes";
    return iconName;
  }

  /* ========================================================================
     02. NOTIFICATIONS
     ======================================================================== */

  function showToast({
    title = "NUSA-AKSI",
    message = "",
    type = "info",
    duration = CONFIG.toastDurationMs,
  } = {}) {
    const region = $("#toast-region");

    if (!region) {
      return;
    }

    const iconMap = {
      info: "fa-circle-info",
      success: "fa-circle-check",
      warning: "fa-triangle-exclamation",
      error: "fa-circle-xmark",
    };

    const toast = createElement("article", `toast toast-${type}`);
    const iconWrap = createElement("span", "toast-icon");
    const copy = createElement("div", "toast-copy");
    const heading = createElement("strong", "", title);
    const body = createElement("p", "", message);
    const closeButton = createElement("button", "toast-close");

    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Tutup notifikasi");
    closeButton.appendChild(createIcon("fa-xmark"));

    iconWrap.appendChild(createIcon(iconMap[type] || iconMap.info));
    copy.append(heading, body);
    toast.append(iconWrap, copy, closeButton);

    region.appendChild(toast);

    let timer = null;

    const removeToast = () => {
      if (!toast.isConnected) {
        return;
      }

      if (timer !== null) {
        window.clearTimeout(timer);
        state.toastTimers.delete(timer);
      }

      toast.classList.add("is-leaving");

      window.setTimeout(() => {
        toast.remove();
      }, 230);
    };

    closeButton.addEventListener("click", removeToast);

    timer = window.setTimeout(removeToast, duration);
    state.toastTimers.add(timer);
  }

  function clearAllToasts() {
    state.toastTimers.forEach((timer) => window.clearTimeout(timer));
    state.toastTimers.clear();

    const region = $("#toast-region");

    if (region) {
      region.replaceChildren();
    }
  }

  /* ========================================================================
     03. INDEXEDDB PERSISTENCE & FALLBACK
     ======================================================================== */

  /*
   * Architectural note:
   *
   * IndexedDB permits asynchronous persistence of structured data, including
   * Blob objects. This is appropriate for a local-first prototype because a
   * report can be saved without an HTTP connection.
   *
   * It does NOT provide confidentiality at rest. LocalStorage is only a
   * degraded fallback, and this prototype intentionally does not encrypt
   * reports or persist the identity proof.
   */

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not available."));
        return;
      }

      let request;

      try {
        request = window.indexedDB.open(
          CONFIG.databaseName,
          CONFIG.databaseVersion
        );
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(CONFIG.objectStoreName)) {
          database.createObjectStore(CONFIG.objectStoreName, {
            keyPath: "id",
          });
        }
      };

      request.onsuccess = () => {
        const database = request.result;

        database.onversionchange = () => {
          database.close();

          if (state.db === database) {
            state.db = null;
          }
        };

        resolve(database);
      };

      request.onerror = () => {
        reject(request.error || new Error("Unable to open IndexedDB."));
      };

      request.onblocked = () => {
        reject(new Error("Database upgrade is blocked by another tab."));
      };
    });
  }

  function readDatabaseRecord(database) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(
        CONFIG.objectStoreName,
        "readonly"
      );

      const store = transaction.objectStore(CONFIG.objectStoreName);
      const request = store.get(CONFIG.stateRecordKey);

      request.onsuccess = () => {
        resolve(request.result ? request.result.payload : null);
      };

      request.onerror = () => {
        reject(request.error || new Error("Unable to read local state."));
      };

      transaction.onerror = () => {
        reject(transaction.error || new Error("Database read failed."));
      };
    });
  }

  function writeDatabaseRecord(database, payload) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(
        CONFIG.objectStoreName,
        "readwrite"
      );

      const store = transaction.objectStore(CONFIG.objectStoreName);

      store.put({
        id: CONFIG.stateRecordKey,
        payload,
        updatedAt: new Date().toISOString(),
      });

      transaction.oncomplete = () => resolve();

      transaction.onerror = () => {
        reject(transaction.error || new Error("Unable to save local state."));
      };

      transaction.onabort = () => {
        reject(transaction.error || new Error("Database write was aborted."));
      };
    });
  }

  function cloneForFallback(report) {
    /*
     * Blob data is omitted from LocalStorage because base64-encoding large
     * photos can exhaust browser quotas. IndexedDB is preferred.
     */
    return {
      ...report,
      imageBlob: null,
      imageUnavailableAfterFallback: Boolean(report.imageBlob),
    };
  }

  function makePersistedPayload() {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),

      // The NIK, identity proof and temporary salt are deliberately absent.
      outbox: state.outbox.map(cloneForFallback),
      sent: state.sent.map(cloneForFallback),
      creditPoints: state.creditPoints,
      creditHistory: state.creditHistory,
    };
  }

  function makeIndexedDBPayload() {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      outbox: state.outbox,
      sent: state.sent,
      creditPoints: state.creditPoints,
      creditHistory: state.creditHistory,
    };
  }

  function normalizeLoadedState(savedState) {
    if (!savedState || typeof savedState !== "object") {
      return;
    }

    state.outbox = Array.isArray(savedState.outbox)
      ? savedState.outbox
      : [];

    state.sent = Array.isArray(savedState.sent)
      ? savedState.sent
      : [];

    state.creditPoints = Math.max(
      0,
      Number(savedState.creditPoints) || 0
    );

    state.creditHistory = Array.isArray(savedState.creditHistory)
      ? savedState.creditHistory
      : [];

    /*
     * Defensive schema normalization prevents stale versions from injecting
     * arbitrary values into rendering code.
     */
    state.outbox = state.outbox.filter(
      (report) => report && typeof report.id === "string"
    );

    state.sent = state.sent.filter(
      (report) => report && typeof report.id === "string"
    );

    state.creditHistory = state.creditHistory.filter(
      (entry) => entry && typeof entry.id === "string"
    );
  }

  function updateStorageUI() {
    const label = $("#storage-status");
    const indicator = $("#storage-indicator");

    if (state.storageMode === "indexeddb") {
      if (label) {
        label.textContent = "IndexedDB aktif";
        label.className = "storage-ready";
      }

      if (indicator) {
        indicator.className = "status-dot status-dot-green";
      }

      return;
    }

    if (state.storageMode === "localstorage") {
      if (label) {
        label.textContent = "Fallback browser";
        label.className = "";
      }

      if (indicator) {
        indicator.className = "status-dot status-dot-amber";
      }

      return;
    }

    if (label) {
      label.textContent = "Memori sesi saja";
      label.className = "storage-error";
    }

    if (indicator) {
      indicator.className = "status-dot status-dot-red";
    }
  }

  function persistToLocalStorage(payload) {
    try {
      window.localStorage.setItem(
        CONFIG.localStorageKey,
        JSON.stringify(payload)
      );

      state.storageMode = "localstorage";
      updateStorageUI();
      return true;
    } catch (error) {
      state.storageMode = "memory";
      updateStorageUI();

      if (!state.storageWarningShown) {
        state.storageWarningShown = true;

        showToast({
          title: "Penyimpanan terbatas",
          message:
            "Browser menolak penyimpanan persisten. Data mungkin hilang jika halaman ditutup.",
          type: "warning",
          duration: 7000,
        });
      }

      return false;
    }
  }

  async function initializeStorage() {
    try {
      const database = await openDatabase();
      state.db = database;

      try {
        const savedState = await readDatabaseRecord(database);
        normalizeLoadedState(savedState);
      } catch (readError) {
        /*
         * A read failure must not prevent the rest of the UI from starting.
         * The next successful save may restore a usable database record.
         */
        console.warn("NUSA-AKSI: IndexedDB read failed.", readError);
      }

      state.storageMode = "indexeddb";
      updateStorageUI();

      return;
    } catch (databaseError) {
      console.warn(
        "NUSA-AKSI: IndexedDB unavailable; attempting fallback.",
        databaseError
      );
    }

    try {
      const raw = window.localStorage.getItem(CONFIG.localStorageKey);

      if (raw) {
        normalizeLoadedState(JSON.parse(raw));
      }

      state.storageMode = "localstorage";
    } catch (storageError) {
      console.warn("NUSA-AKSI: LocalStorage unavailable.", storageError);
      state.storageMode = "memory";
    }

    updateStorageUI();
  }

  async function persistState() {
    /*
     * Serialize persistence operations so rapid form updates cannot race.
     * Callers receive a promise and can wait for durability before resetting
     * the form or reporting local-save success.
     */
    state.persistPromise = state.persistPromise
      .catch(() => undefined)
      .then(async () => {
        if (state.db && state.storageMode === "indexeddb") {
          try {
            await writeDatabaseRecord(state.db, makeIndexedDBPayload());
            return true;
          } catch (databaseError) {
            console.error(
              "NUSA-AKSI: IndexedDB write failed.",
              databaseError
            );

            state.db = null;
            state.storageMode = "localstorage";
            updateStorageUI();
          }
        }

        const payload = makePersistedPayload();
        return persistToLocalStorage(payload);
      });

    return state.persistPromise;
  }

  /* ========================================================================
     04. LOCAL IDENTITY / CRYPTOGRAPHIC DEMONSTRATION
     ======================================================================== */

  /*
   * The following process illustrates local cryptographic computation only.
   *
   * It is not a zk-SNARK:
   *   - There is no arithmetic circuit.
   *   - There is no proving key or verification key.
   *   - There is no public statement / witness verification.
   *   - The generated digest does not prove that a NIK is valid.
   *
   * The random salt makes the demonstration output differ between runs.
   * It is discarded, and the NIK field is cleared immediately after reading.
   */

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);

    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
      return bytes;
    }

    /*
     * Non-cryptographic fallback, provided only to keep a classroom demo
     * running in restricted environments. It must never be treated as secure.
     */
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }

    return bytes;
  }

  async function digestForDemo(inputBytes) {
    if (window.crypto?.subtle?.digest) {
      const digest = await window.crypto.subtle.digest(
        "SHA-256",
        inputBytes
      );

      return new Uint8Array(digest);
    }

    /*
     * A deterministic fallback helps the interaction work in unsupported
     * browsers. It is NOT cryptographic and is labeled accordingly.
     */
    let hash = 2166136261;

    for (let index = 0; index < inputBytes.length; index += 1) {
      hash ^= inputBytes[index];
      hash = Math.imul(hash, 16777619);
    }

    const output = new Uint8Array(32);

    for (let index = 0; index < output.length; index += 1) {
      hash ^= hash >>> 13;
      hash = Math.imul(hash, 1274126177);
      output[index] = (hash >>> ((index % 4) * 8)) & 0xff;
    }

    return output;
  }

  function appendTerminalLine(message, className = "terminal-muted") {
    const terminal = $("#proof-terminal");

    if (!terminal) {
      return;
    }

    const line = createElement(
      "p",
      `terminal-line ${className}`
    );

    const prompt = createElement("span", "terminal-prompt", "›");
    line.append(prompt, document.createTextNode(` ${message}`));

    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
  }

  function clearTerminal() {
    const terminal = $("#proof-terminal");

    if (terminal) {
      terminal.replaceChildren();
    }
  }

  function updateProofProgress(percent, label) {
    const safePercent = clamp(Math.round(percent), 0, 100);

    setText("#proof-progress-percent", `${safePercent}%`);
    setText("#proof-progress-label", label);

    const bar = $("#proof-progress-bar");

    if (bar) {
      bar.style.width = `${safePercent}%`;
    }
  }

  async function runProofSimulation(nik) {
    if (state.proofGenerating) {
      return;
    }

    state.proofGenerating = true;

    const generateButton = $("#generate-proof-btn");
    const nikInput = $("#nik-input");
    const progress = $("#proof-progress");
    const result = $("#proof-result");
    const enterButton = $("#enter-dashboard-btn");

    if (generateButton) {
      generateButton.disabled = true;
    }

    setVisible(progress, true);
    setVisible(result, false);
    setVisible(enterButton, false);

    clearTerminal();

    appendTerminalLine(
      "LOCAL DEMONSTRATION MODE — no server endpoint configured",
      "terminal-warning"
    );

    await wait(CONFIG.terminalLineDelayMs);

    appendTerminalLine("Initializing local witness input...", "terminal-info");
    updateProofProgress(12, "Membaca input lokal...");

    await wait(CONFIG.terminalLineDelayMs);

    /*
     * Do not retain the NIK in the application state.
     * The value is passed only into this transient operation.
     */
    const temporarySalt = randomBytes(32);
    const encodedNik = new TextEncoder().encode(nik);
    const combinedInput = new Uint8Array(
      temporarySalt.length + encodedNik.length
    );

    combinedInput.set(temporarySalt, 0);
    combinedInput.set(encodedNik, temporarySalt.length);

    // Release the direct form value before performing the digest operation.
    if (nikInput) {
      nikInput.value = "";
    }

    appendTerminalLine(
      "Witness input loaded in the browser process.",
      "terminal-info"
    );

    updateProofProgress(29, "Menyiapkan input demo...");

    await wait(CONFIG.terminalLineDelayMs);

    const firstDigest = await digestForDemo(combinedInput);

    /*
     * Wipe best-effort transient buffers. JavaScript cannot guarantee that
     * every engine-level copy has been erased from physical memory.
     */
    combinedInput.fill(0);
    encodedNik.fill(0);
    temporarySalt.fill(0);

    appendTerminalLine(
      `Commitment candidate: 0x${bytesToHex(firstDigest).slice(0, 24)}...`,
      "terminal-info"
    );

    updateProofProgress(52, "Menghitung digest...");
    await wait(CONFIG.terminalLineDelayMs);

    const simulatedMerkleRoot = await digestForDemo(
      new TextEncoder().encode(
        `NUSA-AKSI-DEMO-MERKLE:${bytesToHex(randomBytes(16))}`
      )
    );

    appendTerminalLine(
      `Simulated Merkle root: 0x${bytesToHex(simulatedMerkleRoot).slice(0, 24)}...`,
      "terminal-info"
    );

    updateProofProgress(73, "Menyusun artefak demo...");
    await wait(CONFIG.terminalLineDelayMs);

    const finalInput = new Uint8Array(
      firstDigest.length + simulatedMerkleRoot.length
    );

    finalInput.set(firstDigest, 0);
    finalInput.set(simulatedMerkleRoot, firstDigest.length);

    const finalDigest = await digestForDemo(finalInput);

    firstDigest.fill(0);
    simulatedMerkleRoot.fill(0);
    finalInput.fill(0);

    /*
     * This value is a salted hash-like session token, not a proof that
     * establishes real-world identity or an anonymously verified credential.
     */
    state.proof = `0x${bytesToHex(finalDigest)}`;

    finalDigest.fill(0);

    appendTerminalLine(
      "Local digest computation finished.",
      "terminal-info"
    );

    updateProofProgress(92, "Menyiapkan hasil...");
    await wait(CONFIG.terminalLineDelayMs);

    appendTerminalLine(
      "DEMO ONLY: verifier and zk-SNARK circuit are not present.",
      "terminal-warning"
    );

    updateProofProgress(100, "Simulasi selesai.");

    const hashElement = $("#proof-hash");

    if (hashElement) {
      hashElement.textContent = state.proof;
    }

    setVisible(result, true);
    setVisible(enterButton, true);

    appendTerminalLine(
      "Session token generated in browser memory.",
      "terminal-success"
    );

    showToast({
      title: "Simulasi selesai",
      message:
        "Token demo dihasilkan secara lokal. Tidak ada NIK yang dikirim ke server.",
      type: "success",
    });

    state.proofGenerating = false;

    if (generateButton) {
      generateButton.disabled = false;
    }
  }

  function handleIdentitySubmit(event) {
    event.preventDefault();

    if (state.proofGenerating) {
      return;
    }

    const input = $("#nik-input");
    const error = $("#nik-error");
    const nik = input ? input.value.trim() : "";

    if (!/^\d{16}$/.test(nik)) {
      if (error) {
        error.textContent = "Masukkan tepat 16 digit angka untuk simulasi.";
        error.hidden = false;
      }

      if (input) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
      }

      showToast({
        title: "Format belum sesuai",
        message: "Input demonstrasi harus terdiri dari tepat 16 digit.",
        type: "warning",
      });

      return;
    }

    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    if (input) {
      input.removeAttribute("aria-invalid");
    }

    runProofSimulation(nik).catch((errorObject) => {
      console.error("NUSA-AKSI: Proof demonstration failed.", errorObject);

      state.proofGenerating = false;

      const generateButton = $("#generate-proof-btn");

      if (generateButton) {
        generateButton.disabled = false;
      }

      showToast({
        title: "Simulasi gagal",
        message:
          "Browser tidak dapat menyelesaikan proses digest. Coba ulangi di lingkungan yang mendukung Web Crypto.",
        type: "error",
        duration: 6500,
      });
    });
  }

  function enterDashboard() {
    if (!state.proof || !/^0x[0-9a-f]+$/i.test(state.proof)) {
      showToast({
        title: "Akses belum tersedia",
        message: "Jalankan simulasi verifikasi lokal terlebih dahulu.",
        type: "warning",
      });

      return;
    }

    state.authenticated = true;

    setVisible($("#auth-view"), false);
    setVisible($("#app-view"), true);

    setText(
      "#sidebar-proof-short",
      `${state.proof.slice(0, 8)}…${state.proof.slice(-5)}`
    );

    setText(
      "#topbar-proof-label",
      `${state.proof.slice(0, 8)}…${state.proof.slice(-4)}`
    );

    renderAll();
    switchView("dashboard");

    showToast({
      title: "Bale digital terbuka",
      message:
        "Sesi demo aktif. Ingat, token lokal ini bukan autentikasi anonim yang terverifikasi.",
      type: "success",
    });
  }

  function leaveSession() {
    /*
     * End the local session without affecting reports already saved in the
     * local database. The proof token is held only in application memory.
     */
    state.authenticated = false;
    state.proof = null;
    state.proofGenerating = false;

    clearAllToasts();

    setVisible($("#app-view"), false);
    setVisible($("#auth-view"), true);

    setVisible($("#proof-result"), false);
    setVisible($("#proof-progress"), false);
    setVisible($("#enter-dashboard-btn"), false);

    if ($("#nik-input")) {
      $("#nik-input").value = "";
    }

    if ($("#proof-hash")) {
      $("#proof-hash").textContent = "Belum tersedia";
    }

    clearTerminal();

    appendTerminalLine(
      "Local session closed. Waiting for new demo input...",
      "terminal-muted"
    );

    showToast({
      title: "Sesi lokal diakhiri",
      message: "Laporan tersimpan tetap berada di penyimpanan browser.",
      type: "info",
    });
  }

  /* ========================================================================
     05. SPA NAVIGATION
     ======================================================================== */

  const VIEW_CONFIG = Object.freeze({
    dashboard: {
      selector: "#view-dashboard",
      label: "Beranda Bale",
    },
    report: {
      selector: "#view-report",
      label: "Buat Laporan",
    },
    outbox: {
      selector: "#view-outbox",
      label: "Outbox Lokal",
    },
    feed: {
      selector: "#view-feed",
      label: "Suara Publik",
    },
    credits: {
      selector: "#view-credits",
      label: "Kredit Aksi",
    },
  });

  function closeSidebar() {
    const sidebar = $("#sidebar");

    if (sidebar) {
      sidebar.classList.remove("is-open");
    }

    const openButton = $("#open-sidebar-btn");

    if (openButton) {
      openButton.setAttribute("aria-expanded", "false");
    }
  }

  function switchView(viewName) {
    if (!state.authenticated) {
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(VIEW_CONFIG, viewName)) {
      return;
    }

    state.currentView = viewName;

    Object.entries(VIEW_CONFIG).forEach(([key, view]) => {
      const panel = $(view.selector);

      if (!panel) {
        return;
      }

      const active = key === viewName;

      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });

    $$(".nav-item[data-view]").forEach((button) => {
      const active = button.dataset.view === viewName;

      button.classList.toggle("active", active);

      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    setText("#current-page-label", VIEW_CONFIG[viewName].label);

    closeSidebar();

    if (viewName === "dashboard") {
      renderDashboard();
    }

    if (viewName === "report") {
      updateReportSummary();
      updateSubmitAvailability();
    }

    if (viewName === "outbox") {
      renderOutbox();
    }

    if (viewName === "feed") {
      renderFeed();
    }

    if (viewName === "credits") {
      renderCredits();
    }

    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  function handleNavigationClick(event) {
    const navigation = event.target.closest("[data-view]");
    const shortcut = event.target.closest("[data-goto]");

    if (navigation) {
      event.preventDefault();
      switchView(navigation.dataset.view);
      return;
    }

    if (shortcut) {
      event.preventDefault();
      switchView(shortcut.dataset.goto);
    }
  }

  /* ========================================================================
     06. REPORT WIZARD — 5W1H STRUCTURE
     ======================================================================== */

  function currentStepElement() {
    return $(`#wizard-step-${state.wizardStep}`);
  }

  function goToWizardStep(stepNumber) {
    const targetStep = clamp(Number(stepNumber) || 1, 1, 3);

    state.wizardStep = targetStep;

    [1, 2, 3].forEach((step) => {
      const content = $(`#wizard-step-${step}`);
      const indicator = $(`[data-step-indicator="${step}"]`);

      if (content) {
        content.hidden = step !== targetStep;
      }

      if (indicator) {
        indicator.classList.toggle("active", step === targetStep);
        indicator.classList.toggle("completed", step < targetStep);

        if (step === targetStep) {
          indicator.setAttribute("aria-current", "step");
        } else {
          indicator.removeAttribute("aria-current");
        }
      }
    });

    setText(
      "#summary-status",
      state.online
        ? "Tersimpan lokal sebelum simulasi"
        : "Tersimpan lokal setelah dikirim"
    );

    updateReportSummary();
    updateSubmitAvailability();

    const content = currentStepElement();

    if (content) {
      const heading = content.querySelector("h2");

      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
  }

  function markFieldValidity(field, valid) {
    if (valid) {
      field.removeAttribute("aria-invalid");
    } else {
      field.setAttribute("aria-invalid", "true");
    }
  }

  function validateStepOne() {
    const step = $("#wizard-step-1");
    const errorBox = $("#step1-error");

    if (!step) {
      return false;
    }

    const requiredFields = $$("[required]", step);
    let firstInvalid = null;

    requiredFields.forEach((field) => {
      const value = String(field.value || "").trim();
      const valid = value.length > 0 && field.checkValidity();

      markFieldValidity(field, valid);

      if (!valid && !firstInvalid) {
        firstInvalid = field;
      }
    });

    if (firstInvalid) {
      if (errorBox) {
        errorBox.textContent =
          "Lengkapi semua unsur 5W1H dan judul sebelum melanjutkan.";
        errorBox.hidden = false;
      }

      firstInvalid.focus();

      return false;
    }

    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }

    return true;
  }

  function validateStepThree() {
    const narrative = $("#report-narrative");
    const errorBox = $("#step3-error");

    if (!narrative) {
      return false;
    }

    const narrativeValue = narrative.value.trim();
    const hasRequiredLength =
      narrativeValue.length >= CONFIG.minNarrativeLength;

    const checks = [
      $("#check-factual"),
      $("#check-respectful"),
      $("#check-solution"),
    ];

    const allChecksPassed = checks.every((checkbox) => checkbox?.checked);

    const remaining = Math.max(
      0,
      state.cooldownEndsAt - Date.now()
    );

    if (state.isEmotional) {
      if (errorBox) {
        errorBox.textContent =
          "Bahasa perlu ditinjau ulang. Revisi narasi dan selesaikan jeda refleksi.";
        errorBox.hidden = false;
      }

      updateSubmitAvailability();
      return false;
    }

    if (remaining > 0) {
      if (errorBox) {
        errorBox.textContent =
          "Jeda refleksi masih berlangsung. Tunggu hingga hitung mundur selesai.";
        errorBox.hidden = false;
      }

      updateSubmitAvailability();
      return false;
    }

    if (!hasRequiredLength || !allChecksPassed) {
      if (errorBox) {
        const missingParts = [];

        if (!hasRequiredLength) {
          missingParts.push(
            `narasi minimal ${CONFIG.minNarrativeLength} karakter`
          );
        }

        if (!allChecksPassed) {
          missingParts.push("semua checklist refleksi");
        }

        errorBox.textContent =
          `Lengkapi ${missingParts.join(" dan ")} sebelum menyimpan laporan.`;

        errorBox.hidden = false;
      }

      if (!hasRequiredLength) {
        narrative.setAttribute("aria-invalid", "true");
        narrative.focus();
      } else {
        checks.find((checkbox) => !checkbox?.checked)?.focus();
      }

      updateSubmitAvailability();
      return false;
    }

    narrative.removeAttribute("aria-invalid");

    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }

    return true;
  }

  function collectReportFields() {
    const coordinates = state.coordinates
      ? {
          lat: state.coordinates.lat,
          lng: state.coordinates.lng,
        }
      : null;

    return {
      id: makeId("report"),
      title: $("#report-title").value.trim(),
      category: $("#report-category").value,
      who: $("#report-who").value.trim(),
      what: $("#report-what").value.trim(),
      when: $("#report-when").value,
      location: $("#report-location-text").value.trim(),
      why: $("#report-why").value.trim(),
      how: $("#report-how").value.trim(),
      narrative: $("#report-narrative").value.trim(),

      coordinates,

      imageBlob: state.photoBlob,
      photoName: state.photoFileName,
      originalPhotoSize: state.originalPhotoSize,
      compressedPhotoSize: state.compressedPhotoSize,

      createdAt: new Date().toISOString(),
      status: "pending",
      syncMode: "local-simulation",
    };
  }

  function clearWizardErrors() {
    ["#step1-error", "#step2-error", "#step3-error"].forEach((selector) => {
      const element = $(selector);

      if (element) {
        element.hidden = true;
        element.textContent = "";
      }
    });

    $$("#report-form [aria-invalid='true']").forEach((field) => {
      field.removeAttribute("aria-invalid");
    });
  }

  function resetWizard() {
    const form = $("#report-form");

    if (form) {
      form.reset();
    }

    clearWizardErrors();

    state.coordinates = null;
    state.photoBlob = null;
    state.photoFileName = "";
    state.originalPhotoSize = 0;
    state.compressedPhotoSize = 0;
    state.submitting = false;

    state.isEmotional = false;
    state.nudgeTriggered = false;
    state.cooldownEndsAt = 0;
    state.nudgeModalShown = false;

    cleanupPreviewObjectUrl();

    const pin = $("#map-pin");

    if (pin) {
      pin.style.left = "50%";
      pin.style.top = "50%";
    }

    setText("#map-coordinates", "Belum ada titik dipilih");
    setText("#title-count", "0 / 120");
    setText("#narrative-count", "0 / 4000");

    setVisible($("#photo-preview-panel"), false);
    setVisible($("#compression-progress"), false);
    setVisible($("#compression-result"), false);
    setVisible($("#nudge-alert"), false);
    setVisible($("#emotion-modal"), false);

    const narrative = $("#report-narrative");

    if (narrative) {
      narrative.classList.remove("is-emotional", "is-constructive");
    }

    const scanner = $("#scanner-indicator");

    if (scanner) {
      scanner.classList.remove("scanner-warning");
      scanner.innerHTML =
        '<span class="status-dot status-dot-green"></span> PEMERIKSAAN AKTIF';
    }

    const dropzone = $("#upload-dropzone");

    if (dropzone) {
      dropzone.classList.remove("is-dragging");
    }

    const photoInput = $("#report-photo");

    if (photoInput) {
      photoInput.value = "";
    }

    const image = $("#photo-preview");

    if (image) {
      image.removeAttribute("src");
    }

    if ($("#report-when")) {
      $("#report-when").value = localDateISO();
    }

    setText(
      "#nudge-alert-message",
      "Emosi terdeteksi. Tarik napas. Sampaikan keluhan Anda secara rasional untuk perubahan nyata."
    );

    goToWizardStep(1);
    updateSubmitAvailability();
  }

  async function handleReportSubmit(event) {
    event.preventDefault();

    if (state.submitting) {
      return;
    }

    if (!state.proof || !state.authenticated) {
      showToast({
        title: "Sesi tidak aktif",
        message: "Buka sesi demo terlebih dahulu.",
        type: "error",
      });

      return;
    }

    /*
     * A final validation is required even if the user has already visited
     * every step; a back-navigation could have invalidated earlier answers.
     */
    if (!validateStepOne()) {
      goToWizardStep(1);
      return;
    }

    if (!validateStepThree()) {
      goToWizardStep(3);
      return;
    }

    state.submitting = true;
    updateSubmitAvailability();

    const submitButton = $("#submit-report-btn");

    if (submitButton) {
      submitButton.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Menyimpan lokal...</span>';
    }

    const report = collectReportFields();

    try {
      state.outbox.unshift(report);

      /*
       * Persistence is awaited before acknowledging the save. If the
       * browser rejects persistence, the report remains in in-memory state,
       * but the UI must not claim durable storage.
       */
      const persisted = await persistState();

      renderAll();

      resetWizard();
      switchView("outbox");

      if (state.online) {
        showToast({
          title: "Laporan disimpan lokal",
          message:
            "Laporan masuk ke antrean perangkat. Simulasi sinkronisasi akan berjalan.",
          type: "info",
        });

        window.dispatchEvent(new Event("nusa:backgroundsync"));
      } else if (persisted) {
        showToast({
          title: "Saved Locally",
          message: "Will sync when signal returns",
          type: "success",
          duration: 6200,
        });
      } else {
        showToast({
          title: "Laporan ada di memori sesi",
          message:
            "Penyimpanan permanen gagal. Jangan tutup halaman sebelum data diekspor atau dipulihkan.",
          type: "warning",
          duration: 7500,
        });
      }
    } catch (error) {
      console.error("NUSA-AKSI: Unable to save report.", error);

      showToast({
        title: "Penyimpanan gagal",
        message:
          "Terjadi kesalahan ketika membuat antrean laporan. Periksa penyimpanan browser dan coba lagi.",
        type: "error",
        duration: 6500,
      });
    } finally {
      state.submitting = false;
      updateSubmitAvailability();
    }
  }

  /* ========================================================================
     07. IMAGE VALIDATION & CLIENT-SIDE COMPRESSION
     ======================================================================== */

  /*
   * The browser decodes the image, scales it down on a canvas and produces
   * a compressed Blob. This reduces local storage requirements.
   *
   * Limitations:
   *   - Compression is not an image-forensics process.
   *   - Some source formats and color profiles may be transformed.
   *   - Metadata stripping depends on browser decoding/encoding behavior.
   *   - A file's MIME type and extension cannot prove that it is benign.
   */

  function cleanupPreviewObjectUrl() {
    if (state.previewObjectUrl) {
      URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = null;
    }
  }

  function updateCompressionProgress(percent, label) {
    setText("#compression-progress-label", label);

    const bar = $("#compression-progress-bar");

    if (bar) {
      bar.style.width = `${clamp(percent, 0, 100)}%`;
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas encoding did not return a Blob."));
            return;
          }

          resolve(blob);
        },
        type,
        quality
      );
    });
  }

  async function compressImage(file) {
    if (typeof createImageBitmap !== "function") {
      return {
        blob: file,
        width: null,
        height: null,
        compressionApplied: false,
      };
    }

    let bitmap;

    try {
      bitmap = await createImageBitmap(file);

      const sourceWidth = bitmap.width;
      const sourceHeight = bitmap.height;

      if (!sourceWidth || !sourceHeight) {
        throw new Error("Image dimensions are invalid.");
      }

      const scale = Math.min(
        1,
        CONFIG.maxImageDimension / Math.max(sourceWidth, sourceHeight)
      );

      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      });

      if (!context) {
        throw new Error("Canvas 2D context is unavailable.");
      }

      context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      let compressedBlob;

      try {
        compressedBlob = await canvasToBlob(
          canvas,
          "image/webp",
          CONFIG.imageQuality
        );
      } catch {
        compressedBlob = await canvasToBlob(
          canvas,
          "image/jpeg",
          CONFIG.imageQuality
        );
      }

      /*
       * If recompression would make the file larger, preserve the original
       * rather than making a larger "compressed" artifact.
       */
      const finalBlob =
        compressedBlob.size < file.size ? compressedBlob : file;

      canvas.width = 1;
      canvas.height = 1;

      return {
        blob: finalBlob,
        width: targetWidth,
        height: targetHeight,
        compressionApplied: finalBlob !== file,
      };
    } finally {
      if (bitmap && typeof bitmap.close === "function") {
        bitmap.close();
      }
    }
  }

  async function choosePhoto(file) {
    if (!file) {
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      showToast({
        title: "Format tidak didukung",
        message: "Pilih gambar JPG, PNG, atau WEBP.",
        type: "warning",
      });

      return;
    }

    if (file.size > CONFIG.maxOriginalImageBytes) {
      showToast({
        title: "Ukuran file terlalu besar",
        message:
          `Pilih gambar maksimum ${formatBytes(CONFIG.maxOriginalImageBytes)} sebelum kompresi.`,
        type: "warning",
      });

      return;
    }

    const progressPanel = $("#compression-progress");
    const resultPanel = $("#compression-result");

    setVisible(progressPanel, true);
    setVisible(resultPanel, false);

    updateCompressionProgress(8, "Memvalidasi gambar...");

    try {
      /*
       * The app does not upload the file. Processing takes place in memory,
       * inside the current browser tab.
       */
      await wait(110);

      updateCompressionProgress(36, "Mempersiapkan kompresi...");

      const compressed = await compressImage(file);

      state.photoBlob = compressed.blob;
      state.photoFileName = file.name;
      state.originalPhotoSize = file.size;
      state.compressedPhotoSize = compressed.blob.size;

      cleanupPreviewObjectUrl();

      state.previewObjectUrl = URL.createObjectURL(compressed.blob);

      const preview = $("#photo-preview");

      if (preview) {
        preview.src = state.previewObjectUrl;
        preview.alt = `Pratinjau lokal ${file.name}`;
      }

      setText("#photo-file-name", file.name);

      setText(
        "#photo-file-meta",
        `${formatBytes(file.size)} · ${compressed.width && compressed.height ? `${compressed.width} × ${compressed.height}` : "Dimensi tidak tersedia"}`
      );

      updateCompressionProgress(100, "Pemrosesan selesai.");

      if (resultPanel) {
        const difference = file.size - compressed.blob.size;
        const reducedPercent =
          file.size > 0
            ? Math.max(0, (difference / file.size) * 100)
            : 0;

        resultPanel.textContent = compressed.compressionApplied
          ? `Ukuran lokal berkurang ${reducedPercent.toFixed(1)}% (${formatBytes(file.size)} → ${formatBytes(compressed.blob.size)}).`
          : `Ukuran akhir ${formatBytes(compressed.blob.size)}; file asli dipertahankan karena kompresi tidak menghasilkan file yang lebih kecil.`;

        setVisible(resultPanel, true);
      }

      setVisible($("#photo-preview-panel"), true);

      showToast({
        title: "Gambar siap",
        message:
          "Pratinjau berada di perangkat ini. Gambar belum diunggah ke server.",
        type: "success",
      });
    } catch (error) {
      console.error("NUSA-AKSI: Image processing failed.", error);

      state.photoBlob = null;
      state.photoFileName = "";
      state.originalPhotoSize = 0;
      state.compressedPhotoSize = 0;

      cleanupPreviewObjectUrl();

      setVisible($("#photo-preview-panel"), false);

      showToast({
        title: "Gambar tidak dapat diproses",
        message:
          "Coba file gambar lain yang valid dan berukuran lebih kecil.",
        type: "error",
      });
    } finally {
      setVisible(progressPanel, false);
      updateReportSummary();
    }
  }

  function removePhoto() {
    state.photoBlob = null;
    state.photoFileName = "";
    state.originalPhotoSize = 0;
    state.compressedPhotoSize = 0;

    cleanupPreviewObjectUrl();

    const input = $("#report-photo");
    const preview = $("#photo-preview");

    if (input) {
      input.value = "";
    }

    if (preview) {
      preview.removeAttribute("src");
    }

    setVisible($("#photo-preview-panel"), false);
    setVisible($("#compression-progress"), false);
    setVisible($("#compression-result"), false);

    updateReportSummary();

    showToast({
      title: "Foto dihapus",
      message: "Gambar tidak akan dimasukkan ke laporan.",
      type: "info",
    });
  }

  function handleDropzoneDragOver(event) {
    event.preventDefault();

    const zone = $("#upload-dropzone");

    if (zone) {
      zone.classList.add("is-dragging");
    }
  }

  function handleDropzoneDragLeave(event) {
    event.preventDefault();

    const zone = $("#upload-dropzone");

    if (zone && !zone.contains(event.relatedTarget)) {
      zone.classList.remove("is-dragging");
    }
  }

  function handleDropzoneDrop(event) {
    event.preventDefault();

    const zone = $("#upload-dropzone");

    if (zone) {
      zone.classList.remove("is-dragging");
    }

    const file = event.dataTransfer?.files?.[0];

    if (file) {
      choosePhoto(file);
    }
  }

  /* ========================================================================
     08. SIMULATED MAP / LOCATION INPUT
     ======================================================================== */

  /*
   * The map is deliberately synthetic. Coordinates are computed from the
   * click position around an approximate NTT region; they are NOT a location
   * lookup, a geofence, a remote map request or the user's actual GPS.
   */

  function handleMapClick(event) {
    const map = $("#report-map");
    const pin = $("#map-pin");

    if (!map || !pin) {
      return;
    }

    const bounds = map.getBoundingClientRect();

    const normalizedX = clamp(
      (event.clientX - bounds.left) / bounds.width,
      0.08,
      0.92
    );

    const normalizedY = clamp(
      (event.clientY - bounds.top) / bounds.height,
      0.12,
      0.88
    );

    const lat = -8.5 + (0.5 - normalizedY) * 1.5;
    const lng = 120.9 + (normalizedX - 0.5) * 2.2;

    state.coordinates = {
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      synthetic: true,
    };

    pin.style.left = `${normalizedX * 100}%`;
    pin.style.top = `${normalizedY * 100}%`;

    setText(
      "#map-coordinates",
      `${state.coordinates.lat.toFixed(5)}, ${state.coordinates.lng.toFixed(5)} · DEMO`
    );

    updateReportSummary();
  }

  /* ========================================================================
     09. NUDGE THEORY — LIVE SENTIMENT / TOXICITY HEURISTIC
     ======================================================================== */

  /*
   * Academic rationale:
   *
   * Nudge Theory proposes changing the decision environment while preserving
   * agency. A short delay and a constructive-writing prompt are intended to
   * encourage a reflective review instead of an impulsive reaction.
   *
   * This implementation is intentionally modest:
   *   - It only checks a small regex-based keyword list.
   *   - It flags certain all-caps patterns.
   *   - It does not infer a person's emotional state.
   *   - It cannot judge sarcasm, quotations, cultural context or truth.
   *
   * In particular, "hancur" may describe a physical condition, not abuse.
   * A real deployment should use transparent policy, user appeals, human
   * oversight and careful false-positive testing before blocking speech.
   *
   * The 10-second delay is a UI intervention, not a security control.
   */

  function scanNarrative(text) {
    const value = String(text || "");
    const matchedWords = [];
    let match;

    /*
     * Reset lastIndex because the global regular expression is reused.
     */
    TOXIC_WORD_PATTERN.lastIndex = 0;

    while ((match = TOXIC_WORD_PATTERN.exec(value)) !== null) {
      matchedWords.push(match[0].toLowerCase());

      /*
       * Defensive guard in case a browser ever reports a zero-width match.
       */
      if (match.index === TOXIC_WORD_PATTERN.lastIndex) {
        TOXIC_WORD_PATTERN.lastIndex += 1;
      }
    }

    const lettersOnly = value.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || [];
    const uppercaseLetters = value.match(/[A-ZÀ-ÖØ-Þ]/g) || [];

    const uppercaseRatio =
      lettersOnly.length > 0
        ? uppercaseLetters.length / lettersOnly.length
        : 0;

    const uppercasePhrasePattern =
      /\b[A-ZÀ-ÖØ-Þ]{5,}(?:\s+[A-ZÀ-ÖØ-Þ]{3,}){1,}\b/;

    const hasUppercaseSpam =
      lettersOnly.length >= 14 &&
      uppercaseRatio >= 0.68 &&
      uppercasePhrasePattern.test(value);

    const isEmotional =
      matchedWords.length > 0 || hasUppercaseSpam;

    return {
      isEmotional,
      matchedWords: [...new Set(matchedWords)],
      hasUppercaseSpam,
      uppercaseRatio,
    };
  }

  function getRemainingCooldownMs() {
    return Math.max(0, state.cooldownEndsAt - Date.now());
  }

  function showEmotionModal() {
    const modal = $("#emotion-modal");

    if (!modal || state.nudgeModalShown) {
      return;
    }

    state.nudgeModalShown = true;
    state.returnFocusElement = $("#report-narrative");

    setVisible(modal, true);

    setText(
      "#modal-countdown",
      Math.ceil(getRemainingCooldownMs() / 1000)
    );

    const closeButton = $("#close-emotion-modal");

    if (closeButton) {
      closeButton.focus({ preventScroll: true });
    }
  }

  function closeEmotionModal(restoreFocus = true) {
    setVisible($("#emotion-modal"), false);

    if (
      restoreFocus &&
      state.returnFocusElement &&
      state.returnFocusElement.isConnected
    ) {
      state.returnFocusElement.focus({ preventScroll: true });
    }
  }

  function beginReflectiveDelay() {
    state.nudgeTriggered = true;
    state.cooldownEndsAt = Date.now() + CONFIG.reflectiveDelayMs;

    showEmotionModal();

    showToast({
      title: "Jeda refleksi diaktifkan",
      message:
        "Emosi terdeteksi. Tarik napas. Sampaikan keluhan Anda secara rasional untuk perubahan nyata.",
      type: "warning",
      duration: 6500,
    });
  }

  function resetNudgeStateAfterCooldown() {
    state.nudgeTriggered = false;
    state.cooldownEndsAt = 0;
    state.nudgeModalShown = false;

    setVisible($("#nudge-alert"), false);

    const narrative = $("#report-narrative");

    if (narrative && !state.isEmotional) {
      narrative.classList.remove("is-emotional");
    }
  }

  function updateNudgeDisplay(scanResult) {
    const narrative = $("#report-narrative");
    const alert = $("#nudge-alert");
    const countdown = $("#nudge-countdown");
    const scanner = $("#scanner-indicator");
    const message = $("#nudge-alert-message");

    const remaining = getRemainingCooldownMs();
    const cooldownActive = remaining > 0;

    if (narrative) {
      narrative.classList.toggle(
        "is-emotional",
        scanResult.isEmotional
      );

      narrative.classList.toggle(
        "is-constructive",
        !scanResult.isEmotional &&
          narrative.value.trim().length >= CONFIG.minNarrativeLength
      );
    }

    if (scanner) {
      scanner.classList.toggle(
        "scanner-warning",
        scanResult.isEmotional || cooldownActive
      );

      scanner.innerHTML = "";

      const dot = createElement(
        "span",
        `status-dot ${
          scanResult.isEmotional || cooldownActive
            ? "status-dot-amber"
            : "status-dot-green"
        }`
      );

      scanner.appendChild(dot);

      scanner.appendChild(
        document.createTextNode(
          scanResult.isEmotional
            ? "PERLU DITINJAU"
            : cooldownActive
              ? "JEDA REFLEKSI"
              : "PEMERIKSAAN AKTIF"
        )
      );
    }

    const shouldShowAlert =
      scanResult.isEmotional || (state.nudgeTriggered && cooldownActive);

    setVisible(alert, shouldShowAlert);

    if (message && shouldShowAlert) {
      message.textContent =
        "Emosi terdeteksi. Tarik napas. Sampaikan keluhan Anda secara rasional untuk perubahan nyata.";
    }

    if (countdown && shouldShowAlert) {
      countdown.textContent = cooldownActive
        ? `${Math.ceil(remaining / 1000)}s`
        : scanResult.isEmotional
          ? "TINJAU"
          : "SELESAI";
    }

    setText(
      "#modal-countdown",
      Math.ceil(remaining / 1000)
    );
  }

  function updateSubmitAvailability() {
    const submitButton = $("#submit-report-btn");
    const helpText = $("#submit-button-help");
    const narrative = $("#report-narrative");

    if (!submitButton || !narrative) {
      return;
    }

    const narrativeText = narrative.value.trim();
    const longEnough =
      narrativeText.length >= CONFIG.minNarrativeLength;

    const allChecksPassed = [
      $("#check-factual"),
      $("#check-respectful"),
      $("#check-solution"),
    ].every((checkbox) => checkbox?.checked);

    const cooldownActive = getRemainingCooldownMs() > 0;

    const canSubmit =
      !state.submitting &&
      !state.isEmotional &&
      !cooldownActive &&
      longEnough &&
      allChecksPassed;

    submitButton.disabled = !canSubmit;

    if (helpText) {
      helpText.classList.remove("is-warning", "is-success");

      if (state.isEmotional) {
        helpText.textContent =
          "Revisi bahasa terlebih dahulu. Tombol penyimpanan dinonaktifkan untuk sementara.";
        helpText.classList.add("is-warning");
      } else if (cooldownActive) {
        helpText.textContent =
          `Jeda refleksi: ${Math.ceil(getRemainingCooldownMs() / 1000)} detik tersisa.`;
        helpText.classList.add("is-warning");
      } else if (!longEnough) {
        helpText.textContent =
          `Narasi minimal ${CONFIG.minNarrativeLength} karakter agar konteks lebih jelas.`;
      } else if (!allChecksPassed) {
        helpText.textContent =
          "Centang ketiga pernyataan refleksi untuk melanjutkan.";
      } else {
        helpText.textContent =
          "Narasi siap disimpan secara lokal pada perangkat ini.";
        helpText.classList.add("is-success");
      }
    }
  }

  function handleNarrativeInput() {
    const narrative = $("#report-narrative");

    if (!narrative) {
      return;
    }

    const text = narrative.value;
    const scanResult = scanNarrative(text);

    state.isEmotional = scanResult.isEmotional;

    if (state.isEmotional && !state.nudgeTriggered) {
      beginReflectiveDelay();
    }

    /*
     * The delay does not reset on every keystroke. Repeated typing cannot
     * infinitely extend the same cooldown, but the submit button stays
     * disabled while a flagged pattern remains in the current narrative.
     */
    if (
      !state.isEmotional &&
      state.nudgeTriggered &&
      getRemainingCooldownMs() === 0
    ) {
      resetNudgeStateAfterCooldown();
    }

    updateNudgeDisplay(scanResult);
    updateSubmitAvailability();
    updateReportSummary();

    setText(
      "#narrative-count",
      `${text.length} / ${CONFIG.maxNarrativeLength}`
    );
  }

  function handleChecklistChange() {
    updateSubmitAvailability();
  }

  function handleNudgeTimerTick() {
    if (!state.authenticated) {
      return;
    }

    const narrative = $("#report-narrative");

    if (!narrative || state.currentView !== "report") {
      return;
    }

    const scanResult = scanNarrative(narrative.value);

    if (
      !scanResult.isEmotional &&
      state.nudgeTriggered &&
      getRemainingCooldownMs() === 0
    ) {
      resetNudgeStateAfterCooldown();
    }

    updateNudgeDisplay(scanResult);
    updateSubmitAvailability();
  }

  function initializeNudgeTimer() {
    if (state.nudgeInterval !== null) {
      window.clearInterval(state.nudgeInterval);
    }

    /*
     * A short UI tick updates the countdown. It performs no network calls,
     * no persistent tracking and no background surveillance.
     */
    state.nudgeInterval = window.setInterval(
      handleNudgeTimerTick,
      250
    );
  }

  /* ========================================================================
     10. OFFLINE OUTBOX / SIMULATED BACKGROUND SYNC
     ======================================================================== */

  /*
   * The prototype uses an application event named "nusa:backgroundsync".
   *
   * This is an event-driven simulation, not navigator.serviceWorker,
   * Background Sync API registration, Push API delivery or server transport.
   *
   * The report first enters IndexedDB. When the connectivity simulator is
   * switched to ONLINE, records move from outbox[] to sent[] locally.
   */

  function updateNetworkUI() {
    const label = $("#network-label");
    const dot = $("#network-dot");
    const pill = $("#network-pill");
    const button = $("#network-toggle");
    const banner = $("#offline-banner");

    if (!label || !pill || !button) {
      return;
    }

    label.textContent = state.online ? "ONLINE" : "OFFLINE";

    pill.classList.toggle("is-offline", !state.online);

    if (dot) {
      dot.className = state.online
        ? "status-dot status-dot-green"
        : "status-dot status-dot-amber";
    }

    button.classList.toggle("network-offline", !state.online);
    button.setAttribute("aria-pressed", String(!state.online));

    const icon = button.querySelector("i");
    const text = button.querySelector("span");

    if (icon) {
      icon.className = state.online
        ? "fa-solid fa-wifi"
        : "fa-solid fa-wifi-slash";
      icon.setAttribute("aria-hidden", "true");
    }

    if (text) {
      text.textContent = state.online
        ? "Simulasikan Offline"
        : "Simulasikan Online";
    }

    if (button) {
      button.setAttribute(
        "aria-label",
        state.online
          ? "Simulasikan koneksi offline"
          : "Simulasikan koneksi online"
      );
    }

    setVisible(banner, !state.online);

    setText(
      "#summary-status",
      state.online
        ? "Lokal dahulu; sync disimulasikan"
        : "Lokal; menunggu sinyal demo"
    );
  }

  function toggleNetwork() {
    if (state.syncing) {
      showToast({
        title: "Sinkronisasi sedang berlangsung",
        message:
          "Biarkan simulasi antrean selesai agar perpindahan status tetap konsisten.",
        type: "info",
      });

      return;
    }

    state.networkMode = "simulated";
    state.online = !state.online;

    updateNetworkUI();
    renderDashboard();

    showToast({
      title: state.online ? "Simulasi ONLINE" : "Simulasi OFFLINE",
      message: state.online
        ? "Antrean lokal akan diproses melalui simulasi Background Sync."
        : "Laporan tetap dapat disimpan secara lokal tanpa sinyal.",
      type: state.online ? "success" : "warning",
    });

    if (state.online) {
      window.dispatchEvent(new Event("nusa:backgroundsync"));
    }
  }

  function createCreditHistoryEntry(report) {
    return {
      id: makeId("credit"),
      reportId: report.id,
      title: report.title,
      points: CONFIG.pointsPerSimulatedReport,
      createdAt: new Date().toISOString(),
      reason: "Laporan selesai dalam simulasi sinkronisasi.",
    };
  }

  function awardCreditForReport(report) {
    const historyEntry = createCreditHistoryEntry(report);

    state.creditPoints += historyEntry.points;
    state.creditHistory.unshift(historyEntry);

    return historyEntry;
  }

  async function syncPendingReports({ silent = false } = {}) {
    if (state.syncing) {
      return;
    }

    if (!state.online) {
      if (!silent) {
        showToast({
          title: "Belum ada koneksi simulasi",
          message:
            "Ubah mode jaringan ke ONLINE sebelum menjalankan simulasi sinkronisasi.",
          type: "warning",
        });
      }

      return;
    }

    if (state.outbox.length === 0) {
      if (!silent) {
        showToast({
          title: "Outbox sudah kosong",
          message: "Tidak ada laporan yang menunggu sinkronisasi simulasi.",
          type: "info",
        });
      }

      return;
    }

    state.syncing = true;

    const initialQueue = [...state.outbox];
    const total = initialQueue.length;
    let processed = 0;

    const manualButton = $("#manual-sync-btn");
    const overlay = $("#sync-overlay");

    if (manualButton) {
      manualButton.disabled = true;
    }

    setVisible(overlay, true);
    setText("#sync-overlay-title", "Memproses antrean lokal...");
    setText(
      "#sync-overlay-message",
      "Menjalankan perpindahan data dalam browser; tidak ada server tujuan."
    );
    setText("#sync-progress-label", "0%");

    const progressBar = $("#sync-progress-bar");

    if (progressBar) {
      progressBar.style.width = "0%";
    }

    try {
      /*
       * Process the initial snapshot serially. This avoids simultaneous
       * duplicate award/sync operations in a single browser tab.
       */
      for (const report of initialQueue) {
        if (!state.online) {
          break;
        }

        await wait(CONFIG.syncDelayMs);

        const index = state.outbox.findIndex(
          (pending) => pending.id === report.id
        );

        if (index === -1) {
          continue;
        }

        const [record] = state.outbox.splice(index, 1);

        record.status = "simulated-sent";
        record.simulatedSentAt = new Date().toISOString();

        state.sent.unshift(record);

        const creditEntry = awardCreditForReport(record);

        /*
         * Persist each moved report. The success state is only a local
         * state transition; no HTTP upload or government handoff occurs.
         */
        const persisted = await persistState();

        processed += 1;

        const percent = Math.round((processed / total) * 100);

        if (progressBar) {
          progressBar.style.width = `${percent}%`;
        }

        setText("#sync-progress-label", `${percent}%`);

        setText(
          "#sync-overlay-title",
          `Laporan ${processed} dari ${total}`
        );

        setText(
          "#sync-overlay-message",
          `Simulasi selesai untuk "${record.title}". +${creditEntry.points} XP lokal.`
        );

        if (!persisted) {
          setText(
            "#sync-overlay-message",
            "Perpindahan selesai di memori sesi, tetapi penyimpanan persisten tidak tersedia."
          );
        }
      }

      setText("#sync-overlay-title", "Simulasi antrean selesai");
      setText(
        "#sync-overlay-message",
        `${processed} laporan dipindahkan ke riwayat lokal. Tidak ada laporan yang dikirim ke server.`
      );

      setText("#sync-progress-label", `${processed}/${total}`);

      if (progressBar) {
        progressBar.style.width =
          `${total > 0 ? Math.round((processed / total) * 100) : 100}%`;
      }

      await wait(380);
    } catch (error) {
      console.error("NUSA-AKSI: Simulated sync failed.", error);

      showToast({
        title: "Simulasi sinkronisasi terganggu",
        message:
          "Periksa penyimpanan browser. Beberapa laporan mungkin sudah dipindahkan secara lokal.",
        type: "error",
        duration: 6500,
      });
    } finally {
      state.syncing = false;

      setVisible(overlay, false);

      if (manualButton) {
        manualButton.disabled = false;
      }

      renderAll();

      if (processed > 0) {
        showToast({
          title: "Simulasi sinkronisasi selesai",
          message:
            `${processed} laporan berpindah ke riwayat lokal. Kredit simulasi telah diperbarui; tidak ada server yang menerima laporan.`,
          type: "success",
          duration: 6500,
        });
      }
    }
  }

  function handleManualSync() {
    window.dispatchEvent(new Event("nusa:backgroundsync"));
  }

  async function deletePendingReport(reportId) {
    const report = state.outbox.find((item) => item.id === reportId);

    if (!report) {
      return;
    }

    /*
     * Confirm destructive local data removal. There is no corresponding
     * server-side deletion because the prototype has no backend.
     */
    const confirmed = window.confirm(
      `Hapus laporan "${report.title}" dari antrean lokal?\n\nTindakan ini tidak dapat dibatalkan.`
    );

    if (!confirmed) {
      return;
    }

    state.outbox = state.outbox.filter(
      (item) => item.id !== reportId
    );

    await persistState();

    renderAll();

    showToast({
      title: "Laporan lokal dihapus",
      message: "Entri telah dihapus dari antrean perangkat.",
      type: "info",
    });
  }

  /* ========================================================================
     11. CIVIC CREDIT / GAMIFICATION
     ======================================================================== */

  function getCurrentRank(points = state.creditPoints) {
    let currentRank = RANKS[0];

    for (const rank of RANKS) {
      if (points >= rank.threshold) {
        currentRank = rank;
      }
    }

    const currentIndex = RANKS.findIndex(
      (rank) => rank.name === currentRank.name
    );

    const nextRank = RANKS[currentIndex + 1] || null;

    const progressStart = currentRank.threshold;
    const progressEnd = nextRank
      ? nextRank.threshold
      : currentRank.threshold;

    const progressPercent = nextRank
      ? clamp(
          ((points - progressStart) /
            (progressEnd - progressStart)) *
            100,
          0,
          100
        )
      : 100;

    return {
      currentRank,
      nextRank,
      currentIndex,
      progressStart,
      progressEnd,
      progressPercent,
      points,
    };
  }

  function renderCredits() {
    const rankData = getCurrentRank();

    setText("#credits-badge-name", rankData.currentRank.name);
    setText(
      "#credits-badge-description",
      rankData.currentRank.description
    );

    setText("#credits-total-value", state.creditPoints);

    setText(
      "#credits-next-level-label",
      rankData.nextRank
        ? `Menuju ${rankData.nextRank.name}`
        : "Puncak tingkat simulasi"
    );

    setText(
      "#credits-progress-label",
      rankData.nextRank
        ? `${state.creditPoints} / ${rankData.progressEnd} XP`
        : `${state.creditPoints} XP · Tingkat tertinggi`
    );

    const creditsBar = $("#credits-progress-bar");

    if (creditsBar) {
      creditsBar.style.width = `${rankData.progressPercent}%`;
    }

    setText("#dashboard-badge-name", rankData.currentRank.name);
    setText(
      "#dashboard-badge-description",
      rankData.currentRank.description
    );

    const dashboardNextThreshold = rankData.nextRank
      ? rankData.progressEnd
      : state.creditPoints;

    setText(
      "#dashboard-credit-progress-label",
      rankData.nextRank
        ? `${state.creditPoints} / ${dashboardNextThreshold} XP`
        : `${state.creditPoints} XP`
    );

    const dashboardBar = $("#dashboard-credit-progress");

    if (dashboardBar) {
      dashboardBar.style.width =
        `${rankData.progressPercent}%`;
    }

    setText("#stat-credit-points", state.creditPoints);

    $$(".rank-card").forEach((card) => {
      const cardRankIndex = Number(card.dataset.rank) - 1;

      card.classList.toggle(
        "is-current",
        cardRankIndex === rankData.currentIndex
      );

      card.classList.toggle(
        "is-unlocked",
        cardRankIndex < rankData.currentIndex
      );

      card.setAttribute(
        "aria-label",
        cardRankIndex === rankData.currentIndex
          ? `${RANKS[cardRankIndex].name}, tingkat aktif`
          : RANKS[cardRankIndex].name
      );
    });

    renderCreditHistory();
  }

  function renderCreditHistory() {
    const container = $("#credit-history-list");

    if (!container) {
      return;
    }

    container.replaceChildren();

    if (state.creditHistory.length === 0) {
      container.appendChild(
        createEmptyState(
          "fa-award",
          "Belum ada riwayat kredit.",
          "Kredit simulasi akan muncul setelah sebuah laporan melewati proses sinkronisasi demo."
        )
      );

      return;
    }

    state.creditHistory.forEach((entry) => {
      const item = createElement("article", "credit-history-item");
      const icon = createElement("span", "credit-history-icon");
      const copy = createElement("div", "credit-history-copy");
      const title = createElement(
        "strong",
        "",
        entry.title || "Kontribusi warga"
      );

      const meta = createElement(
        "small",
        "",
        `${formatDateTime(entry.createdAt)} · ${entry.reason || "Kredit lokal"}`
      );

      const points = createElement(
        "span",
        "credit-history-points",
        `+${Number(entry.points) || 0} XP`
      );

      icon.appendChild(createIcon("fa-seedling"));
      copy.append(title, meta);
      item.append(icon, copy, points);

      container.appendChild(item);
    });
  }

  /* ========================================================================
     12. DEMONSTRATION FEED / DOM-SAFE RENDERING
     ======================================================================== */

  function createEmptyState(icon, title, description) {
    const wrapper = createElement("div", "empty-state");
    const iconWrap = createElement("div", "empty-state-icon");
    const heading = createElement("h3", "", title);
    const paragraph = createElement("p", "", description);

    iconWrap.appendChild(createIcon(icon));
    wrapper.append(iconWrap, heading, paragraph);

    return wrapper;
  }

  function publicRecordFromReport(report) {
    return {
      id: report.id,
      title: report.title,
      category: report.category,
      location: report.location || "Lokasi tidak dicantumkan",
      summary: report.narrative || report.what || "Ringkasan tidak tersedia.",
      createdAt: report.simulatedSentAt || report.createdAt,
      isDemo: false,
      source: "local-report",
    };
  }

  function getCombinedFeed() {
    const localSentReports = state.sent.map(publicRecordFromReport);

    /*
     * Demo data is explicitly fictional. User-created reports appear only
     * inside this browser's local demonstration feed after local sync.
     */
    return [...localSentReports, ...DEMO_FEED].sort((first, second) => {
      return (
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime()
      );
    });
  }

  function createCommunityCard(record) {
    const card = createElement("article", "community-card");
    const top = createElement("div", "community-card-top");
    const symbol = createElement("span", "community-card-symbol");
    const tag = createElement(
      "span",
      `report-status-tag ${record.isDemo ? "demo" : "sent"}`,
      record.isDemo ? "DEMO FIKTIF" : "LOKAL · DEMO"
    );

    const heading = createElement("h3", "", record.title);

    const description = createElement(
      "p",
      "community-card-description",
      record.summary
    );

    const category = createElement(
      "span",
      "report-category-tag",
      record.category || "Lainnya"
    );

    const footer = createElement("div", "community-card-footer");

    const location = createElement("span");
    location.append(
      createIcon("fa-location-dot"),
      document.createTextNode(record.location || "Lokasi tidak tersedia")
    );

    const date = createElement("span");
    date.append(
      createIcon("fa-calendar-day"),
      document.createTextNode(formatDate(record.createdAt))
    );

    symbol.appendChild(createIcon(categoryIcon(record.category)));
    top.append(symbol, tag);
    footer.append(location, date);

    card.append(top, category, heading, description, footer);

    return card;
  }

  function renderFeed({ preview = false } = {}) {
    const allRecords = getCombinedFeed();

    const searchQuery = ($("#feed-search-input")?.value || "")
      .trim()
      .toLowerCase();

    const categoryFilter = $("#feed-category-filter")?.value || "";

    const filtered = allRecords.filter((record) => {
      const searchable = [
        record.title,
        record.category,
        record.location,
        record.summary,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !searchQuery || searchable.includes(searchQuery);

      const matchesCategory =
        !categoryFilter || record.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });

    if (preview) {
      const container = $("#dashboard-feed-preview");

      if (!container) {
        return;
      }

      container.replaceChildren();

      filtered.slice(0, 3).forEach((record) => {
        container.appendChild(createCommunityCard(record));
      });

      return;
    }

    const container = $("#feed-list");
    const emptyState = $("#feed-empty-state");

    if (!container) {
      return;
    }

    container.replaceChildren();

    filtered.forEach((record) => {
      container.appendChild(createCommunityCard(record));
    });

    setVisible(emptyState, filtered.length === 0);
  }

  /* ========================================================================
     13. REPORT LIST RENDERING
     ======================================================================== */

  function cleanupListObjectUrls(container) {
    if (!container) {
      return;
    }

    const urls = state.listObjectUrls.get(container) || [];

    urls.forEach((url) => URL.revokeObjectURL(url));

    state.listObjectUrls.set(container, []);
  }

  function registerListObjectUrl(container, blob) {
    if (!container || !(blob instanceof Blob)) {
      return null;
    }

    const url = URL.createObjectURL(blob);
    const urls = state.listObjectUrls.get(container) || [];

    urls.push(url);
    state.listObjectUrls.set(container, urls);

    return url;
  }

  function createReportItem(report, { allowDelete = false } = {}) {
    const item = createElement("article", "report-item");
    const iconWrap = createElement("div", "report-item-icon");
    const main = createElement("div", "report-item-main");
    const top = createElement("div", "report-item-top");
    const title = createElement("h3", "report-item-title", report.title);
    const statusWrap = createElement("span", "report-status-tag");
    const meta = createElement("div", "report-item-meta");

    const status = report.status || "pending";

    statusWrap.classList.add(
      status === "pending" ? "pending" : "sent"
    );

    statusWrap.textContent =
      status === "pending"
        ? "MENUNGGU SYNC"
        : "SIMULASI TERKIRIM";

    iconWrap.appendChild(createIcon(categoryIcon(report.category)));

    top.append(title, statusWrap);

    const category = createElement("span");
    category.append(
      createIcon("fa-layer-group"),
      document.createTextNode(report.category || "Lainnya")
    );

    const location = createElement("span");
    location.append(
      createIcon("fa-location-dot"),
      document.createTextNode(report.location || "Lokasi tidak dicantumkan")
    );

    const createdDate = createElement("span");
    createdDate.append(
      createIcon("fa-calendar-day"),
      document.createTextNode(formatDateTime(report.createdAt))
    );

    meta.append(category, location, createdDate);

    main.append(top, meta);

    if (report.what) {
      main.appendChild(
        createElement(
          "p",
          "report-item-description",
          report.what
        )
      );
    }

    const actions = createElement("div", "report-item-actions");

    if (allowDelete && status === "pending") {
      const deleteButton = createElement(
        "button",
        "icon-button report-delete-button"
      );

      deleteButton.type = "button";
      deleteButton.setAttribute("aria-label", "Hapus laporan lokal");
      deleteButton.title = "Hapus dari antrean lokal";
      deleteButton.appendChild(createIcon("fa-trash"));

      deleteButton.addEventListener("click", () => {
        deletePendingReport(report.id);
      });

      actions.appendChild(deleteButton);
    }

    if (report.imageBlob instanceof Blob) {
      const imageUrl = registerListObjectUrl(
        actions,
        report.imageBlob
      );

      if (imageUrl) {
        const image = createElement("img", "report-thumbnail");
        image.src = imageUrl;
        image.alt = "Foto pendukung lokal";
        image.loading = "lazy";

        item.append(iconWrap, main, image, actions);
        return item;
      }
    }

    item.append(iconWrap, main, actions);

    return item;
  }

  function renderReportList(containerSelector, reports, options = {}) {
    const container = $(containerSelector);

    if (!container) {
      return;
    }

    cleanupListObjectUrls(container);
    container.replaceChildren();

    const limit = Number.isFinite(options.limit)
      ? options.limit
      : reports.length;

    const visibleReports = reports.slice(0, limit);

    if (visibleReports.length === 0) {
      container.appendChild(
        createEmptyState(
          options.emptyIcon || "fa-folder-open",
          options.emptyTitle || "Belum ada laporan.",
          options.emptyDescription ||
            "Laporan yang dibuat di wizard akan muncul di sini."
        )
      );

      return;
    }

    visibleReports.forEach((report) => {
      container.appendChild(
        createReportItem(report, {
          allowDelete: Boolean(options.allowDelete),
        })
      );
    });
  }

  function renderOutbox() {
    renderReportList("#outbox-list", state.outbox, {
      allowDelete: true,
      emptyIcon: "fa-box-open",
      emptyTitle: "Outbox masih kosong.",
      emptyDescription:
        "Laporan yang dibuat ketika koneksi simulasi OFFLINE akan muncul di sini.",
    });

    renderReportList("#sent-reports-list", state.sent, {
      emptyIcon: "fa-circle-check",
      emptyTitle: "Belum ada riwayat simulasi terkirim.",
      emptyDescription:
        "Ubah jaringan ke ONLINE untuk memindahkan antrean melalui simulasi lokal.",
    });

    setText("#outbox-count-heading", state.outbox.length);
    setText("#sent-count-heading", state.sent.length);
    setText("#outbox-nav-count", state.outbox.length);
  }

  function renderDashboard() {
    const totalReports = state.outbox.length + state.sent.length;

    setText("#stat-total-reports", totalReports);
    setText("#stat-pending-reports", state.outbox.length);
    setText("#stat-credit-points", state.creditPoints);

    setText("#outbox-nav-count", state.outbox.length);

    const recent = [
      ...state.outbox,
      ...state.sent,
    ].sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    renderReportList("#dashboard-recent-list", recent, {
      limit: 3,
      emptyIcon: "fa-file-circle-plus",
      emptyTitle: "Belum ada laporan.",
      emptyDescription:
        "Mulai dari pengamatan nyata dan susun konteks 5W1H.",
    });

    renderFeed({ preview: true });
    renderCredits();
    updateNetworkUI();
  }

  function renderAll() {
    updateStorageUI();
    updateNetworkUI();
    renderDashboard();
    renderOutbox();
    renderFeed();
    renderCredits();
    updateReportSummary();
    updateSubmitAvailability();
  }

  /* ========================================================================
     14. LIVE REPORT SUMMARY
     ======================================================================== */

  function updateReportSummary() {
    const title = $("#report-title")?.value.trim();
    const category = $("#report-category")?.value;
    const location = $("#report-location-text")?.value.trim();

    setText(
      "#summary-title",
      title || "Belum diisi"
    );

    setText(
      "#summary-category",
      category || "Belum dipilih"
    );

    setText(
      "#summary-location",
      location || "Belum diisi"
    );

    setText(
      "#summary-photo",
      state.photoBlob
        ? `${state.photoFileName || "Foto"} · ${formatBytes(state.compressedPhotoSize)}`
        : "Belum ada foto"
    );

    setText(
      "#title-count",
      `${$("#report-title")?.value.length || 0} / ${CONFIG.maxTitleLength}`
    );

    /*
     * Keep the status wording aligned with the current simulated connectivity.
     */
    setText(
      "#summary-status",
      state.online
        ? "Lokal dahulu; sync disimulasikan"
        : "Lokal; menunggu sinyal demo"
    );
  }

  function bindSummaryInputs() {
    [
      "#report-title",
      "#report-category",
      "#report-location-text",
    ].forEach((selector) => {
      const element = $(selector);

      if (element) {
        element.addEventListener("input", updateReportSummary);
        element.addEventListener("change", updateReportSummary);
      }
    });
  }

  /* ========================================================================
     15. EVENT WIRING
     ======================================================================== */

  function bindIdentityEvents() {
    const form = $("#identity-form");

    if (form) {
      form.addEventListener("submit", handleIdentitySubmit);
    }

    const visibilityButton = $("#toggle-nik-visibility");

    if (visibilityButton) {
      visibilityButton.addEventListener("click", () => {
        const input = $("#nik-input");

        if (!input) {
          return;
        }

        const shouldReveal = input.type === "password";

        input.type = shouldReveal ? "text" : "password";

        visibilityButton.setAttribute(
          "aria-pressed",
          String(shouldReveal)
        );

        visibilityButton.setAttribute(
          "aria-label",
          shouldReveal ? "Sembunyikan NIK" : "Tampilkan NIK"
        );

        const icon = visibilityButton.querySelector("i");

        if (icon) {
          icon.className = shouldReveal
            ? "fa-regular fa-eye-slash"
            : "fa-regular fa-eye";
        }
      });
    }

    const input = $("#nik-input");

    if (input) {
      input.addEventListener("input", () => {
        const error = $("#nik-error");

        if (error && input.value.length <= CONFIG.maxNIKLength) {
          error.hidden = true;
          error.textContent = "";
        }

        input.removeAttribute("aria-invalid");
      });

      input.addEventListener("paste", (event) => {
        /*
         * Pasting can be convenient for test data. The handler does not
         * copy the value to logs or persistent storage.
         */
        if (event.clipboardData) {
          const pastedValue = event.clipboardData.getData("text");

          if (!/^\d{1,16}$/.test(pastedValue.trim())) {
            event.preventDefault();

            showToast({
              title: "Format tidak sesuai",
              message:
                "Untuk simulasi, gunakan angka saja dengan panjang maksimum 16 digit.",
              type: "warning",
            });
          }
        }
      });
    }

    const enterButton = $("#enter-dashboard-btn");

    if (enterButton) {
      enterButton.addEventListener("click", enterDashboard);
    }

    const leaveButton = $("#leave-session-btn");

    if (leaveButton) {
      leaveButton.addEventListener("click", leaveSession);
    }
  }

  function bindNavigationEvents() {
    document.addEventListener("click", handleNavigationClick);

    const openButton = $("#open-sidebar-btn");
    const closeButton = $("#close-sidebar-btn");

    if (openButton) {
      openButton.addEventListener("click", () => {
        const sidebar = $("#sidebar");

        if (!sidebar) {
          return;
        }

        sidebar.classList.add("is-open");
        openButton.setAttribute("aria-expanded", "true");
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", closeSidebar);
    }

    document.addEventListener("click", (event) => {
      const sidebar = $("#sidebar");
      const openMenuButton = $("#open-sidebar-btn");

      if (
        !sidebar ||
        !sidebar.classList.contains("is-open") ||
        sidebar.contains(event.target) ||
        openMenuButton?.contains(event.target)
      ) {
        return;
      }

      closeSidebar();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeEmotionModal();
        closeSidebar();
      }
    });
  }

  function bindNetworkEvents() {
    const networkButton = $("#network-toggle");
    const manualButton = $("#manual-sync-btn");

    if (networkButton) {
      networkButton.addEventListener("click", toggleNetwork);
    }

    if (manualButton) {
      manualButton.addEventListener("click", handleManualSync);
    }

    window.addEventListener("nusa:backgroundsync", () => {
      syncPendingReports({ silent: false });
    });

    /*
     * Actual browser connectivity can update the indicator until the user
     * takes control of the simulator. It still does not guarantee that the
     * app has a server endpoint or any online service.
     */
    window.addEventListener("online", () => {
      if (state.networkMode !== "browser") {
        return;
      }

      state.online = true;
      updateNetworkUI();

      window.dispatchEvent(new Event("nusa:backgroundsync"));
    });

    window.addEventListener("offline", () => {
      if (state.networkMode !== "browser") {
        return;
      }

      state.online = false;
      updateNetworkUI();
      renderDashboard();
    });
  }

  function bindWizardEvents() {
    const reportForm = $("#report-form");

    if (reportForm) {
      reportForm.addEventListener("submit", handleReportSubmit);
    }

    $$("[data-next]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetStep = Number(button.dataset.next);

        if (state.wizardStep === 1 && !validateStepOne()) {
          return;
        }

        goToWizardStep(targetStep);
      });
    });

    $$("[data-back]").forEach((button) => {
      button.addEventListener("click", () => {
        goToWizardStep(Number(button.dataset.back));
      });
    });

    const narrative = $("#report-narrative");

    if (narrative) {
      narrative.addEventListener("input", handleNarrativeInput);
    }

    [
      "#check-factual",
      "#check-respectful",
      "#check-solution",
    ].forEach((selector) => {
      const checkbox = $(selector);

      if (checkbox) {
        checkbox.addEventListener("change", handleChecklistChange);
      }
    });

    /*
     * Remove stale validation indicators while users edit their answers.
     */
    $$("#report-form input, #report-form textarea, #report-form select").forEach(
      (field) => {
        field.addEventListener("input", () => {
          if (field.hasAttribute("aria-invalid")) {
            field.removeAttribute("aria-invalid");
          }
        });

        field.addEventListener("change", () => {
          if (field.hasAttribute("aria-invalid")) {
            field.removeAttribute("aria-invalid");
          }
        });
      }
    );

    const resetButton = $("#report-form button[type='reset']");

    if (resetButton) {
      resetButton.addEventListener("click", () => {
        window.setTimeout(resetWizard, 0);
      });
    }

    const map = $("#report-map");

    if (map) {
      map.addEventListener("click", handleMapClick);
    }
  }

  function bindUploadEvents() {
    const input = $("#report-photo");
    const chooseButton = $("#choose-photo-btn");
    const removeButton = $("#remove-photo-btn");
    const zone = $("#upload-dropzone");

    if (chooseButton && input) {
      chooseButton.addEventListener("click", () => {
        input.click();
      });
    }

    if (input) {
      input.addEventListener("change", () => {
        choosePhoto(input.files?.[0]);
      });
    }

    if (removeButton) {
      removeButton.addEventListener("click", removePhoto);
    }

    if (zone) {
      zone.addEventListener("dragover", handleDropzoneDragOver);
      zone.addEventListener("dragleave", handleDropzoneDragLeave);
      zone.addEventListener("drop", handleDropzoneDrop);

      /*
       * Prevent the browser from navigating away when a file is dropped
       * over the page rather than the upload zone.
       */
      ["dragover", "drop"].forEach((eventName) => {
        document.addEventListener(eventName, (event) => {
          if (
            eventName === "drop" &&
            !event.target.closest("#upload-dropzone")
          ) {
            event.preventDefault();
          }

          if (eventName === "dragover") {
            event.preventDefault();
          }
        });
      });
    }
  }

  function bindFeedEvents() {
    const search = $("#feed-search-input");
    const filter = $("#feed-category-filter");

    if (search) {
      search.addEventListener("input", () => renderFeed());
    }

    if (filter) {
      filter.addEventListener("change", () => renderFeed());
    }
  }

  function bindModalEvents() {
    const closeButton = $("#close-emotion-modal");

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        closeEmotionModal(true);
      });
    }

    const backdrop = $("#emotion-modal");

    if (backdrop) {
      backdrop.addEventListener("click", (event) => {
        /*
         * Clicking outside the dialog only closes it. The cooldown and
         * submit gate remain in place regardless of modal visibility.
         */
        if (event.target === backdrop) {
          closeEmotionModal(true);
        }
      });
    }
  }

  /* ========================================================================
     16. BOOTSTRAP / APPLICATION INITIALIZATION
     ======================================================================== */

  async function initializeApplication() {
    bindIdentityEvents();
    bindNavigationEvents();
    bindNetworkEvents();
    bindWizardEvents();
    bindUploadEvents();
    bindSummaryInputs();
    bindFeedEvents();
    bindModalEvents();

    /*
     * Set the report date and counters before storage is restored.
     */
    const reportDate = $("#report-when");

    if (reportDate && !reportDate.value) {
      reportDate.value = localDateISO();
    }

    setText("#title-count", `0 / ${CONFIG.maxTitleLength}`);
    setText(
      "#narrative-count",
      `0 / ${CONFIG.maxNarrativeLength}`
    );

    updateNetworkUI();
    updateReportSummary();
    initializeNudgeTimer();

    /*
     * Restore only reports, credits and history. The identity proof remains
     * in memory and must be generated again after a new page load.
     */
    await initializeStorage();

    renderAll();

    /*
     * The app is intentionally not registered as a Service Worker. The
     * three-file deliverable simulates background sync after the document
     * loads. Reliable offline shell installation would need a separate
     * service-worker script, a manifest and a tested cache strategy.
     */
    if (!window.isSecureContext) {
      showToast({
        title: "Lingkungan demonstrasi",
        message:
          "Web Crypto dan beberapa PWA API bergantung pada konteks aman. Jalankan lewat localhost atau HTTPS untuk pengujian yang lebih konsisten.",
        type: "info",
        duration: 7500,
      });
    }

    if (!("indexedDB" in window)) {
      showToast({
        title: "IndexedDB tidak tersedia",
        message:
          "Aplikasi menggunakan fallback browser jika tersedia. Data foto tidak dijamin tersimpan setelah halaman ditutup.",
        type: "warning",
        duration: 7000,
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeApplication,
      { once: true }
    );
  } else {
    initializeApplication();
  }
})();